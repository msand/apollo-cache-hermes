import { JsonValue, NestedArray, NestedObject } from '../primitive';
import { getInbound, getOutbound, getParameterized } from '../util';

import { NodeSnapshot, NodeReference } from './NodeSnapshot';

// Until https://github.com/Microsoft/TypeScript/issues/9944
export { NestedArray, NestedObject };

/**
 * Maintains a reference to the value of a specific parameterized field
 * contained within some other node.
 *
 * These values are stored outside of the entity that contains them, as the
 * entity node is reserved for static values.  At read time, these values are
 * overlaid on top of the static values of the entity that contains them.
 */
export class ParameterizedValueSnapshot implements NodeSnapshot {
  /** Other node snapshots that point to this one. */
  public inbound?: Map<string, NodeReference>;
  /** The node snapshots that this one points to. */
  outbound?: Map<string, NodeReference>;
  /** The parameterized node snapshots that this one points to. */
  parameterized?: Map<string, NodeReference[]>;
  constructor(
    /** A reference to the entity this snapshot is about. */
    public data?: JsonValue,
    /** Other node snapshots that point to this one. */
    inbound?: Map<string, NodeReference> | NodeReference[],
    /** The node snapshots that this one points to. */
    outbound?: Map<string, NodeReference> | NodeReference[],
    /** The parameterized node snapshots that this one points to. */
    parameterized?: Map<string, NodeReference[]> | NodeReference[],
  ) {
    this.inbound = Array.isArray(inbound) ? getInbound(inbound) : inbound;
    this.outbound = Array.isArray(outbound) ? getOutbound(outbound) : outbound;
    this.parameterized = Array.isArray(parameterized) ? getParameterized(parameterized) : parameterized;
  }
}
