import { CacheContext } from '../../src/context';
import { GraphSnapshot } from '../../src/GraphSnapshot';
import { JsonObject } from '../../src/primitive';
import { NodeId } from '../../src/schema';
import { iterParameterized } from '../../src/util';
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
  return createSnapshot(payload, gqlString, gqlVariables, rootId, cacheContext).snapshot;
}

export const mapToEntries = (map: Map<string, NodeReference[]> | undefined): NodeReference[] | undefined =>
  map && Array.from(iterParameterized(map));
export const mapToEntries2 = (map: Map<string, NodeReference> | undefined): NodeReference[] | undefined =>
  map && Array.from(map.values());

/**
 * Converts Hermes' serialization of entities (`{ type, data, outbound, ... }`)
 * into InMemoryCache's normalized shape (`{ ...data, field: { __ref } }`), so
 * vendored Apollo Client expectations can be checked as written.
 *
 * Only entity references are supported; parameterized fields throw.
 */
export function toNormalizedCacheObject(serialized: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [id, node] of Object.entries(serialized)) {
    if (node.type !== 0) throw new Error(`Unsupported node type ${node.type} for ${id}`);
    if (node.parameterized?.length) throw new Error(`Parameterized fields are not supported (${id})`);
    const entity: Record<string, any> = JSON.parse(JSON.stringify(node.data ?? {}));
    for (const { id: target, path } of node.outbound ?? []) {
      let container = entity;
      for (const key of path.slice(0, -1)) container = container[key];
      container[path[path.length - 1]] = { __ref: target };
    }
    if (id === 'ROOT_QUERY' && !('__typename' in entity)) entity.__typename = 'Query';
    normalized[id] = entity;
  }
  return normalized;
}
