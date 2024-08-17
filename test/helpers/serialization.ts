import { CacheContext } from '../../src/context';
import { GraphSnapshot } from '../../src/GraphSnapshot';
import { JsonObject } from '../../src/primitive';
import { NodeId } from '../../src/schema';
import { iterOutbound } from '../../src/util';
import { NodeReference } from '../../src/nodes';

import { createSnapshot } from './write';

/**
 * Helper for creating graphSnapshot used by
 * extract or restore function.
 */
export function createGraphSnapshot(
  payload: JsonObject,
  gqlString: string,
  cacheContext: CacheContext,
  gqlVariables?: JsonObject,
  rootId?: NodeId,
): GraphSnapshot {
  return createSnapshot(
    payload,
    gqlString,
    gqlVariables,
    rootId,
    cacheContext
  ).snapshot;
}

export const mapToEntries = (map: Map<string, NodeReference[]> | undefined): NodeReference[] | undefined => map && Array.from(iterOutbound(map));
export const mapToEntries2 = (map: Map<string, NodeReference> | undefined): NodeReference[] | undefined => map && Array.from(map.values());
