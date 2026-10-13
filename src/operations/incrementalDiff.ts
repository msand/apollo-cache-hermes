import type { Cache, DiffIncrementalInfo } from '@apollo/client/cache';
import {
  DeepMerger,
  getDirectiveArgValue,
  getMainDefinition,
  hasDirectives,
  isDeferredFragment,
  isStreamField,
  resultKeyNameFromField,
  shouldInclude,
} from '@apollo/client/utilities/internal';
import { InvariantError } from '@apollo/client/utilities/invariant';
import isEqual from '@wry/equality';
import type {
  DocumentNode,
  FieldNode,
  FragmentDefinitionNode,
  InlineFragmentNode,
  Kind,
  SelectionNode,
  SelectionSetNode,
} from 'graphql';

import type { JsonObject, JsonValue, PathPart } from '../primitive';
import { fragmentMapForDocument, isSelectedByCaller, someSelection } from '../util';
import type { FragmentMap } from '../util';

import type { QueryResult } from './read';
import { toDiffResult } from './read';

/**
 * The incremental (`@defer`/`@stream`) read semantics of InMemoryCache's
 * StoreReader#diffQueryAgainstStore (Apollo Client 4.3), applied to the result
 * of a Hermes read.
 *
 * Hermes reads a query from its graph as it always has (see read.ts); this
 * module then walks the query's selection sets (with their fragments, which
 * Hermes' parsed queries flatten away) over that result to classify it:
 *
 * - `complete`: every selected field has data.
 * - `streaming`: the only missing data lies in `@defer` boundaries that have
 *   nothing yet (or that the network has not delivered: `deferInfo`), or in
 *   `@stream` lists.
 * - `partial`: other selected fields are missing (or `@defer` boundaries hold
 *   partial data, while partial data is requested).
 * - `empty`: nothing usable.
 *
 * When partial data is not requested, data inside partial `@defer` boundaries
 * (and boundaries still pending according to `deferInfo`) is pruned from the
 * result, as are `@stream` list items that have not streamed yet, so that the
 * result is "streaming" rather than partial.
 *
 * Unlike InMemoryCache's results, Hermes' results can be supersets of the
 * selection (e.g. other fields of the same entities). Pruning only narrows the
 * objects where data in a pruned boundary is dropped, and only drops the fields
 * that the selection set selects: fields it does not select at all are kept.
 */

type DataState =
  // no data
  | 'empty'
  // at least 1 non-deferred field is partial
  | 'partial'
  // at least 1 defer boundary is partial. All non-incremental fields complete
  | 'deferPartial'
  // at least 1 stream boundary is partial. All non-incremental fields complete
  | 'streamPartial'
  // All defer boundaries are complete or empty (but not partial) or all stream
  // boundaries are complete (but not partial)
  | 'streaming'
  // All fields have data
  | 'complete';

/** What incrementalDiff needs to know about the operation being read. */
export interface IncrementalDiffOperation {
  /** The (transformed) document read. */
  document: DocumentNode;
  /** The variables of the read, with their defaults. */
  variables: Record<string, unknown>;
  /** The __typename of the object the read starts at, when it has none of its own. */
  rootTypename: string | undefined;
  /** Whether a fragment applies to objects of the given __typename. */
  fragmentMatches(fragment: InlineFragmentNode | FragmentDefinitionNode, typename: string): boolean;
  /** A fragment of the fragment registry. */
  lookupFragment(fragmentName: string): FragmentDefinitionNode | null;
}

type StreamInfo = NonNullable<DiffIncrementalInfo['streamInfo']>;
type DeferInfo = NonNullable<DiffIncrementalInfo['deferInfo']>;

/** The result of classifying (part of) a result against a selection set. */
interface ExecResult {
  dataState: DataState;
  boundaries: PartialBoundaries;
}

/** The result of pruning (part of) a result. */
interface PruneResult {
  result: JsonValue | undefined;
  dataState: DataState;
  /**
   * Checks that the incremental info consulted while pruning (stream positions
   * and pending @defer boundaries) is unchanged, so that the result can be
   * reused.
   */
  deps: (() => boolean)[];
}

interface ReadContext {
  operation: IncrementalDiffOperation;
  /** Fragment definitions by name (from the document, then the registry). */
  lookupFragment(fragmentName: string): FragmentDefinitionNode;
  variables: Record<string, unknown>;
  /** A stable key for the variables. */
  varKey: string;
  streamInfo: StreamInfo | undefined;
  deferInfo: DeferInfo | undefined;
  /** Whether the results being pruned are frozen (so pruned results are too). */
  freeze: boolean;
}

/**
 * Kind.STRING (Hermes uses graphql for its types only: Apollo Client, its
 * peer dependency, brings it).
 */
const STRING_VALUE = 'StringValue' as Kind.STRING;

const incrementalDirectives = new WeakMap<DocumentNode, boolean>();
const fragmentMaps = new WeakMap<DocumentNode, FragmentMap>();

/** Whether a document uses @defer or @stream. */
function hasIncrementalDirectives(document: DocumentNode): boolean {
  let has = incrementalDirectives.get(document);
  if (has === undefined) {
    has = hasDirectives(['defer', 'stream'], document);
    incrementalDirectives.set(document, has);
  }
  return has;
}

/**
 * The diff of a Hermes read for ApolloCache#diff called with Apollo Client's
 * `[handleIncrementalSymbol]` option, with its `dataState` (like
 * InMemoryCache's).
 *
 * `document` is the (transformed) document read; `getOperation` describes
 * the rest of the operation, when its @defer/@stream boundaries need a look.
 */
export function incrementalDiff<TData>(
  queryResult: QueryResult,
  document: DocumentNode,
  getOperation: () => IncrementalDiffOperation,
  returnPartialData = true,
  incrementalInfo: DiffIncrementalInfo | undefined,
): Cache.InternalDiffResultWithDataState<TData> {
  const { streamInfo, deferInfo } = incrementalInfo ?? {};
  const needsWalk = hasIncrementalDirectives(document) && (!queryResult.complete || !!streamInfo || !!deferInfo);
  if (!needsWalk) {
    // Without @defer/@stream boundaries (or with all their data present), the
    // data state follows from the completeness of the read, like
    // InMemoryCache's.
    const diff = toDiffResult<TData>(queryResult, returnPartialData);
    const dataState = diff.complete ? 'complete' : diff.result === null ? 'empty' : 'partial';
    return Object.assign(diff, { dataState }) as Cache.InternalDiffResultWithDataState<TData>;
  }

  const operation = getOperation();
  const data = queryResult.result ?? {};
  let fragmentMap = fragmentMaps.get(document);
  if (!fragmentMap) fragmentMaps.set(document, (fragmentMap = fragmentMapForDocument(document)));
  const context: ReadContext = {
    operation,
    lookupFragment(fragmentName) {
      const fragment = fragmentMap![fragmentName] ?? operation.lookupFragment(fragmentName);
      if (!fragment) throw new InvariantError(`No fragment named ${fragmentName}`);
      return fragment;
    },
    variables: operation.variables,
    varKey: JSON.stringify(operation.variables),
    streamInfo,
    deferInfo,
    freeze: Object.isFrozen(data),
  };
  const { selectionSet } = getMainDefinition(document);
  const exec = executeSelectionSet(selectionSet, data, operation.rootTypename, context);

  let { dataState } = exec;
  // The fields Hermes found missing are part of the selection; never report
  // an incomplete read as complete.
  if (!queryResult.complete && dataState === 'complete') dataState = 'partial';
  let result: JsonObject = data;
  let pruned = false;

  const scope = rootScope(document, selectionSet);
  if (shouldPrune(dataState, incrementalInfo)) {
    const prunedResult = prunePartialBoundaries(selectionSet, data, exec.boundaries, scope, [], context);
    // Like InMemoryCache: if pruning dropped data while partial data is
    // requested, keep the partial result. Otherwise the pruned result (which
    // does not report missing fields) stands.
    if (prunedResult.result === data || !returnPartialData) {
      result = prunedResult.result as JsonObject;
      dataState = prunedResult.dataState;
      pruned = true;
    }
  }

  // Missing fields inside @defer boundaries are expected while streaming.
  const includeMissing = !pruned && dataState !== 'streaming';

  // Like InMemoryCache's results (which only hold selected fields), a result
  // without any of the fields selected at its root is empty. (Hermes' results
  // can hold other fields of the root object.)
  const hasData = selectsAnyKey(scope, result, context);
  // If all root @defer boundaries are empty, the result is empty.
  if (dataState === 'streaming' && !hasData) dataState = 'empty';
  if (dataState === 'deferPartial' || dataState === 'streamPartial') dataState = 'partial';
  if (dataState === 'partial' && !returnPartialData) dataState = 'empty';

  const complete = dataState === 'complete';
  const keepResult = complete || dataState === 'streaming' || (returnPartialData && hasData);

  return {
    result: keepResult ? (result as any) : null,
    complete,
    // Like InMemoryCache, missing is a getter (and the error is built lazily).
    get missing() {
      return includeMissing ? queryResult.missing : undefined;
    },
    dataState,
  } as Cache.InternalDiffResultWithDataState<TData>;
}

/** Whether a result has a value for any field that the selection sets of `scope` select. */
function selectsAnyKey(scope: Scope, result: JsonObject, context: ReadContext): boolean {
  for (const key of selectedKeys(scope, context).responseKeys) {
    if (Object.prototype.hasOwnProperty.call(result, key)) return true;
  }
  return false;
}

function shouldPrune(dataState: DataState, incrementalInfo: DiffIncrementalInfo | undefined): boolean {
  if (dataState === 'deferPartial' || dataState === 'streamPartial') return true;
  if (dataState === 'complete' || dataState === 'streaming') {
    // The network has not delivered these @defer boundaries (or @stream items)
    // yet, so prune the (possibly complete) cached data sitting at them.
    return !!(incrementalInfo?.streamInfo || incrementalInfo?.deferInfo);
  }
  return false;
}

// Classification (InMemoryCache's executeSelectionSet/executeSubSelectedArray).

/**
 * A tree of memoized values, keyed by sequences of keys (held weakly when they
 * are objects).
 */
interface Memo<T> {
  weak?: WeakMap<object, Memo<T>>;
  strong?: Map<unknown, Memo<T>>;
  value?: T;
}

function memoNode<T>(memo: Memo<T>, keys: readonly unknown[]): Memo<T> {
  let node = memo;
  for (const key of keys) {
    let next: Memo<T> | undefined;
    if (key !== null && typeof key === 'object') {
      node.weak ??= new WeakMap();
      next = node.weak.get(key);
      if (!next) node.weak.set(key, (next = {}));
    } else {
      node.strong ??= new Map();
      next = node.strong.get(key);
      if (!next) node.strong.set(key, (next = {}));
    }
    node = next;
  }
  return node;
}

/**
 * Memoized classifications, by document, result object, selection set (or
 * list field), variables and (for the object read from, which may have no
 * __typename of its own) root __typename. Hermes' reads share unchanged
 * objects between results, so this keeps their PartialBoundaries (and so their
 * pruned results) stable.
 *
 * (Like InMemoryCache's, these are not invalidated when possibleTypes or the
 * fragment registry change at runtime.)
 */
const execMemo: Memo<ExecResult> = {};

function cachedExec(
  context: ReadContext,
  value: object,
  node: SelectionSetNode | FieldNode,
  rootTypename: string | undefined,
  compute: () => ExecResult,
): ExecResult {
  const memo = memoNode(execMemo, [context.operation.document, value, node, context.varKey, rootTypename]);
  return (memo.value ??= compute());
}

function executeSelectionSet(
  selectionSet: SelectionSetNode,
  value: JsonObject,
  rootTypename: string | undefined,
  context: ReadContext,
): ExecResult {
  return cachedExec(context, value, selectionSet, rootTypename, () =>
    execSelectionSetImpl(selectionSet, value, rootTypename, context),
  );
}

/** Whether a fragment applies to an object of type `typename`. */
function fragmentApplies(
  fragment: InlineFragmentNode | FragmentDefinitionNode,
  typename: unknown,
  context: ReadContext,
): boolean {
  if (!fragment.typeCondition) return true;
  // Like Hermes' reads, fragments apply to objects of unknown type.
  if (typeof typename !== 'string') return true;
  return context.operation.fragmentMatches(fragment, typename);
}

function fragmentOf(selection: SelectionNode, context: ReadContext) {
  if (selection.kind === 'InlineFragment') return selection;
  if (selection.kind === 'FragmentSpread') return context.lookupFragment(selection.name.value);
  return undefined;
}

/** The selection set of a fragment (by name), for someSelection. */
function fragmentSelectionSet(context: ReadContext) {
  return (fragmentName: string) => context.lookupFragment(fragmentName).selectionSet;
}

function execSelectionSetImpl(
  selectionSet: SelectionSetNode,
  value: JsonObject,
  rootTypename: string | undefined,
  context: ReadContext,
): ExecResult {
  const { variables } = context;
  const typename = (value.__typename as string | undefined) ?? rootTypename;
  let dataState: DataState | undefined;
  const boundaries = new PartialBoundaries();

  for (const selection of selectionSet.selections) {
    // Omit fields with @skip(if: <truthy>) or @include(if: <falsy>).
    if (!shouldInclude(selection, variables)) continue;

    if (selection.kind === 'Field') {
      const resultName = resultKeyNameFromField(selection);
      const fieldValue = value[resultName];
      // The __typename fields added by addTypename do not count.
      const counts = isSelectedByCaller(selection);

      if (fieldValue === undefined) {
        // Like Hermes' reads (and InMemoryCache), a missing __typename the
        // document selects itself makes a result incomplete, except on roots.
        if (counts && (selection.name.value !== '__typename' || rootTypename === undefined)) {
          dataState = mergeDataState(dataState, 'empty');
        }
      } else if (Array.isArray(fieldValue)) {
        if (fieldValue.length > 0) {
          const exec = executeSubSelectedArray(selection, fieldValue, context);
          dataState = mergeDataState(dataState, exec.dataState);
          boundaries.set(resultName, exec.boundaries);
        } else {
          dataState = mergeDataState(dataState, 'complete');
        }
      } else if (!selection.selectionSet) {
        if (counts) dataState = mergeDataState(dataState, 'complete');
      } else if (fieldValue !== null && typeof fieldValue === 'object') {
        const exec = executeSelectionSet(selection.selectionSet, fieldValue, undefined, context);
        boundaries.set(resultName, exec.boundaries);
        // An object that is present without any of its fields is partial
        // (rather than empty), so that @defer boundaries selecting it are
        // partial rather than streaming.
        dataState = mergeDataState(dataState, exec.dataState === 'empty' ? 'partial' : exec.dataState);
      }
      continue;
    }

    const fragment = fragmentOf(selection, context);
    if (!fragment || !fragmentApplies(fragment, typename, context)) continue;

    const isDeferBoundary = isDeferredFragment(selection as InlineFragmentNode, variables);
    // Not memoized: the same (registered) fragment can resolve differently in
    // different documents.
    const exec = execSelectionSetImpl(fragment.selectionSet, value, rootTypename, context);
    const nextDataState = exec.dataState;
    boundaries.merge(exec.boundaries);
    if (isDeferBoundary && (nextDataState === 'partial' || nextDataState === 'empty')) {
      boundaries.add(selection);
    }
    dataState = mergeDataState(
      dataState,
      isDeferBoundary
        ? nextDataState === 'empty'
          ? 'streaming'
          : nextDataState === 'partial'
            ? 'deferPartial'
            : nextDataState
        : nextDataState,
    );
  }

  return { dataState: dataState ?? 'complete', boundaries };
}

function executeSubSelectedArray(field: FieldNode, array: readonly unknown[], context: ReadContext): ExecResult {
  return cachedExec(context, array, field, undefined, () => execSubSelectedArrayImpl(field, array, context));
}

function execSubSelectedArrayImpl(field: FieldNode, array: readonly unknown[], context: ReadContext): ExecResult {
  let dataState: DataState = 'complete';
  const boundaries = new PartialBoundaries();
  const isStreamed = isStreamField(field, context.variables);

  for (let i = 0; i < array.length; i++) {
    const item = array[i];
    if (item === null) continue;

    let exec: ExecResult | undefined;
    if (Array.isArray(item)) {
      exec = executeSubSelectedArray(field, item, context);
    } else if (field.selectionSet) {
      exec =
        typeof item === 'object'
          ? executeSelectionSet(field.selectionSet, item as JsonObject, undefined, context)
          : { dataState: 'empty', boundaries: new PartialBoundaries() };
    }
    if (!exec) continue;

    const nextDataState = exec.dataState;
    boundaries.set(i, nextDataState === 'partial' ? exec.boundaries.clone().add(field) : exec.boundaries);
    dataState = mergeDataState(dataState, isStreamed && nextDataState === 'partial' ? 'streamPartial' : nextDataState);
  }

  return { dataState, boundaries };
}

// Pruning (InMemoryCache's prunePartialBoundaries/prunePartialStreamArray).

const NO_INFO = {};

/**
 * The selection sets that select fields of the same object of a result (the
 * root, or the fields with the same response key under a set of selection
 * sets), memoized so that they can key pruned results.
 *
 * Scopes resolve fragment spreads through the document's fragments, so root
 * scopes are memoized per document (documents can share operation nodes, e.g.
 * after document transforms that add fragment definitions); child scopes are
 * then memoized per scope.
 */
type Scope = readonly SelectionSetNode[];

const rootScopes = new WeakMap<DocumentNode, WeakMap<SelectionSetNode, Scope>>();
const childScopes = new WeakMap<Scope, Map<string, Scope>>();

function rootScope(document: DocumentNode, selectionSet: SelectionSetNode): Scope {
  let bySelectionSet = rootScopes.get(document);
  if (!bySelectionSet) rootScopes.set(document, (bySelectionSet = new WeakMap()));
  let scope = bySelectionSet.get(selectionSet);
  if (!scope) bySelectionSet.set(selectionSet, (scope = [selectionSet]));
  return scope;
}

function childScope(scope: Scope, resultName: string, context: ReadContext): Scope {
  let byName = childScopes.get(scope);
  if (!byName) childScopes.set(scope, (byName = new Map()));
  let child = byName.get(resultName);
  if (!child) {
    const selectionSets: SelectionSetNode[] = [];
    someSelection(scope, fragmentSelectionSet(context), field => {
      if (field.kind === 'Field' && field.selectionSet && resultKeyNameFromField(field) === resultName) {
        selectionSets.push(field.selectionSet);
      }
    });
    byName.set(resultName, (child = selectionSets));
  }
  return child;
}

/** The fields the selection sets of a scope select (directly or through fragments, whether or not they apply). */
interface SelectedKeys {
  /** Their response keys. */
  responseKeys: Set<string>;
}

const scopeKeys = new WeakMap<Scope, SelectedKeys>();

function selectedKeys(scope: Scope, context: ReadContext): SelectedKeys {
  let keys = scopeKeys.get(scope);
  if (!keys) {
    const responseKeys = new Set<string>();
    someSelection(scope, fragmentSelectionSet(context), field => {
      if (field.kind === 'Field') responseKeys.add(resultKeyNameFromField(field));
    });
    scopeKeys.set(scope, (keys = { responseKeys }));
  }
  return keys;
}

/**
 * The schema names of the aliased fields a (pruned) fragment selects: the
 * results being pruned can hold their stored values under those names too.
 */
function aliasedFieldNames(fragment: SelectionSetNode, context: ReadContext, names = new Set<string>()) {
  someSelection([fragment], fragmentSelectionSet(context), field => {
    if (field.kind === 'Field' && field.alias) names.add(field.name.value);
  });
  return names;
}

/**
 * Memoized pruned results, by PartialBoundaries (which identify the result
 * pruned, see execMemo), selection set (or list field), scope, incremental
 * info and (with incremental info, which is looked up by path) path.
 */
const pruneMemo: Memo<PruneResult> = {};

function cachedPrune(
  boundaries: PartialBoundaries,
  node: SelectionSetNode | FieldNode,
  scope: Scope,
  path: PathPart[],
  context: ReadContext,
  compute: () => PruneResult,
): PruneResult {
  const { streamInfo, deferInfo } = context;
  const pathKey = streamInfo || deferInfo ? JSON.stringify(path) : '';
  const memo = memoNode(pruneMemo, [boundaries, node, scope, streamInfo ?? NO_INFO, deferInfo ?? NO_INFO, pathKey]);
  if (!memo.value || !memo.value.deps.every(check => check())) memo.value = compute();
  return memo.value;
}

function prunePartialBoundaries(
  selectionSet: SelectionSetNode,
  data: JsonValue | undefined,
  boundaries: PartialBoundaries | undefined,
  scope: Scope,
  path: PathPart[],
  context: ReadContext,
): PruneResult {
  if (data == null || typeof data !== 'object' || !boundaries) return { result: data, dataState: 'complete', deps: [] };
  return cachedPrune(boundaries, selectionSet, scope, path, context, () =>
    prunePartialBoundariesImpl(selectionSet, data as JsonObject, boundaries, scope, path, context),
  );
}

function prunePartialBoundariesImpl(
  selectionSet: SelectionSetNode,
  data: JsonObject,
  boundaries: PartialBoundaries,
  scope: Scope,
  path: PathPart[],
  context: ReadContext,
): PruneResult {
  const { variables, deferInfo } = context;
  const merger = new DeepMerger();
  const deps: (() => boolean)[] = [];
  let changed = false;
  let dataState: DataState = 'complete';
  const result: Record<string, any> = {};
  // The schema names of aliased fields in pruned boundaries, and of the fields
  // selected outside them.
  let prunedNames: Set<string> | undefined;
  const keptNames = new Set<string>();

  // __typename might not be part of the selection set, so preserve it.
  if (Object.prototype.hasOwnProperty.call(data, '__typename')) result.__typename = data.__typename;

  const workSet = new Set(selectionSet.selections);
  for (const selection of workSet) {
    if (!shouldInclude(selection, variables)) continue;

    if (selection.kind === 'Field') {
      keptNames.add(selection.name.value);
      const resultName = resultKeyNameFromField(selection);
      if (!Object.prototype.hasOwnProperty.call(data, resultName)) continue;
      const fieldValue = data[resultName];

      if (Array.isArray(fieldValue)) {
        const pruned = prunePartialStreamArray(
          selection,
          fieldValue,
          boundaries.getChild(resultName),
          childScope(scope, resultName, context),
          [...path, resultName],
          context,
        );
        deps.push(...pruned.deps);
        changed ||= pruned.result !== fieldValue;
        result[resultName] = pruned.result;
        dataState = mergeDataState(dataState, pruned.dataState);
      } else if (!selection.selectionSet) {
        result[resultName] = fieldValue;
      } else {
        const pruned = prunePartialBoundaries(
          selection.selectionSet,
          fieldValue,
          boundaries.getChild(resultName),
          childScope(scope, resultName, context),
          [...path, resultName],
          context,
        );
        deps.push(...pruned.deps);
        changed ||= pruned.result !== fieldValue;
        dataState = mergeDataState(dataState, pruned.dataState);
        // A response key can be selected by more than one selection (e.g. a
        // field and an overlapping fragment), so merge their kept fields.
        result[resultName] = Object.prototype.hasOwnProperty.call(result, resultName)
          ? merger.merge(result[resultName], pruned.result)
          : pruned.result;
      }
      continue;
    }

    // Dropping a fragment does not necessarily drop keys (overlapping sibling
    // selections can select them too); the key comparison below detects
    // whether any were dropped.
    const fragment = fragmentOf(selection, context);
    let prune = false;
    if (deferInfo && isDeferredFragment(selection as InlineFragmentNode, variables)) {
      const directive = selection.directives?.find(d => d.name.value === 'defer');
      const label = directive && getDirectiveArgValue(directive, 'label', STRING_VALUE);
      const key = [...path, ...(label ? [label] : [])];
      const pending = !!deferInfo.peekArray(key);
      deps.push(() => !!deferInfo.peekArray(key) === pending);
      prune = pending;
    }

    if (
      fragment &&
      fragmentApplies(fragment, data.__typename ?? (path.length ? undefined : context.operation.rootTypename), context)
    ) {
      if (boundaries.has(selection) || prune) {
        dataState = mergeDataState(dataState, 'streaming');
        prunedNames = aliasedFieldNames(fragment.selectionSet, context, prunedNames);
      } else {
        for (const child of fragment.selectionSet.selections) workSet.add(child);
      }
    }
  }

  // Hermes' results can be supersets of the selection: keep the fields that
  // the selection set does not select (but not the stored values of aliased
  // fields that only pruned boundaries select).
  const selected = selectedKeys(scope, context).responseKeys;
  for (const key of Object.keys(data)) {
    if (key in result || selected.has(key)) continue;
    if (prunedNames?.has(key) && !keptNames.has(key)) continue;
    result[key] = data[key];
  }

  if (Object.keys(result).length !== Object.keys(data).length) {
    changed = true;
  } else if (changed && boundaries.hasSelections()) {
    // Overlapping siblings may rebuild the same fields under a new object
    // identity after a partial @defer is skipped; check whether anything was
    // actually dropped.
    changed = !isEqual(result, data);
  }

  if (changed && context.freeze) Object.freeze(result);
  return { result: changed ? result : data, dataState, deps };
}

function prunePartialStreamArray(
  field: FieldNode,
  array: JsonValue[],
  boundaries: PartialBoundaries | undefined,
  scope: Scope,
  path: PathPart[],
  context: ReadContext,
): PruneResult {
  if (!boundaries) return { result: array, dataState: 'complete', deps: [] };
  return cachedPrune(boundaries, field, scope, path, context, () =>
    prunePartialStreamArrayImpl(field, array, boundaries, scope, path, context),
  );
}

function prunePartialStreamArrayImpl(
  field: FieldNode,
  array: JsonValue[],
  boundaries: PartialBoundaries,
  scope: Scope,
  path: PathPart[],
  context: ReadContext,
): PruneResult {
  const { streamInfo } = context;
  const deps: (() => boolean)[] = [];
  let changed = false;
  let dataState: DataState = 'complete';
  let pruned: JsonValue[] = [];

  const state = streamInfo?.peekArray(path)?.state;
  const length = Math.min(array.length, state?.truncate ? state.streamPosition : Number.MAX_SAFE_INTEGER);

  for (let i = 0; i < length; i++) {
    const item = array[i];
    let prunedItem: PruneResult = { result: item, dataState: 'complete', deps: [] };
    const boundary = boundaries.getChild(i);

    if (boundary?.has(field)) {
      // Stream info is only given to cache.diff during in-flight requests:
      // keep the items that have streamed in so far. Other reads prune
      // partial stream lists back to an empty list.
      if (state) {
        state.truncate = true;
        pruned = pruned.slice(0, state.streamPosition);
      } else {
        pruned = [];
        dataState = 'complete';
      }
      break;
    }

    if (Array.isArray(item)) {
      prunedItem = prunePartialStreamArray(field, item, boundary, scope, [...path, i], context);
    } else if (field.selectionSet) {
      prunedItem = prunePartialBoundaries(field.selectionSet, item, boundary, scope, [...path, i], context);
    }

    deps.push(...prunedItem.deps);
    pruned.push(prunedItem.result!);
    changed ||= prunedItem.result !== item;
    dataState = mergeDataState(dataState, prunedItem.dataState);
  }

  if (streamInfo) {
    // The stream position (and whether to truncate) can change between reads.
    const truncate = state?.truncate;
    const position = state?.streamPosition;
    deps.push(() => {
      const current = streamInfo.peekArray(path)?.state;
      return current === state && current?.truncate === truncate && current?.streamPosition === position;
    });
  }

  changed ||= pruned.length !== array.length;
  if (changed && context.freeze) Object.freeze(pruned);
  return { result: changed ? pruned : array, dataState, deps };
}

/**
 * The selection paths of a result that lead to partial @defer boundaries (and
 * partial @stream list items), for pruning.
 */
class PartialBoundaries {
  private selections = new Set<SelectionNode>();
  private children = new Map<string | number, PartialBoundaries>();

  add(selection: SelectionNode) {
    this.selections.add(selection);
    return this;
  }

  has(selection: SelectionNode) {
    return this.selections.has(selection);
  }

  hasSelections() {
    return this.selections.size > 0;
  }

  getChild(key: string | number) {
    return this.children.get(key);
  }

  clone() {
    return new PartialBoundaries().merge(this);
  }

  set(key: string | number, boundary: PartialBoundaries) {
    const child = this.getChild(key);
    // Avoid mutating memoized boundaries.
    this.children.set(key, child ? child.clone().merge(boundary) : boundary);
  }

  merge(boundaries: PartialBoundaries) {
    boundaries.selections.forEach(selection => this.add(selection));
    boundaries.children.forEach((child, key) => this.set(key, child));
    return this;
  }
}

// Describes the data state transitions that change the running state when it's
// combined with the next data state. Omitted values represent "impossible"
// merges where the data state remains the same.
const DATA_STATE_MERGES: Record<DataState, Partial<Record<DataState, DataState>>> = {
  empty: {
    complete: 'partial',
    deferPartial: 'partial',
    streaming: 'partial',
    streamPartial: 'partial',
  },
  deferPartial: {
    empty: 'partial',
  },
  streamPartial: {
    deferPartial: 'deferPartial',
    empty: 'partial',
  },
  streaming: {
    deferPartial: 'deferPartial',
    empty: 'partial',
    streamPartial: 'streamPartial',
  },
  complete: {
    deferPartial: 'deferPartial',
    streaming: 'streaming',
    streamPartial: 'streamPartial',
    empty: 'partial',
  },
  partial: {},
};

function mergeDataState(current: DataState | undefined, next: DataState): DataState {
  if (next === 'partial') return 'partial';
  if (!current || current === next) return next;
  return DATA_STATE_MERGES[current][next] || current;
}
