"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Hermes = void 0;
const Cache_1 = require("../Cache");
const Queryable_1 = require("./Queryable");
const Transaction_1 = require("./Transaction");
const util_1 = require("./util");
/**
 * Apollo-specific interface to the cache.
 */
class Hermes extends Queryable_1.ApolloQueryable {
    constructor(configuration) {
        super();
        this.watches = new Set();
        this._txCount = 0;
        this._queryable = new Cache_1.Cache(configuration, this);
    }
    identify(object) {
        return this._queryable.identify(object);
    }
    // TODO (yuisu): data can be typed better with update of ApolloCache API
    restore(data, migrationMap, verifyOptions) {
        const verifyQuery = verifyOptions && (0, util_1.buildRawOperationFromQuery)(verifyOptions.query, verifyOptions.variables);
        this._queryable.restore(data, migrationMap, verifyQuery);
        return this;
    }
    // TODO (yuisu): return can be typed better with update of ApolloCache API
    extract(optimistic = false, pruneOptions) {
        const pruneQuery = pruneOptions && (0, util_1.buildRawOperationFromQuery)(pruneOptions.query, pruneOptions.variables);
        return this._queryable.extract(optimistic, pruneQuery);
    }
    reset() {
        return this._queryable.reset();
    }
    removeOptimistic(id) {
        this._queryable.rollback(id);
    }
    performTransaction(transaction, optimisticId, onWatchUpdated, broadcast = true) {
        this._queryable.transaction(broadcast, optimisticId, t => transaction(new Transaction_1.ApolloTransaction(t)), onWatchUpdated);
    }
    recordOptimisticTransaction(transaction, id) {
        this._queryable.transaction(true, id, t => transaction(new Transaction_1.ApolloTransaction(t)));
    }
    watch(options) {
        const query = (0, util_1.buildRawOperationFromQuery)(options.query, options.variables);
        this.watches.add(options);
        const unwatch = this._queryable.watch(query, options);
        return () => {
            unwatch();
            this.watches.delete(options);
        };
    }
    getCurrentCacheSnapshot() {
        return this._queryable.getSnapshot();
    }
    batch(options) {
        const { update, optimistic = true, onWatchUpdated, } = options;
        const optimisticId = typeof optimistic === 'string'
            ? optimistic
            : optimistic ? undefined : null;
        const alreadyDirty = new Set();
        const willWatch = onWatchUpdated && !this._txCount;
        if (willWatch) {
            // If an options.onWatchUpdated callback is provided, we want to call it
            // with only the Cache.WatchOptions objects affected by options.update,
            // but there might be dirty watchers already waiting to be broadcast that
            // have nothing to do with the update. To prevent including those watchers
            // in the post-update broadcast, we perform this initial broadcast to
            // collect the dirty watchers, so we can re-dirty them later, after the
            // post-update broadcast, allowing them to receive their pending
            // broadcasts the next time broadcastWatches is called, just as they would
            // if we never called cache.batch.
            this._queryable.broadcastWatches(Object.assign(Object.assign({}, options), { onWatchUpdated(watch) {
                    alreadyDirty.add(watch);
                    return false;
                } }));
        }
        let updateResult;
        ++this._txCount;
        try {
            this.performTransaction(() => (updateResult = update(this)), optimisticId, onWatchUpdated, !willWatch);
        }
        finally {
            --this._txCount;
        }
        // Note: if this.txCount > 0, then alreadyDirty.size === 0, so this code
        // takes the else branch and calls this.broadcastWatches(options), which
        // does nothing when this.txCount > 0.
        if (onWatchUpdated && alreadyDirty.size) {
            this._queryable.broadcastWatches(Object.assign(Object.assign({}, options), { onWatchUpdated(watch, diff, lastDiff) {
                    const result = onWatchUpdated.call(this, watch, diff, lastDiff);
                    if (result !== false) {
                        // Since onWatchUpdated did not return false, this diff is
                        // about to be broadcast to watch.callback, so we don't need
                        // to re-dirty it with the other alreadyDirty watches below.
                        alreadyDirty.delete(watch);
                    }
                    return result;
                } }));
            // Silently re-dirty any watches that were already dirty before the update
            // was performed, and were not broadcast just now.
            if (alreadyDirty.size) {
                alreadyDirty.forEach(watch => watch.lastDiff = undefined);
            }
        }
        else {
            // If alreadyDirty is empty or we don't have an onWatchUpdated
            // function, we don't need to go to the trouble of wrapping
            // options.onWatchUpdated.
            this._queryable.broadcastWatches(options);
        }
        return updateResult;
    }
    broadcastWatches(options) {
        this._queryable.broadcastWatches(options);
    }
    gc() {
        return this._queryable.gc();
    }
    retain(id) {
        return this._queryable.retain(id);
    }
    release(id) {
        return this._queryable.release(id);
    }
}
exports.Hermes = Hermes;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSGVybWVzLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiSGVybWVzLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQU9BLG9DQUErQztBQUsvQywyQ0FBOEM7QUFDOUMsK0NBQWtEO0FBQ2xELGlDQUFvRDtBQUlwRDs7R0FFRztBQUNILE1BQWEsTUFBb0MsU0FBUSwyQkFBNEI7SUFLbkYsWUFBWSxhQUF1RDtRQUNqRSxLQUFLLEVBQUUsQ0FBQztRQUhILFlBQU8sR0FBRyxJQUFJLEdBQUcsRUFBK0IsQ0FBQztRQW1FaEQsYUFBUSxHQUFHLENBQUMsQ0FBQztRQS9EbkIsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLGFBQUssQ0FBYyxhQUFhLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDaEUsQ0FBQztJQUVELFFBQVEsQ0FBQyxNQUErQjtRQUN0QyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCx3RUFBd0U7SUFDeEUsT0FBTyxDQUFDLElBQVMsRUFBRSxZQUEyQixFQUFFLGFBQTBDO1FBQ3hGLE1BQU0sV0FBVyxHQUFHLGFBQWEsSUFBSSxJQUFBLGlDQUEwQixFQUFDLGFBQWEsQ0FBQyxLQUFLLEVBQUUsYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzlHLElBQUksQ0FBQyxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxZQUFZLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDekQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsMEVBQTBFO0lBQzFFLE9BQU8sQ0FBQyxhQUFzQixLQUFLLEVBQUUsWUFBeUM7UUFDNUUsTUFBTSxVQUFVLEdBQUcsWUFBWSxJQUFJLElBQUEsaUNBQTBCLEVBQUMsWUFBWSxDQUFDLEtBQUssRUFBRSxZQUFZLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDMUcsT0FBTyxJQUFJLENBQUMsVUFBVSxDQUFDLE9BQU8sQ0FBQyxVQUFVLEVBQUUs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