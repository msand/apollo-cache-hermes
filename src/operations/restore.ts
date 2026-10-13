import type { NormalizedCacheObject } from '@apollo/client/cache';

import { CacheSnapshot } from '../CacheSnapshot';
import { CacheContext } from '../context';
import { fieldNameFromStoreName, parseStoreFieldName } from '../context/storeFieldNames';
import { GraphSnapshot, NodeSnapshotMap } from '../GraphSnapshot';
import { EntitySnapshot, NodeReference, ParameterizedValueSnapshot } from '../nodes';
import { OptimisticUpdateQueue } from '../OptimisticUpdateQueue';
import { JsonObject, JsonScalar, JsonValue, NestedArray, NestedObject, NestedValue, PathPart } from '../primitive';
import { NodeId, Serializable } from '../schema';
import * as util from '../util';

import { nodeIdForParameterizedValue, nodeIdForStoreKey } from './SnapshotEditor';

const { getInbound, getOutbound, getParameterized, isNumber, isObject, isReference, isScalar, iterRefs, refToInKey } =
  util;

/** The keys of a node snapshot serialized by extract(). */
const nodeSnapshotKeys = new Set(['type', 'data', 'inbound', 'outbound', 'parameterized']);

/**
 * Whether a serialized node is one of Hermes' (from extract()): an object with
 * a numeric `type` and only the keys extract() writes. InMemoryCache store
 * objects (which may well have a `type` field) have other fields too.
 */
function isSerializedNodeSnapshot(state: unknown): state is Serializable.NodeSnapshot {
  return (
    isObject(state) && typeof state.type === 'number' && Object.keys(state).every(key => nodeSnapshotKeys.has(key))
  );
}

/**
 * A copy of an InMemoryCache store value (found at `path`) with null in place
 * of each Reference within it, as Hermes stores the slots of references
 * (restoreEntityReferences fills them in), calling `onReference` for each.
 */
function withoutReferences(
  value: unknown,
  path: PathPart[],
  onReference: (id: NodeId, path: PathPart[]) => void,
): JsonValue {
  if (isReference(value)) {
    onReference(value.__ref, path);
    return null;
  }
  if (Array.isArray(value)) {
    let copy: JsonValue[] | undefined;
    value.forEach((item, index) => {
      const newItem = withoutReferences(item, [...path, index], onReference);
      if (newItem !== item) (copy ??= value.slice())[index] = newItem;
    });
    return copy ?? (value as JsonValue[]);
  }
  if (isObject(value)) {
    let copy: JsonObject | undefined;
    for (const key of Object.keys(value)) {
      const newValue = withoutReferences(value[key], [...path, key], onReference);
      if (newValue !== value[key]) (copy ??= { ...value })[key] = newValue;
    }
    return copy ?? value;
  }
  return value as JsonValue;
}

/**
 * Restore GraphSnapshot from serializable representation.
 *
 * The parameter 'serializedState' is likely to be result running JSON.stringify
 * on a result of 'extract' method. This function will directly reference object
 * in the serializedState, except for the data of nodes with references, which
 * it copies before patching (so the serializedState itself is never modified).
 *
 * @throws Will throw an error if 'type' in serializedState cannot be mapped to
 *    different sub-class of NodeSnapshot.
 * @throws Will throw an error if there is undefined in sparse array
 */
export function restore<TSerialized>(
  serializedState: Serializable.GraphSnapshot | NormalizedCacheObject,
  cacheContext: CacheContext<TSerialized>,
) {
  const { nodesMap, editedNodeIds, extraRootIds } = createGraphSnapshotNodes(serializedState, cacheContext);
  const graphSnapshot = new GraphSnapshot(nodesMap);

  return {
    cacheSnapshot: new CacheSnapshot(graphSnapshot, graphSnapshot, new OptimisticUpdateQueue()),
    editedNodeIds,
    /** The ids InMemoryCache had retained (from its extract()'s __META), which the cache should retain. */
    extraRootIds,
  };
}

function createGraphSnapshotNodes<TSerialized>(
  serializedState: Serializable.GraphSnapshot | NormalizedCacheObject,
  cacheContext: CacheContext<TSerialized>,
) {
  const nodesMap: NodeSnapshotMap = Object.create(null);
  const editedNodeIds = new Set<NodeId>();
  let extraRootIds: string[] = [];

  const missingPointers = new Map<NodeId, NodeReference[]>();
  // Adds a reference from (the `path` of) node `fromId` to node `id`.
  const addReference = (fromId: NodeId, id: NodeId, path: PathPart[], outbound: NodeReference[]) => {
    outbound.push({ id, path });
    const reverse: NodeReference = { id: fromId, path };
    const target = nodesMap[id];
    if (target) {
      (target.inbound ??= new Map()).set(refToInKey(reverse), reverse);
    } else {
      const references = missingPointers.get(id);
      if (references === undefined) {
        missingPointers.set(id, [reverse]);
      } else {
        references.push(reverse);
      }
    }
  };

  // Create entity nodes in the GraphSnapshot
  for (const nodeId in serializedState) {
    const state = serializedState[nodeId];
    if (state === undefined) continue;
    if (nodeId === '__META' && !isSerializedNodeSnapshot(state)) {
      // InMemoryCache's extract() lists the ids it retained.
      extraRootIds = (state as NonNullable<NormalizedCacheObject['__META']>).extraRootIds ?? [];
      continue;
    }
    const { type, data, inbound, outbound, parameterized } = isSerializedNodeSnapshot(state)
      ? state
      : ({} as Serializable.NodeSnapshot);

    let nodeSnapshot;
    switch (type) {
      case Serializable.NodeSnapshotType.EntitySnapshot:
        nodeSnapshot = new EntitySnapshot(
          (outbound || parameterized ? cloneJson(data) : data) as JsonObject,
          getInbound(inbound),
          getOutbound(outbound),
          getParameterized(parameterized),
        );
        break;
      case Serializable.NodeSnapshotType.ParameterizedValueSnapshot:
        nodeSnapshot = new ParameterizedValueSnapshot(
          (outbound || parameterized ? cloneJson(data) : data) as JsonValue,
          getInbound(inbound),
          getOutbound(outbound),
          getParameterized(parameterized),
        );
        break;
      case undefined: {
        // An InMemoryCache store object.
        const parsed: JsonObject = {};
        const parsedIn = missingPointers.get(nodeId);
        const parsedOut: NodeReference[] = [];
        const parsedParameterized: NodeReference[] = [];
        // A parameterized value node for the field `fieldName`, whose value
        // (and the references within it) is `val`.
        const addParameterizedValue = (fieldId: NodeId, fieldName: string, val: unknown) => {
          const path = [fieldName];
          const fieldOut: NodeReference[] = [];
          const fieldData = withoutReferences(val, [], (id, refPath) => addReference(fieldId, id, refPath, fieldOut));
          nodesMap[fieldId] = new ParameterizedValueSnapshot(
            fieldData,
            [{ id: nodeId, path }],
            fieldOut.length ? fieldOut : undefined,
          );
          editedNodeIds.add(fieldId);
          parsedParameterized.push({ id: fieldId, path });
        };
        // Hermes stores fields with custom directives (e.g. `lastName@upperCase`)
        // like the same fields without them; so a field without directives
        // takes precedence (and otherwise the first one found).
        const entries = Object.entries(state as Record<string, unknown>).sort(
          ([a], [b]) => Number(a.includes('@')) - Number(b.includes('@')),
        );
        for (const [key, val] of entries) {
          const fieldName = fieldNameFromStoreName(key);
          if (key.charAt(fieldName.length) === ':') {
            // A field stored per its keyArgs policy (or @connection directive),
            // under InMemoryCache's store field name (e.g. `feed:{"type":"news"}`).
            addParameterizedValue(nodeIdForStoreKey(nodeId, [fieldName], key), fieldName, val);
            continue;
          }
          // Other InMemoryCache store field names (from getStoreKeyName): fields
          // with arguments are parameterized value nodes.
          const storeFieldName = parseStoreFieldName(key);
          if (storeFieldName?.args && Object.keys(storeFieldName.args).length) {
            const path = [storeFieldName.fieldName];
            addParameterizedValue(
              nodeIdForParameterizedValue(nodeId, path, storeFieldName.args),
              storeFieldName.fieldName,
              val,
            );
            continue;
          }
          const fieldKey = storeFieldName ? storeFieldName.fieldName : key;
          if (fieldKey !== key && (fieldKey in parsed || parsedOut.some(ref => ref.path[0] === fieldKey))) continue;
          parsed[fieldKey] = withoutReferences(val, [fieldKey], (id, path) =>
            addReference(nodeId, id, path, parsedOut),
          );
        }
        nodeSnapshot = new EntitySnapshot(
          parsed as JsonObject,
          parsedIn,
          parsedOut.length ? parsedOut : undefined,
          parsedParameterized.length ? parsedParameterized : undefined,
        );
        break;
      }
      default:
        throw new Error(`Invalid Serializable.NodeSnapshotType ${type} at ${nodeId}`);
    }

    nodesMap[nodeId] = nodeSnapshot!;
    editedNodeIds.add(nodeId);
  }

  // Patch data property and reconstruct references
  restoreEntityReferences(nodesMap, cacheContext);

  return { nodesMap, editedNodeIds, extraRootIds };
}

/**
 * Deep copies JSON-like data (arrays and plain objects), preserving holes and
 * undefined values.
 */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    value.forEach((item, index) => (copy[index] = cloneJson(item)));
    return copy as T;
  }
  if (isObject(value)) {
    const copy: Record<string, unknown> = {};
    for (const key of Object.keys(value)) copy[key] = cloneJson((value as Record<string, unknown>)[key]);
    return copy as T;
  }
  return value;
}

function set(data: NestedArray<JsonScalar> | NestedObject<JsonScalar>, path: PathPart[], value: JsonValue | undefined) {
  let obj = data;
  const l = path.length - 1;
  for (let i = 0; i < l; i++) {
    const key = path[i];
    if (!(key in obj)) {
      obj[key] = typeof key === 'string' ? {} : [];
    }
    obj = obj[key];
  }
  obj[path[l]] = value;
}

function restoreEntityReferences<TSerialized>(nodesMap: NodeSnapshotMap, cacheContext: CacheContext<TSerialized>) {
  const { entityTransformer, entityIdForValue } = cacheContext;

  for (const nodeId in nodesMap) {
    const { data, outbound, parameterized } = nodesMap[nodeId];
    if (entityTransformer && isObject(data) && entityIdForValue(data)) {
      entityTransformer(data);
    }

    // If it doesn't have outbound then 'data' doesn't have any references
    // If it is 'undefined' means that there is no data value
    // in both cases, there is no need for modification.
    if ((!outbound && !parameterized) || data === undefined) {
      continue;
    }

    for (const { id: referenceId, path } of iterRefs(outbound, parameterized)) {
      const referenceNode = nodesMap[referenceId];
      if (!referenceNode) {
        // A dangling reference (to a deleted entity) has no data.
        if (!path.length) {
          nodesMap[nodeId].data = undefined;
        } else if (Array.isArray(data) || isObject(data)) {
          set(data, path, undefined);
        }
      } else if (referenceNode instanceof EntitySnapshot && data === null) {
        // data is a reference.
        nodesMap[nodeId].data = referenceNode.data;
      } else if (referenceNode instanceof ParameterizedValueSnapshot) {
        // This is specifically to handle a sparse array which happen
        // when each element in the array reference data in a
        // ParameterizedValueSnapshot.
        // (see: parameterizedFields/nestedParameterizedReferenceInArray.ts)
        // We only want to try walking if its data contains an array
        const hasArrayIndex = path.some(part => isNumber(part));
        if (hasArrayIndex) {
          tryRestoreSparseArray(data, path, 0);
        }
      } else if (Array.isArray(data) || isObject(data)) {
        set(data, path, referenceNode.data);
      }
    }
  }
}

/**
 * Helper function to walk 'data' according to the given path
 * and try to recreate sparse array when encounter 'null' in array along
 * the path.
 *
 * The function assumes that the given data already has the shape of the path
 * For example:
 *    path -> ['one', 0, 'two', 1] will be with
 *    data ->
 *    { one: [
 *        two: [null, <some data>]
 *    ]}
 *
 * This is garunteed to be such a case because when we extract sparse array,
 * we will set 'undefined' as value of an array which will then be
 * JSON.stringify to 'null' and will preserve the structure along the path
 *
 */
function tryRestoreSparseArray(
  data: NestedValue<JsonValue | undefined>,
  possibleSparseArrayPaths: PathPart[],
  idx: number,
) {
  if (data === undefined) {
    // There should never be 'undefined'
    throw new Error(`Unexpected 'undefined' in the path [${possibleSparseArrayPaths}] at index ${idx}`);
  }

  if (idx >= possibleSparseArrayPaths.length || data === null || isScalar(data)) {
    return;
  }

  const prop = possibleSparseArrayPaths[idx];
  if (Array.isArray(data) && typeof prop === 'number' && data[prop] === null) {
    // truely make it sparse rather than just set "undefined'"
    delete data[prop];
    return;
  }

  tryRestoreSparseArray((data as JsonObject)[prop], possibleSparseArrayPaths, idx + 1);
}
