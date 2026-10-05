import type { Reference } from '@apollo/client';
import type { CacheContext } from '../context';
import type { GraphSnapshot as GraphSnapshotType } from '../GraphSnapshot';
import type { NodeSnapshot } from '../nodes';
import type { JsonObject, PathPart } from '../primitive';
import type { NodeId, OperationInstance, RawOperation } from '../schema';
/**
 * A newly modified snapshot.
 */
export interface EditedSnapshot<TSerialized = GraphSnapshotType> {
    snapshot: GraphSnapshotType;
    editedNodeIds: Set<NodeId>;
    writtenQueries: Set<OperationInstance<TSerialized>>;
    ref: Reference | undefined;
}
export type NodeSnapshotMap = {
    [Key in NodeId]?: NodeSnapshot;
};
/**
 * Builds a set of changes to apply on top of an existing `GraphSnapshot`.
 *
 * Performs the minimal set of edits to generate new immutable versions of each
 * node, while preserving immutability of the parent snapshot.
 */
export declare class SnapshotEditor<TSerialized> {
    /** The configuration/context to use when editing snapshots. */
    private _context;
    /** The snapshot to base edits off of. */
    private _parent;
    /**
     * Tracks all node snapshots that have changed vs the parent snapshot.
     */
    private _newNodes;
    /**
     * Tracks the nodes that have new _values_ vs the parent snapshot.
     *
     * This is a subset of the keys in `_newValues`.  The difference is all nodes
     * that have only changed references.
     */
    private _editedNodeIds;
    /**
     * Tracks the nodes that have been rebuilt, and have had all their inbound
     * references updated to point to the new value.
     */
    private _rebuiltNodeIds;
    /** The queries that were written, and should now be considered complete. */
    private _writtenQueries;
    private _pathToId;
    constructor(
    /** The configuration/context to use when editing snapshots. */
    _context: CacheContext<TSerialized>, 
    /** The snapshot to base edits off of. */
    _parent: GraphSnapshotType);
    /**
     * Merge a GraphQL payload (query/fragment/etc) into the snapshot, rooted at
     * the node identified by `rootId`.
     */
    mergePayload(query: RawOperation, payload: JsonObject, prune: boolean): {
        warnings?: string[];
        ref: NodeId | undefined;
    };
    /**
     * Merge a payload (subgraph) into the cache, following the parsed form of the
     * operation.
     */
    private _mergeSubgraph;
    /**
     * Merge an array from the payload (or previous cache data).
     */
    private _mergeArraySubgraph;
    delete(nodeId: NodeId): void;
    /**
     * Whether this editor has deleted the node.
     */
    private _isDeleted;
    /**
     * Modify a GraphQL payload (query/fragment/etc) into the snapshot, rooted at
     * the node identified by `rootId`.
     */
    modify(rootId: NodeId, payload: JsonObject, deleted: Set<string>, seenObjects: Set<object | null>): {
        warnings?: string[];
    };
    /**
     * Modify a payload (subgraph) into the cache.
     */
    private _modifySubgraph;
    private _getPreviousValue;
    /**
     * Modify an array from the payload (or previous cache data).
     */
    private _modifyArraySubgraph;
    /**
     *
     */
    private _removeArrayReferences;
    /**
     * Update all nodes with edited references, and ensure that the bookkeeping of
     * the new and _past_ references are properly updated.
     *
     * Returns the set of node ids that are newly orphaned by these edits.
     */
    private _mergeReferenceEdits;
    /**
     * Commits the transaction, returning a new immutable snapshot.
     */
    commit(ref?: NodeId | undefined): EditedSnapshot<TSerialized>;
    /**
     * Collect all our pending changes into a new GraphSnapshot.
     */
    _buildNewSnapshot(): GraphSnapshotType;
    /**
     * Transitively walks the inbound references of all edited nodes, rewriting
     * those references to point to the newly edited versions.
     */
    private _rebuildInboundReferences;
    /**
     * Transitively removes all orphaned nodes from the graph.
     */
    private _removeOrphanedNodes;
    private removeInbound;
    /**
     * Retrieve the _latest_ version of a node snapshot.
     */
    private _getNodeSnapshot;
    /**
     * Retrieve the _latest_ version of a node.
     */
    private _getNodeData;
    /**
     * Set `newValue` at `path` of the value snapshot identified by `id`, without
     * modifying the parent's copy of it.
     *
     * This will not shallow clone objects/arrays along `path` if they were
     * previously cloned during this transaction.
     */
    private _setValue;
    /**
     * Ensures that we have built a new version of a snapshot for node `id` (and
     * that it is referenced by `_newNodes`).
     */
    private _ensureNewSnapshot;
    /**
     * Ensures that there is a ParameterizedValueSnapshot for the given node with
     * arguments
     */
    private _ensureParameterizedValueSnapshot;
}
/**
 * Generate a stable id for a parameterized value.
 */
export declare function nodeIdForParameterizedValue(containerId: NodeId, path: PathPart[], args?: JsonObject): string;
//# sourceMappingURL=SnapshotEditor.d.ts.map