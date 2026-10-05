"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheTransaction = void 0;
const tslib_1 = require("tslib");
const client_1 = require("@apollo/client");
const equality = tslib_1.__importStar(require("@wry/equality"));
const transaction = tslib_1.__importStar(require("./apollo/Transaction"));
const cacheSnapshot = tslib_1.__importStar(require("./CacheSnapshot"));
const operations = tslib_1.__importStar(require("./operations"));
const schema = tslib_1.__importStar(require("./schema"));
const nodes = tslib_1.__importStar(require("./nodes"));
const util = tslib_1.__importStar(require("./util"));
const isEqual = equality.equal;
const makeRef = client_1.makeReference;
const { StaticNodeId } = schema;
const { CacheSnapshot } = cacheSnapshot;
const { ApolloTransaction } = transaction;
const { cloneNodeSnapshot, EntitySnapshot } = nodes;
const { read, SnapshotEditor, write } = operations;
const { addToSet, isObject, isReference } = util;
const DELETE = Object.create(null);
const INVALIDATE = Object.create(null);
function isDeleteModifier(value) {
    return value === DELETE;
}
function isInvalidateModifier(value) {
    return value === INVALIDATE;
}
/**
 * Collects a set of edits against a version of the cache, eventually committing
 * them in the form of a new cache snapshot.
 *
 * If a ChangeId is provided, edits will be made on top of the optimistic state
 * (an optimistic update).  Otherwise edits are made against the baseline state.
 */
class CacheTransaction {
    constructor(_context, _snapshot, _optimisticChangeId) {
        this._context = _context;
        this._snapshot = _snapshot;
        this._optimisticChangeId = _optimisticChangeId;
        /** The set of nodes edited throughout the transaction. */
        this._editedNodeIds = new Set();
        /** All edits made throughout the transaction. */
        this._deltas = [];
        /** All queries written during the transaction. */
        this._writtenQueries = new Set();
        this._parentSnapshot = _snapshot;
    }
    isOptimisticTransaction() {
        return this._optimisticChangeId ? true : undefined;
    }
    transformDocument(document) {
        return this._context.transformDocument(document);
    }
    /**
     * Executes reads against the current values in the transaction.
     */
    read(query) {
        return read(this._context, query, this._optimisticChangeId ? this._snapshot.optimistic : this._snapshot.baseline, Object.create(null));
    }
    /**
     * Merges a payload with the current values in the transaction.
     *
     * If this is an optimistic transaction, edits will be made directly on top of
     * any previous optimistic values.  Otherwise, edits will be made to the
     * baseline state (and any optimistic updates will be replayed over it).
     */
    write(query, payload) {
        if (this._optimisticChangeId) {
            return this._writeOptimistic(query, payload);
        }
        else {
            return this._writeBaseline(query, payload);
        }
    }
    /**
     * Roll back a previously enqueued optimistic update.
     */
    rollback(changeId) {
        const current = this._snapshot;
        const optimisticQueue = current.optimisticQueue.remove(changeId);
        current.optimisticQueue = optimisticQueue;
        const optimistic = this._buildOptimisticSnapshot(current.baseline);
        // Invalidate all IDs from the soon-to-be previous optimistic snapshot,
        // since we don't know which IDs were changed by the one we're rolling back.
        const allIds = new Set(current.optimistic.allNodeIds());
        addToSet(this._editedNodeIds, allIds);
        this._snapshot = new CacheSnapshot(current.baseline, optimistic, optimisticQueue);
    }
    /**
     * Complete the transaction, returning the new snapshot and the ids of any
     * nodes that were edited.
     */
    commit() {
        this._triggerEntityUpdaters();
        let snapshot = this._snapshot;
        if (this._optimisticChangeId) {
            snapshot = new CacheSnapshot(snapshot.baseline, snapshot.optimistic, snapshot.optimisticQueue.enqueue(this._optimisticChangeId, this._deltas));
        }
        return { snapshot, editedNodeIds: this._editedNodeIds, writtenQueries: this._writtenQueries };
    }
    markEditedNodeIds(allIds) {
        addToSet(this._editedNodeIds, allIds);
    }
    setSnapshot(snapshot) {
        this._snapshot = snapshot;
    }
    getPreviousNodeSnapshot(nodeId) {
        const prevSnapshot = this._optimisticChangeId ? this._parentSnapshot.optimistic : this._parentSnapshot.baseline;
        return prevSnapshot.getNodeSnapshot(nodeId);
    }
    getCurrentNodeSnapshot(nodeId) {
        const currentSnapshot = this._optimisticChangeId ? this._snapshot.optimistic : this._snapshot.baseline;
        return currentSnapshot.getNodeSnapshot(nodeId);
    }
    /**
     * Emits change events for any callbacks configured via
     * CacheContext#entityUpdaters.
     */
    _triggerEntityUpdaters() {
        const { entityUpdaters } = this._context;
        if (!Object.keys(entityUpdaters).length)
            return;
        // Capture a static set of nodes, as the updaters may add to _editedNodeIds.
        const nodesToEmit = [];
        for (const nodeId of this._editedNodeIds) {
            const node = this.getCurrentNodeSnapshot(nodeId);
            const previous = this.getPreviousNodeSnapshot(nodeId);
            // One of them may be undefined; but we are guaranteed that both represent
            // the same entity.
            const either = node || previous;
            if (!(either instanceof EntitySnapshot))
                continue; // Only entities
            let typeName = isObject(either.data) && either.data.__typename;
            const isRoot = nodeId === StaticNodeId.QueryRoot;
            if (!typeName && isRoot) {
                typeName = 'Query';
            }
            if (!typeName)
                continue; // Must have a typename for now.
            const updater = entityUpdaters[typeName];
            if (!updater)
                continue;
            nodesToEmit.push({
                updater,
                node: node && (isRoot || node.inbound) && node.data,
                previous: previous && previous.data,
            });
        }
        if (!nodesToEmit.length)
            return;
        // TODO: This is weirdly the only place where we assume an Apollo interface.
        // Can we clean this up? :(
        const dataProxy = new ApolloTransaction(this);
        for (const { updater, node, previous } of nodesToEmit) {
            updater(dataProxy, node, previous);
        }
    }
    /**
     * Merge a payload with the baseline snapshot.
     */
    _writeBaseline(query, payload) {
        const current = this._snapshot;
        const { snapshot: baseline, editedNodeIds, writtenQueries, ref } = write(this._context, current.baseline, query, payload);
        addToSet(this._editedNodeIds, editedNodeIds);
        addToSet(this._writtenQueries, writtenQueries);
        const optimistic = this._buildOptimisticSnapshot(baseline);
        this._snapshot = new CacheSnapshot(baseline, optimistic, current.optimisticQueue);
        return ref;
    }
    /**
     * Given a baseline snapshot, build an optimistic one from it.
     */
    _buildOptimisticSnapshot(baseline) {
        const { optimisticQueue } = this._snapshot;
        if (!optimisticQueue.hasUpdates())
            return baseline;
        const { snapshot, editedNodeIds } = optimisticQueue.apply(this._context, baseline);
        addToSet(this._editedNodeIds, editedNodeIds);
        return snapshot;
    }
    /**
     * Merge a payload with the optimistic snapshot.
     */
    _writeOptimistic(query, payload) {
        this._deltas.push({ query, payload });
        const { snapshot: optimistic, editedNodeIds, writtenQueries, ref } = write(this._context, this._snapshot.optimistic, query, payload);
        addToSet(this._writtenQueries, writtenQueries);
        addToSet(this._editedNodeIds, editedNodeIds);
        this._snapshot = new CacheSnapshot(this._snapshot.baseline, optimistic, this._snapshot.optimisticQueue);
        return ref;
    }
    modify(options) {
        var _a;
        const graphSnapshot = options.optimistic ? this._snapshot.optimistic : this._snapshot.baseline;
        const id = 'id' in options ? options.id : 'ROOT_QUERY';
        if (!id) {
            return false;
        }
        const node = graphSnapshot.getNodeSnapshot(id);
        if (!node) {
            return false;
        }
        const nodeRefToMatch = ({ id }) => ({ d: graphSnapshot.getNodeData(id), k: id });
        function readFromSnapshot(obj, key) {
            var _a, _b, _c, _d;
            const data = obj.data;
            const datum = data && typeof data === 'object' && key in data ? data[key] : undefined;
            if (datum != null) {
                return [{ d: datum, k: null }];
            }
            const nodes = (_c = (_b = (_a = obj.parameterized) === null || _a === void 0 ? void 0 : _a.get(key)) === null || _b === void 0 ? void 0 : _b.map(nodeRefToMatch)) !== null && _c !== void 0 ? _c : [];
            const out = (_d = obj.outbound) === null || _d === void 0 ? void 0 : _d.get(key);
            if (out) {
                const k = out.id;
                return [{ d: graphSnapshot.getNodeData(k), k }].concat(nodes);
            }
            if (nodes.length) {
                return nodes;
            }
            if (id === 'ROOT_QUERY' && key === '__typename') {
                return [{ d: 'Query', k: null }];
            }
            if (datum === null) {
                return [{ d: null, k: null }];
            }
            return [];
        }
        function readOneFromSnapshot(obj, key) {
            var _a, _b, _c;
            const data = obj.data;
            const datum = data && typeof data === 'object' && key in data ? data[key] : undefined;
            if (datum != null) {
                return datum;
            }
            const out = (_a = obj.outbound) === null || _a === void 0 ? void 0 : _a.get(key);
            if (out) {
                return graphSnapshot.getNodeData(out.id);
            }
            const ref = (_c = (_b = obj.parameterized) === null || _b === void 0 ? void 0 : _b.get(key)) === null || _c === void 0 ? void 0 : _c[0];
            if (ref) {
                return graphSnapshot.getNodeData(ref.id);
            }
            if (id === 'ROOT_QUERY' && key === '__typename') {
                return 'Query';
            }
            return datum;
        }
        const tempStore = Object.create(null);
        const readField = (fieldNameOrOptions, from) => {
            var _a, _b, _c, _d;
            if (from === void 0) { from = ((_b = (_a = tempStore[id]) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : node.data); }
            if (typeof fieldNameOrOptions === 'object') {
                from = (_c = fieldNameOrOptions.from) !== null && _c !== void 0 ? _c : from;
                fieldNameOrOptions = fieldNameOrOptions.fieldName;
            }
            if (!from) {
                return undefined;
            }
            if (isReference(from)) {
                const ref = from.__ref;
                const obj = (_d = tempStore[ref]) !== null && _d !== void 0 ? _d : graphSnapshot.getNodeSnapshot(ref);
                if (!obj) {
                    return undefined;
                }
                return readOneFromSnapshot(obj, fieldNameOrOptions);
            }
            else {
                return from[fieldNameOrOptions];
            }
        };
        function getSnapshot(nodeId) {
            var _a;
            return (_a = tempStore[nodeId]) !== null && _a !== void 0 ? _a : graphSnapshot.getNodeSnapshot(nodeId);
        }
        const ensureNewSnapshot = (nodeId) => {
            const parent = getSnapshot(nodeId);
            // TODO: We're assuming that the only time we call _ensureNewSnapshot when
            // there is no parent is when the node is an entity. Can we enforce it, or
            // pass a type through?
            const newSnapshot = parent ? cloneNodeSnapshot(parent) : new EntitySnapshot();
            tempStore[nodeId] = newSnapshot;
            return newSnapshot;
        };
        const details = {
            readField,
            DELETE,
            INVALIDATE,
            canRead(value) {
                return isReference(value)
                    ? snapshot.has(value.__ref)
                    : typeof value === 'object' && value !== null;
            },
            fieldName: '',
            isReference,
            storage: node,
            storeFieldName: '',
            toReference: (value, mergeIntoStore) => {
                const entityId = this._context.entityIdForValue(value);
                if (entityId && mergeIntoStore && !isReference(value) && typeof value !== 'string') {
                    const nodeSnapshot = ensureNewSnapshot(entityId);
                    nodeSnapshot.data = Object.assign(Object.assign({}, nodeSnapshot.data), value);
                    modified = true;
                }
                return entityId ? makeRef(entityId) : undefined;
            },
        };
        const data = (_a = node.data) !== null && _a !== void 0 ? _a : {};
        const keys = Object.keys(data);
        const payload = {};
        const deleted = new Set();
        let modified = false;
        let allDeleted = false;
        let invalidated = false;
        if (typeof options.fields === 'function') {
            const field = options.fields;
            if (keys.length === 0) {
                details.fieldName = '';
                details.storeFieldName = '';
                try {
                    const value = field(data, details);
                    if (isDeleteModifier(value)) {
                        allDeleted = true;
                        modified = true;
                    }
                }
                catch (e) {
                    console.log(e);
                }
            }
            for (const key of keys) {
                for (const { d, k } of readFromSnapshot(node, key)) {
                    const storeFieldName = k !== null && k !== void 0 ? k : key;
                    const useRef = k === null || k === void 0 ? void 0 : k.includes('❖');
                    const copyOrCurrent = Array.isArray(d)
                        ? Array.prototype.slice.call(d)
                        : useRef ? { __ref: k } : typeof d === 'object'
                            ? Object.assign({}, d) : d;
                    details.fieldName = key;
                    details.storeFieldName = storeFieldName;
                    const value = field(copyOrCurrent, details);
                    if (isDeleteModifier(value)) {
                        deleted.add(storeFieldName);
                        modified = true;
                    }
                    else if (isInvalidateModifier(value)) {
                        this._editedNodeIds.add(id);
                        let dirty = this._context.dirty.get(id);
                        if (!dirty) {
                            this._context.dirty.set(id, dirty = new Set());
                        }
                        dirty.add(key);
                        dirty.add(storeFieldName);
                        invalidated = true;
                    }
                    else if (value !== copyOrCurrent || (!useRef && !isEqual(value, d))) {
                        payload[key] = (isReference(value) ? getSnapshot(value.__ref).data : value);
                        modified = true;
                    }
                }
            }
            if (keys.length !== 0 && keys.length === deleted.size && keys.every(key => deleted.has(key))) {
                allDeleted = true;
                modified = true;
            }
        }
        else {
            for (const key of Object.keys(options.fields)) {
                const field = options.fields[key];
                if (!field)
                    continue;
                for (const { d, k } of readFromSnapshot(node, key)) {
                    const storeFieldName = k !== null && k !== void 0 ? k : key;
                    const useRef = k === null || k === void 0 ? void 0 : k.includes('❖');
                    const copyOrCurrent = Array.isArray(d)
                        ? Array.prototype.slice.call(d)
                        : useRef ? { __ref: k } : typeof d === 'object'
                            ? Object.assign({}, d) : d;
                    details.fieldName = key;
                    details.storeFieldName = storeFieldName;
                    const value = field(copyOrCurrent, details);
                    if (isDeleteModifier(value)) {
                        deleted.add(storeFieldName);
                        modified = true;
                    }
                    else if (isInvalidateModifier(value)) {
                        this._editedNodeIds.add(id);
                        let dirty = this._context.dirty.get(id);
                        if (!dirty) {
                            this._context.dirty.set(id, dirty = new Set());
                        }
                        dirty.add(key);
                        dirty.add(storeFieldName);
                        invalidated = true;
                    }
                    else if (value !== copyOrCurrent || (!useRef && !isEqual(value, d))) {
                        const nextValue = isReference(value) ? getSnapshot(value.__ref).data : value;
                        if (nextValue !== undefined) {
                            payload[key] = nextValue;
                        }
                        modified = true;
                    }
                }
            }
            if (keys.length !== 0 && keys.length === deleted.size && keys.every(key => deleted.has(key))) {
                allDeleted = true;
                modified = true;
            }
        }
        if (!modified && !invalidated) {
            return false;
        }
        const current = this._snapshot;
        const editor = new SnapshotEditor(this._context, graphSnapshot);
        const empty = new Set();
        const seenObjects = new Set();
        for (const [mergeId, snapshot] of Object.entries(tempStore)) {
            const mergePayload = snapshot.data;
            if (mergePayload && typeof mergePayload === 'object' && !Array.isArray(mergePayload)) {
                editor.modify(mergeId, mergePayload, empty, seenObjects);
            }
        }
        if (allDeleted) {
            editor.delete(id);
            if (options.optimistic) {
                this._deltas.push({ delete: id });
            }
        }
        else {
            const seenObjects = new Set();
            editor.modify(id, payload, deleted, seenObjects);
            if (options.optimistic) {
                this._deltas.push({ id, payload, deleted });
            }
        }
        const newSnapshot = editor.commit();
        const { snapshot, editedNodeIds } = newSnapshot;
        addToSet(this._editedNodeIds, editedNodeIds);
        const edited = Array.from(editedNodeIds);
        for (const [key, val] of snapshot.readCache) {
            if (key.rootId === id || edited.some(cachedId => { var _a; return (_a = val.entityIds) === null || _a === void 0 ? void 0 : _a.has(cachedId); })) {
                snapshot.readCache.delete(key);
            }
        }
        if (options.optimistic) {
            this._snapshot = new CacheSnapshot(current.baseline, snapshot, current.optimisticQueue);
        }
        else {
            const optimistic = this._buildOptimisticSnapshot(snapshot);
            this._snapshot = new CacheSnapshot(snapshot, optimistic, current.optimisticQueue);
        }
        return modified;
    }
    merge(tempStore) {
        const current = this._snapshot;
        const editor = new SnapshotEditor(this._context, current.baseline);
        const empty = new Set();
        const seenObjects = new Set();
        for (const [id, snapshot] of Object.entries(tempStore)) {
            const payload = snapshot.data;
            if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
                editor.modify(id, payload, empty, seenObjects);
            }
        }
        const newSnapshot = editor.commit();
        const { snapshot, editedNodeIds } = newSnapshot;
        addToSet(this._editedNodeIds, editedNodeIds);
        const edited = Array.from(editedNodeIds);
        for (const [key, val] of snapshot.readCache) {
            if (edited.some(cachedId => { var _a; return (_a = val.entityIds) === null || _a === void 0 ? void 0 : _a.has(cachedId); })) {
                snapshot.readCache.delete(key);
            }
        }
        const optimistic = this._buildOptimisticSnapshot(snapshot);
        this._snapshot = new CacheSnapshot(snapshot, optimistic, current.optimisticQueue);
    }
    evict(options) {
        var _a;
        const modifier = (_current, details) => {
            return details.DELETE;
        };
        return this.modify({
            id: (_a = options.id) !== null && _a !== void 0 ? _a : 'ROOT_QUERY',
            fields: options.fieldName ? {
                [options.fieldName]: modifier,
            } : modifier,
            broadcast: options.broadcast,
        });
    }
    /**
     * Evicts several entities with one snapshot edit, where evict() makes one
     * per entity. Like evict(), it skips ids that are not in the cache.
     *
     * Each entity is removed whole. evict() instead keeps the fields it cannot
     * match to a stored field name, such as a null field that also has a
     * parameterized variant.
     *
     * Returns whether any entity was evicted.
     */
    batchEvict(ids) {
        const current = this._snapshot;
        const graphSnapshot = current.baseline;
        const evictedIds = new Set();
        for (const id of ids) {
            if (graphSnapshot.getNodeSnapshot(id)) {
                evictedIds.add(id);
            }
        }
        if (!evictedIds.size) {
            return false;
        }
        const editor = new SnapshotEditor(this._context, graphSnapshot);
        for (const id of evictedIds) {
            editor.delete(id);
        }
        // The same commit steps as modify() takes for a non-optimistic evict.
        const { snapshot, editedNodeIds } = editor.commit();
        addToSet(this._editedNodeIds, editedNodeIds);
        const edited = Array.from(editedNodeIds);
        for (const [key, val] of snapshot.readCache) {
            if (evictedIds.has(key.rootId) || edited.some(cachedId => { var _a; return (_a = val.entityIds) === null || _a === void 0 ? void 0 : _a.has(cachedId); })) {
                snapshot.readCache.delete(key);
            }
        }
        const optimistic = this._buildOptimisticSnapshot(snapshot);
        this._snapshot = new CacheSnapshot(snapshot, optimistic, current.optimisticQueue);
        return true;
    }
}
exports.CacheTransaction = CacheTransaction;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVUcmFuc2FjdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIkNhY2hlVHJhbnNhY3Rpb24udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQVFBLDJDQUErQztBQUMvQyxnRUFBMEM7QUFVMUMsMEVBQW9EO0FBQ3BELHVFQUFpRDtBQUNqRCxpRUFBMkM7QUFDM0MseURBQW1DO0FBQ25DLHVEQUFpQztBQUNqQyxxREFBK0I7QUFFL0IsTUFBTSxPQUFPLEdBQUcsUUFBUSxDQUFDLEtBQUssQ0FBQztBQUMvQixNQUFNLE9BQU8sR0FBRyxzQkFBYSxDQUFDO0FBQzlCLE1BQU0sRUFBRSxZQUFZLEVBQUUsR0FBRyxNQUFNLENBQUM7QUFDaEMsTUFBTSxFQUFFLGFBQWEsRUFBRSxHQUFHLGFBQWEsQ0FBQztBQUN4QyxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsR0FBRyxXQUFXLENBQUM7QUFDMUMsTUFBTSxFQUFFLGlCQUFpQixFQUFFLGNBQWMsRUFBRSxHQUFHLEtBQUssQ0FBQztBQUNwRCxNQUFNLEVBQUUsSUFBSSxFQUFFLGNBQWMsRUFBRSxLQUFLLEVBQUUsR0FBRyxVQUFVLENBQUM7QUFDbkQsTUFBTSxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQUUsV0FBVyxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBRWpELE1BQU0sTUFBTSxHQUFtQixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQ25ELE1BQU0sVUFBVSxHQUF1QixNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBRTNELFNBQVMsZ0JBQWdCLENBQUMsS0FBVTtJQUNsQyxPQUFPLEtBQUssS0FBSyxNQUFNLENBQUM7QUFDMUIsQ0FBQztBQUVELFNBQVMsb0JBQW9CLENBQUMsS0FBVTtJQUN0QyxPQUFPLEtBQUssS0FBSyxVQUFVLENBQUM7QUFDOUIsQ0FBQztBQVFEOzs7Ozs7R0FNRztBQUNILE1BQWEsZ0JBQWdCO0lBYzNCLFlBQ1UsUUFBbUMsRUFD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