"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Cache = void 0;
const CacheSnapshot_1 = require("./CacheSnapshot");
const CacheTransaction_1 = require("./CacheTransaction");
const context_1 = require("./context");
const GraphSnapshot_1 = require("./GraphSnapshot");
const operations_1 = require("./operations");
const OptimisticUpdateQueue_1 = require("./OptimisticUpdateQueue");
const schema_1 = require("./schema");
const util_1 = require("./util");
const errors_1 = require("./errors");
/**
 * The Hermes cache.
 *
 * @see https://github.com/apollographql/apollo-client/issues/1971
 * @see https://github.com/apollographql/apollo-client/blob/2.0-alpha/src/data/cache.ts
 */
class Cache {
    constructor(configuration, cacheInstance = undefined) {
        /** All active query observers. */
        this._observers = [];
        this._transactions = [];
        this._editedNodeIds = new Set();
        // Maps root entity IDs to the number of times they have been retained, minus
        // the number of times they have been released. Retained entities keep other
        // entities they reference (even indirectly) from being garbage collected.
        this._rootIds = Object.create(null);
        const initialGraphSnapshot = new GraphSnapshot_1.GraphSnapshot();
        this._snapshot = new CacheSnapshot_1.CacheSnapshot(initialGraphSnapshot, initialGraphSnapshot, new OptimisticUpdateQueue_1.OptimisticUpdateQueue());
        this._context = new context_1.CacheContext(configuration);
        this._cacheInstance = cacheInstance;
    }
    retain(rootId) {
        return (this._rootIds[rootId] = (this._rootIds[rootId] || 0) + 1);
    }
    release(rootId) {
        if (this._rootIds[rootId] > 0) {
            const count = --this._rootIds[rootId];
            if (!count)
                delete this._rootIds[rootId];
            return count;
        }
        return 0;
    }
    // Return a Set<string> of all the ID strings that have been retained by
    // this layer/root *and* any layers/roots beneath it.
    getRootIdSet(ids = new Set()) {
        Object.keys(this._rootIds).forEach(ids.add, ids);
        ids.add(schema_1.StaticNodeId.QueryRoot);
        ids.add(schema_1.StaticNodeId.MutationRoot);
        return ids;
    }
    // The goal of garbage collection is to remove IDs from the Root layer of the
    // store that are no longer reachable starting from any IDs that have been
    // explicitly retained (see retain and release, above). Returns an array of
    // dataId strings that were removed from the store.
    gc() {
        const ids = this.getRootIdSet();
        const addRef = (ref) => ids.add(ref.id);
        const addRefs = (refs) => refs.forEach(addRef);
        const snapshot = Object.assign({}, this._snapshot.optimistic._values);
        ids.forEach((id) => {
            var _a, _b;
            if (util_1.hasOwn.call(snapshot, id)) {
                // Because we are iterating over an ECMAScript Set, the IDs we add here
                // will be visited in later iterations of the forEach loop only if they
                // were not previously contained by the Set.
                const node = snapshot[id];
                (_a = node.outbound) === null || _a === void 0 ? void 0 : _a.forEach(addRef);
                (_b = node.parameterized) === null || _b === void 0 ? void 0 : _b.forEach(addRefs);
                // By removing IDs from the snapshot object here, we protect them from
                // getting removed from the root store layer below.
                delete snapshot[id];
            }
        });
        const idsToRemove = Object.keys(snapshot);
        if (idsToRemove.length) {
            this.transaction(false, (t) => {
                t.batchEvict(idsToRemove);
            });
        }
        return idsToRemove;
    }
    identify(object) {
        return this._context.entityIdForValue(object);
    }
    transformDocument(document) {
        return this._context.transformDocument(document);
    }
    restore(data, migrationMap, verifyQuery) {
        const { cacheSnapshot, editedNodeIds } = (0, operations_1.restore)(data, this._context);
        const migrated = (0, operations_1.migrate)(cacheSnapshot, migrationMap);
        if (verifyQuery && !(0, operations_1.read)(this._context, verifyQuery, migrated.baseline, Object.create(null), false).complete) {
            throw new errors_1.UnsatisfiedCacheError(`Restored cache cannot satisfy the verification query`);
        }
        this._setSnapshot(migrated, editedNodeIds);
    }
    extract(optimistic, pruneQuery) {
        const cacheSnapshot = optimistic ? this._snapshot.optimistic : this._snapshot.baseline;
        return (0, operations_1.extract)(pruneQuery ? (0, operations_1.prune)(this._context, cacheSnapshot, pruneQuery).snapshot : cacheSnapshot, this._context);
    }
    /**
     * Reads the selection expressed by a query from the cache.
     *
     * TODO: Can we drop non-optimistic reads?
     * https://github.com/apollographql/apollo-client/issues/1971#issuecomment-319402170
     */
    read(query, optimistic) {
        // TODO: Can we drop non-optimistic reads?
        // https://github.com/apollographql/apollo-client/issues/1971#issuecomment-319402170
        const tempStore = Object.create(null);
        const result = (0, operations_1.read)(this._context, query, optimistic ? this._snapshot.optimistic : this._snapshot.baseline, tempStore);
        const newKeys = Object.keys(tempStore);
        if (newKeys.length) {
            this.transaction(true, (t) => {
                t.merge(tempStore);
            });
        }
        return result;
    }
    /**
     * Retrieves the current value of the entity identified by `id`.
     */
    getEntity(id) {
        return this._snapshot.optimistic.getNodeData(id);
    }
    /**
     * Registers a callback that should be triggered any time the nodes selected
     * by a particular query have changed.
     */
    watch(query, options) {
        if (typeof options === 'function') {
            options = {
                callback: options,
                immediate: true,
                optimistic: false,
                query: query.document,
            };
        }
        const observer = new operations_1.QueryObserver(this._context, query, this._snapshot.optimistic, options);
        this._observers.push(observer);
        return () => this._removeObserver(observer);
    }
    modify(options) {
        var _a;
        return this.transaction((_a = options.broadcast) !== null && _a !== void 0 ? _a : true, t => t.modify(options));
    }
    /**
     * Writes values for a selection to the cache.
     */
    write(query, payload, broadcast = true) {
        let ref;
        this.transaction(broadcast, (t) => {
            ref = t.write(query, payload);
        });
        return ref;
    }
    transaction(broadcast, changeIdOrCallback, callback, onWatchUpdated) {
        const { tracer } = this._context;
        let changeId;
        if (typeof callback !== 'function') {
            callback = changeIdOrCallback;
        }
        else {
            changeId = changeIdOrCallback;
        }
        let tracerContext;
        if (tracer.transactionStart) {
            tracerContext = tracer.transactionStart();
        }
        const transaction = new CacheTransaction_1.CacheTransaction(this._context, this._snapshot, changeId);
        this._transactions.push(transaction);
        let result;
        try {
            result = callback(transaction);
        }
        catch (error) {
            if (tracer.transactionEnd) {
                if (error instanceof Error) {
                    tracer.transactionEnd(error.toString(), tracerContext);
                }
                else {
                    tracer.transactionEnd('unknown error', tracerContext);
                }
            }
            return false;
        }
        finally {
            this._transactions.pop();
        }
        const { snapshot, editedNodeIds } = transaction.commit();
        this._setSnapshot(snapshot, editedNodeIds, broadcast, onWatchUpdated);
        if (this._transactions.length) {
            const outer = this._transactions[this._transactions.length - 1];
            outer.markEditedNodeIds(editedNodeIds);
            outer.setSnapshot(snapshot);
        }
        if (tracer.transactionEnd) {
            tracer.transactionEnd(undefined, tracerContext);
        }
        return typeof result === 'boolean' ? result : editedNodeIds.size > 0;
    }
    /**
     * Roll back a previously enqueued optimistic update.
     */
    rollback(changeId) {
        this.transaction(true, t => t.rollback(changeId));
    }
    getSnapshot() {
        return this._snapshot;
    }
    /**
     * Resets all data tracked by the cache.
     */
    async reset() {
        const allIds = new Set(this._snapshot.optimistic.allNodeIds());
        const baseline = new GraphSnapshot_1.GraphSnapshot();
        const optimistic = baseline;
        const optimisticQueue = new OptimisticUpdateQueue_1.OptimisticUpdateQueue();
        this._setSnapshot(new CacheSnapshot_1.CacheSnapshot(baseline, optimistic, optimisticQueue), allIds);
    }
    // Internal
    /**
     * Unregister an observer.
     */
    _removeObserver(observer) {
        const index = this._observers.findIndex(o => o === observer);
        if (index < 0)
            return;
        this._observers.splice(index, 1);
    }
    /**
     * Point the cache to a new snapshot, and let observers know of the change.
     * Call onChange callback if one exist to notify cache users of any change.
     */
    _setSnapshot(snapshot, editedNodeIds, broadcast = true, onWatchUpdated) {
        const lastSnapshot = this._snapshot;
        this._snapshot = snapshot;
        if (lastSnapshot) {
            const { strict } = this._context;
            _copyUnaffectedCachedReads(lastSnapshot.baseline, snapshot.baseline, editedNodeIds, strict);
            // Don't bother copying the optimistic read cache unless it's actually a
            // different snapshot.
            if (snapshot.optimistic !== snapshot.baseline) {
                _copyUnaffectedCachedReads(lastSnapshot.optimistic, snapshot.optimistic, editedNodeIds, strict);
            }
        }
        if (broadcast === false) {
            (0, util_1.addToSet)(this._editedNodeIds, editedNodeIds);
            return;
        }
        if (this._transactions.length) {
            // Only broadcast after last transaction finishes
            return;
        }
        this._broadcastWatches(editedNodeIds, onWatchUpdated);
        if (this._context.onChange) {
            this._context.onChange(this._snapshot, editedNodeIds);
        }
    }
    broadcastWatches(options) {
        this._broadcastWatches(this._editedNodeIds, options === null || options === void 0 ? void 0 : options.onWatchUpdated, options === null || options === void 0 ? void 0 : options.optimistic);
    }
    _broadcastWatches(editedNodeIds, onWatchUpdated, optimistic = true) {
        const snapshot = this._snapshot;
        let tracerContext;
        if (this._context.tracer.broadcastStart) {
            tracerContext = this._context.tracer.broadcastStart({ snapshot, editedNodeIds });
        }
        const graphSnapshot = optimistic ? snapshot.optimistic : snapshot.baseline;
        for (const observer of this._observers) {
            observer.consumeChanges(graphSnapshot, editedNodeIds, this._cacheInstance, onWatchUpdated);
        }
        this._context.dirty.clear();
        if (this._context.tracer.broadcastEnd) {
            this._context.tracer.broadcastEnd({ snapshot, editedNodeIds }, tracerContext);
        }
    }
    evict(options) {
        var _a;
        return this.transaction((_a = options.broadcast) !== null && _a !== void 0 ? _a : true, t => t.evict(options));
    }
    /**
     * Evicts several entities in one transaction and one snapshot edit; see
     * CacheTransaction#batchEvict.
     */
    batchEvict(ids, broadcast = true) {
        return this.transaction(broadcast, t => t.batchEvict(ids));
    }
}
exports.Cache = Cache;
/**
 * Preserves cached reads for any queries that do not overlap with the edited
 * entities in the new snapshot.
 *
 * TODO: Can we special case ROOT_QUERY somehow; any fields hanging off of it
 * tend to aggressively bust the cache, when we don't really mean to.
 */
function _copyUnaffectedCachedReads(lastSnapshot, nextSnapshot, editedNodeIds, strict) {
    for (const [operation, result] of lastSnapshot.readCache) {
        const { complete, entityIds, dynamicNodeIds } = result;
        // We don't care about incomplete results.
        if (!complete)
            continue;
        // If we're not in strict mode; we can carry completeness forward (and
        // not bother copying results forward, as its cheaper to just fetch again).
        if (!strict) {
            nextSnapshot.readCache.set(operation, { complete: true });
            continue;
        }
        // Nor queries where we don't know which nodes were affected.
        if (!entityIds)
            continue;
        // If any nodes in the cached read were edited, do not copy.
        if (entityIds && (0, util_1.setsHaveSomeIntersection)(editedNodeIds, entityIds))
            continue;
        // If any dynamic nodes were edited, also do not copy.
        if (dynamicNodeIds && (0, util_1.setsHaveSomeIntersection)(editedNodeIds, dynamicNodeIds))
            continue;
        nextSnapshot.readCache.set(operation, result);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJDYWNoZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFHQSxtREFBZ0Q7QUFDaEQseURBQXNEO0FBQ3RELHVDQUF5QztBQUN6QyxtREFBaUU7QUFDakUsNkNBQW1HO0FBQ25HLG1FQUFnRTtBQUdoRSxxQ0FBc0Y7QUFDdEYsaUNBQWtGO0FBQ2xGLHFDQUFpRDtBQVNqRDs7Ozs7R0FLRztBQUNILE1BQWEsS0FBSztJQWNoQixZQUNFLGFBQWtFLEVBQ2xFLGdCQUFpRCxTQUFTO1FBUjVELGtDQUFrQztRQUMxQixlQUFVLEdBQWlDLEVBQUUsQ0FBQztRQUU5QyxrQkFBYSxHQUFvQyxFQUFFLENBQUM7UUFDcEQsbUJBQWMsR0FBZ0IsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVloRCw2RUFBNkU7UUFDN0UsNEVBQTRFO1FBQzVFLDBFQUEwRTtRQUNsRSxhQUFRLEdBRVosTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQztRQVh0QixNQUFNLG9CQUFvQixHQUFHLElBQUksNkJBQWEsRUFBRSxDQUFDO1FBQ2pELElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSw2QkFBYSxDQUFDLG9CQUFvQixFQUFFLG9CQUFvQixFQUFFLElBQUksNkNBQXFCLEVBQUUsQ0FBQyxDQUFDO1FBQzVHLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxzQkFBWSxDQUFDLGFBQWEsQ0FBQyxDQUFDO1FBQ2hELElBQUksQ0FBQyxjQUFjLEdBQUcsYUFBYSxDQUFDO0lBQ3RDLENBQUM7SUFTTSxNQUFNLENBQUMsTUFBYztRQUMxQixPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDcEUsQ0FBQztJQUVNLE9BQU8sQ0FBQyxNQUFjO1FBQzNCLElBQUksSUFB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