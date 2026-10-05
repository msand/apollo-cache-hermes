"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrate = migrate;
const GraphSnapshot_1 = require("../GraphSnapshot");
const nodes_1 = require("../nodes");
const util_1 = require("../util");
const SnapshotEditor_1 = require("./SnapshotEditor");
/**
 * Returns the migrated entity snapshot. Supports add and modify but not delete
 * fields.
 */
function migrateEntity(id, snapshot, nodesToAdd, migrationMap, allNodes) {
    var _a, _b;
    // Only if object and if valid MigrationMap is provided
    if (!(0, util_1.isObject)(snapshot.data))
        return snapshot;
    const entityMigrations = (0, util_1.deepGet)(migrationMap, ['_entities']);
    const parameterizedMigrations = (0, util_1.deepGet)(migrationMap, ['_parameterized']);
    const typeName = snapshot.data.__typename || 'Query';
    if (entityMigrations && entityMigrations[typeName]) {
        for (const field in entityMigrations[typeName]) {
            const fieldMigration = entityMigrations[typeName][field];
            if (!fieldMigration)
                continue;
            snapshot.data[field] = fieldMigration(snapshot.data[field]);
        }
    }
    if (parameterizedMigrations && parameterizedMigrations[typeName]) {
        for (const parameterized of parameterizedMigrations[typeName]) {
            const parameterizedPath = parameterized.path;
            const fieldId = (0, SnapshotEditor_1.nodeIdForParameterizedValue)(id, parameterizedPath, parameterized.args);
            // create a parameterized value snapshot if container doesn't know of the
            // parameterized field we expect
            if (!((_b = (_a = snapshot.parameterized) === null || _a === void 0 ? void 0 : _a.get((0, util_1.toParamKey)(parameterizedPath))) === null || _b === void 0 ? void 0 : _b.find(s => s.id === fieldId))) {
                let newData = parameterized.defaultReturn;
                const copyFrom = parameterized.copyFrom;
                if (allNodes && copyFrom) {
                    const { path, args } = copyFrom;
                    const copyFromFieldId = (0, SnapshotEditor_1.nodeIdForParameterizedValue)(id, path, args);
                    const copyFromNode = allNodes[copyFromFieldId];
                    if (copyFromNode) {
                        newData = copyFromNode.data;
                    }
                    else {
                        // If copyFrom doesn't exist added so we can retrieve it on read
                        nodesToAdd[copyFromFieldId] = new nodes_1.ParameterizedValueSnapshot(newData);
                    }
                }
                const newNode = new nodes_1.ParameterizedValueSnapshot(newData);
                nodesToAdd[fieldId] = newNode;
                // update the reference for the new node in the container
                (0, util_1.addInboundReference)(newNode, id, parameterizedPath);
                (0, util_1.addParameterizedReference)(snapshot, fieldId, parameterizedPath);
            }
        }
    }
    return snapshot;
}
/**
 * Migrates the CacheSnapshot. This function migrates the field values
 * in place so use it with care. Do not use it on the Hermes' current
 * CacheSnapshot. Doing so run the risk of violating immutability.
 */
function migrate(cacheSnapshot, migrationMap) {
    if (migrationMap) {
        const nodesToAdd = Object.create(null);
        const nodes = cacheSnapshot.baseline._values;
        for (const nodeId in nodes) {
            const nodeSnapshot = nodes[nodeId];
            if (nodeSnapshot instanceof nodes_1.EntitySnapshot) {
                migrateEntity(nodeId, nodeSnapshot, nodesToAdd, migrationMap, nodes);
            }
        }
        // rebuild the migrated GraphSnapshot
        const snapshots = Object.assign({}, cacheSnapshot.baseline._values);
        for (const addId in nodesToAdd) {
            const nodeToAdd = nodesToAdd[addId];
            if (!nodeToAdd)
                continue;
            snapshots[addId] = nodeToAdd;
        }
        cacheSnapshot.baseline = new GraphSnapshot_1.GraphSnapshot(snapshots);
    }
    return cacheSnapshot;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlncmF0ZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1pZ3JhdGUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7QUFpSEEsMEJBcUJDO0FBcklELG9EQUFpRDtBQUNqRCxvQ0FBc0U7QUFHdEUsa0NBTWlCO0FBRWpCLHFEQUFnRjtBQWtDaEY7OztHQUdHO0FBQ0gsU0FBUyxhQUFhLENBQ3BCLEVBQVUsRUFDVixRQUF3QixFQUN4QixVQUEyQixFQUMzQixZQUEyQixFQUMzQixRQUEwQjs7SUFHMUIsdURBQXVEO0lBQ3ZELElBQUksQ0FBQyxJQUFBLGVBQVEsRUFBQyxRQUFRLENBQUMsSUFBSSxDQUFDO1FBQUUsT0FBTyxRQUFRLENBQUM7SUFFOUMsTUFBTSxnQkFBZ0IsR0FBRyxJQUFBLGNBQU8sRUFBQyxZQUFZLEVBQUUsQ0FBQyxXQUFXLENBQUMsQ0FBcUIsQ0FBQztJQUNsRixNQUFNLHVCQUF1QixHQUFHLElBQUEsY0FBTyxFQUFDLFlBQVksRUFBRSxDQUFDLGdCQUFnQixDQUFDLENBQTRCLENBQUM7SUFFckcsTUFBTSxRQUFRLEdBQUcsUUFBUSxDQUFDLElBQUksQ0FBQyxVQUFvQixJQUFJLE9BQU8sQ0FBQztJQUUvRCxJQUFJLGdCQUFnQixJQUFJLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxFQUFFLENBQUM7UUFDbkQsS0FBSyxNQUFNLEtBQUssSUFBSSxnQkFBZ0IsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDO1lBQy9DLE1BQU0sY0FBYyxHQUFHLGdCQUFnQixDQUFDLFFBQVEsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3pELElBQUksQ0FBQyxjQUFjO2dCQUFFLFNBQVM7WUFDOUIsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsR0FBRyxjQUFjLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDO1FBQzlELENBQUM7SUFDSCxDQUFDO0lBRUQsSUFBSSx1QkFBdUIsSUFBSSx1QkFBdUIsQ0FB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