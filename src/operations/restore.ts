import { isReference } from '@apollo/client';

import { CacheSnapshot } from '../CacheSnapshot';
import { CacheContext } from '../context';
import { GraphSnapshot, NodeSnapshotMap } from '../GraphSnapshot';
import { EntitySnapshot, NodeReference, ParameterizedValueSnapshot } from '../nodes';
import { OptimisticUpdateQueue } from '../OptimisticUpdateQueue';
import { JsonObject, JsonScalar, JsonValue, NestedArray, NestedObject, NestedValue, PathPart } from '../primitive';
import { NodeId, Serializable } from '../schema';
import { getInbound, getOutbound, getParameterized, isNumber, isObject, isScalar, iterRefs, refToInKey } from '../util';

import { nodeIdForParameterizedValue } from './SnapshotEditor';

/**
 * Restore GraphSnapshot from serializable representation.
 *
 * The parameter 'serializedState' is likely to be result running JSON.stringify
 * on a result of 'extract' method. This function will directly reference object
 * in the serializedState.
 *
 * @throws Will throw an error if 'type' in serializedState cannot be mapped to
 *    different sub-class of NodeSnapshot.
 * @throws Will throw an error if there is undefined in sparse array
 */
export function restore<TSerialized>(serializedState: Serializable.GraphSnapshot, cacheContext: CacheContext<TSerialized>) {
  const { nodesMap, editedNodeIds } = createGraphSnapshotNodes(serializedState, cacheContext);
  const graphSnapshot = new GraphSnapshot(nodesMap);

  return {
    cacheSnapshot: new CacheSnapshot(graphSnapshot, graphSnapshot, new OptimisticUpdateQueue()),
    editedNodeIds,
  };
}

function createGraphSnapshotNodes<TSerialized>(serializedState: Serializable.GraphSnapshot, cacheContext: CacheContext<TSerialized>) {
  const nodesMap: NodeSnapshotMap = Object.create(null);
  const editedNodeIds = new Set<NodeId>();

  const missingPointers = new Map<NodeId, NodeReference[]>();

  // Create entity nodes in the GraphSnapshot
  for (const nodeId in serializedState) {
    const state = serializedState[nodeId];
    const { type, data, inbound, outbound, parameterized } = state;

    let nodeSnapshot;
    switch (type) {
      case Serializable.NodeSnapshotType.EntitySnapshot:
        nodeSnapshot = new EntitySnapshot(data as JsonObject, getInbound(inbound), getOutbound(outbound), getParameterized(parameterized));
        break;
      case Serializable.NodeSnapshotType.ParameterizedValueSnapshot:
        nodeSnapshot = new ParameterizedValueSnapshot(data as JsonValue, getInbound(inbound), getOutbound(outbound), getParameterized(parameterized));
        break;
      case undefined: {
        const parsed: JsonObject = {};
        const parsedIn: NodeReference[] = missingPointers.get(nodeId) ?? [];
        const parsedOut: NodeReference[] = [];
        const parsedParameterized: NodeReference[] = [];
        for (const [key, val] of Object.entries(state)) {
          const result = /(.+)\((.+)\)/.exec(key);
          if (result) {
            const fieldId = nodeIdForParameterizedValue(nodeId, [result[1]], JSON.parse(result[2]));
            const path = [key];
            nodesMap[fieldId] = new ParameterizedValueSnapshot(
              val as JsonValue,
              [...missingPointers.get(nodeId) ?? [], { id: nodeId, path }],
              []
            );
            editedNodeIds.add(fieldId);
            parsedParameterized.push({ id: fieldId, path });
          } else if (isReference(val)) {
            const id = val.__ref;
            const path = [key];
            parsedOut.push({ id, path });
            const reverse: NodeReference = { id: nodeId, path };
            if (id in nodesMap) {
              nodesMap[id]?.inbound?.set(refToInKey(reverse), reverse);
            } else {
              const references = missingPointers.get(id);
              if (references === undefined) {
                missingPointers.set(id, [reverse]);
              } else {
                references.push(reverse);
              }
            }
          } else {
            parsed[key] = val;
          }
        }
        nodeSnapshot = new EntitySnapshot(parsed as JsonObject, getInbound(parsedIn), getOutbound(parsedOut), getParameterized(parsedParameterized));
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

  return { nodesMap, editedNodeIds };
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
      if (referenceNode instanceof EntitySnapshot && data === null) {
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
function tryRestoreSparseArray(data: NestedValue<JsonValue | undefined>, possibleSparseArrayPaths: PathPart[], idx: number) {
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
