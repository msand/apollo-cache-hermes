import type { DocumentNode } from 'graphql';
import type { CacheContext } from '../context';
import type { GraphSnapshot, NodeSnapshotMap } from '../GraphSnapshot';
import type { JsonObject } from '../primitive';
import type { NodeId, OperationInstance, RawOperation } from '../schema';
export type MissingTree = string | {
    readonly [key: string]: MissingTree;
};
export declare class MissingFieldError extends Error {
    readonly message: string;
    readonly path: MissingTree | Array<string | number>;
    readonly query: DocumentNode;
    readonly variables?: Record<string, any> | undefined;
    constructor(message: string, path: MissingTree | Array<string | number>, query: DocumentNode, variables?: Record<string, any> | undefined);
    readonly missing: MissingTree;
}
export interface QueryResult {
    /** The value of the root requested by a query. */
    result?: JsonObject;
    /** Whether the query's selection set was satisfied. */
    complete: boolean;
    /** The ids of entity nodes selected by the query. */
    entityIds?: Set<NodeId>;
    /** The ids of nodes overlaid on top of static cache results. */
    dynamicNodeIds?: Set<NodeId>;
    missing?: MissingFieldError[];
    fromOptimisticTransaction?: boolean;
}
export interface QueryResultWithNodeIds extends QueryResult {
    /** The ids of entity nodes selected by the query. */
    entityIds: Set<NodeId>;
}
/**
 * Get you some data.
 */
export declare function read<TSerialized>(context: CacheContext<TSerialized>, raw: RawOperation, snapshot: GraphSnapshot, tempStore?: NodeSnapshotMap, includeNodeIds?: true): QueryResultWithNodeIds;
export declare function read<TSerialized>(context: CacheContext<TSerialized>, raw: RawOperation, snapshot: GraphSnapshot, tempStore?: NodeSnapshotMap, includeNodeIds?: boolean): QueryResult;
/**
 * Walks a parameterized field map, overlaying values at those paths on top of
 * existing results.
 *
 * Overlaid values are objects with prototypes pointing to the original results,
 * and new properties pointing to the parameterized values (or objects that
 * contain them).
 */
export declare function _walkAndOverlayDynamicValues<TSerialized>(query: OperationInstance<TSerialized>, context: CacheContext<TSerialized>, snapshot: GraphSnapshot, result: JsonObject | undefined, dynamicNodeIds: Set<NodeId>, tempStore: NodeSnapshotMap): JsonObject | undefined;
/**
 * Determines whether `result` satisfies the properties requested by
 * `selection`.
 */
export declare function _visitSelection<TSerialized>(query: OperationInstance<TSerialized>, context: CacheContext<TSerialized>, result?: JsonObject, nodeIds?: Set<NodeId>, missing?: MissingFieldError[]): boolean;
//# sourceMappingURL=read.d.ts.map