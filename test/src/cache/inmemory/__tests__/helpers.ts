import type { Cache, NormalizedCacheObject } from '@apollo/client/cache';
import { isReference } from '@apollo/client/utilities';

import { Hermes } from '../../../../../src';
import { CacheContext } from '../../../../../src/context';
import { toNormalizedCacheObject } from '../../../../helpers';

// Hermes: these helpers stand in for InMemoryCache's StoreWriter, StoreReader
// and EntityStore. A "store" is a Hermes cache, written with cache.write and
// read with cache.diff, whose toObject() is its extract() in InMemoryCache's
// normalized shape.

export type HermesStore = Hermes & {
  /** The cache's contents in InMemoryCache's normalized shape. */
  toObject(): NormalizedCacheObject;
};

/** Writes into a new Hermes cache with this configuration for each store. */
export class HermesWriter {
  constructor(public readonly config: CacheContext.Configuration = {}) {}
}

/** Reads from a store, like InMemoryCache's StoreReader. */
export class HermesReader {
  diffQueryAgainstStore<T = any>(options: DiffQueryAgainstStoreOptions): Cache.DiffResult<T> {
    const { store, query, variables, rootId, returnPartialData = true } = options;
    return store.diff<T>({ query, variables, id: rootId, returnPartialData, optimistic: false });
  }
}

export interface DiffQueryAgainstStoreOptions {
  store: HermesStore;
  query: Cache.DiffOptions['query'];
  variables?: Record<string, any>;
  rootId?: string;
  returnPartialData?: boolean;
  /** Ignored, like InMemoryCache does. */
  previousResult?: any;
}

export function toStore(cache: Hermes): HermesStore {
  const store = cache as HermesStore;
  store.toObject = () => toNormalizedCacheObject(cache.extract());
  return store;
}

/** A new store, with the entities of seed (in InMemoryCache's normalized shape). */
export function defaultNormalizedCacheFactory(
  seed?: NormalizedCacheObject,
  config?: CacheContext.Configuration,
): HermesStore {
  const cache = new Hermes(config);
  if (seed && Object.keys(seed).length) cache.restore(fromNormalizedCacheObject(seed));
  return toStore(cache);
}

/** The inverse of toNormalizedCacheObject (for entity references only). */
function fromNormalizedCacheObject(normalized: NormalizedCacheObject) {
  type Edge = { id: string; path: (string | number)[] };
  const serialized: Record<
    string,
    { type: 0 | 1; data: any; outbound?: Edge[]; inbound?: Edge[]; parameterized?: Edge[] }
  > = {};
  const inbound: Record<string, Edge[]> = {};
  for (const [id, entity] of Object.entries(normalized)) {
    const outbound: Edge[] = [];
    const strip = (value: any, path: (string | number)[]): any => {
      if (isReference(value)) {
        outbound.push({ id: value.__ref, path });
        (inbound[value.__ref] ??= []).push({ id, path });
        return undefined;
      }
      if (Array.isArray(value)) return value.map((item, index) => strip(item, [...path, index]));
      if (value && typeof value === 'object') {
        const stripped: Record<string, any> = {};
        for (const key of Object.keys(value)) stripped[key] = strip(value[key], [...path, key]);
        return stripped;
      }
      return value;
    };
    // Fields stored per their keyArgs policies (InMemoryCache's `field:...`
    // store field names) are Hermes' parameterized value nodes.
    const data = strip(entity, []);
    const parameterized: Edge[] = [];
    for (const key of Object.keys(data ?? {})) {
      const fieldName = /^[_a-z][_0-9a-z]*/i.exec(key)?.[0];
      if (!fieldName || key.charAt(fieldName.length) !== ':') continue;
      const nodeId = `${id}❖${JSON.stringify([fieldName])}❖${key}`;
      serialized[nodeId] = { type: 1, data: data[key], inbound: [{ id, path: [fieldName] }] };
      parameterized.push({ id: nodeId, path: [fieldName] });
      delete data[key];
    }
    serialized[id] = { type: 0, data };
    if (outbound.length) serialized[id].outbound = outbound;
    if (parameterized.length) serialized[id].parameterized = parameterized;
  }
  for (const [id, edges] of Object.entries(inbound)) {
    if (serialized[id]) serialized[id].inbound = edges;
  }
  return serialized;
}

interface WriteQueryToStoreOptions extends Omit<Cache.WriteOptions, 'dataId'> {
  writer: HermesWriter;
  /** Writes into this store, rather than into a new one. */
  store?: HermesStore;
  dataId?: string;
}

export function readQueryFromStore<T = any>(reader: HermesReader, options: DiffQueryAgainstStoreOptions) {
  return reader.diffQueryAgainstStore<T>({
    ...options,
    returnPartialData: false,
  }).result;
}

export function writeQueryToStore(options: WriteQueryToStoreOptions): HermesStore {
  const {
    writer,
    store = defaultNormalizedCacheFactory(undefined, writer.config),
    dataId = 'ROOT_QUERY',
    ...writeOptions
  } = options;
  store.write({ ...writeOptions, dataId });
  return store;
}

export function withError(func: Function, regex?: RegExp) {
  let message: string = null as never;
  const { error } = console;
  console.error = (m: any) => {
    message = m;
  };

  try {
    const result = func();
    if (regex) {
      expect(message).toMatch(regex);
    }
    return result;
  } finally {
    console.error = error;
  }
}
