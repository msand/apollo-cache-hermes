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
 * Fields with arguments (Hermes' parameterized value nodes) are stored in
 * their container under InMemoryCache's store field name: `field({"arg":1})`,
 * or, for fields stored per their keyArgs policies (or @connection
 * directives), the store field name their node id ends with (e.g.
 * `field:{"arg":1}`).
 *
 * Like InMemoryCache's, root objects have the __typename of their root type:
 * Query, Mutation or Subscription, unless `rootTypenames` (e.g. a cache's
 * `policies.rootTypenamesById`) says otherwise.
 */
export function toNormalizedCacheObject(
  serialized: Record<string, any>,
  rootTypenames: Record<string, string> = defaultRootTypenames,
): Record<string, any> {
  const build = (id: string): any => {
    const node = serialized[id];
    const root = { value: cloneData(node.data ?? (node.type === 0 ? {} : null)) };
    for (const { id: target, path } of node.outbound ?? []) setAt(root, path, { __ref: target });
    for (const { id: target, path } of node.parameterized ?? []) {
      const storeKey = target.slice(target.lastIndexOf('❖') + 1);
      const fieldName = path[path.length - 1];
      const container = objectAt(root, path.slice(0, -1));
      // (Fields with keyArgs may also be stored under their field name.)
      if (container[fieldName] == null) delete container[fieldName];
      const storeFieldName = storeKey.startsWith('{')
        ? `${fieldName}(${stableStringify(JSON.parse(storeKey))})`
        : storeKey;
      container[storeFieldName] = build(target);
    }
    return root.value;
  };

  const normalized: Record<string, any> = {};
  for (const [id, node] of Object.entries(serialized)) {
    // Parameterized values are stored in their containers.
    if (node.type !== 0) continue;
    const entity = build(id);
    const rootTypename = rootTypenames[id];
    if (rootTypename && !('__typename' in entity)) entity.__typename = rootTypename;
    normalized[id] = entity;
  }
  return normalized;
}

/**
 * Copies JSON data like a JSON round trip, except that missing list items
 * stay missing (rather than becoming null), like InMemoryCache's sparse lists.
 */
function cloneData(value: any): any {
  if (value && typeof value.toJSON === 'function') return JSON.parse(JSON.stringify(value));
  if (Array.isArray(value)) {
    const copy = new Array(value.length);
    value.forEach((item, index) => {
      if (item !== undefined) copy[index] = cloneData(item);
    });
    return copy;
  }
  if (value && typeof value === 'object') {
    const copy: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      if (value[key] !== undefined) copy[key] = cloneData(value[key]);
    }
    return copy;
  }
  return value;
}

const defaultRootTypenames: Record<string, string> = {
  ROOT_QUERY: 'Query',
  ROOT_MUTATION: 'Mutation',
  ROOT_SUBSCRIPTION: 'Subscription',
};

function setAt(root: { value: any }, path: (string | number)[], value: any) {
  if (!path.length) {
    root.value = value;
  } else {
    objectAt(root, path.slice(0, -1))[path[path.length - 1]] = value;
  }
}

/** The object (or array) at path, created where missing. */
function objectAt(root: { value: any }, path: (string | number)[]): any {
  if (root.value === null || typeof root.value !== 'object') root.value = typeof path[0] === 'number' ? [] : {};
  let container = root.value;
  path.forEach((key, index) => {
    if (container[key] === null || typeof container[key] !== 'object') {
      container[key] = typeof path[index + 1] === 'number' ? [] : {};
    }
    container = container[key];
  });
  return container;
}

/** JSON with sorted object keys, like InMemoryCache's store field names. */
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested) =>
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? Object.keys(nested)
          .sort()
          .reduce<Record<string, unknown>>((sorted, key) => {
            sorted[key] = nested[key];
            return sorted;
          }, {})
      : nested,
  );
}
