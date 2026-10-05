"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.restore = restore;
const tslib_1 = require("tslib");
const CacheSnapshot_1 = require("../CacheSnapshot");
const GraphSnapshot_1 = require("../GraphSnapshot");
const nodes_1 = require("../nodes");
const OptimisticUpdateQueue_1 = require("../OptimisticUpdateQueue");
const util = tslib_1.__importStar(require("../util"));
const SnapshotEditor_1 = require("./SnapshotEditor");
const { getInbound, getOutbound, getParameterized, isNumber, isObject, isReference, isScalar, iterRefs, refToInKey, } = util;
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
function restore(serializedState, cacheContext) {
    const { nodesMap, editedNodeIds } = createGraphSnapshotNodes(serializedState, cacheContext);
    const graphSnapshot = new GraphSnapshot_1.GraphSnapshot(nodesMap);
    return {
        cacheSnapshot: new CacheSnapshot_1.CacheSnapshot(graphSnapshot, graphSnapshot, new OptimisticUpdateQueue_1.OptimisticUpdateQueue()),
        editedNodeIds,
    };
}
function createGraphSnapshotNodes(serializedState, cacheContext) {
    var _a, _b, _c, _d;
    const nodesMap = Object.create(null);
    const editedNodeIds = new Set();
    const missingPointers = new Map();
    // Create entity nodes in the GraphSnapshot
    for (const nodeId in serializedState) {
        const state = serializedState[nodeId];
        const { type, data, inbound, outbound, parameterized } = state;
        let nodeSnapshot;
        switch (type) {
            case 0 /* Serializable.NodeSnapshotType.EntitySnapshot */:
                nodeSnapshot = new nodes_1.EntitySnapshot(data, getInbound(inbound), getOutbound(outbound), getParameterized(parameterized));
                break;
            case 1 /* Serializable.NodeSnapshotType.ParameterizedValueSnapshot */:
                nodeSnapshot = new nodes_1.ParameterizedValueSnapshot(data, getInbound(inbound), getOutbound(outbound), getParameterized(parameterized));
                break;
            case undefined: {
                const parsed = {};
                const parsedIn = (_a = missingPointers.get(nodeId)) !== null && _a !== void 0 ? _a : [];
                const parsedOut = [];
                const parsedParameterized = [];
                for (const [key, val] of Object.entries(state)) {
                    const result = /(.+)\((.+)\)/.exec(key);
                    if (result) {
                        const fieldId = (0, SnapshotEditor_1.nodeIdForParameterizedValue)(nodeId, [result[1]], JSON.parse(result[2]));
                        const path = [key];
                        nodesMap[fieldId] = new nodes_1.ParameterizedValueSnapshot(val, [...(_b = missingPointers.get(nodeId)) !== null && _b !== void 0 ? _b : [], { id: nodeId, path }], []);
                        editedNodeIds.add(fieldId);
                        parsedParameterized.push({ id: fieldId, path });
                    }
                    else if (isReference(val)) {
                        const id = val.__ref;
                        const path = [key];
                        parsedOut.push({ id, path });
                        const reverse = { id: nodeId, path };
                        if (id in nodesMap) {
                            (_d = (_c = nodesMap[id]) === null || _c === void 0 ? void 0 : _c.inbound) === null || _d === void 0 ? void 0 : _d.set(refToInKey(reverse), reverse);
                        }
                        else {
                            const references = missingPointers.get(id);
                            if (references === undefined) {
                                missingPointers.set(id, [reverse]);
                            }
                            else {
                                references.push(reverse);
                            }
                        }
                    }
                    else {
                        parsed[key] = val;
                    }
                }
                nodeSnapshot = new nodes_1.EntitySnapshot(parsed, getInbound(parsedIn), getOutbound(parsedOut), getParameterized(parsedParameterized));
                break;
            }
            default:
                throw new Error(`Invalid Serializable.NodeSnapshotType ${type} at ${nodeId}`);
        }
        nodesMap[nodeId] = nodeSnapshot;
        editedNodeIds.add(nodeId);
    }
    // Patch data property and reconstruct references
    restoreEntityReferences(nodesMap, cacheContext);
    return { nodesMap, editedNodeIds };
}
function set(data, path, value) {
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
function restoreEntityReferences(nodesMap, cacheContext) {
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
            if (referenceNode instanceof nodes_1.EntitySnapshot && data === null) {
                // data is a reference.
                nodesMap[nodeId].data = referenceNode.data;
            }
            else if (referenceNode instanceof nodes_1.ParameterizedValueSnapshot) {
                // This is specifically to handle a sparse array which happen
                // when each element in the array reference data in a
                // ParameterizedValueSnapshot.
                // (see: parameterizedFields/nestedParameterizedReferenceInArray.ts)
                // We only want to try walking if its data contains an array
                const hasArrayIndex = path.some(part => isNumber(part));
                if (hasArrayIndex) {
                    tryRestoreSparseArray(data, path, 0);
                }
            }
            else if (Array.isArray(data) || isObject(data)) {
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
function tryRestoreSparseArray(data, possibleSparseArrayPaths, idx) {
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
    tryRestoreSparseArray(data[prop], possibleSparseArrayPaths, idx + 1);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJlc3RvcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFrQ0EsMEJBUUM7O0FBMUNELG9EQUFpRDtBQUVqRCxvREFBa0U7QUFDbEUsb0NBQXFGO0FBQ3JGLG9FQUFpRTtBQUdqRSxzREFBZ0M7QUFFaEMscURBQStEO0FBRS9ELE1BQU0sRUFDSixVQUFVLEVBQ1YsV0FBVyxFQUNYLGdCQUFnQixFQUNoQixRQUFRLEVBQ1IsUUFBUSxFQUNSLFdBQVcsRUFDWCxRQUFRLEVBQ1IsUUFBUSxFQUNSLFVBQVUsR0FDWCxHQUFHLElBQUksQ0FBQztBQUVUOzs7Ozs7Ozs7O0dBVUc7QUFDSCxTQUFnQixPQUFPLENBQWMsZUFBMkMsRUFBRSxZQUF1QztJQUN2SCxNQUFNLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBRSxHQUFHLHdCQUF3QixDQUFDLGVBQWUsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUM1RixNQUFNLGFBQWEsR0FBRyxJQUFJLDZCQUFhLENBQUMsUUFBUSxDQUFDLENBQUM7SUFFbEQsT0FBTztRQUNMLGFBQWEsRUFBRSxJQUFJLDZCQUFhLENBQUMsYUFBYSxFQUFFLGFBQWEsRUFBRSxJQUFJLDZDQUFxQixFQUFFLENBQUM7UUFDM0YsYUFBYTtLQUNkLENBQUM7QUFDSixDQUFDO0FBRUQsU0FBUyx3QkFBd0IsQ0FBYyxlQUEyQyxFQUFFLFlBQXVDOztJQUNqSSxNQUFNLFFBQVEsR0FBb0IsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN0RCxNQUFNLGFBQWEsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO0lBRXhDLE1BQU0sZUFBZSxHQUFHLElBQUksR0FBRyxFQUEyQixDQUFDO0lBRTNELDJDQUEyQztJQUMzQyxLQUFLLE1BQU0sTUFBTSxJQUFJLGVBQWUsRUFBRSxDQUFDO1FBQ3JDLE1BQU0sS0FBSyxHQUFHLGVBQWUsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUN0QyxNQUFNLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLGFBQWEsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUUvRCxJQUFJLFlBQVksQ0FBQztRQUNqQixRQUFRLElBQUksRUFBRSxDQUFDO1lBQ2I7Z0JBQ0UsWUFBWSxHQUFHLElBQUksc0JBQWMsQ0FBQyxJQUFrQixFQUFFLFVBQVUsQ0FBQyxPQUFPLENBQUMsRUFBRSxXQUFXLENBQUMsUUFBUSxDQUFDLEVBQUUsZ0JBQWdCLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztnQkFDbkksTUFBTTtZQUNSO2dCQUNFLFlBQVksR0FBRyxJQUFJLGtDQUEwQixDQUFDLElBQWlCLEVBQUUsVUFBVSxDQUFDLE9BQU8sQ0FBQyxFQUFFLFdBQVcsQ0FBQyxRQUFRLENBQUMsRUFBRSxnQkFBZ0IsQ0FBQyxhQUFhLENBQUMsQ0FBQyxDQUFDO2dCQUM5SSxNQUFNO1lBQ1IsS0FBSyxTQUFTLENBQUMsQ0FBQyxDQUFDO2dCQUNmLE1BQU0sTUFBTSxHQUFlLEVBQUUsQ0FBQztnQkFDOUIsTUFBTSxRQUFRLEdBQW9CLE1BQUEsZUFBZSxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsbUNBQUksRUFBRSxDQUFDO2dCQUNwRSxNQUFNLFNBQVMsR0FBb0IsRUFBRSxDQUFDO2dCQUN0QyxNQUFNLG1CQUFtQixHQUFvQixFQUFFLENBQUM7Z0JBQ2hELEtBQUssTUFBTSxDQUFDLEdBQUcsRUFBRSxHQUFHLENBQUMsSUFBSSxNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQy9DLE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUM7b0JBQ3hDLElBQUksTUFBTSxFQUFFLENBQUM7d0JBQ1gsTUFBTSxPQUFPLEdBQUcsSUFBQSw0Q0FBMkIsRUFBQyxNQUFNLEVBQUUsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxJQUFJLENBQUMsS0FBSyxDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUM7d0JBQ3hGLE1BQU0sSUFBSSxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7d0JBQ25CLFFBQVEsQ0FBQyxPQUFPLENBQUMsR0FBRyxJQUFJLGtDQUEwQixDQUNoRCxHQUFnQixFQUNoQixDQUFDLEdBQUcsTUFBQSxlQUFlLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxtQ0FBSSxFQUFFLEVBQUUsRUFBRSxFQUFFLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLEVBQzVELEVBQUUsQ0FDSCxDQUFDO3dCQUNGLGFBQWEsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7d0JBQzNCLG1CQUFtQixDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztvQkFDbEQsQ0FBQzt5QkFBTSxJQUFJLFdBQVcsQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDO3dCQUM1QixNQUFNLEVBQUUsR0FBRyxHQUFHLENBQUMsS0FBSyxDQUFDO3dCQUNyQixNQUFNLElBQUksR0FBRyxDQUFDLEdBQUcsQ0FBQyxDQUFDO3dCQUNuQixTQUFTLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7d0JBQzdCLE1BQU0sT0FBTyxHQUFrQixFQUFFLEVBQUUsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUM7d0JBQ3BELElBQUksRUFBRSxJQUFJLFFBQVEsRUFBRSxDQUFDOzRCQUNuQixNQUFBLE1BQUEsUUFBUSxDQUFDLEVBQUUsQ0FBQywwQ0FBRSxPQUFPLDBDQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLEVBQUUsT0FBTyxDQUFDLENBQUM7d0JBQzNELENBQUM7NkJBQU0sQ0FBQzs0QkFDTixNQUFNLFVBQVUsR0FBRyxlQUFlLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDOzRCQUMzQyxJQUFJLFVBQVUsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQ0FDN0IsZUFBZSxDQUFDLEdBQUcsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDOzRCQUNyQyxDQUFDO2lDQUFNLENBQUM7Z0NBQ04sVUFBVSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQzs0QkFDM0IsQ0FBQzt3QkFDSCxDQUFDO29CQUNILENBQUM7eUJBQU0sQ0FBQzt3QkFDTixNQUFNLENBQUMsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDO29CQUNwQixDQUFDO2dCQUNILENBQUM7Z0JBQ0QsWUFBWSxHQUFHLElBQUksc0JBQWMsQ0FBQyxNQUFvQixFQUFFLFVBQVUsQ0FBQyxRQUFRLENBQUMsRUFBRSxXQUFXLENBQUMsU0FBUyxDQUFDLEVBQUUsZ0JBQWdCLENBQUMsbUJBQW1CLENBQUMsQ0FBQyxDQUFDO2dCQUM3SSxNQUFNO1lBQ1IsQ0FBQztZQUNEO2dCQUNFLE1BQU0sSUFBSSxLQUFLLENBQUMseUNBQXlDLElBQUksT0FBTyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1FBQ2xGLENBQUM7UUFFRCxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsWUFBYSxDQUFDO1FBQ2pDLGFBQWEsQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLENBQUM7SUFDNUIsQ0FBQztJQUVELGlEQUFpRDtJQUNqRCx1QkFBdUIsQ0FBQyxRQUFRLEVBQUUsWUFBWSxDQUFDLENBQUM7SUFFaEQsT0FBTyxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsQ0FBQztBQUNyQyxDQUFDO0FBRUQsU0FBUyxHQUFHLENBQUMsSUFBd0QsRUFBRSxJQUFnQixFQUFFLEtBQTRCO0lBQ25ILElBQUksR0FBRyxHQUFHLElBQUksQ0FBQztJQUNmLE1BQU0sQ0FBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0lBQzFCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxFQUFFLEVBQUUsQ0FBQztRQUMzQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDcEIsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDbEIsR0FBRyxDQUFDLEdBQUcsQ0FBQyxHQUFHLE9BQU8sR0FBRyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUM7UUFDL0MsQ0FBQztRQUNELEdBQUcsR0FBRyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7SUFDakIsQ0FBQztJQUNELEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxLQUFLLENBQUM7QUFDdkIsQ0FBQztBQUVELFNBQVMsdUJBQXVCLENBQWMsUUFBeUIsRUFBRSxZQUF1QztJQUM5RyxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxZQUFZLENBQUM7SUFFN0QsS0FBSyxNQUFNLE1BQU0sSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUM5QixNQUFNLEVBQUUsSUFBSSxFQUFFLFFBQVEsRUFBRSxhQUFhLEVBQUUsR0FBRyxRQUFRLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDM0QsSUFBSSxpQkFBaUIsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksZ0JBQWdCLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUNsRSxpQkFBaUIsQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUMxQixDQUFDO1FBRUQsc0VBQXNFO1FBQ3RFLHlEQUF5RDtRQUN6RCxvREFBb0Q7UUFDcEQsSUFBSSxDQUFDLENBQUMsUUFBUSxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksSUFBSSxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3hELFNBQVM7UUFDWCxDQUFDO1FBRUQsS0FBSyxNQUFNLEVBQUUsRUFBRSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsSUFBSSxRQUFRLENBQUMsUUFBUSxFQUFFLGFBQWEsQ0FBQyxFQUFFLENBQUM7WUFDMUUsTUFBTSxhQUFhLEdBQUcsUUFBUSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQzVDLElBQUksYUFBYSxZQUFZLHNCQUFjLElBQUksSUFBSSxLQUFLLElBQUksRUFBRSxDQUFDO2dCQUM3RCx1QkFBdUI7Z0JBQ3ZCLFFBQVEsQ0FBQyxNQUFNLENBQUMsQ0FBQyxJQUFJLEdBQUcsYUFBYSxDQUFDLElBQUksQ0FBQztZQUM3QyxDQUFDO2lCQUFNLElBQUksYUFBYSxZQUFZLGtDQUEwQixFQUFFLENBQUM7Z0JBQy9ELDZEQUE2RDtnQkFDN0QscURBQXFEO2dCQUNyRCw4QkFBOEI7Z0JBQzlCLG9FQUFvRTtnQkFDcEUsNERBQTREO2dCQUM1RCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7Z0JBQ3hELElBQUksYUFBYSxFQUFFLENBQUM7b0JBQ2xCLHFCQUFxQixDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQ3ZDLENBQUM7WUFDSCxDQUFDO2lCQUFNLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztnQkFDakQsR0FBRyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsYUFBYSxDQUFDLElBQUksQ0FBQyxDQUFDO1lBQ3RDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztBQUNILENBQUM7QUFFRDs7Ozs7Ozs7Ozs7Ozs7Ozs7R0FpQkc7QUFDSCxTQUFTLHFCQUFxQixDQUFDLElBQXdDLEVBQUUsd0JBQW9DLEVBQUUsR0FBVztJQUN4SCxJQUFJLElBQUksS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUN2QixvQ0FBb0M7UUFDcEMsTUFBTSxJQUFJLEtBQUssQ0FBQyx1Q0FBdUMsd0JBQXdCLGNBQWMsR0FBRyxFQUFFLENBQUMsQ0FBQztJQUN0RyxDQUFDO0lBRUQsSUFBSSxHQUFHLElBQUksd0JBQXdCLENBQUMsTUFBTSxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDOUUsT0FBTztJQUNULENBQUM7SUFFRCxNQUFNLElBQUksR0FBRyx3QkFBd0IsQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUMzQyxJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsS0FBSyxJQUFJLEVBQUUsQ0FBQztRQUMzRSwwREFBMEQ7UUFDMUQsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7UUFDbEIsT0FBTztJQUNULENBQUM7SUFFRCxxQkFBcUIsQ0FBRSxJQUFtQixDQUFDLElBQUksQ0FBQyxFQUFFLHdCQUF3QixFQUFFLEdBQUcsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUN2RixDQUFDIn0=