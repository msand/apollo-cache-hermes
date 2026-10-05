"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingFieldError = void 0;
exports.read = read;
exports._walkAndOverlayDynamicValues = _walkAndOverlayDynamicValues;
exports._visitSelection = _visitSelection;
const tslib_1 = require("tslib");
const client_1 = require("@apollo/client");
const schema = tslib_1.__importStar(require("../schema"));
const util = tslib_1.__importStar(require("../util"));
const nodes = tslib_1.__importStar(require("../nodes"));
const snapshotEditor = tslib_1.__importStar(require("./SnapshotEditor"));
const makeRef = client_1.makeReference;
const { StaticNodeId } = schema;
const { cloneNodeSnapshot, EntitySnapshot } = nodes;
const { nodeIdForParameterizedValue } = snapshotEditor;
const { deepGet, isNil, isObject, isReference, lazyImmutableDeepSet, safeStringify, walkOperation, } = util;
class MissingFieldError extends Error {
    constructor(message, path, query, variables) {
        // 'Error' breaks prototype chain here
        super(message);
        this.message = message;
        this.path = path;
        this.query = query;
        this.variables = variables;
        if (Array.isArray(this.path)) {
            this.missing = this.message;
            for (let i = this.path.length - 1; i >= 0; --i) {
                this.missing = { [this.path[i]]: this.missing };
            }
        }
        else {
            this.missing = this.path;
        }
        // We're not using `Object.setPrototypeOf` here as it isn't fully supported
        // on Android (see issue #3236).
        // eslint-disable-next-line no-proto
        this.__proto__ = MissingFieldError.prototype;
    }
}
exports.MissingFieldError = MissingFieldError;
function read(context, raw, snapshot, tempStore = Object.create(null), includeNodeIds) {
    var _a, _b;
    let tracerContext;
    if (context.tracer.readStart) {
        tracerContext = context.tracer.readStart(raw);
    }
    const operation = context.parseOperation(raw);
    // Retrieve the previous result (may be partially complete), or start anew.
    const queryResult = snapshot.readCache.get(operation) || {};
    snapshot.readCache.set(operation, queryResult);
    let cacheHit = true;
    if (!queryResult.result) {
        cacheHit = false;
        const nodeSnapshot = (_a = snapshot.getNodeSnapshot(operation.rootId)) !== null && _a !== void 0 ? _a : {};
        const { data, outbound, parameterized } = nodeSnapshot;
        queryResult.result = data;
        if ((!operation.isStatic && (data || outbound || parameterized || context.typePolicies)) ||
            (operation.parsedQuery.__typename && data && !('__typename' in data))) {
            const dynamicNodeIds = new Set();
            queryResult.result = _walkAndOverlayDynamicValues(operation, context, snapshot, (_b = queryResult.result) !== null && _b !== void 0 ? _b : {}, dynamicNodeIds, tempStore);
            queryResult.dynamicNodeIds = dynamicNodeIds;
        }
        queryResult.entityIds = includeNodeIds ? new Set() : undefined;
        // When strict mode is disabled, we carry completeness forward for observed
        // queries.  Once complete, always complete.
        if (typeof queryResult.complete !== 'boolean') {
            const missing = [];
            queryResult.complete = _visitSelection(operation, context, queryResult.result, queryResult.entityIds, missing);
            if (missing.length) {
                queryResult.missing = missing;
            }
        }
    }
    // We can potentially ask for results without node ids first, and then follow
    // up with an ask for them.  In that case, we need to fill in the cache a bit
    // more.
    if (includeNodeIds && !queryResult.entityIds) {
        cacheHit = false;
        const entityIds = new Set();
        queryResult.complete = _visitSelection(operation, context, queryResult.result, entityIds);
        queryResult.entityIds = entityIds;
    }
    if (context.tracer.readEnd) {
        const result = { result: queryResult, cacheHit };
        context.tracer.readEnd(operation, result, tracerContext);
    }
    return queryResult;
}
class OverlayWalkNode {
    constructor(value, containerId, parsedMap, path) {
        this.value = value;
        this.containerId = containerId;
        this.parsedMap = parsedMap;
        this.path = path;
    }
}
/**
 * Walks a parameterized field map, overlaying values at those paths on top of
 * existing results.
 *
 * Overlaid values are objects with prototypes pointing to the original results,
 * and new properties pointing to the parameterized values (or objects that
 * contain them).
 */
function _walkAndOverlayDynamicValues(query, context, snapshot, result, dynamicNodeIds, tempStore) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    // Corner case: We stop walking once we reach a parameterized field with no
    // snapshot, but we should also preemptively stop walking if there are no
    // dynamic values to be overlaid
    const id = query.rootId;
    const isRoot = id === StaticNodeId.QueryRoot;
    const rootSnapshot = ((_a = snapshot.getNodeSnapshot(id)) !== null && _a !== void 0 ? _a : isRoot)
        ? {}
        : undefined;
    if (isNil(rootSnapshot))
        return result;
    // TODO: A better approach here might be to walk the outbound references from
    // each node, rather than walking the result set.  We'd have to store the path
    // on parameterized value nodes to make that happen.
    const newResult = _wrapValue(result, context);
    // TODO: This logic sucks.  We'd do much better if we had knowledge of the
    // schema.  Can we layer that on in such a way that we can support uses w/ and
    // w/o a schema compilation step?
    const queue = [new OverlayWalkNode(newResult, id, query.parsedQuery, [])];
    function readFromSnapshot(obj, key) {
        var _a, _b, _c;
        const data = obj.data;
        if (!data || typeof data !== 'object') {
            return undefined;
        }
        if (key in data) {
            return data[key];
        }
        const out = (_a = obj.outbound) === null || _a === void 0 ? void 0 : _a.get(key);
        if (out !== undefined) {
            return snapshot.getNodeData(out.id);
        }
        const ref = (_c = (_b = obj.parameterized) === null || _b === void 0 ? void 0 : _b.get(key)) === null || _c === void 0 ? void 0 : _c[0];
        if (ref !== undefined) {
            return snapshot.getNodeData(ref.id);
        }
        if (isRoot && key === '__typename') {
            return 'Query';
        }
        return undefined;
    }
    let readFallbackObject;
    const readField = (fieldNameOrOptions, from) => {
        var _a, _b;
        if (from === void 0) { from = (_a = rootSnapshot.data) !== null && _a !== void 0 ? _a : readFallbackObject; }
        if (!from) {
            return undefined;
        }
        if (typeof fieldNameOrOptions !== 'string')
            throw new Error('Not implemented');
        if (isReference(from)) {
            const ref = from.__ref;
            const obj = (_b = tempStore[ref]) !== null && _b !== void 0 ? _b : snapshot.getNodeSnapshot(ref);
            if (!obj) {
                return undefined;
            }
            return readFromSnapshot(obj, fieldNameOrOptions);
        }
        else {
            return from[fieldNameOrOptions];
        }
    };
    function getSnapshot(nodeId) {
        var _a;
        return (_a = tempStore[nodeId]) !== null && _a !== void 0 ? _a : snapshot.getNodeSnapshot(nodeId);
    }
    const ensureNewSnapshot = (nodeId) => {
        const parent = getSnapshot(nodeId);
        // TODO: We're assuming that the only time we call _ensureNewSnapshot when
        // there is no parent is when the node is an entity.  Can we enforce it, or
        // pass a type through?
        const newSnapshot = parent ? cloneNodeSnapshot(parent) : new EntitySnapshot();
        tempStore[nodeId] = newSnapshot;
        return newSnapshot;
    };
    const readOptions = {
        args: {},
        cache: null,
        canRead(value) {
            return isReference(value)
                ? snapshot.has(value.__ref)
                : typeof value === 'object' && value !== null;
        },
        field: null,
        fieldName: '',
        isReference,
        mergeObjects(existing, incoming) {
            return Object.assign(Object.assign({}, existing), incoming);
        },
        readField,
        storage: rootSnapshot,
        storeFieldName: '',
        toReference: (value, mergeIntoStore) => {
            const entityId = context.entityIdForValue(value);
            if (entityId && mergeIntoStore && !isReference(value) && typeof value !== 'string') {
                const nodeSnapshot = ensureNewSnapshot(entityId);
                nodeSnapshot.data = Object.assign(Object.assign({}, nodeSnapshot.data), value);
            }
            const ref = entityId !== null && entityId !== void 0 ? entityId : value;
            return typeof ref === 'string' ? makeRef(ref) : undefined;
        },
        variables: query.variables,
    };
    while (queue.length) {
        const walkNode = queue.pop();
        const { value, parsedMap } = walkNode;
        let { containerId, path } = walkNode;
        const valueId = context.entityIdForValue(value);
        if (valueId) {
            containerId = valueId;
            path = [];
        }
        let typeName = value.__typename;
        if (!typeName && containerId === StaticNodeId.QueryRoot && path.length === 0) {
            typeName = 'Query'; // Preserve the default cache's behavior.
        }
        const typePolicies = (_c = (_b = context.typePolicies) === null || _b === void 0 ? void 0 : _b[typeName]) === null || _c === void 0 ? void 0 : _c.fields;
        for (const key in parsedMap) {
            const node = parsedMap[key];
            let child;
            let fieldName = key;
            // This is an alias if we have a schemaName declared.
            fieldName = node.schemaName ? node.schemaName : key;
            let nextContainerId = containerId;
            let nextPath = path;
            if (node.args) {
                let childId = nodeIdForParameterizedValue(containerId, [...path, fieldName], node.args);
                let childSnapshot;
                if (typePolicies) {
                    const fieldPolicy = typePolicies[fieldName];
                    const readFn = fieldPolicy && (typeof fieldPolicy === 'object' ? fieldPolicy.read : fieldPolicy);
                    if (readFn) {
                        readOptions.fieldName = fieldName;
                        readOptions.storeFieldName = key;
                        readOptions.args = node.args;
                        readFallbackObject = value;
                        const readResult = readFn(undefined, readOptions);
                        if (isReference(readResult)) {
                            const ref = readResult.__ref;
                            childSnapshot = getSnapshot(ref);
                        }
                        else {
                            child = readResult;
                        }
                    }
                }
                if (!childSnapshot) {
                    childSnapshot = snapshot.getNodeSnapshot(childId);
                }
                if (!childSnapshot) {
                    // Should we fall back to a redirect?
                    const redirect = deepGet(context.resolverRedirects, [typeName, fieldName]);
                    if (redirect) {
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
                nextContainerId = childId;
                nextPath = [];
                child = childSnapshot.data;
            }
            else {
                nextPath = [...path, fieldName];
                child = value[fieldName];
                const policy = typePolicies === null || typePolicies === void 0 ? void 0 : typePolicies[fieldName];
                const readFn = typeof policy === 'function' ? policy : policy === null || policy === void 0 ? void 0 : policy.read;
                if (readFn) {
                    readOptions.fieldName = fieldName;
                    readOptions.storeFieldName = key;
                    readOptions.args = (_d = node.args) !== null && _d !== void 0 ? _d : null;
                    readFallbackObject = value;
                    child = readFn(child, readOptions);
                }
            }
            let ref;
            if (isReference(child)) {
                ref = child.__ref;
                child = (_e = snapshot.getNodeSnapshot(ref)) === null || _e === void 0 ? void 0 : _e.data;
            }
            const hasPolicy = child && ((_g = (_f = context.typePolicies) === null || _f === void 0 ? void 0 : _f[child.__typename]) === null || _g === void 0 ? void 0 : _g.fields);
            // Have we reached a leaf (either in the query, or in the cache)?
            if (hasPolicy || ref || _shouldWalkChildren(child, node)) {
                child = _recursivelyWrapValue(child, context);
                const allChildValues = _flattenGraphQLObject(child, nextPath);
                for (let i = 0; i < allChildValues.length; i++) {
                    const item = allChildValues[i];
                    queue.push(new OverlayWalkNode(item.value, nextContainerId, (_h = node.children) !== null && _h !== void 0 ? _h : {}, item.path));
                }
            }
            // Because key is already a field alias, result will be written correctly
            // using alias as key.
            if (child !== undefined) {
                value[key] = child;
            }
            else if (key === '__typename' && typeName) {
                value.__typename = typeName;
            }
        }
    }
    return newResult;
}
/**
 *  Check if `value` is an object and if any of its children are parameterized.
 *  We can skip this part of the graph if there are no parameterized children
 *  to resolve.
 */
function _shouldWalkChildren(value, node) {
    return !!node.hasParameterizedChildren && !!node.children && value !== null;
}
/**
 *  Finds all of the actual objects in `value` which can be a single object, an
 *  array of objects, or a multidimensional array of objects, and returns them
 *  as a flat list.
 */
function _flattenGraphQLObject(value, path) {
    if (value === null)
        return [];
    if (!Array.isArray(value))
        return [{ value, path }];
    const flattened = [];
    for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const list = _flattenGraphQLObject(item, [...path, i]);
        flattened.push(...list);
    }
    return flattened;
}
function _recursivelyWrapValue(value, context) {
    if (!Array.isArray(value)) {
        return _wrapValue(value, context);
    }
    const newValue = [];
    // Note that we're careful to iterate over all indexes, in case this is a
    // sparse array.
    for (let i = 0; i < value.length; i++) {
        newValue[i] = _recursivelyWrapValue(value[i], context);
    }
    return newValue;
}
function _wrapValue(value, context) {
    if (value === undefined) {
        return {};
    }
    if (Array.isArray(value)) {
        return [...value];
    }
    if (isObject(value)) {
        const newValue = Object.assign({}, value);
        if (context.entityTransformer && context.entityIdForValue(value)) {
            context.entityTransformer(newValue);
        }
        return newValue;
    }
    return value;
}
/**
 * Determines whether `result` satisfies the properties requested by
 * `selection`.
 */
function _visitSelection(query, context, result, nodeIds, missing) {
    let complete = true;
    if (nodeIds && result !== undefined) {
        nodeIds.add(query.rootId);
    }
    const missingByFieldName = new Map();
    // TODO: Memoize per query, and propagate through cache snapshots.
    walkOperation(query.info.parsed, result, (value, fields, path) => {
        var _a, _b;
        if (value === undefined) {
            complete = false;
        }
        // If we're not including node ids, we can stop the walk right here.
        if (!complete && !missing) {
            return !nodeIds;
        }
        if (!isObject(value)) {
            return false;
        }
        if (nodeIds && isObject(value)) {
            const nodeId = context.entityIdForValue(value);
            if (nodeId !== undefined) {
                nodeIds.add(nodeId);
            }
        }
        for (const field of fields) {
            if (!(field in value) && field !== '__typename') {
                let missingError = missingByFieldName.get(field);
                const nodeId = (_a = context.entityIdForValue(value)) !== null && _a !== void 0 ? _a : ((value === null || value === void 0 ? void 0 : value.__typename) === 'Query' ? 'ROOT_QUERY' : undefined);
                const objOrNodeId = nodeId ? `${nodeId} object` : `object ${(safeStringify(value))}`;
                const message = `Can't find field '${field}' on ${objOrNodeId}`;
                if (!missingError) {
                    const missingTree = {};
                    lazyImmutableDeepSet(missingTree, undefined, [...path, field], message);
                    missingByFieldName.set(field, missingError = new MissingFieldError(message, missingTree, query.info.document, (_b = query.variables) !== null && _b !== void 0 ? _b : {}));
                }
                else {
                    const missingTree = missingError.path;
                    lazyImmutableDeepSet(missingTree, undefined, [...path, field], message);
                }
                complete = false;
            }
        }
        return false;
    });
    for (const error of missingByFieldName.values()) {
        missing === null || missing === void 0 ? void 0 : missing.push(error);
    }
    return complete;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVhZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInJlYWQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBd0dBLG9CQStEQztBQW1CRCxvRUE0T0M7QUF3RkQsMENBb0VDOztBQWxrQkQsMkNBQStDO0FBYS9DLDBEQUFvQztBQUNwQyxzREFBZ0M7QUFDaEMsd0RBQWtDO0FBRWxDLHlFQUFtRDtBQUVuRCxNQUFNLE9BQU8sR0FBRyxzQkFBYSxDQUFDO0FBQzlCLE1BQU0sRUFBRSxZQUFZLEVBQUUsR0FBRyxNQUFNLENBQUM7QUFDaEMsTUFBTSxFQUFFLGlCQUFpQixFQUFFLGNBQWMsRUFBRSxHQUFHLEtBQUssQ0FBQztBQUNwRCxNQUFNLEVBQUUsMkJBQTJCLEVBQUUsR0FBRyxjQUFjLENBQUM7QUFDdkQsTUFBTSxFQUNKLE9BQU8sRUFDUCxLQUFLLEVBQ0wsUUFBUSxFQUNSLFdBQVcsRUFDWCxvQkFBb0IsRUFDcEIsYUFBYSxFQUNiLGFBQWEsR0FDZCxHQUFHLElBQUksQ0FBQztBQVFULE1BQWEsaUJBQWtCLFNBQVEsS0FBSztJQUMxQyxZQUNrQixPQUFlLEVBQ2YsSUFBMEMsRUFDMUMsS0FBbUIsRUFDbkIsU0FBK0I7UUFFL0Msc0NBQXNDO1FBQ3RDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQU5DLFlBQU8sR0FBUCxPQUFPLENBQVE7UUFDZixTQUFJLEdBQUosSUFBSSxDQUFzQztRQUMxQyxVQUFLLEdBQUwsS0FBSyxDQUFjO1FBQ25CLGNBQVMsR0FBVCxTQUFTLENBQXNCO1FBSy9DLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUM3QixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUM7WUFDNUIsS0FBSyxJQUFJLENBQUMsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxDQUFDLEVBQUUsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLENBQUMsRUFBRSxDQUFDO2dCQUMvQyxJQUFJLENBQUMsT0FBTyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2xELENBQUM7UUFDSCxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQztRQUMzQixDQUFDO1FBRUQsMkVBQTJFO1FBQzNFLGdDQUFnQztRQUNoQyxvQ0FBb0M7UUFDbkMsSUFBWSxDQUFDLFNBQVMsR0FBRyxpQkFBaUIsQ0FBQyxTQUFTLENBQUM7SUFDeEQsQ0FBQztDQUdGO0FBMUJELDhDQTBCQztBQXVDRCxTQUFnQixJQUFJLENBQ2xCLE9BQWtDLEVBQ2xDLEdBQWlCLEVBQ2pCLFFBQXVCLEVBQ3ZCLFlBQTZCLE1BQU0sQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEVBQ2hELGNBQXdCOztJQUV4QixJQUFJLGFBQWEsQ0FBQztJQUNsQixJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDN0IsYUFBYSxHQUFHLE9BQU8sQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFRCxNQUFNLFNBQVMsR0FBRyxPQUFPLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBRTlDLDJFQUEyRTtJQUMzRSxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFxQyxDQUFDO0lBQy9GLFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxXQUEwQixDQUFDLENBQUM7SUFFOUQsSUFBSSxRQUFRLEdBQUcsSUFBSSxDQUFDO0lBQ3BCLElBQUksQ0FBQyxXQUFXLENBQUMsTUFBTSxFQUFFLENBQUM7UUFDeEIsUUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixNQUFNLFlBQVksR0FBRyxNQUFBLFFBQVEsQ0FBQyxlQUFlLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxtQ0FBSSxFQUFFLENBQUM7UUFDdEUsTUFBTSxFQUFFLElBQUksRUFBRSxRQUFRLEVBQUUsYUFBYSxFQUFFLEdBQUcsWUFBWSxDQUFDO1FBQ3ZELFdBQVcsQ0FBQyxNQUFNLEdBQUcsSUFBa0IsQ0FBQztRQUV4QyxJQUNFLENBQUMsQ0FBQyxTQUFTLENBQUMsUUFBUSxJQUFJLENBQUMsSUFBSSxJQUFJLFFBQVEsSUFBSSxhQUFhLElBQUksT0FBTyxDQUFDLFlBQVksQ0FBQyxDQUFDO1lBQ3BGLENBQUMsU0FBUyxDQUFDLFdBQVcsQ0FBQyxVQUFVLElBQUksSUFBSSxJQUFJLENBQUMsQ0FBQyxZQUFZLElBQUssSUFBbUIsQ0FBQyxDQUFDLEVBQ3JGLENBQUM7WUFDRCxNQUFNLGNBQWMsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1lBQ3pDLFdBQVcsQ0FBQyxNQUFNLEdBQUcsNEJBQTRCLENBQUMsU0FBUyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBQSxXQUFXLENBQUMsTUFBTSxtQ0FBSSxFQUFFLEVBQUUsY0FBZSxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQ3RJLFdBQVcsQ0FBQyxjQUFjLEdBQUcsY0FBYyxDQUFDO1FBQzlDLENBQUM7UUFFRCxXQUFXLENBQUMsU0FBUyxHQUFHLGNBQWMsQ0FBQyxDQUFDLENBQUMsSUFBSSxHQUFHLEVBQVUsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FBRXZFLDJFQUEyRTtRQUMzRSw0Q0FBNEM7UUFDNUMsSUFBSSxPQUFPLFdBQVcsQ0FBQyxRQUFRLEtBQUssU0FBUyxFQUFFLENBQUM7WUFDOUMsTUFBTSxPQUFPLEdBQXdCLEVBQUUsQ0FBQztZQUN4QyxXQUFXLENBQUMsUUFBUSxHQUFHLGVBQWUsQ0FBQyxTQUFTLEVBQUUsT0FBTyxFQUFFLFdBQVcsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsQ0FBQztZQUMvRyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEVBQUUsQ0FBQztnQkFDbkIsV0FBVyxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7WUFDaEMsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsNkVBQTZFO0lBQzdFLDZFQUE2RTtJQUM3RSxRQUFRO0lBQ1IsSUFBSSxjQUFjLElBQUksQ0FBQyxXQUFXLENBQUMsU0FBUyxFQUFFLENBQUM7UUFDN0MsUUFBUSxHQUFHLEtBQUssQ0FBQztRQUNqQixNQUFNLFNBQVMsR0FBRyxJQUFJLEdBQUcsRUFBVSxDQUFDO1FBQ3BDLFdBQVcsQ0FBQyxRQUFRLEdBQUcsZUFBZSxDQUFDLFNBQVMsRUFBRSxPQUFPLEVBQUUsV0FBVyxDQUFDLE1BQU0sRUFBRSxTQUFTLENBQUMsQ0FBQztRQUMxRixXQUFXLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztJQUNwQyxDQUFDO0lBRUQsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQzNCLE1BQU0sTUFBTSxHQUFHLEVBQUUsTUFBTSxFQUFFLFdBQTBCLEVBQUUsUUFBUSxFQUFFLENBQUM7UUFDaEUsT0FBTyxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxhQUFhLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsT0FBTyxXQUFXLENBQUM7QUFDckIsQ0FBQztBQUVELE1BQU0sZUFBZTtJQUNuQixZQUNrQixLQUFpQixFQUNqQixXQUFtQixFQUNuQixTQUFzQixFQUN0QixJQUFnQjtRQUhoQixVQUFLLEdBQUwsS0FBSyxDQUFZO1FBQ2pCLGdCQUFXLEdBQVgsV0FBVyxDQUFRO1FBQ25CLGNBQVMsR0FBVCxTQUFTLENBQWE7UUFDdEIsU0FBSSxHQUFKLElBQUksQ0FBWTtJQUMvQixDQUFDO0NBQ0w7QUFFRDs7Ozs7OztHQU9HO0FBQ0gsU0FBZ0IsNEJBQTRCLENBQzFDLEtBQXFDLEVBQ3JDLE9BQWtDLEVBQ2xDLFFBQXVCLEVBQ3ZCLE1BQThCLEVBQzlCLGNBQTJCLEVBQzNCLFNBQTBCOztJQUUxQiwyRUFBMkU7SUFDM0UseUVBQXlFO0lBQ3pFLGdDQUFnQztJQUNoQyxNQUFNLEVBQUUsR0FBRyxLQUFLLENBQUMsTUFBTSxDQUFDO0lBQ3hCLE1BQU0sTUFBTSxHQUFHLEVBQUUsS0FBSyxZQUFZLENBQUMsU0FBUyxDQUFDO0lBQzdDLE1BQU0sWUFBWSxHQUNkLENBQUEsTUFBQSxRQUFRLENBQUMsZUFBZSxDQUFDLEVBQUUsQ0FBQyxtQ0FDekIsTUFBTTtRQUNULENBQUMsQ0FBQyxFQUFFO1FBQ0osQ0FBQyxDQUFDLFNBQVMsQ0FBQztJQUNoQixJQUFJLEtBQUssQ0FBQyxZQUFZLENBQUM7UUFBRSxPQUFPLE1BQU0sQ0FBQztJQUV2Qyw2RUFBNkU7SUFDN0UsOEVBQThFO0lBQzlFLG9EQUFvRDtJQUVwRCxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsTUFBTSxFQUFFLE9BQU8sQ0FBZSxDQUFDO0lBQzVELDBFQUEwRTtJQUMxRSw4RUFBOEU7SUFDOUUsaUNBQWlDO0lBQ2pDLE1BQU0sS0FBSyxHQUFHLENBQUMsSUFBSSxlQUFlLENBQUMsU0FBUyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsV0FBVyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUM7SUFFMUUsU0FBUyxnQkFBZ0IsQ0FBQyxHQUEyQixFQUFFLEdBQVc7O1FBQ2hFLE1BQU0sSUFBSSxHQUFHLEdBQUcsQ0FBQyxJQUFJLENBQUM7UUFDdEIsSUFBSSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztZQUN0QyxPQUFPLFNBQVMsQ0FBQztRQUNuQixDQUFDO1FBQ0QsSUFBSSxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7WUFDaEIsT0FBUSxJQUFtQixDQUFDLEdBQUcsQ0FBQyxDQUFDO1FBQ25DLENBQUM7UUFDRCxNQUFNLEdBQUcsR0FBRyxNQUFBLEdBQUcsQ0FBQyxRQUFRLDBDQUFFLEdBQUcsQ0FBQyxHQUFHLENBQUMsQ0FBQztRQUNuQyxJQUFJLEdBQUcsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN0QixPQUFPLFFBQVEsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RDLENBQUM7UUFDRCxNQUFNLEdBQUcsR0FBRyxNQUFBLE1BQUEsR0FBRyxDQUFDLGFBQWEsMENBQUUsR0FBRyxDQUFDLEdBQUcsQ0FBQywwQ0FBRyxDQUFDLENBQUMsQ0FBQztRQUM3QyxJQUFJLEdBQUcsS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUN0QixPQUFPLFFBQVEsQ0FBQyxXQUFXLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxDQUFDO1FBQ3RDLENBQUM7UUFDRCxJQUFJLE1BQU0sSUFBSSxHQUFHLEtBQUssWUFBWSxFQUFFLENBQUM7WUFDbkMsT0FBTyxPQUFPLENBQUM7UUFDakIsQ0FBQztRQUNELE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxJQUFJLGtCQUEyQyxDQUFDO0lBQ2hELE1BQU0sU0FBUyxHQUFHLENBQ2hCLGtCQUE2QyxFQUM3QyxJQUFzRixFQUN0RixFQUFFOzs2QkFERixFQUFBLGFBQWdDLFlBQVksQ0FBQyxJQUFtQixtQ0FBSSxrQkFBa0I7UUFFdEYsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ1YsT0FBTyxTQUFTLENBQUM7UUFDbkIsQ0FBQztRQUNELElBQUksT0FBTyxrQkFBa0IsS0FBSyxRQUFRO1lBQUUsTUFBTSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBRS9FLElBQUksV0FBVyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7WUFDdEIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQztZQUN2QixNQUFNLEdBQUcsR0FBRyxNQUFBLFNBQVMsQ0FBQyxHQUFHLENBQUMsbUNBQUksUUFBUSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUM1RCxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0JBQ1QsT0FBTyxTQUFTLENBQUM7WUFDbkIsQ0FBQztZQUNELE9BQU8sZ0JBQWdCLENBQUMsR0FBRyxFQUFFLGtCQUFrQixDQUFDLENBQUM7UUFDbkQsQ0FBQzthQUFNLENBQUM7WUFDTixPQUFPLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxDQUFDO1FBQ2xDLENBQUM7SUFDSCxDQUFDLENBQUM7SUFFRixTQUFTLFdBQVcsQ0FBQyxNQUFjOztRQUNqQyxPQUFPLE1BQUEsU0FBUyxDQUFDLE1BQU0sQ0FBQyxtQ0FBSSxRQUFRLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQy9ELENBQUM7SUFFRCxNQUFNLGlCQUFpQixHQUFHLENBQUMsTUFBYyxFQUFnQixFQUFFO1FBQ3pELE1BQU0sTUFBTSxHQUFHLFdBQVcsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUVuQywwRUFBMEU7UUFDMUUsMkVBQTJFO1FBQzNFLHVCQUF1QjtRQUN2QixNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLGlCQUFpQixDQUFDLE1BQU0sQ0FBQyxDQUFDLENBQUMsQ0FBQyxJQUFJLGNBQWMsRUFBRSxDQUFDO1FBQzlFLFNBQVMsQ0FBQyxNQUFNLENBQUMsR0FBRyxXQUFXLENBQUM7UUFDaEMsT0FBTyxXQUFXLENBQUM7SUFDckIsQ0FBQyxDQUFDO0lBRUYsTUFBTSxXQUFXLEdBQXlCO1FBQ3hDLElBQUksRUFBRSxFQUFFO1FBQ1IsS0FBSyxFQUFFLElBQVc7UUFDbEIsT0FBTyxDQUFDLEtBQWlCO1lBQ3ZCLE9BQU8sV0FBVyxDQUFDLEtBQUssQ0FBQztnQkFDdkIsQ0FBQyxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQztnQkFDM0IsQ0FBQyxDQUFDLE9BQU8sS0FBSyxLQUFLLFFBQVEsSUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDO1FBQ2xELENBQUM7UUFDRCxLQUFLLEVBQUUsSUFBSTtRQUNYLFNBQVMsRUFBRSxFQUFFO1FBQ2IsV0FBVztRQUNYLFlBQVksQ0FBSSxRQUFXLEVBQUUsUUFBVztZQUN0Qyx1Q0FBWSxRQUFRLEdBQUssUUFBUSxFQUFHO1FBQ3RDLENBQUM7UUFDRCxTQUFTO1FBQ1QsT0FBTyxFQUFFLFlBQVk7UUFDckIsY0FBYyxFQUFFLEVBQUU7UUFDbEIsV0FBVyxFQUFFLENBQUMsS0FBSyxFQUFFLGNBQWMsRUFBRSxFQUFFO1lBQ3JDLE1BQU0sUUFBUSxHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNqRCxJQUFJLFFBQVEsSUFBSSxjQUFjLElBQUksQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksT0FBTyxLQUFLLEtBQUssUUFBUSxFQUFFLENBQUM7Z0JBQ25GLE1BQU0sWUFBWSxHQUFHLGlCQUFpQixDQUFDLFFBQVEsQ0FBQyxDQUFDO2dCQUNqRCxZQUFZLENBQUMsSUFBSSxtQ0FBUSxZQUFZLENBQUMsSUFBVSxHQUFLLEtBQUssQ0FBRSxDQUFDO1lBQy9ELENBQUM7WUFDRCxNQUFNLEdBQUcsR0FBRyxRQUFRLGFBQVIsUUFBUSxjQUFSLFFBQVEsR0FBSSxLQUFLLENBQUM7WUFDOUIsT0FBTyxPQUFPLEdBQUcsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDO1FBQzVELENBQUM7UUFDRCxTQUFTLEVBQUUsS0FBSyxDQUFDLFNBQVM7S0FDM0IsQ0FBQztJQUVGLE9BQU8sS0FBSyxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ3BCLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxHQUFHLEVBQUcsQ0FBQztRQUM5QixNQUFNLEVBQUUsS0FBSyxFQUFFLFNBQVMsRUFBRSxHQUFHLFFBQVEsQ0FBQztRQUN0QyxJQUFJLEVBQUUsV0FBVyxFQUFFLElBQUksRUFBRSxHQUFHLFFBQVEsQ0FBQztRQUNyQyxNQUFNLE9BQU8sR0FBRyxPQUFPLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDaEQsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLFdBQVcsR0FBRyxPQUFPLENBQUM7WUFDdEIsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNaLENBQUM7UUFFRCxJQUFJLFFBQVEsR0FBRyxLQUFLLENBQUMsVUFBb0IsQ0FBQztRQUMxQyxJQUFJLENBQUMsUUFBUSxJQUFJLFdBQVcsS0FBSyxZQUFZLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxNQUFNLEtBQUssQ0FBQyxFQUFFLENBQUM7WUFDN0UsUUFBUSxHQUFHLE9BQU8sQ0FBQyxDQUFDLHlDQUF5QztRQUMvRCxDQUFDO1FBQ0QsTUFBTSxZQUFZLEdBQUcsTUFBQSxNQUFBLE9BQU8sQ0FBQyxZQUFZLDBDQUFHLFFBQVEsQ0FBQywwQ0FBRSxNQUFNLENBQUM7UUFFOUQsS0FBSyxNQUFNLEdBQUcsSUFBSSxTQUFTLEVBQUUsQ0FBQztZQUM1QixNQUFNLElBQUksR0FBRyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUM7WUFDNUIsSUFBSSxLQUFLLENBQUM7WUFDVixJQUFJLFNBQVMsR0FBRyxHQUFHLENBQUM7WUFFcEIscURBQXFEO1lBQ3JELFNBQVMsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLENBQUMsVUFBVSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUM7WUFFcEQsSUFBSSxlQUFlLEdBQUcsV0FBVyxDQUFDO1lBQ2xDLElBQUksUUFBUSxHQUFHLElBQUksQ0FBQztZQUVwQixJQUFJLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztnQkFDZCxJQUFJLE9BQU8sR0FBRywyQkFBMkIsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxTQUFTLENBQUMsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7Z0JBQ3hGLElBQUksYUFBaUQsQ0FBQztnQkFFdEQsSUFBSSxZQUFZLEVBQUUsQ0FBQztvQkFDakIsTUFBTSxXQUFXLEdBQUcsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUM1QyxNQUFNLE1BQU0sR0FBRyxXQUFXLElBQUksQ0FBQyxPQUFPLFdBQVcsS0FBSyxRQUFRLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLFdBQVcsQ0FBQyxDQUFDO29CQUNqRyxJQUFJLE1BQU0sRUFBRSxDQUFDO3dCQUNYLFdBQVcsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO3dCQUNsQyxXQUFXLENBQUMsY0FBYyxHQUFHLEdBQUcsQ0FBQzt3QkFDakMsV0FBVyxDQUFDLElBQUksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDO3dCQUM3QixrQkFBa0IsR0FBRyxLQUFLLENBQUM7d0JBQzNCLE1BQU0sVUFBVSxHQUFHLE1BQU0sQ0FBQyxTQUFTLEVBQUUsV0FBVyxDQUFDLENBQUM7d0JBQ2xELElBQUksV0FBVyxDQUFDLFVBQVUsQ0FBQyxFQUFFLENBQUM7NEJBQzVCLE1BQU0sR0FBRyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7NEJBQzdCLGFBQWEsR0FBRyxXQUFXLENBQUMsR0FBRyxDQUFDLENBQUM7d0JBQ25DLENBQUM7NkJBQU0sQ0FBQzs0QkFDTixLQUFLLEdBQUcsVUFBVSxDQUFDO3dCQUNyQixDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQztnQkFFRCxJQUFJLENBQUMsYUFBYSxFQUFFLENBQUM7b0JBQ25CLGFBQWEsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUNwRCxDQUFDO2dCQUVELElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztvQkFDbkIscUNBQXFDO29CQUNyQyxNQUFNLFFBQVEsR0FBOEMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxpQkFBaUIsRUFBRSxDQUFDLFFBQVEsRUFBRSxTQUFTLENBQUMsQ0FBUSxDQUFDO29CQUM3SCxJQUFJLFFBQVEsRUFBRSxDQUFDO3dCQUNiLE9BQU8sR0FBRyxRQUFRLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO3dCQUM5QixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7NEJBQ3BCLGFBQWEsR0FBRyxRQUFRLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxDQUFDO3dCQUNwRCxDQUFDO29CQUNILENBQUM7Z0JBQ0gsQ0FBQztnQkFFRCxjQUFjLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO2dCQUU1Qix5Q0FBeUM7Z0JBQ3pDLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztvQkFDbkIsU0FBUztnQkFDWCxDQUFDO2dCQUVELGVBQWUsR0FBRyxPQUFPLENBQUM7Z0JBQzFCLFFBQVEsR0FBRyxFQUFFLENBQUM7Z0JBQ2QsS0FBSyxHQUFHLGFBQWEsQ0FBQyxJQUFJLENBQUM7WUFDN0IsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLFFBQVEsR0FBRyxDQUFDLEdBQUcsSUFBSSxFQUFFLFNBQVMsQ0FBQyxDQUFDO2dCQUNoQyxLQUFLLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUN6QixNQUFNLE1BQU0sR0FBRyxZQUFZLGFBQVosWUFBWSx1QkFBWixZQUFZLENBQUcsU0FBUyxDQUFDLENBQUM7Z0JBQ3pDLE1BQU0sTUFBTSxHQUFHLE9BQU8sTUFBTSxLQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNLGFBQU4sTUFBTSx1QkFBTixNQUFNLENBQUUsSUFBSSxDQUFDO2dCQUNwRSxJQUFJLE1BQU0sRUFBRSxDQUFDO29CQUNYLFdBQVcsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO29CQUNsQyxXQUFXLENBQUMsY0FBYyxHQUFHLEdBQUcsQ0FBQztvQkFDakMsV0FBVyxDQUFDLElBQUksR0FBRyxNQUFBLElBQUksQ0FBQyxJQUFJLG1DQUFJLElBQUksQ0FBQztvQkFDckMsa0JBQWtCLEdBQUcsS0FBSyxDQUFDO29CQUMzQixLQUFLLEdBQUcsTUFBTSxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsQ0FBQztnQkFDckMsQ0FBQztZQUNILENBQUM7WUFFRCxJQUFJLEdBQUcsQ0FBQztZQUNSLElBQUksV0FBVyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3ZCLEdBQUcsR0FBRyxLQUFLLENBQUMsS0FBSyxDQUFDO2dCQUNsQixLQUFLLEdBQUcsTUFBQSxRQUFRLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQywwQ0FBRSxJQUFJLENBQUM7WUFDOUMsQ0FBQztZQUVELE1BQU0sU0FBUyxHQUFHLEtBQUssS0FBSSxNQUFBLE1BQUEsT0FBTyxDQUFDLFlBQVksMENBQUcsS0FBSyxDQUFDLFVBQVUsQ0FBQywwQ0FBRSxNQUFNLENBQUEsQ0FBQztZQUU1RSxpRUFBaUU7WUFDakUsSUFBSSxTQUFTLElBQUksR0FBRyxJQUFJLG1CQUFtQixDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMsRUFBRSxDQUFDO2dCQUN6RCxLQUFLLEdBQUcscUJBQXFCLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUM5QyxNQUFNLGNBQWMsR0FBRyxxQkFBcUIsQ0FBQyxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7Z0JBRTlELEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxjQUFjLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7b0JBQy9DLE1BQU0sSUFBSSxHQUFHLGNBQWMsQ0FBQyxDQUFDLENBQUMsQ0FBQztvQkFDL0IsS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLGVBQWUsQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLGVBQWUsRUFBRSxNQUFBLElBQUksQ0FBQyxRQUFRLG1DQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztnQkFDL0YsQ0FBQztZQUNILENBQUM7WUFFRCx5RUFBeUU7WUFDekUsc0JBQXNCO1lBQ3RCLElBQUksS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO2dCQUN4QixLQUFLLENBQUMsR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDO1lBQ3JCLENBQUM7aUJBQU0sSUFBSSxHQUFHLEtBQUssWUFBWSxJQUFJLFFBQVEsRUFBRSxDQUFDO2dCQUM1QyxLQUFLLENBQUMsVUFBVSxHQUFHLFFBQVEsQ0FBQztZQUM5QixDQUFDO1FBQ0gsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBYUQ7Ozs7R0FJRztBQUNILFNBQVMsbUJBQW1CLENBQzFCLEtBQTRCLEVBQzVCLElBQXFCO0lBRXJCLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyx3QkFBd0IsSUFBSSxDQUFDLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxLQUFLLEtBQUssSUFBSSxDQUFDO0FBQzlFLENBQUM7QUFRRDs7OztHQUlHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxLQUEyQixFQUFFLElBQWdCO0lBQzFFLElBQUksS0FBSyxLQUFLLElBQUk7UUFBRSxPQUFPLEVBQUUsQ0FBQztJQUM5QixJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUM7UUFBRSxPQUFPLENBQUMsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUVwRCxNQUFNLFNBQVMsR0FBNkIsRUFBRSxDQUFDO0lBRS9DLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDdEMsTUFBTSxJQUFJLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ3RCLE1BQU0sSUFBSSxHQUFHLHFCQUFxQixDQUFDLElBQUksRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFFdkQsU0FBUyxDQUFDLElBQUksQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDO0lBQzFCLENBQUM7SUFFRCxPQUFPLFNBQVMsQ0FBQztBQUNuQixDQUFDO0FBRUQsU0FBUyxxQkFBcUIsQ0FBbUMsS0FBb0IsRUFBRSxPQUFrQztJQUN2SCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1FBQzFCLE9BQU8sVUFBVSxDQUFDLEtBQUssRUFBRSxPQUFPLENBQUMsQ0FBQztJQUNwQyxDQUFDO0lBRUQsTUFBTSxRQUFRLEdBQWdCLEVBQUUsQ0FBQztJQUNqQyx5RUFBeUU7SUFDekUsZ0JBQWdCO0lBQ2hCLEtBQUssSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFLENBQUM7UUFDdEMsUUFBUSxDQUFDLENBQUMsQ0FBQyxHQUFHLHFCQUFxQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQztJQUN6RCxDQUFDO0lBRUQsT0FBTyxRQUF3QixDQUFDO0FBQ2xDLENBQUM7QUFFRCxTQUFTLFVBQVUsQ0FBbUMsS0FBb0IsRUFBRSxPQUFrQztJQUM1RyxJQUFJLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUN4QixPQUFPLEVBQU8sQ0FBQztJQUNqQixDQUFDO0lBQ0QsSUFBSSxLQUFLLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDekIsT0FBTyxDQUFDLEdBQUcsS0FBSyxDQUFNLENBQUM7SUFDekIsQ0FBQztJQUNELElBQUksUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7UUFDcEIsTUFBTSxRQUFRLHFCQUFTLEtBQWEsQ0FBRSxDQUFDO1FBQ3ZDLElBQUksT0FBTyxDQUFDLGlCQUFpQixJQUFJLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ2pFLE9BQU8sQ0FBQyxpQkFBaUIsQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUN0QyxDQUFDO1FBQ0QsT0FBTyxRQUFRLENBQUM7SUFDbEIsQ0FBQztJQUNELE9BQU8sS0FBSyxDQUFDO0FBQ2YsQ0FBQztBQUVEOzs7R0FHRztBQUNILFNBQWdCLGVBQWUsQ0FDN0IsS0FBcUMsRUFDckMsT0FBa0MsRUFDbEMsTUFBbUIsRUFDbkIsT0FBcUIsRUFDckIsT0FBNkI7SUFFN0IsSUFBSSxRQUFRLEdBQUcsSUFBSSxDQUFDO0lBQ3BCLElBQUksT0FBTyxJQUFJLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUNwQyxPQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUM1QixDQUFDO0lBQ0QsTUFBTSxrQkFBa0IsR0FBRyxJQUFJLEdBQUcsRUFBNkIsQ0FBQztJQUVoRSxrRUFBa0U7SUFDbEUsYUFBYSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxDQUFDLEtBQUssRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEVBQUU7O1FBQy9ELElBQUksS0FBSyxLQUFLLFNBQVMsRUFBRSxDQUFDO1lBQ3hCLFFBQVEsR0FBRyxLQUFLLENBQUM7UUFDbkIsQ0FBQztRQUVELG9FQUFvRTtRQUNwRSxJQUFJLENBQUMsUUFBUSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDMUIsT0FBTyxDQUFDLE9BQU8sQ0FBQztRQUNsQixDQUFDO1FBRUQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztRQUVELElBQUksT0FBTyxJQUFJLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQy9CLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUMvQyxJQUFJLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDekIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztZQUN0QixDQUFDO1FBQ0gsQ0FBQztRQUVELEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxFQUFFLENBQUM7WUFDM0IsSUFBSSxDQUFDLENBQUMsS0FBSyxJQUFJLEtBQUssQ0FBQyxJQUFJLEtBQUssS0FBSyxZQUFZLEVBQUUsQ0FBQztnQkFDaEQsSUFBSSxZQUFZLEdBQUcsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDO2dCQUNqRCxNQUFNLE1BQU0sR0FBRyxNQUFBLE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQyxLQUFLLENBQUMsbUNBQUksQ0FBQyxDQUFBLEtBQUssYUFBTCxLQUFLLHVCQUFMLEtBQUssQ0FBRSxVQUFVLE1BQUssT0FBTyxDQUFDLENBQUMsQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUM3RyxNQUFNLFdBQVcsR0FBRyxNQUFNLENBQUMsQ0FBQyxDQUFDLEdBQUcsTUFBTSxTQUFTLENBQUMsQ0FBQyxDQUFDLFVBQVUsQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxDQUFDO2dCQUNyRixNQUFNLE9BQU8sR0FBRyxxQkFBcUIsS0FBSyxRQUFRLFdBQVcsRUFBRSxDQUFDO2dCQUNoRSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7b0JBQ2xCLE1BQU0sV0FBVyxHQUFnQixFQUFFLENBQUM7b0JBQ3BDLG9CQUFvQixDQUFDLFdBQVcsRUFBRSxTQUFTLEVBQUUsQ0FBQyxHQUFHLElBQUksRUFBRSxLQUFLLENBQUMsRUFBRSxPQUFPLENBQUMsQ0FBQztvQkFDeEUsa0JBQWtCLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxZQUFZLEdBQUcsSUFBSSxpQkFBaUIsQ0FDaEUsT0FBTyxFQUNQLFdBQVcsRUFDWCxLQUFLLENBQUMsSUFBSSxDQUFDLFFBQVEsRUFDbkIsTUFBQSxLQUFLLENBQUMsU0FBUyxtQ0FBSSxFQUFFLENBQ3RCLENBQUMsQ0FBQztnQkFDTCxDQUFDO3FCQUFNLENBQUM7b0JBQ04sTUFBTSxXQUFXLEdBQUcsWUFBWSxDQUFDLElBRWhDLENBQUM7b0JBQ0Ysb0JBQW9CLENBQUMsV0FBVyxFQUFFLFNBQVMsRUFBRSxDQUFDLEdBQUcsSUFBSSxFQUFFLEtBQUssQ0FBQyxFQUFFLE9BQU8sQ0FBQyxDQUFDO2dCQUMxRSxDQUFDO2dCQUNELFFBQVEsR0FBRyxLQUFLLENBQUM7WUFDbkIsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUMsQ0FBQyxDQUFDO0lBRUgsS0FBSyxNQUFNLEtBQUssSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1FBQ2hELE9BQU8sYUFBUCxPQUFPLHVCQUFQLE9BQU8sQ0FBRSxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDdkIsQ0FBQztJQUVELE9BQU8sUUFBUSxDQUFDO0FBQ2xCLENBQUMifQ==