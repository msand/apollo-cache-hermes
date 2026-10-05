"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extract = extract;
const nodes_1 = require("../nodes");
const schema_1 = require("../schema");
const util_1 = require("../util");
/**
 * Create serializable representation of GraphSnapshot.
 *
 * The output still contains 'undefined' value as it is expected that caller
 * will perform JSON.stringify which will strip off 'undefined' value or
 * turn it into 'null' if 'undefined' is in an array.
 *
 * @throws Will throw an error if there is no corresponding node type
 */
function extract(graphSnapshot, cacheContext) {
    const result = {};
    const entities = graphSnapshot._values;
    // We don't need to check for hasOwnProperty because data._values is
    // created with prototype of 'null'
    for (const id in entities) {
        const nodeSnapshot = entities[id];
        const { outbound, inbound, parameterized } = nodeSnapshot;
        let type;
        if (nodeSnapshot instanceof nodes_1.EntitySnapshot) {
            type = 0 /* Serializable.NodeSnapshotType.EntitySnapshot */;
        }
        else if (nodeSnapshot instanceof nodes_1.ParameterizedValueSnapshot) {
            type = 1 /* Serializable.NodeSnapshotType.ParameterizedValueSnapshot */;
        }
        else {
            throw new Error(`${nodeSnapshot.constructor.name} does not have corresponding enum value in Serializable.NodeSnapshotType`);
        }
        const serializedEntity = { type };
        if (parameterized) {
            serializedEntity.parameterized = Array.from((0, util_1.iterParameterized)(parameterized));
        }
        if (outbound) {
            serializedEntity.outbound = Array.from(outbound.values());
        }
        if (inbound) {
            serializedEntity.inbound = Array.from(inbound.values());
        }
        // Extract data value
        const extractedData = extractSerializableData(graphSnapshot, nodeSnapshot);
        if (extractedData !== undefined) {
            if (cacheContext.tracer.warning) {
                try {
                    if (!(0, schema_1.isSerializable)(extractedData, /* allowUndefined */ true)) {
                        cacheContext.tracer.warning(`Data at entityID ${id} is unserializable`);
                    }
                }
                catch (error) {
                    cacheContext.tracer.warning(`Data at entityID ${id} is unserializable because of stack overflow`);
                    if (error instanceof Error) {
                        cacheContext.tracer.warning(error.toString());
                    }
                    else {
                        cacheContext.tracer.warning('unknown error');
                    }
                }
            }
            serializedEntity.data = extractedData;
        }
        result[id] = serializedEntity;
    }
    return result;
}
function extractSerializableData(graphSnapshot, nodeSnapshot) {
    // If there is no outbound, then data is a value
    // 'data' can also be undefined or null even though there exist an
    // outbound reference (e.g referencing ParameterizedValueSnapshot).
    // We can simply skip extraction of such data.
    if (!nodeSnapshot.outbound || !nodeSnapshot.data) {
        return nodeSnapshot.data;
    }
    // Type annotation is needed otherwise type of entity.data is not nullable
    // and so does extractedData which will cause an error when we assing 'null'.
    let extractedData = nodeSnapshot.data;
    // Set all the outbound path (e.g reference) to undefined.
    for (const outbound of (0, util_1.iterRefs)(nodeSnapshot.outbound, nodeSnapshot.parameterized)) {
        // Only reference to EntitySnapshot is recorded in the data property
        // So we didn't end up set the value to be 'undefined' in the output
        // in every case
        if (graphSnapshot.getNodeSnapshot(outbound.id) instanceof nodes_1.EntitySnapshot) {
            // we have to write out 'null' here to differentiate between
            // data doesn't exist and data is a reference.
            //
            // In the case of parameterized field hanging off of a root
            // the data at the ROOTQUERY node will be undefined with outbound
            // reference to the parameterized node.
            extractedData = (0, util_1.lazyImmutableDeepSet)(extractedData, nodeSnapshot.data, outbound.path, outbound.path.length === 0 ? null : undefined);
        }
    }
    return extractedData;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZXh0cmFjdC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImV4dHJhY3QudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFnQkEsMEJBd0RDO0FBdEVELG9DQUFvRjtBQUVwRixzQ0FBeUQ7QUFDekQsa0NBQTRFO0FBRTVFOzs7Ozs7OztHQVFHO0FBQ0gsU0FBZ0IsT0FBTyxDQUFjLGFBQTRCLEVBQUUsWUFBdUM7SUFDeEcsTUFBTSxNQUFNLEdBQStCLEVBQUUsQ0FBQztJQUM5QyxNQUFNLFFBQVEsR0FBRyxhQUFhLENBQUMsT0FBTyxDQUFDO0lBQ3ZDLG9FQUFvRTtJQUNwRSxtQ0FBbUM7SUFDbkMsS0FBSyxNQUFNLEVBQUUsSUFBSSxRQUFRLEVBQUUsQ0FBQztRQUMxQixNQUFNLFlBQVksR0FBRyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM7UUFDbEMsTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsYUFBYSxFQUFFLEdBQUcsWUFBWSxDQUFDO1FBRTFELElBQUksSUFBbUMsQ0FBQztRQUN4QyxJQUFJLFlBQVksWUFBWSxzQkFBYyxFQUFFLENBQUM7WUFDM0MsSUFBSSx1REFBK0MsQ0FBQztRQUN0RCxDQUFDO2FBQU0sSUFBSSxZQUFZLFlBQVksa0NBQTBCLEVBQUUsQ0FBQztZQUM5RCxJQUFJLG1FQUEyRCxDQUFDO1FBQ2xFLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxJQUFJLEtBQUssQ0FBQyxHQUFHLFlBQVksQ0FBQyxXQUFXLENBQUMsSUFBSSwwRUFBMEUsQ0FBQyxDQUFDO1FBQzlILENBQUM7UUFFRCxNQUFNLGdCQUFnQixHQUE4QixFQUFFLElBQUksRUFBRSxDQUFDO1FBRTdELElBQUksYUFBYSxFQUFFLENBQUM7WUFDbEIsZ0JBQWdCLENBQUMsYUFBYSxHQUFHLEtBQUssQ0FBQyxJQUFJLENBQUMsSUFBQSx3QkFBaUIsRUFBQyxhQUFhLENBQUMsQ0FBQyxDQUFDO1FBQ2hGLENBQUM7UUFFRCxJQUFJLFFBQVEsRUFBRSxDQUFD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