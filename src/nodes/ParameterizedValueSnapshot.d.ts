import { JsonValue, NestedArray, NestedObject } from '../primitive';
import { NodeSnapshot, NodeReference } from './NodeSnapshot';
export { NestedArray, NestedObject };
/**
 * Maintains a reference to the value of a specific parameterized field
 * contained within some other node.
 *
 * These values are stored outside of the entity that contains them, as the
 * entity node is reserved for static values.  At read time, these values are
 * overlaid on top of the static values of the entity that contains them.
 */
export declare class ParameterizedValueSnapshot implements NodeSnapshot {
    /** A reference to the entity this snapshot is about. */
    data?: JsonValue | undefined;
    /** Other node snapshots that point to this one. */
    inbound?: Map<string, NodeReference>;
    /** The node snapshots that this one points to. */
    outbound?: Map<string, NodeReference>;
    /** The parameterized node snapshots that this one points to. */
    parameterized?: Map<string, NodeReference[]>;
    constructor(
    /** A reference to the entity this snapshot is about. */
    data?: JsonValue | undefined, 
    /** Other node snapshots that point to this one. */
    inbound?: Map<string, NodeReference> | NodeReference[], 
    /** The node snapshots that this one points to. */
    outbound?: Map<string, NodeReference> | NodeReference[], 
    /** The parameterized node snapshots that this one points to. */
    parameterized?: Map<string, NodeReference[]> | NodeReference[]);
}
//# sourceMappingURL=ParameterizedValueSnapshot.d.ts.map