import { MissingFieldError } from '@apollo/client/cache';
import type { Cache, FieldReadFunction, MissingTree, Reference, StoreValue } from '@apollo/client/cache';
import { makeReference } from '@apollo/client/utilities/internal';
import { invariant, InvariantError } from '@apollo/client/utilities/invariant';
import type { StoreObject } from '@apollo/client/utilities';

import type { CacheContext, QueryInfo } from '../context';
import { hasOwn, isDev } from '../context/helpers';
import { storeFieldNameOf } from '../context/storeFieldNames';
import type { StoreKey } from '../context/storeFieldNames';
import type { GraphSnapshot, NodeSnapshotMap } from '../GraphSnapshot';
import { alternativeForType, childrenForType, fieldNodeOf } from '../ParsedQueryNode';
import type { ParsedQuery, ParsedQueryNode } from '../ParsedQueryNode';
import type { JsonObject, JsonValue, PathPart } from '../primitive';
import type { NodeId, OperationInstance, RawOperation } from '../schema';
import type { NodeSnapshot } from '../nodes';
import * as schema from '../schema';
import * as util from '../util';
import * as nodes from '../nodes';

import * as snapshotEditor from './SnapshotEditor';
import { FieldFunctions, getReadFunction, withReferences } from './fieldFunctions';

const makeRef = makeReference;
const { isRootNodeId } = schema;
const { cloneNodeSnapshot, EntitySnapshot, ParameterizedValueSnapshot } = nodes;
const { nodeIdForStoreKey } = snapshotEditor;
const { deepGet, isNil, isObject, isReference, lazyImmutableDeepSet, safeStringify } = util;

export interface QueryResult {
  /** The value of the root requested by a query. */
  result?: JsonObject;
  /** Whether the query's selection set was satisfied. */
  complete: boolean;
  /** The ids of entity nodes selected by the query. */
  entityIds?: Set<NodeId>;
  /** The ids of nodes overlaid on top of static cache results. */
  dynamicNodeIds?: Set<NodeId>;
  /**
   * What is missing from an incomplete result (built when first accessed, like
   * InMemoryCache's diff.missing).
   */
  missing?: MissingFieldError;
  /**
   * Whether an incomplete result has a value for any field the query selects
   * at its root. (Hermes' results can hold other fields of the root object,
   * which do not count.)
   */
  hasSelectedData?: boolean;
}

/** The (shared, frozen) result of a complete read that selects no fields. */
const EMPTY_RESULT: JsonObject = Object.freeze({});

/**
 * The Apollo Client 4 Cache.DiffResult for a read, like InMemoryCache's: an
 * incomplete result is null unless partial data is requested (the default)
 * and at least one selected field was found.
 */
export function toDiffResult<TData = unknown>(
  queryResult: QueryResult,
  returnPartialData = true,
  fromOptimisticTransaction?: boolean,
): Cache.DiffResult<TData> {
  const { result, complete } = queryResult;
  let diff: Cache.DiffResult<TData>;
  if (complete) {
    // Like InMemoryCache, a complete result has a `missing: undefined` property,
    // and a read that selects no fields (they are all skipped) has an empty
    // result, even when nothing was written.
    diff = { result: (result ?? EMPTY_RESULT) as any, complete: true, missing: undefined };
  } else {
    const keepResult = returnPartialData && !!result && hasSelectedData(queryResult);
    diff = {
      result: keepResult ? (result as any) : null,
      complete: false,
      // Like InMemoryCache, missing is a getter (which builds the error lazily).
      get missing() {
        return queryResult.missing;
      },
    };
  }
  if (fromOptimisticTransaction) diff.fromOptimisticTransaction = true;
  return diff;
}

/** Whether a (possibly incomplete) result has a value for any field the query selects at its root. */
function hasSelectedData({ result, hasSelectedData: selected }: QueryResult): boolean {
  return selected ?? (!!result && Object.keys(result).length > 0);
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
  try {
    return _read(context, operation, snapshot, tempStore, includeNodeIds, queryResult, tracerContext);
  } catch (error) {
    // A read that throws (e.g. for a list of entities selected without a
    // selection set) leaves no partial result behind.
    snapshot.readCache.delete(operation);
    throw error;
  }
}

function _read<TSerialized>(
  context: CacheContext<TSerialized>,
  operation: OperationInstance<TSerialized>,
  snapshot: GraphSnapshot,
  tempStore: NodeSnapshotMap,
  includeNodeIds: boolean | undefined,
  queryResult: Partial<QueryResultWithNodeIds>,
  tracerContext: unknown,
) {
  let cacheHit = true;
  if (!queryResult.result) {
    cacheHit = false;
    const rootSnapshot = snapshot.getNodeSnapshot(operation.rootId);
    if (!rootSnapshot && !isRootNodeId(operation.rootId)) {
      // Like InMemoryCache, reading from a missing entity reports a dangling
      // reference, with an empty result.
      queryResult.result = {};
      queryResult.complete = false;
      queryResult.hasSelectedData = false;
      setMissing(queryResult, operation, `Dangling reference to missing ${operation.rootId} object`);
      queryResult.entityIds = includeNodeIds ? new Set([operation.rootId]) : undefined;
    } else {
      const { data, outbound, parameterized } = rootSnapshot ?? {};
      queryResult.result = data as JsonObject;

      // Fields whose read function returned a reference to a missing entity.
      const danglingFields: DanglingFields = new WeakMap();
      if (
        ((!operation.isStatic || context.policies.hasFieldPolicies) &&
          (data || outbound || parameterized || context.policies.hasFieldPolicies)) ||
        (operation.parsedQuery.__typename &&
          // An empty root (e.g. after writing `{}`) still reads its __typename.
          (data || isRootNodeId(operation.rootId)) &&
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
        if (!checked.complete) queryResult.hasSelectedData = checked.hasSelectedData;
        if (checked.missing) setMissing(queryResult, operation, checked.missing);
        if (checked.result !== queryResult.result) {
          queryResult.result = checked.result;
          if (context.freezeSnapshots) util.deepFreeze(queryResult.result);
        }
      }
    }
  }

  // We can potentially ask for results without node ids first, and then follow
  // up with an ask for them.  In that case, we need to fill in the cache a bit
  // more. (Only the ids: the first read, which knew which fields' read
  // functions returned dangling references, determined completeness.)
  if (includeNodeIds && !queryResult.entityIds) {
    cacheHit = false;
    const entityIds = new Set<NodeId>([operation.rootId]);
    if (snapshot.getNodeSnapshot(operation.rootId) || isRootNodeId(operation.rootId)) {
      _visitSelection(operation, context, queryResult.result, entityIds, { snapshot, tempStore });
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
    /** The result object being built (a copy of `source`, which the walk overlays). */
    public readonly value: JsonObject,
    /**
     * The object `value` was copied from, which the walk reads fields from
     * (so that overlaying a key never changes what other keys read).
     */
    public readonly source: JsonObject,
    public readonly containerId: NodeId,
    public readonly parsedMap: ParsedQuery,
    public readonly path: PathPart[],
    /**
     * For (unidentified) objects within the result of a read function: the
     * object as the read function returned it (which, unlike stored data, may
     * hold References at any depth, and fields under their store field names).
     */
    public readonly unnormalized?: JsonObject,
  ) {}
}

/**
 * The ids of the entities whose data (copies of it) results hold, where they
 * were found by following References (e.g. those returned by read functions,
 * which need not be at the entities' stored paths).
 */
const resultEntityIds = new WeakMap<object, NodeId>();

/**
 * Walks a parameterized field map, overlaying values at those paths on top of
 * existing results.
 *
 * Overlaid values are (shallow) copies of the original results' objects, with
 * their own properties set to the parameterized values (or copies of the
 * objects that contain them); the original results are left untouched.
 */
function _walkAndOverlayDynamicValues<TSerialized>(
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
  if (!snapshot.getNodeSnapshot(id) && !isRootNodeId(id)) return result;

  // TODO: A better approach here might be to walk the outbound references from
  // each node, rather than walking the result set.  We'd have to store the path
  // on parameterized value nodes to make that happen.

  const newResult = _wrapValue(result, context) as JsonObject;
  // TODO: This logic sucks.  We'd do much better if we had knowledge of the
  // schema.  Can we layer that on in such a way that we can support uses w/ and
  // w/o a schema compilation step?
  const queue = [new OverlayWalkNode(newResult, result ?? {}, id, query.parsedQuery, [])];

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
    // Custom scalar values are stored serialized.
    value = context.scalars.serializeStoreObject(value);
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

  // The entities whose data References were resolved to (by data).
  const resolvedIds = new WeakMap<object, NodeId>();
  const resolveReference = (ref: Reference) => {
    const data = getSnapshot(ref.__ref)?.data;
    if (data !== null && typeof data === 'object') resolvedIds.set(data, ref.__ref);
    return data;
  };
  const isDangling = (value: unknown) => isReference(value) && !getSnapshot(value.__ref) && !isRootNodeId(value.__ref);

  // Replaces References (returned by read functions) with the data of the
  // entities they point to.  Like InMemoryCache, lists of objects (with
  // `dropDangling`) skip References to missing entities.
  function resolveReferences(value: any, dropDangling = false): any {
    if (isReference(value)) return resolveReference(value);
    if (!Array.isArray(value)) return value;
    let resolved = value;
    for (let i = 0; i < value.length; i++) {
      const item = resolveReferences(value[i], dropDangling);
      if (item !== value[i]) {
        if (resolved === value) resolved = [...value];
        resolved[i] = item;
      }
    }
    if (dropDangling && resolved !== value && value.some(isDangling)) {
      resolved = resolved.filter((_item: unknown, i: number) => !isDangling(value[i]));
    }
    return resolved;
  }

  const { hasFieldPolicies } = context.policies;
  const isObjectOrArray = (value: unknown) => value !== null && typeof value === 'object';

  // Walk breadth-first, so read functions run in the order of the results.
  for (let q = 0; q < queue.length; q++) {
    const walkNode = queue[q];
    const { value, source, parsedMap, unnormalized } = walkNode;
    let { containerId, path } = walkNode;
    // The object read from (e.g. a root object, which may have an id field) is
    // not identified by its data.
    const valueId =
      q === 0
        ? undefined
        : (resultEntityIds.get(value) ??
          identifyStored(context, value, () => {
            const reference = getSnapshot(containerId)?.outbound?.get(path.join('.'));
            return reference && getSnapshot(reference.id) ? reference.id : undefined;
          }));
    if (valueId) {
      containerId = valueId;
      path = [];
    }

    let typeName = value.__typename as string;
    if (!typeName && path.length === 0) {
      // Like InMemoryCache, root objects have their root type's __typename.
      typeName = context.rootTypename(containerId)!;
    }

    // Read functions are called on a Reference to the entity being walked, or
    // (for unidentified objects) on the stored object itself.
    const containerSnapshot = getSnapshot(containerId);
    // (Objects within read function results are passed as they were returned.)
    const currentObject: StoreObject | Reference =
      path.length === 0 && !(containerSnapshot instanceof ParameterizedValueSnapshot)
        ? makeRef(containerId)
        : (unnormalized ?? withReferences(containerSnapshot, path, deepGet(containerSnapshot?.data, path)) ?? value);
    // The value a read function returns (with its References resolved), or the
    // missing entity its (Reference) result points to.
    const callReadFunction = (
      readFn: FieldReadFunction,
      existing: StoreValue,
      fieldName: string,
      node: ParsedQueryNode,
      storeKey: StoreKey,
    ): { value: any; dangling?: undefined } | { value?: undefined; dangling: NodeId } => {
      const args = (node.args as JsonObject | undefined) ?? null;
      const storeFieldName = storeFieldNameOf(fieldName, storeKey, args);
      const storageKeys = [containerId, ...path, storeFieldName];
      const readResult = readFn(
        existing,
        fieldFunctions.options(currentObject, fieldName, storeFieldName, args, storageKeys, fieldNodeOf(node)),
      );
      if (isDangling(readResult)) return { dangling: (readResult as Reference).__ref };
      return { value: resolveReferences(readResult, !!node.children) };
    };

    for (const key in parsedMap) {
      let node = parsedMap[key];
      // Fields of fragments that don't match the type are not selected.
      if (node.alternatives) {
        // The field selected under this key for objects of this type.
        const alternative = alternativeForType(context, node, typeName);
        if (!alternative) continue;
        node = alternative;
      } else if (node.conditions && !context.conditionsMatch(node.conditions, typeName)) {
        continue;
      }
      let child;

      // This is an alias if we have a schemaName declared.
      const fieldName = node.schemaName ? node.schemaName : key;
      // Like InMemoryCache, the scalar policies of fields with selection sets
      // are ignored.
      const readFn = node.children
        ? context.policies.getReadFunction(typeName, fieldName)
        : getReadFunction(context, typeName, fieldName);

      let nextContainerId = containerId;
      let nextPath = path;

      // Fields are stored under their arguments, or as their keyArgs policies
      // (or @connection directives) say.
      const storeKey = storeKeyOf(context, typeName, fieldName, node, query.variables);

      // The field's value within an object returned by a read function: like
      // InMemoryCache, under its store field name.
      const storeFieldName =
        unnormalized && storeKey !== undefined
          ? storeFieldNameOf(fieldName, storeKey, node.args as JsonObject | undefined)
          : undefined;
      const hasUnnormalizedValue = storeFieldName !== undefined && hasOwn.call(unnormalized, storeFieldName);
      if (hasUnnormalizedValue && !readFn) {
        nextPath = [...path, storeFieldName];
        child = unnormalized![storeFieldName];
      } else if (storeKey !== undefined) {
        let childId = nodeIdForStoreKey(containerId, [...path, fieldName], storeKey);
        let childSnapshot: Readonly<NodeSnapshot> | undefined = getSnapshot(childId);

        if (readFn) {
          dynamicNodeIds.add(childId);
          const existing = hasUnnormalizedValue
            ? unnormalized![storeFieldName]
            : childSnapshot && withReferences(childSnapshot, [], childSnapshot.data);
          const read = callReadFunction(readFn, existing, fieldName, node, storeKey);
          if (read.dangling !== undefined) {
            markDangling(value, key, read.dangling);
            continue;
          }
          child = read.value;
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

          // Still no snapshot? Ok we're done here.  (The field is missing,
          // even if its container holds a value for the field stored under
          // its name, e.g. one written without arguments.)
          if (!childSnapshot) {
            delete value[key];
            continue;
          }
          child = childSnapshot.data;
        }

        nextContainerId = childId;
        nextPath = [];
      } else {
        nextPath = [...path, fieldName];
        child = unnormalized ? unnormalized[fieldName] : source[fieldName];
        if (readFn) {
          const existing = unnormalized ? child : withReferences(containerSnapshot, nextPath, child);
          const read = callReadFunction(readFn, existing, fieldName, node, storeKey);
          if (read.dangling !== undefined) {
            markDangling(value, key, read.dangling);
            continue;
          }
          child = read.value;
        }
      }

      // Whether the value is (within) one returned by a read function.
      let childUnnormalized = !!readFn || !!unnormalized;
      const isRef = isReference(child);
      if (isRef) {
        if (isDangling(child)) {
          markDangling(value, key, child.__ref);
          continue;
        }
        child = resolveReference(child);
        childUnnormalized = false;
      } else if (unnormalized && !readFn && node.children && Array.isArray(child)) {
        // Lists within read function results may hold References too.
        child = resolveReferences(child, true);
      } else if (child === undefined) {
        const reference = getSnapshot(nextContainerId)?.outbound?.get(nextPath.join('.'));
        if (reference && !getSnapshot(reference.id) && !isRootNodeId(reference.id)) {
          markDangling(value, key, reference.id);
          continue;
        }
      }

      if (node.children && !readFn && child != null && isDev()) {
        const scalar = context.policies.getScalarTypeForField(typeName, fieldName);
        if (scalar) {
          invariant.warn(
            "The field policy for '%s' is configured with the '%s' scalar, but the field is not a scalar field because it contains a selection set. The field value remains unchanged.",
            `${typeName}.${fieldName}`,
            scalar,
          );
        }
      }

      // Objects (at any depth) may have fields with read functions.
      const hasPolicy = hasFieldPolicies && node.children && isObjectOrArray(child);

      // Have we reached a leaf (either in the query, or in the cache)?
      if (hasPolicy || isRef || _shouldWalkChildren(child, node)) {
        const original = child;
        child = _recursivelyWrapValue(child, context);
        const allChildValues = _flattenGraphQLObject(child, nextPath);
        // Only the child selections of fragments that match the type apply.
        const children = childrenForType(context, node, typeName) ?? {};
        // (Wrapping copies objects, keeping the structure of lists.)
        const originals = _flattenGraphQLObject(original as UnknownGraphQLObject, nextPath);

        for (let i = 0; i < allChildValues.length; i++) {
          const item = allChildValues[i];
          const originalItem = originals[i]?.value;
          const entityId = isObject(originalItem) ? resolvedIds.get(originalItem) : undefined;
          if (entityId !== undefined) resultEntityIds.set(item.value, entityId);
          queue.push(
            new OverlayWalkNode(
              item.value,
              isObject(originalItem) ? originalItem : item.value,
              nextContainerId,
              children,
              item.path,
              childUnnormalized && entityId === undefined && isObject(originalItem) ? originalItem : undefined,
            ),
          );
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
      } else if (readFn || key !== fieldName) {
        // Like InMemoryCache, a read function returning undefined makes the
        // field missing, even when the cache holds a value for it. (So does a
        // missing aliased field, even when the result holds a stored field
        // named like its alias.)
        delete value[key];
        // Nor is the field's stored value (under its schema name) part of the
        // result, unless another selection's response key is that name.
        if (readFn && key !== fieldName && !(fieldName in parsedMap)) delete value[fieldName];
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
 * The id of a value read from the cache (or returned by a read function).
 *
 * Unlike writes, reads do not call keyFields functions (which, like
 * InMemoryCache's, expect the written data and its selection set); the id of a
 * value of such a type is found in the graph instead (with `fallback`).
 */
function identifyStored<TSerialized>(
  context: CacheContext<TSerialized>,
  value: unknown,
  fallback?: () => NodeId | undefined,
): NodeId | undefined {
  if (!isObject(value)) return undefined;
  if (context.policies.hasKeyFieldsFunction((value as JsonObject).__typename)) return fallback?.();
  return context.entityIdForValue(value);
}

/**
 * Fields (by result object and key) whose value is a reference to a missing
 * entity, as returned by a read function.
 */
type DanglingFields = WeakMap<JsonObject, Map<string, NodeId>>;

/** Whether a parsed __typename field was selected by the document itself, not added by addTypenameToDocument. */
function selectsTypename(node: ParsedQueryNode): boolean {
  const field = fieldNodeOf(node);
  return !!field && util.isSelectedByCaller(field);
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
    selects = util.someSelection(
      [info.operation.selectionSet],
      name => info.fragmentMap[name]?.selectionSet,
      selection =>
        selection.kind === 'Field' &&
        selection.name.value === '__typename' &&
        util.isSelectedByCaller(selection, info.pretransformed),
    );
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

function addMissingField(tree: MissingTree | undefined, path: PathPart[], message: string): MissingTree {
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

interface VisitSelectionOptions {
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
function _visitSelection<TSerialized>(
  query: OperationInstance<TSerialized>,
  context: CacheContext<TSerialized>,
  result?: JsonObject,
  nodeIds?: Set<NodeId>,
  options: VisitSelectionOptions = {},
): { complete: boolean; missing?: MissingTree; hasSelectedData: boolean; result?: JsonObject } {
  const { snapshot, tempStore, danglingFields } = options;
  let complete = true;
  let missingTree: MissingTree | undefined;
  // Whether the result has a value for any field selected at its root.
  let hasSelectedData = false;
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
    return reference && !getNode(reference.id) && !isRootNodeId(reference.id) ? reference.id : undefined;
  };
  const addMissing = (path: PathPart[], message: string) => {
    complete = false;
    missingTree = addMissingField(missingTree, path, message);
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
    if (!typeName && containerPath.length === 0) {
      typeName = context.rootTypename(containerId) ?? typeName;
    }
    for (const key in parsed) {
      let node = parsed[key];
      // Fields of fragments that don't match the type are not selected.
      if (node.alternatives) {
        // The field selected under this key for objects of this type.
        const alternative = alternativeForType(context, node, typeName);
        if (!alternative) continue;
        node = alternative;
      } else if (node.conditions && !context.conditionsMatch(node.conditions, typeName)) {
        continue;
      }
      const fieldValue = value[key];
      const danglingId = danglingFieldIds?.get(key);
      // (Dangling references read as empty objects.)
      if (fieldValue !== undefined && !resultPath.length) hasSelectedData = true;

      if (danglingId !== undefined) {
        addMissing([...resultPath, key], `Dangling reference to missing ${danglingId} object`);
        continue;
      }
      // Leaf fields that are present need no further work.
      if (fieldValue !== undefined && (!node.children || fieldValue === null)) {
        // Like InMemoryCache (in development), lists of entities need a selection set.
        if (!node.children && Array.isArray(fieldValue) && snapshot && isDev()) {
          assertSelectionSetForList(node, key, typeName, containerId, containerPath);
        }
        continue;
      }

      const fieldName = node.schemaName ?? key;
      if (fieldValue === undefined) {
        // Like InMemoryCache, only a __typename the document selects itself (not
        // one added by addTypenameToDocument) can be missing; roots always have one.
        if (
          key === '__typename' &&
          ((!containerPath.length && context.rootTypename(containerId)) || !selectsTypename(node))
        )
          continue;
        let target;
        if (snapshot) {
          const [fieldContainerId, fieldPath] = fieldLocation(typeName, fieldName, node, containerId, containerPath);
          target = missingTarget(fieldContainerId, fieldPath);
        }
        let message;
        if (target !== undefined) {
          message = `Dangling reference to missing ${target} object`;
          if (!resultPath.length) hasSelectedData = true;
          // Like InMemoryCache, a dangling reference reads as an empty object.
          danglingObjects.push([...resultPath, key]);
        } else {
          const isEntity =
            !containerPath.length && (isRootNodeId(containerId) || getNode(containerId) instanceof EntitySnapshot);
          // Like InMemoryCache's store objects, __typename comes first.
          const shown = '__typename' in value ? { __typename: value.__typename, ...value } : value;
          const objOrNodeId = isEntity ? `${containerId} object` : `object ${safeStringify(shown)}`;
          message = `Can't find field '${fieldName}' on ${objOrNodeId}`;
        }
        addMissing([...resultPath, key], message);
        continue;
      }
      // Only the child selections of fragments that match the type apply.
      const children = childrenForType(context, node, typeName);
      if (!children) continue;

      const [fieldContainerId, fieldPath] = fieldLocation(typeName, fieldName, node, containerId, containerPath);
      visitValue(fieldValue, children, fieldContainerId, fieldPath, [...resultPath, key]);
    }
  }

  /**
   * The node a field's value is stored in, and its path there: a parameterized
   * value node for fields stored under a key, the container otherwise.
   */
  function fieldLocation(
    typeName: unknown,
    fieldName: string,
    node: ParsedQueryNode,
    containerId: NodeId,
    containerPath: PathPart[],
  ): [NodeId, PathPart[]] {
    const fieldPath = [...containerPath, fieldName];
    const storeKey = storeKeyOf(context, typeName, fieldName, node, query.variables);
    return storeKey !== undefined
      ? [nodeIdForStoreKey(containerId, fieldPath, storeKey), []]
      : [containerId, fieldPath];
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
    let entityId = resultEntityIds.get(value) ?? identifyStored(context, value);
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

  /**
   * Throws InMemoryCache's error for a list field without a selection set
   * whose items are (or contain) entities.
   */
  function assertSelectionSetForList(
    node: ParsedQueryNode,
    key: string,
    typeName: unknown,
    containerId: NodeId,
    containerPath: PathPart[],
  ) {
    const fieldName = node.schemaName ?? key;
    const [fieldContainerId, path] = fieldLocation(typeName, fieldName, node, containerId, containerPath);
    for (const reference of getNode(fieldContainerId)?.outbound?.values() ?? []) {
      if (reference.path.length > path.length && util.pathBeginsWith(reference.path, path)) {
        const data = getNode(reference.id)?.data;
        const typename = isObject(data) ? data.__typename : undefined;
        throw new InvariantError(
          `Missing selection set for object of type ${String(typename)} returned for query field ${fieldName}`,
        );
      }
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

  return { complete, missing: missingTree, hasSelectedData, result: filteredResult };
}

/**
 * Sets the MissingFieldError of a result, describing what is missing
 * (`missing`); like InMemoryCache's, the error is only built when accessed.
 */
function setMissing(queryResult: Partial<QueryResult>, operation: OperationInstance<any>, missing: MissingTree) {
  let error: MissingFieldError | undefined;
  Object.defineProperty(queryResult, 'missing', {
    configurable: true,
    enumerable: true,
    get: () =>
      (error ??= new MissingFieldError(firstMissing(missing), missing, operation.document, operation.variables ?? {})),
  });
}

/**
 * The store key of a field (see StoreFieldNames#storeKey). Without arguments
 * or field policies (which configure keyArgs), it is stored under its name.
 */
function storeKeyOf<TSerialized>(
  context: CacheContext<TSerialized>,
  typeName: unknown,
  fieldName: string,
  node: ParsedQueryNode,
  variables: JsonObject | undefined,
): StoreKey {
  if (!node.args && !context.policies.hasFieldPolicies) return undefined;
  return context.storeFieldNames.storeKey(
    typeName,
    fieldName,
    node.args as JsonObject | undefined,
    fieldNodeOf(node),
    variables,
  );
}
