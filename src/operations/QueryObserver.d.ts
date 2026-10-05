import { Cache } from '@apollo/client';
import { CacheContext } from '../context';
import { GraphSnapshot } from '../GraphSnapshot';
import { NodeId, RawOperation } from '../schema';
import { Hermes } from '../apollo';
import WatchOptions = Cache.WatchOptions;
/**
 * Observes a query, triggering a callback when nodes within it have changed.
 *
 * @internal
 */
export declare class QueryObserver<TSerialized> {
    /** Cache configuration/context to use when executing queries. */
    private _context;
    /** The query being observed. */
    private _query;
    /** The most recent result */
    private _result;
    /** The callback to trigger when observed nodes have changed. */
    private _options;
    constructor(context: CacheContext<TSerialized>, query: RawOperation, snapshot: GraphSnapshot, options: WatchOptions);
    /**
     * We expect the cache to tell us whenever there is a new snapshot, and which
     * nodes have changed.
     */
    consumeChanges(snapshot: GraphSnapshot, changedNodeIds: Set<NodeId>, cacheInstance: Hermes<TSerialized>, onWatchUpdated?: Cache.BatchOptions<Hermes<TSerialized>>['onWatchUpdated']): void;
    /**
     * Whether there are any changed nodes that overlap with the ones we're
     * observing.
     */
    private _hasUpdate;
    /**
     * Trigger the callback.
     */
    private _update;
}
//# sourceMappingURL=QueryObserver.d.ts.map