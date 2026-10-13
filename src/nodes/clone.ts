import { shareReferences } from '../util/references';

import { EntitySnapshot } from './EntitySnapshot';
import { NodeSnapshot } from './NodeSnapshot';
import { ParameterizedValueSnapshot } from './ParameterizedValueSnapshot';

/**
 * Factory function for cloning nodes to their specific type signatures, while
 * preserving object shapes.
 *
 * The clone shares the parent's reference maps until it changes them (see
 * shareReferences).
 */
export function cloneNodeSnapshot(parent: NodeSnapshot) {
  shareReferences(parent);
  const { inbound, outbound, parameterized } = parent;

  if (parent instanceof EntitySnapshot) {
    return new EntitySnapshot(parent.data, inbound, outbound, parameterized);
  } else if (parent instanceof ParameterizedValueSnapshot) {
    return new ParameterizedValueSnapshot(parent.data, inbound, outbound, parameterized);
  } else {
    throw new Error(`Unknown node type: ${Object.getPrototypeOf(parent).constructor.name}`);
  }
}
