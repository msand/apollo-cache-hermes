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

const {
  getInbound,
  getOutbound,
  getParameterized,
  isNumber,
  isObject,
  isReference,
  isScalar,
  iterRefs,
  lazyImmutableDeepSet,
  refToInKey,
} = util;

/** The keys of a node snapshot serialized by extract(). */
const nodeSnapshotKeys = new Set(['type', 'data', 'inbound', 'outbound', 'parameterized']);

/**
 * Whether a serialized node is one of Hermes' (from extract()): an object with
 * a numeric `type` and only the keys extract() writes. InMemoryCache store
 * objects (which may well have a `type` field) have other fields too.
 */
function isSerializedNodeSnapshot(state: unknown): state is Serializable.NodeSnapshot {
  if (!isObject(state) || typeof state.type !== 'number') return false;
  for (const key in state) {
    if (!nodeSnapshotKeys.has(key)) return false;
  }
  return true;
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
  // (Every node created is an edited node.)
  const graphSnapshot = new GraphSnapshot(nodesMap, undefined, undefined, editedNodeIds.size);

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
  // The serialized data of the nodes whose references are filled in below,
  // which is copied (along their paths) rather than changed.
  const originals = new Map<NodeId, unknown>();
  // (Entity transformers change data in place, so it is copied for them.)
  const ownData = (nodeId: NodeId, data: unknown) => {
    if (cacheContext.entityTransformer) return cloneJson(data);
    originals.set(nodeId, data);
    return data;
  };
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
          (outbound || parameterized ? ownData(nodeId, data) : data) as JsonObject,
          getInbound(inbound),
          getOutbound(outbound),
          getParameterized(parameterized),
        );
        break;
      case Serializable.NodeSnapshotType.ParameterizedValueSnapshot:
        nodeSnapshot = new ParameterizedValueSnapshot(
          (outbound || parameterized ? ownData(nodeId, data) : data) as JsonValue,
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
  restoreEntityReferences(nodesMap, cacheContext, originals);

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

/** Calls `callback` with each reference, in the order of iterRefs (without its generator). */
function forEachRef(
  outbound: Map<string, NodeReference> | undefined,
  parameterized: Map<string, NodeReference[]> | undefined,
  callback: (reference: NodeReference) => void,
) {
  parameterized?.forEach(references => references.forEach(callback));
  outbound?.forEach(callback);
}

function restoreEntityReferences<TSerialized>(
  nodesMap: NodeSnapshotMap,
  cacheContext: CacheContext<TSerialized>,
  originals: Map<NodeId, unknown>,
) {
  const { entityTransformer, entityIdForValue } = cacheContext;

  // First, copy the data of the nodes (from the serialized data, which is left
  // as it is) along the paths that change: the data objects that nodes
  // reference are then final, so the references filled in below hold the data
  // in its final form (in place of the nulls that serialized references are).
  for (const nodeId in nodesMap) {
    const node = nodesMap[nodeId];
    const { data, outbound, parameterized } = node;
    if (entityTransformer && isObject(data) && entityIdForValue(data)) {
      entityTransformer(data);
    }

    // If it doesn't have outbound then 'data' doesn't have any references
    // If it is 'undefined' means that there is no data value
    // in both cases, there is no need for modification.
    if ((!outbound && !parameterized) || data === undefined) {
      continue;
    }

    const original = originals.get(nodeId) as JsonValue | undefined;
    const isContainer = Array.isArray(data) || isObject(data);
    forEachRef(outbound, parameterized, ({ id: referenceId, path }) => {
      const referenceNode = nodesMap[referenceId];
      if (!referenceNode) {
        // A dangling reference (to a deleted entity) has no data.
        if (!path.length) {
          node.data = undefined;
        } else if (isContainer) {
          node.data = lazyImmutableDeepSet(node.data, original, path, undefined);
        }
      } else if (referenceNode instanceof ParameterizedValueSnapshot) {
        // This is specifically to handle a sparse array which happen
        // when each element in the array reference data in a
        // ParameterizedValueSnapshot.
        // (see: parameterizedFields/nestedParameterizedReferenceInArray.ts)
        // We only want to try walking if its data contains an array
        if (path.some(part => isNumber(part))) {
          const end = sparseItemIndex(node.data, path);
          if (end >= 0) node.data = lazyImmutableDeepSet(node.data, original, path.slice(0, end + 1), undefined, true);
        }
      } else if (path.length && isContainer) {
        node.data = lazyImmutableDeepSet(node.data, original, path, null);
      }
    });
  }

  // Then fill in the references to entities (in the copies made above).
  for (const nodeId in nodesMap) {
    const node = nodesMap[nodeId];
    const { outbound, parameterized } = node;
    const data = originals.get(nodeId) ?? node.data;
    if ((!outbound && !parameterized) || node.data === undefined) continue;
    const isContainer = Array.isArray(data) || isObject(data);
    forEachRef(outbound, parameterized, ({ id: referenceId, path }) => {
      const referenceNode = nodesMap[referenceId];
      if (!(referenceNode instanceof EntitySnapshot)) return;
      if (!path.length) {
        // data is a reference.
        if (data === null) node.data = referenceNode.data;
      } else if (isContainer) {
        let container = node.data as Record<PathPart, unknown>;
        for (let i = 0; i < path.length - 1; i++) container = container[path[i]] as Record<PathPart, unknown>;
        container[path[path.length - 1]] = referenceNode.data;
      }
    });
  }
}

/**
 * The index in `path` of the first list item along it that is null (whose
 * value is a parameterized node's, so the list is truly sparse there), or -1.
 */
function sparseItemIndex(data: unknown, path: PathPart[]): number {
  let value = data;
  for (let i = 0; i < path.length; i++) {
    if (value === undefined) {
      // There should never be 'undefined'
      throw new Error(`Unexpected 'undefined' in the path [${path}] at index ${i}`);
    }
    if (value === null || isScalar(value)) return -1;
    const prop = path[i];
    if (Array.isArray(value) && typeof prop === 'number' && value[prop] === null) return i;
    value = (value as JsonObject)[prop];
  }
  return -1;
}
