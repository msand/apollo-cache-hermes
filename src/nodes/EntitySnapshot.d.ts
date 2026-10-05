import { JsonObject, NestedArray, NestedObject } from '../primitive';
import { NodeReference, NodeSnapshot } from './NodeSnapshot';
export { NestedArray, NestedObject };
/**
 * Maintains a reference to a single entity within the cached graph, and any
 * bookkeeping metadata associated with it.
 *
 * Note that this houses all the _static_ values for an entity, but none of the
 * parameterized values that may also have been queried for it.
 */
export declare class EntitySnapshot implements NodeSnapshot {
    /** A reference to the entity this snapshot is about. */
    data?: JsonObject | undefined;
    /** Other node snapshots that point to this one. */
    inbound?: Map<string, NodeReference>;
    /** The node snapshots that this one points to. */
    outbound?: Map<string, NodeReference>;
    /** The parameterized node snapshots that this one points to. */
    parameterized?: Map<string, NodeReference[]>;
    constructor(
    /** A reference to the entity this snapshot is about. */
    data?: JsonObject | undefined, 
    /** Other node snapshots that point to this one. */
    inbound?: Map<string, NodeReference> | NodeReference[], 
    /** The node snapshots that this one points to. */
    outbound?: Map<string, NodeReference> | NodeReference[], 
    /** The parameterized node snapshots that this one points to. */
    parameterized?: Map<string, NodeReference[]> | NodeReference[]);
}
//# sourceMappingURL=EntitySnapshot.d.ts.map