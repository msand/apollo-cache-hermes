import { CacheContext } from './context';
import { GraphSnapshot } from './GraphSnapshot';
import { ChangeId, NodeId, CacheDelta } from './schema';
/**
 * Tracks an individual optimistic update.
 */
export interface OptimisticUpdate {
    id: ChangeId;
    deltas: CacheDelta[];
}
/**
 * Manages a queue of optimistic updates, and the values they express on top of
 * existing cache snapshots.
 */
export declare class OptimisticUpdateQueue {
    /**
     * The queue of updates, in order of oldest (lowest precedence) to newest
     * (highest precedence).
     */
    private _updates;
    constructor(
    /**
     * The queue of updates, in order of oldest (lowest precedence) to newest
     * (highest precedence).
     */
    _updates?: OptimisticUpdate[]);
    /**
     * Appends a new optimistic update to the queue.
     */
    enqueue(id: ChangeId, deltas: CacheDelta[]): OptimisticUpdateQueue;
    /**
     * Removes an update from the queue.
     */
    remove(id: ChangeId): OptimisticUpdateQueue;
    /**
     * Whether there are any updates to apply.
     */
    hasUpdates(): boolean;
    /**
     * Applies the current optimistic updates to a snapshot.
     */
    apply<TSerialized>(context: CacheContext<TSerialized>, snapshot: GraphSnapshot): {
        snapshot: GraphSnapshot;
        editedNodeIds: Set<NodeId>;
    };
}
//# sourceMappingURL=OptimisticUpdateQueue.d.ts.map