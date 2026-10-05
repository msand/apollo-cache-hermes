"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryObserver = void 0;
const tslib_1 = require("tslib");
const equality_1 = tslib_1.__importDefault(require("@wry/equality"));
const read_1 = require("./read");
/**
 * Observes a query, triggering a callback when nodes within it have changed.
 *
 * @internal
 */
class QueryObserver {
    constructor(context, query, snapshot, options) {
        this._context = context;
        this._query = query;
        this._options = options;
        if (options.immediate) {
            this._result = (0, read_1.read)(context, query, snapshot, Object.create(null), context.strict);
            options.lastDiff = this._result;
            this._update();
        }
        else {
            this._result = {
                complete: false,
            };
        }
    }
    /**
     * We expect the cache to tell us whenever there is a new snapshot, and which
     * nodes have changed.
     */
    consumeChanges(snapshot, changedNodeIds, cacheInstance, onWatchUpdated) {
        const lastDiff = this._options.lastDiff;
        if (lastDiff && !this._hasUpdate(changedNodeIds))
            return;
        // Note that if strict mode is disabled, we _do not_ ask for node ids.
        //
        // This effectively circumvents the logic in _hasUpdate (entityIds will be
        // undefined).
        const operation = this._context.parseOperation(this._query);
        const readResult = (0, read_1.read)(this._context, this._query, snapshot, Object.create(null), this._context.strict);
        this._result = readResult;
        const result = readResult.result;
        this._options.lastDiff = readResult;
        const rootKeys = Object.keys(operation.parsedQuery);
        if (!readResult.complete && (!result || !rootKeys.some(key => key in result))) {
            return;
        }
        const lastResult = lastDiff === null || lastDiff === void 0 ? void 0 : lastDiff.result;
        const sameAsBefore = result && lastResult && rootKeys.every(key => (0, equality_1.default)(result[key], lastResult[key]));
        const dirtyKeys = this._context.dirty.get(operation.rootId);
        if (sameAsBefore && !(dirtyKeys && rootKeys.some(key => dirtyKeys.has(key)))) {
            return;
        }
        const shouldCancel = (onWatchUpdated === null || onWatchUpdated === void 0 ? void 0 : onWatchUpdated.call(cacheInstance, this._options, readResult, lastDiff)) === false;
        if (shouldCancel) {
            // Returning false from the onWatchUpdated callback will prevent
            // calling c.callback(diff) for this watcher.
            return;
        }
        if (sameAsBefore) {
            return;
        }
        this._update();
    }
    /**
     * Whether there are any changed nodes that overlap with the ones we're
     * observing.
     */
    _hasUpdate(_changedNodeIds) {
        const { complete, entityIds, dynamicNodeIds } = this._result;
        if (!complete)
            return true;
        // We can't know if we have no ids to test against. Favor updating.
        if (!entityIds)
            return true;
        for (const nodeId of _changedNodeIds) {
            if (entityIds.has(nodeId))
                return true;
            if (dynamicNodeIds && dynamicNodeIds.has(nodeId))
                return true;
        }
        return false;
    }
    /**
     * Trigger the callback.
     */
    _update() {
        this._options.callback(this._result);
    }
}
exports.QueryObserver = QueryObserver;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUXVlcnlPYnNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIlF1ZXJ5T2JzZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7OztBQUNBLHFFQUFvQztBQU9wQyxpQ0FBMkM7QUFJM0M7Ozs7R0FJRztBQUNILE1BQWEsYUFBYTtJQVd4QixZQUFZLE9BQWtDLEVBQUUsS0FBbUIsRUFBRSxRQUF1QixFQUFFLE9BQXFCO1FBQ2pILElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDO1FBQ3hCLElBQUksQ0FBQyxNQUFNLEdBQUcsS0FBSyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxRQUFRLEdBQUcsT0FBTyxDQUFDO1FBQ3hCLElBQUksT0FBTyxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3RCLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBQSxXQUFJLEVBQUMsT0FBTyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsTUFBTSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsRUFBRSxPQUFPLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDbkYsT0FBTyxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDO1lBQ2hDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNqQixDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxPQUFPLEdBQUc7Z0JBQ2IsUUFBUSxFQUFFLEtBQUs7YUFDaEIsQ0FBQztRQUNKLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsY0FBYyxDQUNaLFFBQXVCLEVBQ3ZCLGNBQTJCLEVBQzNCLGFBQWtDLEVBQ2xDLGNBQTBFO1FBRTFFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsUUFBUSxDQUFDO1FBQ3hDLElBQUksUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLENBQUM7WUFBRSxPQUFPO1FBQ3pELHNFQUFzRTtRQUN0RSxFQUFFO1FBQ0YsMEVBQTBFO1FBQzFFLGNBQWM7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