import { JsonObject, NestedArray, NestedObject } from '../primitive';
import { getInbound, getOutbound, getParameterized } from '../util';

import { NodeReference, NodeSnapshot } from './NodeSnapshot';

// Until https://github.com/Microsoft/TypeScript/issues/9944
export { NestedArray, NestedObject };

/**
 * Maintains a reference to a single entity within the cached graph, and any
 * bookkeeping metadata associated with it.
 *
 * Note that this houses all the _static_ values for an entity, but none of the
 * parameterized values that may also have been queried for it.
 */
export class EntitySnapshot implements NodeSnapshot {
  /** Other node snapshots that point to this one. */
  public inbound?: Map<string, NodeReference>;
  /** The node snapshots that this one points to. */
  public outbound?: Map<string, NodeReference>;
  /** The parameterized node snapshots that this one points to. */
  public parameterized?: Map<string, NodeReference[]>;
  constructor(
    /** A reference to the entity this snapshot is about. */
    public data?: JsonObject,
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
