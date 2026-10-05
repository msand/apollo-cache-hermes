"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotEditor = void 0;
exports.nodeIdForParameterizedValue = nodeIdForParameterizedValue;
const tslib_1 = require("tslib");
const equality = tslib_1.__importStar(require("@wry/equality"));
const client_1 = require("@apollo/client");
const graphSnapshot = tslib_1.__importStar(require("../GraphSnapshot"));
const schema = tslib_1.__importStar(require("../schema"));
const errors = tslib_1.__importStar(require("../errors"));
const nodes = tslib_1.__importStar(require("../nodes"));
const util = tslib_1.__importStar(require("../util"));
// Ensure typescript doesn't emit (0, fn)(...args)
const isEqual = equality.equal;
const { GraphSnapshot } = graphSnapshot;
const { StaticNodeId } = schema;
const { InvalidPayloadError, OperationError } = errors;
const { cloneNodeSnapshot, EntitySnapshot, ParameterizedValueSnapshot } = nodes;
const { addInboundReference, addOutboundReference, addParameterizedReference, addToSet, deepGet, hasOwn, hasParameterizedReference, ifString, isNil, isReference, iterParameterized, iterRefs, lazyImmutableDeepSet, pathBeginsWith, removeInboundReference, removeOutboundReference, removeParameterizedReference, toOutKey, } = util;
const makeRef = client_1.makeReference;
const ensureIdConstistencyMsg = `Ensure id is included (or not included) consistently across multiple requests.`;
function forEach(parameterized, fn) {
    if (!parameterized) {
        return;
    }
    for (const refs of parameterized.values()) {
        for (const ref of refs) {
            fn(ref);
        }
    }
}
function getVisibleProxy(value, map) {
    const compatible = value != null && typeof value === 'object';
    if (!compatible) {
        return undefined;
    }
    if (!map) {
        return value;
    }
    return new Proxy(value, {
        get: (target, p) => {
            return hasOwn.call(target, p) ? target[p] : target[map[p]];
        },
    });
}
/**
 * Builds a set of changes to apply on top of an existing `GraphSnapshot`.
 *
 * Performs the minimal set of edits to generate new immutable versions of each
 * node, while preserving immutability of the parent snapshot.
 */
class SnapshotEditor {
    constructor(
    /** The configuration/context to use when editing snapshots. */
    _context, 
    /** The snapshot to base edits off of. */
    _parent) {
        this._context = _context;
        this._parent = _parent;
        /**
         * Tracks all node snapshots that have changed vs the parent snapshot.
         */
        this._newNodes = Object.create(null);
        /**
         * Tracks the nodes that have new _values_ vs the parent snapshot.
         *
         * This is a subset of the keys in `_newValues`.  The difference is all nodes
         * that have only changed references.
         */
        this._editedNodeIds = new Set();
        /**
         * Tracks the nodes that have been rebuilt, and have had all their inbound
         * references updated to point to the new value.
         */
        this._rebuiltNodeIds = new Set();
        /** The queries that were written, and should now be considered complete. */
        this._writtenQueries = new Set();
        this._pathToId = Object.create(null);
    }
    /**
     * Merge a GraphQL payload (query/fragment/etc) into the snapshot, rooted at
     * the node identified by `rootId`.
     */
    mergePayload(query, payload, prune) {
        const parsed = this._context.parseOperation(query);
        // We collect all warnings associated with this operation to avoid
        // overwhelming the log for particularly nasty payloads.
        const warnings = [];
        // First, we walk the payload and apply all _scalar_ edits, while collecting
        // all references that have changed.  Reference changes are applied later,
        // once all new nodes have been built (and we can guarantee that we're
        // referencing the correct version).
        const referenceEdits = [];
        const ref = this._mergeSubgraph(referenceEdits, warnings, parsed.rootId, [] /* prefixPath */, [] /* path */, parsed.parsedQuery, payload, prune, parsed.propMap);
        // Now that we have new versions of every edited node, we can point all the
        // edited references to the correct nodes.
        //
        // In addition, this performs bookkeeping the inboundReferences of affected
        // nodes, and collects all newly orphaned nodes.
        const orphanedNodeIds = this._mergeReferenceEdits(referenceEdits);
        // Remove (garbage collect) orphaned subgraphs.
        this._removeOrphanedNodes(orphanedNodeIds);
        // The query should now be considered complete for future reads.
        this._writtenQueries.add(parsed);
        // Don't emit empty arrays for easy testing upstream.
        return warnings.length ? { warnings, ref } : { ref };
    }
    /**
     * Merge a payload (subgraph) into the cache, following the parsed form of the
     * operation.
     */
    _mergeSubgraph(referenceEdits, warnings, containerId, prefixPath, path, parsed, payload, prune, propMap) {
        var _a, _b, _c, _d, _e;
        // Don't trust our inputs; we can receive values that aren't JSON
        // serializable via optimistic updates.
        if (payload === undefined) {
            payload = null;
        }
        // We should only ever reach a subgraph if it is a container (object/array).
        if (typeof payload !== 'object') {
            const message = `Received a ${typeof payload} value, but expected an object/array/null`;
            throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
        }
        // TODO(ianm): We're doing this a lot.  How much is it impacting perf?
        const previousValue = this._getPreviousValue(containerId, path);
        const isRoot = containerId === StaticNodeId.QueryRoot;
        const typename = isRoot ? 'Query'
            : payload && typeof payload === 'object' && '__typename' in payload
                ? payload.__typename
                : (previousValue && typeof previousValue === 'object' && '__typename' in previousValue
                    ? previousValue.__typename
                    : undefined);
        const typePolicy = typeof typename === 'string' ? (_a = this._context.typePolicies) === null || _a === void 0 ? void 0 : _a[typename] : undefined;
        if (typeof (typePolicy === null || typePolicy === void 0 ? void 0 : typePolicy.merge) === 'function') {
            payload = typePolicy.merge(previousValue, payload, {});
        }
        // Recurse into arrays.
        if (Array.isArray(payload) || Array.isArray(previousValue)) {
            if (!isNil(previousValue) && !Array.isArray(previousValue)) {
                throw new InvalidPayloadError(`Unsupported transition from a non-list to list value`, prefixPath, containerId, path, payload);
            }
            if (!isNil(payload) && !Array.isArray(payload)) {
                throw new InvalidPayloadError(`Unsupported transition from a list to a non-list value`, prefixPath, containerId, path, payload);
            }
            this._mergeArraySubgraph(referenceEdits, warnings, containerId, prefixPath, path, parsed, payload, previousValue, prune, propMap);
            return;
        }
        const ref = isReference(payload) ? payload.__ref : undefined;
        const payloadId = (_b = ref !== null && ref !== void 0 ? ref : this._context.entityIdForValue(getVisibleProxy(payload, propMap))) !== null && _b !== void 0 ? _b : (path.length === 0 && !isRoot ? containerId : undefined);
        const previousId = (_c = this._context.entityIdForValue(getVisibleProxy(previousValue, propMap))) !== null && _c !== void 0 ? _c : (path.length === 0 && !isRoot
            ? containerId
            : ifString(deepGet(this._pathToId[containerId], path)));
        // Is this an identity change?
        if (payloadId !== previousId) {
            // It is invalid to transition from a *value* with an id to one without.
            if (!isNil(payload) && !payloadId) {
                const message = `Unsupported transition from an entity to a non-entity value. ${ensureIdConstistencyMsg}`;
                throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
            }
            // The reverse is also invalid.
            if (!isNil(previousValue) && !previousId) {
                const message = `Unsupported transition from a non-entity value to an entity. ${ensureIdConstistencyMsg}`;
                throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
            }
            // Double check that our id generator is behaving properly.
            if (payloadId && isNil(payload)) {
                throw new OperationError(`entityIdForNode emitted an id for a nil payload value`, prefixPath, containerId, path, payload);
            }
            // Fix references. See: orphan node tests on "orphan a subgraph" The new
            // value is null and the old value is an entity. We will want to remove
            // reference to such entity
            if (containerId !== payloadId || path.length !== 0) {
                if (!(containerId in this._pathToId)) {
                    this._pathToId[containerId] = Object.create(null);
                }
                lazyImmutableDeepSet(this._pathToId[containerId], undefined, path, payloadId);
                referenceEdits.push({
                    containerId,
                    path,
                    prevNodeId: previousId,
                    nextNodeId: payloadId,
                });
            }
            // Nothing more to do here; the reference edit will null out this field.
            if (!payloadId)
                return;
            // Enough to set the reference, no sub selections to traverse in the ref
            if (ref)
                return;
            // End of the line for a non-reference.
        }
        else if (isNil(payload)) {
            if (previousValue !== null) {
                this._setValue(containerId, path, null);
            }
            return;
        }
        // If we've entered a new node; it becomes our container.
        if (payloadId) {
            prefixPath = [...prefixPath, ...path];
            containerId = payloadId;
            path = [];
        }
        const readFromSnapshot = (obj, key) => {
            var _a, _b, _c;
            const data = obj.data;
            if (!data || typeof data !== 'object') {
                return undefined;
            }
            if (key in data) {
                return data[key];
            }
            const out = (_a = obj.outbound) === null || _a === void 0 ? void 0 : _a.get(key);
            if (out) {
                return this._getNodeData(out.id);
            }
            const ref = (_c = (_b = obj.parameterized) === null || _b === void 0 ? void 0 : _b.get(key)) === null || _c === void 0 ? void 0 : _c[0];
            if (ref !== undefined) {
                return this._getNodeData(ref.id);
            }
            if (containerId === 'ROOT_QUERY' && key === '__typename') {
                return 'Query';
            }
            return undefined;
        };
        const readField = (fieldNameOrOptions, from = { __ref: containerId }) => {
            if (!from) {
                return undefined;
            }
            if (typeof fieldNameOrOptions !== 'string')
                throw new Error('Not implemented');
            if (isReference(from)) {
                const obj = this._getNodeSnapshot(from.__ref);
                if (!obj) {
                    return undefined;
                }
                return readFromSnapshot(obj, fieldNameOrOptions);
            }
            else {
                return from[fieldNameOrOptions];
            }
        };
        const mergeOptions = {
            args: null,
            cache: null,
            canRead: (value) => {
                return isReference(value)
                    ? this._getNodeSnapshot(value.__ref) != null
                    : typeof value === 'object' && value !== null;
            },
            field: null,
            fieldName: '',
            isReference,
            readField,
            storage: this._newNodes,
            storeFieldName: '',
            toReference: (value, mergeIntoStore) => {
                const entityId = this._context.entityIdForValue(value);
                if (entityId && mergeIntoStore && !isReference(value) && typeof value !== 'string') {
                    this._ensureNewSnapshot(entityId).data = value;
                }
                return entityId ? makeRef(entityId) : undefined;
            },
            variables: undefined,
            mergeObjects(existing, incoming) {
                return incoming && Object.assign(Object.assign({}, existing), incoming);
            },
        };
        // Finally, we can walk into individual values.
        for (const payloadName in parsed) {
            const node = parsed[payloadName];
            // Having a schemaName on the node implies that payloadName is an alias.
            const schemaName = node.schemaName ? node.schemaName : payloadName;
            let fieldValue = deepGet(payload, [payloadName]);
            // Don't trust our inputs.
            if (fieldValue === undefined) {
                // If it was explicitly undefined, that likely indicates a malformed
                // input (mutation, direct write).
                if (payload && payloadName in payload) {
                    warnings.push(`Encountered undefined at ${[...prefixPath, ...path].join('.')}. Treating as null`);
                }
                continue;
            }
            let containerIdForField = containerId;
            // For static fields, we append the current cacheKey to create a new path
            // to the field.
            //
            //   user: {
            //     name: 'Bob',   -> fieldPath: ['user', 'name']
            //     address: {     -> fieldPath: ['user', 'address']
            //       city: 'A',   -> fieldPath: ['user', 'address', 'city']
            //       state: 'AB', -> fieldPath: ['user', 'address', 'state']
            //     },
            //     info: {
            //       id: 0,       -> fieldPath: ['id']
            //       prop1: 'hi'  -> fieldPath: ['prop1']
            //     },
            //     history: [
            //       {
            //         postal: 123 -> fieldPath: ['user', 'history', 0, 'postal']
            //       },
            //       {
            //         postal: 456 -> fieldPath: ['user', 'history', 1, 'postal']
            //       }
            //     ],
            //     phone: [
            //       '1234', -> fieldPath: ['user', 0]
            //       '5678', -> fieldPath: ['user', 1]
            //     ],
            //   },
            //
            // Similarly, something to keep in mind is that parameterized nodes
            // (instances of ParameterizedValueSnapshot) can have direct references to
            // an entity node's value.
            //
            // For example, with the query:
            //
            //   foo(id: 1) { id, name }
            //
            // The cache would have:
            //
            //   1: {
            //     data: { id: 1, name: 'Foo' },
            //   },
            //   'ROOT_QUERY❖["foo"]❖{"id":1}': {
            //     data: // a direct reference to the node of entity '1'.
            //   },
            //
            // This allows us to rely on standard behavior for entity references: If
            // node '1' is edited, the parameterized node must also be edited.
            // Similarly, the parameterized node contains an outbound reference to the
            // entity node, for garbage collection.
            let fieldPrefixPath = prefixPath;
            let fieldPath = [...path, schemaName];
            if (node.args) {
                if (fieldValue === null && prune) {
                    this._setValue(containerIdForField, path, null);
                    continue;
                }
                // The values of a parameterized field are explicit nodes in the graph;
                // so we set up a new container & path.
                containerIdForField = this._ensureParameterizedValueSnapshot(containerId, fieldPath, node.args);
                fieldPrefixPath = [...prefixPath, ...fieldPath];
                fieldPath = [];
            }
            // Note that we're careful to fetch the value of our new container; not
            // the outer container.
            const previousFieldValue = this._getPreviousValue(containerIdForField, fieldPath);
            const fieldPolicy = typePolicy ? (_d = typePolicy.fields) === null || _d === void 0 ? void 0 : _d[payloadName] : undefined;
            const merge = typeof fieldPolicy === 'object' && typeof (fieldPolicy === null || fieldPolicy === void 0 ? void 0 : fieldPolicy.merge) === 'function' ? fieldPolicy === null || fieldPolicy === void 0 ? void 0 : fieldPolicy.merge : undefined;
            if (merge) {
                mergeOptions.args = (_e = node.args) !== null && _e !== void 0 ? _e : null;
                mergeOptions.fieldName = payloadName;
                mergeOptions.storeFieldName = payloadName;
                fieldValue = merge(previousFieldValue, fieldValue, mergeOptions);
            }
            // For fields with sub selections, we walk into them; only leaf fields are
            // directly written via _setValue.  This allows us to perform minimal
            // edits to the graph.
            if (node.children) {
                this._mergeSubgraph(referenceEdits, warnings, containerIdForField, fieldPrefixPath, fieldPath, node.children, fieldValue, prune, node.propMap);
                // We've hit a leaf field.
                //
                // Note that we must perform a _deep_ equality check here, to cover cases
                // where a leaf value is a complex object.
            }
            else if (!isEqual(fieldValue, previousFieldValue)) {
                // We intentionally do not deep copy the nodeValue as Apollo will
                // then perform Object.freeze anyway. So any change in the payload
                // value afterward will be reflect in the graph as well.
                //
                // We use selection.name.value instead of payloadKey so that we
                // always write to cache using real field name rather than alias
                // name.
                this._setValue(containerIdForField, fieldPath, fieldValue);
            }
        }
        if (payload && !prune) {
            for (const payloadName of Object.keys(payload)) {
                if (!hasOwn.call(parsed, payloadName)) {
                    const value = payload[payloadName];
                    const fieldPath = [...path, payloadName];
                    this._setValue(containerId, fieldPath, value);
                }
            }
        }
        return payloadId;
    }
    /**
     * Merge an array from the payload (or previous cache data).
     */
    _mergeArraySubgraph(referenceEdits, warnings, containerId, prefixPath, path, parsed, payload, previousValue, prune, propMap) {
        if (isNil(payload)) {
            // Note that we mark this as an edit, as this method is only ever called
            // if we've determined the value to be an array (which means that
            // previousValue MUST be an array in this case).
            this._setValue(containerId, path, null);
            return;
        }
        const payloadLength = payload ? payload.length : 0;
        const previousLength = previousValue ? previousValue.length : 0;
        // Note that even though we walk into arrays, we need to be
        // careful to ensure that we don't leave stray values around if
        // the new array is of a different length.
        //
        // So, we resize the array to our desired size before walking.
        if (payloadLength !== previousLength || !previousValue) {
            const newArray = Array.isArray(previousValue)
                ? previousValue.slice(0, payloadLength) : new Array(payloadLength);
            this._setValue(containerId, path, newArray);
            // Drop any extraneous references.
            if (payloadLength < previousLength) {
                this._removeArrayReferences(referenceEdits, containerId, path, payloadLength - 1);
            }
        }
        // Note that we're careful to iterate over all indexes, in case this is a
        // sparse array.
        for (let i = 0; i < payload.length; i++) {
            let childPayload = payload[i];
            if (childPayload === undefined) {
                // Undefined values in an array are strictly invalid; and likely
                // indicate a malformed input (mutation, direct write).
                childPayload = null;
                if (i in payload) {
                    warnings.push(`Encountered undefined at ${[...path, i].join('.')}. Treating as null`);
                }
                else {
                    warnings.push(`Encountered hole in array at ${[...path, i].join('.')}. Filling with null`);
                }
            }
            this._mergeSubgraph(referenceEdits, warnings, containerId, prefixPath, [...path, i], parsed, childPayload, prune, propMap);
        }
    }
    delete(nodeId) {
        var _a, _b;
        this._editedNodeIds.add(nodeId);
        const referenceEdits = [];
        const nodeSnapshot = this._getNodeSnapshot(nodeId);
        (_a = nodeSnapshot === null || nodeSnapshot === void 0 ? void 0 : nodeSnapshot.inbound) === null || _a === void 0 ? void 0 : _a.forEach(({ id, path }) => {
            this._editedNodeIds.add(id);
            referenceEdits.push({ containerId: id, nextNodeId: undefined, prevNodeId: nodeId, path });
        });
        // Outbound targets only lose an inbound reference; their data is unchanged,
        // so they are not marked as edited, and their other referrers are not
        // rebuilt. Targets left without any inbound reference are still marked, as
        // orphans, by _mergeReferenceEdits.
        (_b = nodeSnapshot === null || nodeSnapshot === void 0 ? void 0 : nodeSnapshot.outbound) === null || _b === void 0 ? void 0 : _b.forEach(({ id, path }) => {
            referenceEdits.push({ containerId: nodeId, nextNodeId: undefined, prevNodeId: id, path });
        });
        forEach(nodeSnapshot === null || nodeSnapshot === void 0 ? void 0 : nodeSnapshot.parameterized, ({ id, path }) => {
            referenceEdits.push({ containerId: nodeId, nextNodeId: undefined, prevNodeId: id, path });
        });
        // One editor may delete several nodes (batchEvict, gc, optimistic replay).
        // Edits touching a node this editor already deleted are moot, and would
        // otherwise fail on its missing snapshot.
        this._mergeReferenceEdits(referenceEdits.filter(({ containerId, prevNodeId }) => !this._isDeleted(containerId) && !(prevNodeId && this._isDeleted(prevNodeId))));
        this._newNodes[nodeId] = undefined;
    }
    /**
     * Whether this editor has deleted the node.
     */
    _isDeleted(nodeId) {
        return nodeId in this._newNodes && this._newNodes[nodeId] === undefined;
    }
    /**
     * Modify a GraphQL payload (query/fragment/etc) into the snapshot, rooted at
     * the node identified by `rootId`.
     */
    modify(rootId, payload, deleted, seenObjects) {
        const warnings = [];
        const referenceEdits = [];
        this._modifySubgraph(referenceEdits, warnings, rootId, [] /* prefixPath */, [] /* path */, payload, deleted, seenObjects);
        this._mergeReferenceEdits(referenceEdits);
        return warnings.length ? { warnings } : {};
    }
    /**
     * Modify a payload (subgraph) into the cache.
     */
    _modifySubgraph(referenceEdits, warnings, containerId, prefixPath, path, payload, deleted, seenObjects) {
        var _a;
        // Don't trust our inputs; we can receive values that aren't JSON
        // serializable via optimistic updates.
        if (payload === undefined) {
            payload = null;
        }
        // We should only ever reach a subgraph if it is a container (object/array).
        if (typeof payload !== 'object') {
            const message = `Received a ${typeof payload} value, but expected an object/array/null`;
            throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
        }
        if (seenObjects.has(payload)) {
            return;
        }
        seenObjects.add(payload);
        // TODO(ianm): We're doing this a lot.  How much is it impacting perf?
        const previousValue = this._getPreviousValue(containerId, path);
        const nodeSnapshot = this._getNodeSnapshot(containerId);
        // Recurse into arrays.
        if (Array.isArray(payload) || Array.isArray(previousValue)) {
            if (!isNil(previousValue) && !Array.isArray(previousValue)) {
                throw new InvalidPayloadError(`Unsupported transition from a non-list to list value`, prefixPath, containerId, path, payload);
            }
            if (!isNil(payload) && !Array.isArray(payload)) {
                throw new InvalidPayloadError(`Unsupported transition from a list to a non-list value`, prefixPath, containerId, path, payload);
            }
            this._modifyArraySubgraph(referenceEdits, warnings, containerId, prefixPath, path, payload, previousValue, seenObjects);
            return;
        }
        const reference = isReference(payload) ? payload.__ref : null;
        const payloadId = reference ? reference : this._context.entityIdForValue(Object.assign(Object.assign({}, previousValue), payload));
        const previousId = this._context.entityIdForValue(previousValue);
        // Is this an identity change?
        if (payloadId !== previousId) {
            // It is invalid to transition from a *value* with an id to one without.
            if (!isNil(payload) && !payloadId) {
                const message = `Unsupported transition from an entity to a non-entity value. ${ensureIdConstistencyMsg}`;
                throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
            }
            // The reverse is also invalid.
            if (!isNil(previousValue) && !previousId) {
                const message = `Unsupported transition from a non-entity value to an entity. ${ensureIdConstistencyMsg}`;
                throw new InvalidPayloadError(message, prefixPath, containerId, path, payload);
            }
            // Double check that our id generator is behaving properly.
            if (payloadId && isNil(payload)) {
                throw new OperationError(`entityIdForNode emitted an id for a nil payload value`, prefixPath, containerId, path, payload);
            }
            // Fix references. See: orphan node tests on "orphan a subgraph" The new
            // value is null and the old value is an entity. We will want to remove
            // reference to such entity
            if (containerId !== payloadId || path.length !== 0) {
                referenceEdits.push({
                    containerId,
                    path,
                    prevNodeId: previousId,
                    nextNodeId: payloadId,
                });
            }
            // Nothing more to do here; the reference edit will null out this field.
            if (!payloadId || reference)
                return;
            // End of the line for a non-reference.
        }
        else if (isNil(payload)) {
            if (previousValue !== null) {
                this._setValue(containerId, path, null);
            }
            return;
        }
        // If we've entered a new node; it becomes our container.
        if (payloadId) {
            prefixPath = [...prefixPath, ...path];
            containerId = payloadId;
            path = [];
        }
        // Finally, we can walk into individual values.
        for (const payloadName in payload) {
            const node = payload[payloadName];
            // Having a schemaName on the node implies that payloadName is an alias.
            const fieldValue = deepGet(payload, [payloadName]);
            // Don't trust our inputs.
            if (fieldValue === undefined) {
                // If it was explicitly undefined, that likely indicates a malformed
                // input (mutation, direct write).
                if (payload && payloadName in payload) {
                    warnings.push(`Encountered undefined at ${[...prefixPath, ...path].join('.')}. Treating as null`);
                }
                continue;
            }
            const containerIdForField = containerId;
            // For static fields, we append the current cacheKey to create a new path
            // to the field.
            //
            //   user: {
            //     name: 'Bob',   -> fieldPath: ['user', 'name']
            //     address: {     -> fieldPath: ['user', 'address']
            //       city: 'A',   -> fieldPath: ['user', 'address', 'city']
            //       state: 'AB', -> fieldPath: ['user', 'address', 'state']
            //     },
            //     info: {
            //       id: 0,       -> fieldPath: ['id']
            //       prop1: 'hi'  -> fieldPath: ['prop1']
            //     },
            //     history: [
            //       {
            //         postal: 123 -> fieldPath: ['user', 'history', 0, 'postal']
            //       },
            //       {
            //         postal: 456 -> fieldPath: ['user', 'history', 1, 'postal']
            //       }
            //     ],
            //     phone: [
            //       '1234', -> fieldPath: ['user', 0]
            //       '5678', -> fieldPath: ['user', 1]
            //     ],
            //   },
            //
            // Similarly, something to keep in mind is that parameterized nodes
            // (instances of ParameterizedValueSnapshot) can have direct references to
            // an entity node's value.
            //
            // For example, with the query:
            //
            //   foo(id: 1) { id, name }
            //
            // The cache would have:
            //
            //   1: {
            //     data: { id: 1, name: 'Foo' },
            //   },
            //   'ROOT_QUERY❖["foo"]❖{"id":1}': {
            //     data: // a direct reference to the node of entity '1'.
            //   },
            //
            // This allows us to rely on standard behavior for entity references: If
            // node '1' is edited, the parameterized node must also be edited.
            // Similarly, the parameterized node contains an outbound reference to the
            // entity node, for garbage collection.
            const fieldPrefixPath = prefixPath;
            const fieldPath = [...path, payloadName];
            const parameterizedFields = (_a = nodeSnapshot === null || nodeSnapshot === void 0 ? void 0 : nodeSnapshot.parameterized) === null || _a === void 0 ? void 0 : _a.get(payloadName);
            if (parameterizedFields === null || parameterizedFields === void 0 ? void 0 : parameterizedFields.length) {
                for (const field of parameterizedFields) {
                    // The values of a parameterized field are explicit nodes in the graph
                    // so we set up a new container & path.
                    this._modifySubgraph(referenceEdits, warnings, field.id, [...prefixPath, ...field.path], [], deepGet(fieldValue, field.path.slice(1)), new Set(), seenObjects);
                }
                if (parameterizedFields.some(field => field.path.length === 1)) {
                    continue;
                }
            }
            // Note that we're careful to fetch the value of our new container; not
            // the outer container.
            const previousFieldValue = this._getPreviousValue(containerIdForField, fieldPath);
            // For fields with sub selections, we walk into them; only leaf fields are
            // directly written via _setValue.  This allows us to perform minimal
            // edits to the graph.
            if (typeof node === 'object') {
                this._modifySubgraph(referenceEdits, warnings, containerIdForField, fieldPrefixPath, fieldPath, fieldValue, new Set(), seenObjects);
                // We've hit a leaf field.
                //
                // Note that we must perform a _deep_ equality check here, to cover cases
                // where a leaf value is a complex object.
            }
            else if (!isEqual(fieldValue, previousFieldValue)) {
                // We intentionally do not deep copy the nodeValue as Apollo will
                // then perform Object.freeze anyway. So any change in the payload
                // value afterward will be reflect in the graph as well.
                //
                // We use selection.name.value instead of payloadKey so that we
                // always write to cache using real field name rather than alias
                // name.
                this._setValue(containerIdForField, fieldPath, fieldValue);
            }
        }
        const node = this._getNodeSnapshot(containerId);
        const value = deepGet(node === null || node === void 0 ? void 0 : node.data, path);
        for (const key of deleted) {
            const fieldPath = [...path, key];
            if (value && key in value) {
                this._setValue(containerId, fieldPath, undefined, true, true);
            }
            else {
                const keyParts = key.split('❖');
                const keyPath = keyParts.length > 1 ? JSON.parse(keyParts[1]) : [key];
                referenceEdits.push({
                    containerId,
                    path: keyPath,
                    prevNodeId: key,
                    nextNodeId: undefined,
                });
            }
        }
    }
    _getPreviousValue(containerId, path) {
        var _a, _b;
        const node = this._getNodeSnapshot(containerId);
        const value = deepGet(node === null || node === void 0 ? void 0 : node.data, path);
        if (value === undefined) {
            if (node) {
                const out = (_a = node.outbound) === null || _a === void 0 ? void 0 : _a.get(toOutKey(path));
                if (out !== undefined) {
                    return this._getNodeData(out.id);
                }
                const key = path.at(0);
                if (key === undefined) {
                    return value;
                }
                const refs = (_b = node.parameterized) === null || _b === void 0 ? void 0 : _b.get(key.toString());
                if (refs === undefined) {
                    return value;
                }
                const length = path.length;
                for (const ref of refs) {
                    const p = ref.path;
                    if (p.length === length && path.every((part, i) => part === p[i])) {
                        return this._getNodeData(ref.id);
                    }
                }
            }
        }
        return value;
    }
    /**
     * Modify an array from the payload (or previous cache data).
     */
    _modifyArraySubgraph(referenceEdits, warnings, containerId, prefixPath, path, payload, previousValue, seenObjects) {
        if (isNil(payload)) {
            // Note that we mark this as an edit, as this method is only ever called
            // if we've determined the value to be an array (which means that
            // previousValue MUST be an array in this case).
            this._setValue(containerId, path, null);
            return;
        }
        const payloadLength = payload ? payload.length : 0;
        const previousLength = previousValue ? previousValue.length : 0;
        // Note that even though we walk into arrays, we need to be
        // careful to ensure that we don't leave stray values around if
        // the new array is of a different length.
        //
        // So, we resize the array to our desired size before walking.
        if (payloadLength !== previousLength || !previousValue) {
            const newArray = Array.isArray(previousValue)
                ? previousValue.slice(0, payloadLength) : new Array(payloadLength);
            this._setValue(containerId, path, newArray);
            // Drop any extraneous references.
            if (payloadLength < previousLength) {
                this._removeArrayReferences(referenceEdits, containerId, path, payloadLength - 1);
            }
        }
        // Note that we're careful to iterate over all indexes, in case this is a
        // sparse array.
        for (let i = 0; i < payload.length; i++) {
            let childPayload = payload[i];
            if (childPayload === undefined) {
                // Undefined values in an array are strictly invalid; and likely
                // indicate a malformed input (mutation, direct write).
                childPayload = null;
                if (i in payload) {
                    warnings.push(`Encountered undefined at ${[...path, i].join('.')}. Treating as null`);
                }
                else {
                    warnings.push(`Encountered hole in array at ${[...path, i].join('.')}. Filling with null`);
                }
            }
            if (typeof childPayload === 'object') {
                this._modifySubgraph(referenceEdits, warnings, containerId, prefixPath, [...path, i], childPayload, new Set(), seenObjects);
            }
            else {
                this._setValue(containerId, [...path, i], childPayload);
            }
        }
    }
    /**
     *
     */
    _removeArrayReferences(referenceEdits, containerId, prefix, afterIndex) {
        const container = this._getNodeSnapshot(containerId);
        if (!container || (!container.outbound && !container.parameterized))
            return;
        for (const reference of iterRefs(container.outbound, container.parameterized)) {
            if (!pathBeginsWith(reference.path, prefix))
                continue;
            const index = reference.path[prefix.length];
            if (typeof index !== 'number')
                continue;
            if (index <= afterIndex)
                continue;
            // At this point, we've got a reference beyond the array's new bounds.
            referenceEdits.push({
                containerId,
                path: reference.path,
                prevNodeId: reference.id,
                nextNodeId: undefined,
                noWrite: true,
            });
        }
    }
    /**
     * Update all nodes with edited references, and ensure that the bookkeeping of
     * the new and _past_ references are properly updated.
     *
     * Returns the set of node ids that are newly orphaned by these edits.
     */
    _mergeReferenceEdits(referenceEdits) {
        const orphanedNodeIds = new Set();
        for (const { containerId, path, prevNodeId, nextNodeId, noWrite } of referenceEdits) {
            if (!noWrite) {
                const target = nextNodeId ? this._getNodeData(nextNodeId) : null;
                this._setValue(containerId, path, target);
            }
            const container = this._ensureNewSnapshot(containerId);
            if (prevNodeId) {
                const prevTarget = this._ensureNewSnapshot(prevNodeId);
                const parameterized = prevTarget instanceof ParameterizedValueSnapshot;
                if (parameterized) {
                    removeParameterizedReference(container, prevNodeId, path);
                }
                else {
                    removeOutboundReference(container, path);
                }
                removeInboundReference(prevTarget, containerId, path);
                if (!prevTarget.inbound) {
                    orphanedNodeIds.add(prevNodeId);
                }
            }
            if (nextNodeId) {
                const nextTarget = this._ensureNewSnapshot(nextNodeId);
                const parameterized = nextTarget instanceof ParameterizedValueSnapshot;
                if (parameterized) {
                    addParameterizedReference(container, nextNodeId, path);
                }
                else {
                    addOutboundReference(container, nextNodeId, path);
                }
                addInboundReference(nextTarget, containerId, path);
                orphanedNodeIds.delete(nextNodeId);
            }
        }
        for (const id of orphanedNodeIds) {
            this._editedNodeIds.add(id);
        }
        return orphanedNodeIds;
    }
    /**
     * Commits the transaction, returning a new immutable snapshot.
     */
    commit(ref) {
        // At this point, every node that has had any of its properties change now
        // exists in _newNodes.  In order to preserve immutability, we need to walk
        // all nodes that transitively reference an edited node, and update their
        // references to point to the new version.
        this._rebuildInboundReferences();
        const snapshot = this._buildNewSnapshot();
        if (this._context.freezeSnapshots) {
            snapshot.freeze();
        }
        return {
            snapshot,
            editedNodeIds: this._editedNodeIds,
            writtenQueries: this._writtenQueries,
            ref: ref ? makeRef(ref) : undefined,
        };
    }
    /**
     * Collect all our pending changes into a new GraphSnapshot.
     */
    _buildNewSnapshot() {
        const { entityTransformer } = this._context;
        const snapshots = Object.assign({}, this._parent._values);
        for (const id in this._newNodes) {
            const newSnapshot = this._newNodes[id];
            // Drop snapshots that were garbage collected.
            if (newSnapshot === undefined) {
                delete snapshots[id];
            }
            else {
                // TODO: This should not be run for ParameterizedValueSnapshots
                if (entityTransformer) {
                    const { data } = this._newNodes[id];
                    if (data)
                        entityTransformer(data);
                }
                snapshots[id] = newSnapshot;
            }
        }
        return new GraphSnapshot(snapshots);
    }
    /**
     * Transitively walks the inbound references of all edited nodes, rewriting
     * those references to point to the newly edited versions.
     */
    _rebuildInboundReferences() {
        const queue = Array.from(this._editedNodeIds);
        addToSet(this._rebuiltNodeIds, queue);
        while (queue.length) {
            const nodeId = queue.pop();
            const snapshot = this._getNodeSnapshot(nodeId);
            if (!(snapshot instanceof EntitySnapshot))
                continue;
            if (!snapshot || !snapshot.inbound)
                continue;
            for (const { id, path } of snapshot.inbound.values()) {
                this._setValue(id, path, snapshot.data, false);
                if (this._rebuiltNodeIds.has(id))
                    continue;
                this._rebuiltNodeIds.add(id);
                queue.push(id);
            }
        }
    }
    /**
     * Transitively removes all orphaned nodes from the graph.
     */
    _removeOrphanedNodes(nodeIds) {
        const queue = Array.from(nodeIds);
        while (queue.length) {
            const nodeId = queue.pop();
            const node = this._getNodeSnapshot(nodeId);
            if (!node)
                continue;
            this._newNodes[nodeId] = undefined;
            this._editedNodeIds.add(nodeId);
            const { outbound, parameterized } = node;
            if (outbound) {
                this.removeInbound(outbound.values(), nodeId, queue);
            }
            if (parameterized) {
                this.removeInbound(iterParameterized(parameterized), nodeId, queue);
            }
        }
    }
    removeInbound(refs, nodeId, queue) {
        for (const { id, path } of refs) {
            const reference = this._ensureNewSnapshot(id);
            removeInboundReference(reference, nodeId, path);
            if (reference.inbound === undefined) {
                queue.push(id);
            }
        }
    }
    /**
     * Retrieve the _latest_ version of a node snapshot.
     */
    _getNodeSnapshot(id) {
        return id in this._newNodes ? this._newNodes[id] : this._parent.getNodeSnapshot(id);
    }
    /**
     * Retrieve the _latest_ version of a node.
     */
    _getNodeData(id) {
        const snapshot = this._getNodeSnapshot(id);
        return snapshot ? snapshot.data : undefined;
    }
    /**
     * Set `newValue` at `path` of the value snapshot identified by `id`, without
     * modifying the parent's copy of it.
     *
     * This will not shallow clone objects/arrays along `path` if they were
     * previously cloned during this transaction.
     */
    _setValue(id, path, newValue, isEdit = true, isDelete) {
        if (isEdit) {
            this._editedNodeIds.add(id);
        }
        const parent = this._parent.getNodeSnapshot(id);
        const current = this._ensureNewSnapshot(id);
        current.data = lazyImmutableDeepSet(current.data, parent && parent.data, path, newValue, isDelete);
    }
    /**
     * Ensures that we have built a new version of a snapshot for node `id` (and
     * that it is referenced by `_newNodes`).
     */
    _ensureNewSnapshot(id) {
        let parent;
        if (id in this._newNodes) {
            return this._newNodes[id];
        }
        else {
            parent = this._parent.getNodeSnapshot(id);
        }
        // TODO: We're assuming that the only time we call _ensureNewSnapshot when
        // there is no parent is when the node is an entity.  Can we enforce it, or
        // pass a type through?
        const newSnapshot = parent ? cloneNodeSnapshot(parent) : new EntitySnapshot();
        this._newNodes[id] = newSnapshot;
        return newSnapshot;
    }
    /**
     * Ensures that there is a ParameterizedValueSnapshot for the given node with
     * arguments
     */
    _ensureParameterizedValueSnapshot(containerId, path, args) {
        const fieldId = nodeIdForParameterizedValue(containerId, path, args);
        // We're careful to not edit the container unless we absolutely have to.
        // (There may be no changes for this parameterized value).
        const containerSnapshot = this._getNodeSnapshot(containerId);
        if (!containerSnapshot || !hasParameterizedReference(containerSnapshot, fieldId, path)) {
            // We need to construct a new snapshot otherwise.
            const newSnapshot = new ParameterizedValueSnapshot();
            addInboundReference(newSnapshot, containerId, path);
            this._newNodes[fieldId] = newSnapshot;
            // Ensure that the container points to it.
            const snapshot = this._ensureNewSnapshot(containerId);
            addParameterizedReference(snapshot, fieldId, path);
        }
        return fieldId;
    }
}
exports.SnapshotEditor = SnapshotEditor;
/**
 * Generate a stable id for a parameterized value.
 */
function nodeIdForParameterizedValue(containerId, path, args) {
    return `${containerId}❖${JSON.stringify(path)}❖${JSON.stringify(args)}`;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU25hcHNob3RFZGl0b3IuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJTbmFwc2hvdEVkaXRvci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFxcUNBLGtFQUVDOztBQXZxQ0QsZ0VBQTBDO0FBQzFDLDJDQUErQztBQVkvQyx3RUFBa0Q7QUFDbEQsMERBQW9DO0FBQ3BDLDBEQUFvQztBQUNwQyx3REFBa0M7QUFDbEMsc0RBQWdDO0FBRWhDLGtEQUFrRDtBQUNsRCxNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsS0FBSyxDQUFDO0FBQy9CLE1BQU0sRUFBRSxhQUFhLEVBQUUsR0FBRyxhQUFhLENBQUM7QUFDeEMsTUFBTSxFQUFFLFlBQVksRUFBRSxHQUFHLE1BQU0sQ0FBQztBQUNoQyxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsY0FBYyxFQUFFLEdBQUcsTUFBTSxDQUFDO0FBQ3ZELE1BQU0sRUFBRSxpQkFBaUIsRUFBRSxjQUFjLEVBQUUsMEJBQTBCLEVBQUUsR0FBRyxLQUFLLENBQUM7QUFDaEYsTUFBTSxFQUNKLG1CQUFtQixFQUNuQixvQkFBb0IsRUFDcEIseUJBQXlCLEVBQ3pCLFFBQVEsRUFDUixPQUFPLEVBQ1AsTUFBTSxFQUNOLHlCQUF5QixFQUN6QixRQUFRLEVBQ1IsS0FBSyxFQUNMLFdBQVcsRUFDWCxpQkFBaUIsRUFDakIsUUFBUSxFQUNSLG9CQUFvQixFQUNwQixjQUFjLEVBQ2Qsc0JBQXNCLEVBQ3RCLHVCQUF1QixFQUN2Qiw0QkFBNEIsRUFDNUIsUUFBUSxHQUNULEdBQUcsSUFBSSxDQUFDO0FBQ1QsTUFBTSxPQUFPLEdBQUcsc0JBQWEsQ0FBQztBQUU5QixNQUFNLHVCQUF1QixHQUFHLGdGQUFnRixDQUFDO0FBOEJqSCxTQUFTLE9BQU8sQ0FBQyxhQUF1RCxFQUFFLEVBQWlDO0lBQ3pHLElBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUNuQixPQUFPO0lBQ1QsQ0FBQztJQUNELEtBQUssTUFBTSxJQUFJLElBQUksYUFBYSxD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