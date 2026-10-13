import { MissingFieldError } from '@apollo/client/cache';
import type { Cache, FieldReadFunction, MissingTree, Reference, StoreValue } from '@apollo/client/cache';
import { makeReference } from '@apollo/client/utilities/internal';
import type { StoreObject } from '@apollo/client/utilities';
import { addTypenameToDocument } from '@apollo/client/utilities';
import type { DocumentNode, SelectionSetNode } from 'graphql';

import type { CacheContext, QueryInfo } from '../context';
import { storeFieldNameOf } from '../context/storeFieldNames';
import type { StoreKey } from '../context/storeFieldNames';
import type { GraphSnapshot, NodeSnapshotMap } from '../GraphSnapshot';
import { fieldNodeOf } from '../ParsedQueryNode';
import type { ParsedQuery, ParsedQueryNode } from '../ParsedQueryNode';
import type { JsonObject, JsonValue, PathPart } from '../primitive';
import type { NodeId, OperationInstance, RawOperation } from '../schema';
import type { NodeSnapshot } from '../nodes';
import * as schema from '../schema';
import * as util from '../util';
import * as nodes from '../nodes';

import * as snapshotEditor from './SnapshotEditor';
import { FieldFunctions, withReferences } from './fieldFunctions';

const makeRef = makeReference;
const { StaticNodeId } = schema;
const { cloneNodeSnapshot, EntitySnapshot, ParameterizedValueSnapshot } = nodes;
const { nodeIdForStoreKey } = snapshotEditor;
const { deepGet, isNil, isObject, isReference, lazyImmutableDeepSet, safeStringify } = util;

export { MissingFieldError };
export type { MissingTree };

export interface QueryResult {
  /** The value of the root requested by a query. */
  result?: JsonObject;
  /** Whether the query's selection set was satisfied. */
  complete: boolean;
  /** The ids of entity nodes selected by the query. */
  entityIds?: Set<NodeId>;
  /** The ids of nodes overlaid on top of static cache results. */
  dynamicNodeIds?: Set<NodeId>;
  /** What is missing from an incomplete result. */
  missing?: MissingFieldError;
}

/** The (shared, frozen) result of a complete read that selects no fields. */
const EMPTY_RESULT: JsonObject = Object.freeze({});

/**
 * The Apollo Client 4 Cache.DiffResult for a read, like InMemoryCache's: an
 * incomplete result is null unless partial data is requested (the default)
 * and at least one field was found.
 */
export function toDiffResult<TData = unknown>(
  { result, complete, missing }: QueryResult,
  returnPartialData = true,
): Cache.DiffResult<TData> {
  // Like InMemoryCache, a complete result has a `missing: undefined` property,
  // and a read that selects no fields (they are all skipped) has an empty
  // result, even when nothing was written.
  if (complete) return { result: (result ?? EMPTY_RESULT) as any, complete: true, missing: undefined };
  const keepResult = returnPartialData && !!result && Object.keys(result).length > 0;
  // Like InMemoryCache, missing is a getter (which it uses to build the error lazily).
  return {
    result: keepResult ? (result as any) : null,
    complete: false,
    get missing() {
      return missing;
    },
  };
}

export interface QueryResultWithNodeIds extends QueryResult {
  /** The ids of entity nodes selected by the query. */
  entityIds: Set<NodeId>;
}

/**
 * Get you some data.
 */
export function read<TSerialized>(
  context: CacheContext<TSerialized>,
  raw: RawOperation,
  snapshot: GraphSnapshot,
  tempStore?: NodeSnapshotMap,
  includeNodeIds?: true,
): QueryResultWithNodeIds;

export function read<TSerialized>(
  context: CacheContext<TSerialized>,
  raw: RawOperation,
  snapshot: GraphSnapshot,
  tempStore?: NodeSnapshotMap,
  includeNodeIds?: boolean,
): QueryResult;

export function read<TSerialized>(
  context: CacheContext<TSerialized>,
  raw: RawOperation,
  snapshot: GraphSnapshot,
  tempStore: NodeSnapshotMap = Object.create(null),
  includeNodeIds?: boolean,
) {
  let tracerContext;
  if (context.tracer.readStart) {
    tracerContext = context.tracer.readStart(raw);
  }

  const operation = context.parseOperation(raw);

  // Retrieve the previous result (may be partially complete), or start anew.
  const queryResult = snapshot.readCache.get(operation) || ({} as Partial<QueryResultWithNodeIds>);
  snapshot.readCache.set(operation, queryResult as QueryResult);

  let cacheHit = true;
  if (!queryResult.result) {
    cacheHit = false;
    const rootSnapshot = snapshot.getNodeSnapshot(operation.rootId);
    if (!rootSnapshot && !isRootId(operation.rootId)) {
      // Like InMemoryCache, reading from a missing entity reports a dangling
      // reference, with an empty result.
      const message = `Dangling reference to missing ${operation.rootId} object`;
      queryResult.result = {};
      queryResult.complete = false;
      queryResult.missing = new MissingFieldError(message, message, operation.document, operation.variables ?? {});
      queryResult.entityIds = includeNodeIds ? new Set([operation.rootId]) : undefined;
    } else {
      const { data, outbound, parameterized } = rootSnapshot ?? {};
      queryResult.result = data as JsonObject;

      // Fields whose read function returned a reference to a missing entity.
      const danglingFields: DanglingFields = new WeakMap();
      if (
        (!operation.isStatic && (data || outbound || parameterized || context.typePolicies)) ||
        (operation.parsedQuery.__typename &&
          // An empty root (e.g. after writing `{}`) still reads its __typename.
          (data || isRootId(operation.rootId)) &&
          !(data && '__typename' in (data as JsonObject)) &&
          selectsRootTypename(operation.info))
      ) {
        const dynamicNodeIds = new Set<NodeId>();
        queryResult.result = _walkAndOverlayDynamicValues(
          operation,
          context,
          snapshot,
          queryResult.result ?? {},
          dynamicNodeIds!,
          tempStore,
          danglingFields,
        );
        queryResult.dynamicNodeIds = dynamicNodeIds;
        // Results built here are new objects; freeze them like the snapshot data they come from.
        if (context.freezeSnapshots) util.deepFreeze(queryResult.result);
      }

      queryResult.entityIds = includeNodeIds ? new Set<NodeId>() : undefined;

      // When strict mode is disabled, we carry completeness forward for observed
      // queries.  Once complete, always complete.
      if (typeof queryResult.complete !== 'boolean') {
        const checked = _visitSelection(operation, context, queryResult.result, queryResult.entityIds, {
          snapshot,
          tempStore,
          danglingFields,
        });
        queryResult.complete = checked.complete;
        if (checked.missing) {
          queryResult.missing = checked.missing;
        }
        if (checked.result !== queryResult.result) {
          queryResult.result = checked.result;
          if (context.freezeSnapshots) util.deepFreeze(queryResult.result);
        }
      }
    }
  }

  // We can potentially ask for results without node ids first, and then follow
  // up with an ask for them.  In that case, we need to fill in the cache a bit
  // more.
  if (includeNodeIds && !queryResult.entityIds) {
    cacheHit = false;
    const entityIds = new Set<NodeId>([operation.rootId]);
    if (snapshot.getNodeSnapshot(operation.rootId) || isRootId(operation.rootId)) {
      queryResult.complete = _visitSelection(operation, context, queryResult.result, entityIds, {
        snapshot,
        tempStore,
      }).complete;
    }
    queryResult.entityIds = entityIds;
  }

  if (context.tracer.readEnd) {
    const result = { result: queryResult as QueryResult, cacheHit };
    context.tracer.readEnd(operation, result, tracerContext);
  }

  return queryResult;
}

class OverlayWalkNode {
  constructor(
    public readonly value: JsonObject,
    public readonly containerId: NodeId,
    public readonly parsedMap: ParsedQuery,
    public readonly path: PathPart[],
  ) {}
}

/**
 * Walks a parameterized field map, overlaying values at those paths on top of
 * existing results.
 *
 * Overlaid values are objects with prototypes pointing to the original results,
 * and new properties pointing to the parameterized values (or objects that
 * contain them).
 */
export function _walkAndOverlayDynamicValues<TSerialized>(
  query: OperationInstance<TSerialized>,
  context: CacheContext<TSerialized>,
  snapshot: GraphSnapshot,
  result: JsonObject | undefined,
  dynamicNodeIds: Set<NodeId>,
  tempStore: NodeSnapshotMap,
  danglingFields?: DanglingFields,
): JsonObject | undefined {
  // Corner case: We stop walking once we reach a parameterized field with no
  // snapshot, but we should also preemptively stop walking if there are no
  // dynamic values to be overlaid
  const id = query.rootId;
  const isRoot = id === StaticNodeId.QueryRoot;
  const rootSnapshot: Readonly<NodeSnapshot> | undefined = (snapshot.getNodeSnapshot(id) ?? isRoot) ? {} : undefined;
  if (isNil(rootSnapshot)) return result;

  // TODO: A better approach here might be to walk the outbound references from
  // each node, rather than walking the result set.  We'd have to store the path
  // on parameterized value nodes to make that happen.

  const newResult = _wrapValue(result, context) as JsonObject;
  // TODO: This logic sucks.  We'd do much better if we had knowledge of the
  // schema.  Can we layer that on in such a way that we can support uses w/ and
  // w/o a schema compilation step?
  const queue = [new OverlayWalkNode(newResult, id, query.parsedQuery, [])];

  function getSnapshot(nodeId: string) {
    return tempStore[nodeId] ?? snapshot.getNodeSnapshot(nodeId);
  }

  // Like InMemoryCache, a reference to a missing entity reads as an empty
  // object, reported as a dangling reference by _visitSelection.
  function markDangling(value: JsonObject, key: string, ref: NodeId) {
    value[key] = {};
    if (!danglingFields) return;
    let fields = danglingFields.get(value);
    if (!fields) danglingFields.set(value, (fields = new Map()));
    fields.set(key, ref);
  }

  // The missing entity a read function's (Reference) result points to.
  let danglingResult: NodeId | undefined;

  const ensureNewSnapshot = (nodeId: NodeId): NodeSnapshot => {
    const parent = getSnapshot(nodeId);

    // TODO: We're assuming that the only time we call _ensureNewSnapshot when
    // there is no parent is when the node is an entity.  Can we enforce it, or
    // pass a type through?
    const newSnapshot = parent ? cloneNodeSnapshot(parent) : new EntitySnapshot();
    tempStore[nodeId] = newSnapshot;
    return newSnapshot;
  };

  const mergeIntoEntity = (entityId: NodeId, value: StoreObject, valueIsOlder = false) => {
    const nodeSnapshot = ensureNewSnapshot(entityId);
    const data = nodeSnapshot.data as {};
    nodeSnapshot.data = (valueIsOlder ? { ...value, ...data } : { ...data, ...value }) as JsonObject;
  };

  const fieldFunctions = new FieldFunctions(
    context,
    getSnapshot,
    query.variables,
    (value, mergeIntoStore) => {
      if (typeof value === 'string') return makeRef(value);
      if (isReference(value)) return value;
      const entityId = context.entityIdForValue(value);
      if (entityId && mergeIntoStore) mergeIntoEntity(entityId, value as StoreObject);
      return entityId ? makeRef(entityId) : undefined;
    },
    (ref, value, valueIsOlder) => mergeIntoEntity(ref.__ref, value, valueIsOlder),
  );

  // Replaces References (returned by read functions) with the data of the
  // entities they point to.
  function resolveReferences(value: any): any {
    if (isReference(value)) return getSnapshot(value.__ref)?.data;
    if (!Array.isArray(value)) return value;
    let resolved = value;
    for (let i = 0; i < value.length; i++) {
      const item = resolveReferences(value[i]);
      if (item !== value[i]) {
        if (resolved === value) resolved = [...value];
        resolved[i] = item;
      }
    }
    return resolved;
  }

  const hasFieldPolicies = Object.values(context.typePolicies ?? {}).some(policy => policy?.fields);
  const isObjectOrArray = (value: unknown) => value !== null && typeof value === 'object';

  // Walk breadth-first, so read functions run in the order of the results.
  for (let q = 0; q < queue.length; q++) {
    const walkNode = queue[q];
    const { value, parsedMap } = walkNode;
    let { containerId, path } = walkNode;
    const valueId = context.entityIdForValue(value);
    if (valueId) {
      containerId = valueId;
      path = [];
    }

    let typeName = value.__typename as string;
    if (!typeName && containerId === StaticNodeId.QueryRoot && path.length === 0) {
      typeName = 'Query'; // Preserve the default cache's behavior.
    }
    const typePolicies = context.typePolicies?.[typeName]?.fields;

    // Read functions are called on a Reference to the entity being walked, or
    // (for unidentified objects) on the stored object itself.
    const containerSnapshot = getSnapshot(containerId);
    const currentObject: StoreObject | Reference =
      path.length === 0 && !(containerSnapshot instanceof ParameterizedValueSnapshot)
        ? makeRef(containerId)
        : (withReferences(containerSnapshot, path, deepGet(containerSnapshot?.data, path)) ?? value);
    const callReadFunction = (
      readFn: FieldReadFunction,
      existing: StoreValue,
      fieldName: string,
      node: ParsedQueryNode,
      storeKey: StoreKey,
    ) => {
      const args = (node.args as JsonObject | undefined) ?? null;
      const storeFieldName = storeFieldNameOf(fieldName, storeKey, args);
      const storageKeys = [containerId, ...path, storeFieldName];
      const readResult = readFn(
        existing,
        fieldFunctions.options(currentObject, fieldName, storeFieldName, args, storageKeys, fieldNodeOf(node)),
      );
      danglingResult =
        isReference(readResult) && !getSnapshot(readResult.__ref) && !isRootId(readResult.__ref)
          ? readResult.__ref
          : undefined;
      return resolveReferences(readResult);
    };

    for (const key in parsedMap) {
      const node = parsedMap[key];
      // Fields of fragments that don't match the type are not selected.
      if (node.conditions && !context.conditionsMatch(node.conditions, typeName)) continue;
      let child;

      // This is an alias if we have a schemaName declared.
      const fieldName = node.schemaName ? node.schemaName : key;
      const policy = typePolicies?.[fieldName];
      const readFn = typeof policy === 'function' ? policy : policy?.read;

      let nextContainerId = containerId;
      let nextPath = path;

      // Fields are stored under their arguments, or as their keyArgs policies
      // (or @connection directives) say.
      const storeKey = context.storeFieldNames.storeKey(
        typeName,
        fieldName,
        node.args as JsonObject | undefined,
        fieldNodeOf(node),
        query.variables,
      );

      if (storeKey !== undefined) {
        let childId = nodeIdForStoreKey(containerId, [...path, fieldName], storeKey);
        let childSnapshot: Readonly<NodeSnapshot> | undefined = getSnapshot(childId);

        if (readFn) {
          dynamicNodeIds.add(childId);
          const existing = childSnapshot && withReferences(childSnapshot, [], childSnapshot.data);
          child = callReadFunction(readFn, existing, fieldName, node, storeKey);
          if (danglingResult !== undefined) {
            markDangling(value, key, danglingResult);
            continue;
          }
        } else {
          if (!childSnapshot) {
            // Should we fall back to a redirect?
            const redirect: CacheContext.ResolverRedirect | undefined = deepGet(context.resolverRedirects, [
              typeName,
              fieldName,
            ]) as any;
            if (redirect && node.args) {
              childId = redirect(node.args);
              if (!isNil(childId)) {
                childSnapshot = snapshot.getNodeSnapshot(childId);
              }
            }
          }

          dynamicNodeIds.add(childId);

          // Still no snapshot? Ok we're done here.
          if (!childSnapshot) {
            continue;
          }
          child = childSnapshot.data;
        }

        nextContainerId = childId;
        nextPath = [];
      } else {
        nextPath = [...path, fieldName];
        child = value[fieldName];
        if (readFn) {
          const existing = withReferences(containerSnapshot, nextPath, child);
          child = callReadFunction(readFn, existing, fieldName, node, storeKey);
          if (danglingResult !== undefined) {
            markDangling(value, key, danglingResult);
            continue;
          }
        }
      }

      const isRef = isReference(child);
      if (isRef) {
        const target = getSnapshot(child.__ref);
        if (!target && !isRootId(child.__ref)) {
          markDangling(value, key, child.__ref);
          continue;
        }
        child = target?.data;
      } else if (child === undefined) {
        const reference = getSnapshot(nextContainerId)?.outbound?.get(nextPath.join('.'));
        if (reference && !getSnapshot(reference.id) && !isRootId(reference.id)) {
          markDangling(value, key, reference.id);
          continue;
        }
      }

      // Objects (at any depth) may have fields with read functions.
      const hasPolicy = hasFieldPolicies && node.children && isObjectOrArray(child);

      // Have we reached a leaf (either in the query, or in the cache)?
      if (hasPolicy || isRef || _shouldWalkChildren(child, node)) {
        child = _recursivelyWrapValue(child, context);
        const allChildValues = _flattenGraphQLObject(child, nextPath);

        for (let i = 0; i < allChildValues.length; i++) {
          const item = allChildValues[i];
          queue.push(new OverlayWalkNode(item.value, nextContainerId, node.children ?? {}, item.path));
        }
      }

      // Because key is already a field alias, result will be written correctly
      // using alias as key.
      if (child !== undefined) {
        value[key] = child;
      } else if (key === '__typename' && typeName && selectsRootTypename(query.info)) {
        // Like InMemoryCache, the root __typename is only read when the document
        // the caller passed in selects it (not when Hermes' addTypename adds it).
        value.__typename = typeName;
      } else if (readFn) {
        // Like InMemoryCache, a read function returning undefined makes the
        // field missing, even when the cache holds a value for it.
        delete value[key];
        delete value[fieldName];
      }
    }
  }

  return newResult;
}

/**
 *  Private: Represents the possible types of a GraphQL object.
 *
 *  Since we are not using the schema when walking through the result and
 *  overlaying values, we do not know if a field represents an object, an array
 *  of objects, or a multidimensional array of objects. The query alone is
 *  ambiguous.
 */
type UnknownGraphQLObject = JsonObject | null | UnknownGraphQLObjectArray;
interface UnknownGraphQLObjectArray extends Array<UnknownGraphQLObject> {}

/**
 *  Check if `value` is an object and if any of its children are parameterized.
 *  We can skip this part of the graph if there are no parameterized children
 *  to resolve.
 */
function _shouldWalkChildren(value: JsonValue | undefined, node: ParsedQueryNode): value is UnknownGraphQLObject {
  return !!node.hasParameterizedChildren && !!node.children && value !== null;
}

/**
 *  Private: Represents and location and value of objects discovered while
 *  flattening the value of a graphql object field.
 */
type FlattenedGraphQLObject = { value: JsonObject; path: PathPart[] };

/**
 *  Finds all of the actual objects in `value` which can be a single object, an
 *  array of objects, or a multidimensional array of objects, and returns them
 *  as a flat list.
 */
function _flattenGraphQLObject(value: UnknownGraphQLObject, path: PathPart[]): FlattenedGraphQLObject[] {
  if (value === null) return [];
  if (!Array.isArray(value)) return [{ value, path }];

  const flattened: FlattenedGraphQLObject[] = [];

  for (let i = 0; i < value.length; i++) {
    const item = value[i];
    const list = _flattenGraphQLObject(item, [...path, i]);

    flattened.push(...list);
  }

  return flattened;
}

function _recursivelyWrapValue<T extends JsonValue, TSerialized>(
  value: T | undefined,
  context: CacheContext<TSerialized>,
): T {
  if (!Array.isArray(value)) {
    return _wrapValue(value, context);
  }

  const newValue: JsonValue[] = [];
  // Note that we're careful to iterate over all indexes, in case this is a
  // sparse array.
  for (let i = 0; i < value.length; i++) {
    newValue[i] = _recursivelyWrapValue(value[i], context);
  }

  return newValue as unknown as T;
}

function _wrapValue<T extends JsonValue, TSerialized>(value: T | undefined, context: CacheContext<TSerialized>): T {
  if (value === undefined) {
    return {} as T;
  }
  if (Array.isArray(value)) {
    return [...value] as T;
  }
  if (isObject(value)) {
    const newValue = { ...(value as any) };
    if (context.entityTransformer && context.entityIdForValue(value)) {
      context.entityTransformer(newValue);
    }
    return newValue;
  }
  return value;
}

/**
 * Fields (by result object and key) whose value is a reference to a missing
 * entity, as returned by a read function.
 */
export type DanglingFields = WeakMap<JsonObject, Map<string, NodeId>>;

/**
 * Whether `id` is one of the root ids, which InMemoryCache never reports as
 * dangling references.
 */
export function isRootId(id: NodeId) {
  return id === StaticNodeId.QueryRoot || id === StaticNodeId.MutationRoot || id === StaticNodeId.SubscriptionRoot;
}

const rootTypenameSelections = new WeakMap<QueryInfo<any>, boolean>();

/**
 * Whether the root selection set of an operation selects __typename itself,
 * rather than through the __typename fields Hermes added with
 * addTypenameToDocument (those added before the document reached Hermes count).
 */
function selectsRootTypename(info: QueryInfo<any>): boolean {
  let selects = rootTypenameSelections.get(info);
  if (selects === undefined) {
    selects = false;
    const visited = new Set<SelectionSetNode>();
    const visit = (selectionSet: SelectionSetNode) => {
      if (visited.has(selectionSet)) return;
      visited.add(selectionSet);
      for (const selection of selectionSet.selections) {
        if (selection.kind === 'Field') {
          if (
            selection.name.value === '__typename' &&
            (info.pretransformed || !addTypenameToDocument.added(selection))
          ) {
            selects = true;
          }
        } else if (selection.kind === 'InlineFragment') {
          visit(selection.selectionSet);
        } else {
          const fragment = info.fragmentMap[selection.name.value];
          if (fragment) visit(fragment.selectionSet);
        }
      }
    };
    visit(info.operation.selectionSet);
    rootTypenameSelections.set(info, selects);
  }
  return selects;
}

/**
 * The first message of a MissingTree, in query order (as InMemoryCache picks
 * the message of the MissingFieldError it reports).
 */
function firstMissing(tree: MissingTree): string {
  if (typeof tree === 'string') return tree;
  for (const key in tree) {
    const message = firstMissing(tree[key]);
    if (message) return message;
  }
  return '';
}

function setMissing(tree: MissingTree | undefined, path: PathPart[], message: string): MissingTree {
  if (!path.length) return message;
  const root = (tree && typeof tree === 'object' ? tree : {}) as { [key: string]: MissingTree };
  let node = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    let child = node[key];
    if (!child || typeof child !== 'object') {
      child = node[key] = {};
    }
    node = child as { [key: string]: MissingTree };
  }
  node[path[path.length - 1]] = message;
  return root;
}

export interface VisitSelectionOptions {
  /** The snapshot read from, used to identify dangling references. */
  snapshot?: GraphSnapshot;
  /** Nodes pending creation by read functions. */
  tempStore?: NodeSnapshotMap;
  /** Fields whose read function returned a dangling reference. */
  danglingFields?: DanglingFields;
}

/**
 * Determines whether `result` satisfies the properties requested by
 * `selection`, collecting InMemoryCache-style missing field errors.
 *
 * Like InMemoryCache, dangling references (to entities that are no longer in
 * the cache) are reported as missing, except in lists, where they are dropped
 * from the returned result.
 */
export function _visitSelection<TSerialized>(
  query: OperationInstance<TSerialized>,
  context: CacheContext<TSerialized>,
  result?: JsonObject,
  nodeIds?: Set<NodeId>,
  options: VisitSelectionOptions = {},
): { complete: boolean; missing?: MissingFieldError; result?: JsonObject } {
  const { snapshot, tempStore, danglingFields } = options;
  let complete = true;
  let missingTree: MissingTree | undefined;
  // Result paths of dangling references, and of lists holding them (with their indexes).
  const danglingObjects: PathPart[][] = [];
  const danglingItems = new Map<string, { path: PathPart[]; indexes: Set<number> }>();

  if (nodeIds && result !== undefined) {
    nodeIds.add(query.rootId);
  }

  const getNode = (id: NodeId) => tempStore?.[id] ?? snapshot?.getNodeSnapshot(id);
  const getOutbound = (containerId: NodeId, path: PathPart[]) => getNode(containerId)?.outbound?.get(path.join('.'));
  const missingTarget = (containerId: NodeId, path: PathPart[]) => {
    const reference = getOutbound(containerId, path);
    return reference && !getNode(reference.id) && !isRootId(reference.id) ? reference.id : undefined;
  };
  const addMissing = (path: PathPart[], message: string) => {
    complete = false;
    missingTree = setMissing(missingTree, path, message);
  };

  function visitObject(
    value: JsonObject,
    parsed: ParsedQuery,
    containerId: NodeId,
    containerPath: PathPart[],
    resultPath: PathPart[],
  ) {
    const danglingFieldIds = danglingFields?.get(value);
    // Like the read walk, treat the query root as a Query.
    let typeName = value.__typename;
    if (!typeName && containerId === StaticNodeId.QueryRoot && containerPath.length === 0) {
      typeName = 'Query';
    }
    for (const key in parsed) {
      const node = parsed[key];
      // Fields of fragments that don't match the type are not selected.
      if (node.conditions && !context.conditionsMatch(node.conditions, typeName)) continue;
      const fieldValue = value[key];
      const danglingId = danglingFieldIds?.get(key);

      if (danglingId !== undefined) {
        addMissing([...resultPath, key], `Dangling reference to missing ${danglingId} object`);
        continue;
      }
      // Leaf fields that are present need no further work.
      if (fieldValue !== undefined && (!node.children || fieldValue === null)) continue;

      const fieldName = node.schemaName ?? key;
      const fieldPath = [...containerPath, fieldName];
      const storeKey = context.storeFieldNames.storeKey(
        typeName,
        fieldName,
        node.args as JsonObject | undefined,
        fieldNodeOf(node),
        query.variables,
      );
      if (fieldValue === undefined) {
        if (key === '__typename') continue;
        let target;
        if (snapshot) {
          target =
            storeKey !== undefined
              ? missingTarget(nodeIdForStoreKey(containerId, fieldPath, storeKey), [])
              : missingTarget(containerId, fieldPath);
        }
        let message;
        if (target !== undefined) {
          message = `Dangling reference to missing ${target} object`;
          // Like InMemoryCache, a dangling reference reads as an empty object.
          danglingObjects.push([...resultPath, key]);
        } else {
          const isEntity =
            !containerPath.length && (isRootId(containerId) || getNode(containerId) instanceof EntitySnapshot);
          // Like InMemoryCache's store objects, __typename comes first.
          const shown = '__typename' in value ? { __typename: value.__typename, ...value } : value;
          const objOrNodeId = isEntity ? `${containerId} object` : `object ${safeStringify(shown)}`;
          message = `Can't find field '${fieldName}' on ${objOrNodeId}`;
        }
        addMissing([...resultPath, key], message);
        continue;
      }
      if (!node.children) continue;

      if (storeKey !== undefined) {
        const fieldId = nodeIdForStoreKey(containerId, fieldPath, storeKey);
        visitValue(fieldValue, node.children, fieldId, [], [...resultPath, key]);
      } else {
        visitValue(fieldValue, node.children, containerId, fieldPath, [...resultPath, key]);
      }
    }
  }

  function visitValue(
    value: JsonValue,
    parsed: ParsedQuery,
    containerId: NodeId,
    containerPath: PathPart[],
    resultPath: PathPart[],
  ) {
    if (value === null || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const itemPath = [...containerPath, i];
        if (item === undefined) {
          if (snapshot && missingTarget(containerId, itemPath) !== undefined) {
            const pathKey = JSON.stringify(resultPath);
            let entry = danglingItems.get(pathKey);
            if (!entry) danglingItems.set(pathKey, (entry = { path: resultPath, indexes: new Set() }));
            entry.indexes.add(i);
          } else {
            complete = false;
          }
          continue;
        }
        visitValue(item, parsed, containerId, itemPath, [...resultPath, i]);
      }
      return;
    }

    // Entering an entity makes it the container of the fields below. Values
    // returned by read functions need not be at their stored path, so the
    // stored reference is only a fallback.
    let entityId = context.entityIdForValue(value);
    if (entityId === undefined && snapshot) {
      const reference = getOutbound(containerId, containerPath);
      if (reference && getNode(reference.id)) entityId = reference.id;
    }
    if (entityId !== undefined) {
      nodeIds?.add(entityId);
      visitObject(value, parsed, entityId, [], resultPath);
    } else {
      visitObject(value, parsed, containerId, containerPath, resultPath);
    }
  }

  visitObject(result ?? {}, query.parsedQuery, query.rootId, [], []);

  let filteredResult = result;
  for (const path of danglingObjects) {
    filteredResult = lazyImmutableDeepSet(filteredResult, result, path, {});
  }
  // Like InMemoryCache, lists skip their dangling references.
  if (danglingItems.size) {
    const entries = Array.from(danglingItems.values()).sort((a, b) => b.path.length - a.path.length);
    for (const { path, indexes } of entries) {
      const list = deepGet(filteredResult, path) as JsonValue[];
      const filtered = list.filter((_item, index) => !indexes.has(index));
      filteredResult = lazyImmutableDeepSet(filteredResult, result, path, filtered);
    }
  }

  const missing =
    missingTree === undefined
      ? undefined
      : new MissingFieldError(firstMissing(missingTree), missingTree, query.document, query.variables ?? {});

  return { complete, missing, result: filteredResult };
}
