import type { Cache as CacheInterface, Reference } from '@apollo/client';
import type { ChangeId, NodeId, OperationInstance, RawOperation } from './schema';
import type { CacheSnapshot as CacheSnapshotType } from './CacheSnapshot';
import type { GraphSnapshot, NodeSnapshotMap } from './GraphSnapshot';
import type { JsonObject, JsonValue } from './primitive';
import type { CacheContext } from './context';
import type { Queryable } from './Queryable';
import type { NodeSnapshot } from './nodes';
import type { DocumentNode } from './util';
/**
 * Collects a set of edits against a version of the cache, eventually committing
 * them in the form of a new cache snapshot.
 *
 * If a ChangeId is provided, edits will be made on top of the optimistic state
 * (an optimistic update).  Otherwise edits are made against the baseline state.
 */
export declare class CacheTransaction<TSerialized> implements Queryable {
    private _context;
    private _snapshot;
    private _optimisticChangeId?;
    /** The set of nodes edited throughout the transaction. */
    private _editedNodeIds;
    /** All edits made throughout the transaction. */
    private _deltas;
    /** All queries written during the transaction. */
    private _writtenQueries;
    /** The original snapshot before the transaction began. */
    private _parentSnapshot;
    constructor(_context: CacheContext<TSerialized>, _snapshot: CacheSnapshotType, _optimisticChangeId?: ChangeId | undefined);
    isOptimisticTransaction(): true | undefined;
    transformDocument(document: DocumentNode): DocumentNode;
    /**
     * Executes reads against the current values in the transaction.
     */
    read(query: RawOperation): CacheInterface.DiffResult<JsonValue>;
    /**
     * Merges a payload with the current values in the transaction.
     *
     * If this is an optimistic transaction, edits will be made directly on top of
     * any previous optimistic values.  Otherwise, edits will be made to the
     * baseline state (and any optimistic updates will be replayed over it).
     */
    write(query: RawOperation, payload: JsonObject): Reference | undefined;
    /**
     * Roll back a previously enqueued optimistic update.
     */
    rollback(changeId: ChangeId): void;
    /**
     * Complete the transaction, returning the new snapshot and the ids of any
     * nodes that were edited.
     */
    commit(): {
        snapshot: CacheSnapshotType;
        editedNodeIds: Set<NodeId>;
        writtenQueries: Set<OperationInstance<TSerialized>>;
    };
    markEditedNodeIds(allIds: Iterable<string>): void;
    setSnapshot(snapshot: CacheSnapshotType): void;
    getPreviousNodeSnapshot(nodeId: NodeId): NodeSnapshot | undefined;
    getCurrentNodeSnapshot(nodeId: NodeId): NodeSnapshot | undefined;
    /**
     * Emits change events for any callbacks configured via
     * CacheContext#entityUpdaters.
     */
    private _triggerEntityUpdaters;
    /**
     * Merge a payload with the baseline snapshot.
     */
    private _writeBaseline;
    /**
     * Given a baseline snapshot, build an optimistic one from it.
     */
    _buildOptimisticSnapshot(baseline: GraphSnapshot): GraphSnapshot;
    /**
     * Merge a payload with the optimistic snapshot.
     */
    private _writeOptimistic;
    modify<Entity extends Record<string, unknown>>(options: CacheInterface.ModifyOptions<Entity>): boolean;
    merge(tempStore: NodeSnapshotMap): void;
    evict(options: CacheInterface.EvictOptions): boolean;
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
    batchEvict(ids: Iterable<NodeId>): boolean;
}
//# sourceMappingURL=CacheTransaction.d.ts.map