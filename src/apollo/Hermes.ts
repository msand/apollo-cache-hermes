
import { OptimisticWrapperFunction, wrap } from 'optimism';
import type { DocumentNode } from 'graphql/index';
import { equal } from '@wry/equality';

import {
  Cache as CacheInterface,
  Policies,
  InMemoryCache,
  canonicalStringify,
  makeVar,
  Reference,
  StoreObject,
  Transaction,
  type ApolloCache, NormalizedCacheObject,
} from '../../apollo-client/src/cache';
import { EntityStore, supportsResultCaching } from '../../apollo-client/src/cache/inmemory/entityStore';
import { StoreReader } from '../../apollo-client/src/cache/inmemory/readFromStore';
import { StoreWriter } from '../../apollo-client/src/cache/inmemory/writeToStore';
import { shouldCanonizeResults } from '../../apollo-client/src/cache/inmemory/helpers';
import { DocumentTransform, addTypenameToDocument, cacheSizes, defaultCacheSizes } from '../../apollo-client/src/utilities';
import { getInMemoryCacheMemoryInternals } from '../../apollo-client/src/utilities/caching/getMemoryInternals';
import { CacheContext } from '../context';
import { Cache, MigrationMap } from '../Cache';
import { CacheSnapshot } from '../CacheSnapshot';
import { Serializable } from '../schema';

import { ApolloQueryable } from './Queryable';
import { ApolloTransaction } from './Transaction';
import { buildRawOperationFromQuery } from './util';

import BatchOptions = CacheInterface.BatchOptions;
import Root = EntityStore.Root;

type BroadcastOptions = Pick<
    BatchOptions<ApolloCache<NormalizedCacheObject>>,
    'optimistic' | 'onWatchUpdated'
>;

/**
 * Apollo-specific interface to the cache.
 */
export class Hermes extends ApolloQueryable implements InMemoryCache {
  data!: EntityStore;
  optimisticData!: EntityStore;
  /** The underlying Hermes cache. */
  public _queryable: Cache;

  config: CacheContext.Configuration;
  watches = new Set<CacheInterface.WatchOptions>();
  addTypename: boolean;

  storeReader!: StoreReader;
  storeWriter!: StoreWriter;
  addTypenameTransform = new DocumentTransform(addTypenameToDocument);

  maybeBroadcastWatch!: OptimisticWrapperFunction<
      [CacheInterface.WatchOptions, BroadcastOptions?],
      any,
      [CacheInterface.WatchOptions]
  >;

  // Override the default value, since InMemoryCache result objects are frozen
  // in development and expected to remain logically immutable in production.
  public readonly assumeImmutableResults = true;

  // Dynamically imported code can augment existing typePolicies or
  // possibleTypes by calling cache.policies.addTypePolicies or
  // cache.policies.addPossibletypes.
  public readonly policies: Policies;

  public readonly makeVar = makeVar;

  constructor(config: CacheContext.Configuration = {}) {
    super();
    this.config = config;
    this.addTypename = !!config.addTypename;
    const queryable = this._queryable = new Cache(config, this);
    this.policies = new Policies({
      cache: this as unknown as InMemoryCache,
      dataIdFromObject: queryable.entityIdForValue,
      possibleTypes: config.possibleTypes,
      typePolicies: queryable.typePolicies,
    });

    this.init();
  }

  init() {
    // Passing { resultCaching: false } in the InMemoryCache constructor options
    // will completely disable dependency tracking, which will improve memory
    // usage but worsen the performance of repeated reads.
    const rootStore = (this.data = new Root({
      policies: this.policies,
      resultCaching: this.config.resultCaching,
    }));

    // When no optimistic writes are currently active, cache.optimisticData ===
    // cache.data, so there are no additional layers on top of the actual data.
    // When an optimistic update happens, this.optimisticData will become a
    // linked list of EntityStore Layer objects that terminates with the
    // original this.data cache object.
    this.optimisticData = rootStore.stump;

    this.resetResultCache();
  }

  resetResultCache(resetResultIdentities?: boolean) {
    const previousReader = this.storeReader;
    const { fragments } = this.config;

    // The StoreWriter is mostly stateless and so doesn't really need to be
    // reset, but it does need to have its writer.storeReader reference updated,
    // so it's simpler to update this.storeWriter as well.
    this.storeWriter = new StoreWriter(
      // @ts-ignore
      this,
      (this.storeReader = new StoreReader({
        // @ts-ignore
        cache: this,
        addTypename: this.addTypename,
        resultCacheMaxSize: this.config.resultCacheMaxSize,
        canonizeResults: shouldCanonizeResults(this.config),
        canon:
          resetResultIdentities ? void 0 : (
            previousReader && previousReader.canon
          ),
        fragments,
      })),
      fragments
    );

    this.maybeBroadcastWatch = wrap(
      (c: CacheInterface.WatchOptions, options?: BroadcastOptions) => {
        return this._queryable.broadcastWatches(options);
      },
      {
        max:
          this.config.resultCacheMaxSize ||
          cacheSizes['inMemoryCache.maybeBroadcastWatch'] ||
          defaultCacheSizes?.['inMemoryCache.maybeBroadcastWatch'] ||
            5000,
        makeCacheKey: (c: CacheInterface.WatchOptions) => {
          // Return a cache key (thus enabling result caching) only if we're
          // currently using a data store that can track cache dependencies.
          const snapshot = this._queryable.getSnapshot();
          const store = c.optimistic ? snapshot.optimistic : snapshot.baseline;
          if (supportsResultCaching(store)) {
            const { optimistic, id, variables } = c;
            return store.makeCacheKey(
              c.query,
              // Different watches can have the same query, optimistic
              // status, rootId, and variables, but if their callbacks are
              // different, the (identical) result needs to be delivered to
              // each distinct callback. The easiest way to achieve that
              // separation is to include c.callback in the cache key for
              // maybeBroadcastWatch calls. See issue #5733.
              c.callback,
              canonicalStringify({ optimistic, id, variables })
            );
          }
        },
      }
    );

    /* TODO
    // Since we have thrown away all the cached functions that depend on the
    // CacheGroup dependencies maintained by EntityStore, we should also reset
    // all CacheGroup dependency information.
    new Set([this.data.group, this.optimisticData.group]).forEach((group) =>
      group.resetCaching()
    );
    */
  }

  // TODO (yuisu): data can be typed better with update of ApolloCache API

  public restore(data: NormalizedCacheObject | Serializable.GraphSnapshot): this;
  public restore(data: NormalizedCacheObject | Serializable.GraphSnapshot, migrationMap?: MigrationMap, verifyOptions?: CacheInterface.ReadOptions): Hermes;
  public restore(data: NormalizedCacheObject | Serializable.GraphSnapshot, migrationMap?: MigrationMap, verifyOptions?: CacheInterface.ReadOptions): Hermes {
    const verifyQuery = verifyOptions && buildRawOperationFromQuery(verifyOptions.query, verifyOptions.variables);
    this._queryable.restore(data, migrationMap, verifyQuery);
    return this;
  }

  // TODO (yuisu): return can be typed better with update of ApolloCache API
  public extract(optimistic?: boolean): Serializable.GraphSnapshot;
  public extract(optimistic?: boolean, pruneOptions?: CacheInterface.ReadOptions): Serializable.GraphSnapshot;
  public extract(optimistic: boolean = false, pruneOptions?: CacheInterface.ReadOptions): Serializable.GraphSnapshot {
    const pruneQuery = pruneOptions && buildRawOperationFromQuery(pruneOptions.query, pruneOptions.variables);
    return this._queryable.extract(optimistic, pruneQuery);
  }

  /*
  public read<T>(options: CacheInterface.ReadOptions): T | null {
    const {
      // Since read returns data or null, without any additional metadata
      // about whether/where there might have been missing fields, the
      // default behavior cannot be returnPartialData = true (like it is
      // for the diff method), since defaulting to true would violate the
      // integrity of the T in the return type. However, partial data may
      // be useful in some cases, so returnPartialData:true may be
      // specified explicitly.
      returnPartialData = false,
    } = options;
    try {
      return (
        this.storeReader.diffQueryAgainstStore<T>({
          ...options,
          store: options.optimistic ? this.optimisticData : this.data,
          config: this.config,
          returnPartialData,
        }).result || null
      );
    } catch (e) {
      if (e instanceof MissingFieldError) {
        // Swallow MissingFieldError and return null, so callers do not need to
        // worry about catching "normal" exceptions resulting from incomplete
        // cache data. Unexpected errors will be re-thrown. If you need more
        // information about which fields were missing, use cache.diff instead,
        // and examine diffResult.missing.
        return null;
      }
      throw e;
    }
  }
  */

  /*
  public write(options: CacheInterface.WriteOptions): Reference | undefined {
    try {
      ++this.txCount;
      return this.storeWriter.writeToStore(this.data, options);
    } finally {
      if (!--this.txCount && options.broadcast !== false) {
        this.broadcastWatches();
      }
    }
  }
  */

  /*
  public modify<Entity extends Record<string, any> = Record<string, any>>(
    options: CacheInterface.ModifyOptions<Entity>
  ): boolean {
    if (hasOwn.call(options, 'id') && !options.id) {
      // To my knowledge, TypeScript does not currently provide a way to
      // enforce that an optional property?:type must *not* be undefined
      // when present. That ability would be useful here, because we want
      // options.id to default to ROOT_QUERY only when no options.id was
      // provided. If the caller attempts to pass options.id with a
      // falsy/undefined value (perhaps because cache.identify failed), we
      // should not assume the goal was to modify the ROOT_QUERY object.
      // We could throw, but it seems natural to return false to indicate
      // that nothing was modified.
      return false;
    }
    const store
        = (
          options.optimistic // Defaults to false.
        )
          ? this.optimisticData
          : this.data;
    try {
      ++this.txCount;
      return store.modify(options.id || 'ROOT_QUERY', options.fields);
    } finally {
      if (!--this.txCount && options.broadcast !== false) {
        this.broadcastWatches();
      }
    }
  }
  */

  /*
  public diff<TData, TVariables extends OperationVariables = any>(
    options: CacheInterface.DiffOptions<TData, TVariables>
  ): CacheInterface.DiffResult<TData> {
    return this.storeReader.diffQueryAgainstStore({
      ...options,
      store: options.optimistic ? this.optimisticData : this.data,
      rootId: options.id || 'ROOT_QUERY',
      config: this.config,
    });
  }
  */

  public watch<TData = any, TVariables = any>(
    options: CacheInterface.WatchOptions<TData, TVariables>
  ): () => void {
    const query = buildRawOperationFromQuery(options.query, options.variables);
    this.watches.add(options);
    const unwatch = this._queryable.watch(query, options);
    return () => {
      unwatch();
      this.watches.delete(options);
    };
  }

  public gc(options?: {
    // If true, also free non-essential result cache memory by bulk-releasing
    // this.{store{Reader,Writer},maybeBroadcastWatch}. Defaults to false.
    resetResultCache?: boolean,
    // If resetResultCache is true, this.storeReader.canon will be preserved by
    // default, but can also be discarded by passing resetResultIdentities:true.
    // Defaults to false.
    resetResultIdentities?: boolean,
  }): string[] {
    return this._queryable.gc();
  }

  // Call this method to ensure the given root ID remains in the cache after
  // garbage collection, along with its transitive child entities. Note that
  // the cache automatically retains all directly written entities. By default,
  // the retainment persists after optimistic updates are removed. Pass true
  // for the optimistic argument if you would prefer for the retainment to be
  // discarded when the top-most optimistic layer is removed. Returns the
  // resulting (non-negative) retainment count.
  public retain(rootId: string, optimistic?: boolean): number {
    return this._queryable.retain(rootId);
  }

  // Call this method to undo the effect of the retain method, above. Once the
  // retainment count falls to zero, the given ID will no longer be preserved
  // during garbage collection, though it may still be preserved by other safe
  // entities that refer to it. Returns the resulting (non-negative) retainment
  // count, in case that's useful.
  public release(rootId: string, optimistic?: boolean): number {
    return this._queryable.release(rootId);
  }

  // Returns the canonical ID for a given StoreObject, obeying typePolicies
  // and keyFields (and dataIdFromObject, if you still use that). At minimum,
  // the object must contain a __typename and any primary key fields required
  // to identify entities of that type. If you pass a query result object, be
  // sure that none of the primary key fields have been renamed by aliasing.
  // If you pass a Reference object, its __ref ID string will be returned.
  public identify(object: StoreObject | Reference): string | undefined {
    return this._queryable.identify(object);
  }

  /*
  public evict(options: CacheInterface.EvictOptions): boolean {
    if (!options.id) {
      if (hasOwn.call(options, 'id')) {
        // See comment in modify method about why we return false when
        // options.id exists but is falsy/undefined.
        return false;
      }
      options = { ...options, id: 'ROOT_QUERY' };
    }
    try {
      // It's unlikely that the eviction will end up invoking any other
      // cache update operations while it's running, but {in,de}crementing
      // this.txCount still seems like a good idea, for uniformity with
      // the other update methods.
      ++this.txCount;
      // Pass this.data as a limit on the depth of the eviction, so evictions
      // during optimistic updates (when this.data is temporarily set equal to
      // this.optimisticData) do not escape their optimistic Layer.
      return this.optimisticData.evict(options, this.data);
    } finally {
      if (!--this.txCount && options.broadcast !== false) {
        this.broadcastWatches();
      }
    }
  }
  */

  public reset(options?: CacheInterface.ResetOptions): Promise<void> {
    return this._queryable.reset();
  }

  public removeOptimistic(idToRemove: string) {
    this._queryable.rollback(idToRemove);
  }

  txCount = 0;

  public batch<TUpdateResult>(
    options: CacheInterface.BatchOptions<ApolloCache<NormalizedCacheObject>, TUpdateResult>
  ): TUpdateResult {
    const {
      update,
      optimistic = true,
      removeOptimistic,
      onWatchUpdated,
    } = options;

    const optimisticId
        = typeof optimistic === 'string'
          ? optimistic
          : optimistic ? undefined : null;

    const alreadyDirty = new Set<CacheInterface.WatchOptions>();

    const willWatch = onWatchUpdated && !this.txCount;
    if (willWatch) {
      // If an options.onWatchUpdated callback is provided, we want to call it
      // with only the Cache.WatchOptions objects affected by options.update,
      // but there might be dirty watchers already waiting to be broadcast that
      // have nothing to do with the update. To prevent including those watchers
      // in the post-update broadcast, we perform this initial broadcast to
      // collect the dirty watchers, so we can re-dirty them later, after the
      // post-update broadcast, allowing them to receive their pending
      // broadcasts the next time broadcastWatches is called, just as they would
      // if we never called cache.batch.
      this._queryable.broadcastWatches({
        ...options,
        onWatchUpdated(watch) {
          alreadyDirty.add(watch);
          return false;
        },
      });
    }

    let updateResult: TUpdateResult;

    ++this.txCount;
    try {
      this.performTransaction(
        () => (updateResult = update(this)),
        optimisticId,
        onWatchUpdated,
        !willWatch,
      );
    } finally {
      --this.txCount;
    }

    // Note: if this.txCount > 0, then alreadyDirty.size === 0, so this code
    // takes the else branch and calls this.broadcastWatches(options), which
    // does nothing when this.txCount > 0.
    if (onWatchUpdated && alreadyDirty.size) {
      this._queryable.broadcastWatches({
        ...options,
        onWatchUpdated(watch, diff, lastDiff) {
          const result = onWatchUpdated.call(this, watch, diff, lastDiff);
          if (result !== false) {
            // Since onWatchUpdated did not return false, this diff is
            // about to be broadcast to watch.callback, so we don't need
            // to re-dirty it with the other alreadyDirty watches below.
            alreadyDirty.delete(watch);
          }
          return result;
        },
      });
      // Silently re-dirty any watches that were already dirty before the update
      // was performed, and were not broadcast just now.
      if (alreadyDirty.size) {
        alreadyDirty.forEach(watch => watch.lastDiff = undefined);
      }
    } else {
      // If alreadyDirty is empty or we don't have an onWatchUpdated
      // function, we don't need to go to the trouble of wrapping
      // options.onWatchUpdated.
      this._queryable.broadcastWatches(options);
    }

    return updateResult!;
  }

  public performTransaction(
    update: (cache: ApolloCache<NormalizedCacheObject>) => any,
    optimisticId?: string | null
  ): void;

  public performTransaction(
    update: (cache: ApolloCache<NormalizedCacheObject>) => any,
    optimisticId?: string | null,
    onWatchUpdated?: BatchOptions<any>['onWatchUpdated'],
    broadcast?: boolean,
  ): void;

  public performTransaction(
    update: (cache: ApolloCache<NormalizedCacheObject>) => any,
    optimisticId?: string | null,
    onWatchUpdated?: BatchOptions<any>['onWatchUpdated'],
    broadcast: boolean = true,
  ): void {
    this._queryable.transaction(broadcast, optimisticId, t => update(new ApolloTransaction(t)), onWatchUpdated);
  }

  /*
  public transformDocument(document: DocumentNode): DocumentNode {
    return this.addTypenameToDocument(this.addFragmentsToDocument(document));
  }
  */

  public broadcastWatches(options?: BroadcastOptions) {
    if (!this.txCount) {
      this._queryable.broadcastWatches(options);
    }
  }

  addFragmentsToDocument(document: DocumentNode) {
    const { fragments } = this.config;
    return fragments ? fragments.transform(document) : document;
  }

  addTypenameToDocument(document: DocumentNode) {
    if (this.addTypename) {
      return this.addTypenameTransform.transformDocument(document);
    }
    return document;
  }

  // This method is wrapped by maybeBroadcastWatch, which is called by
  // broadcastWatches, so that we compute and broadcast results only when
  // the data that would be broadcast might have changed. It would be
  // simpler to check for changes after recomputing a result but before
  // broadcasting it, but this wrapping approach allows us to skip both
  // the recomputation and the broadcast, in most cases.
  broadcastWatch(c: CacheInterface.WatchOptions, options?: BroadcastOptions) {
    const { lastDiff } = c;

    // Both WatchOptions and DiffOptions extend ReadOptions, and DiffOptions
    // currently requires no additional properties, so we can use c (a
    // WatchOptions object) as DiffOptions, without having to allocate a new
    // object, and without having to enumerate the relevant properties (query,
    // variables, etc.) explicitly. There will be some additional properties
    // (lastDiff, callback, etc.), but cache.diff ignores them.
    const diff = this.diff<any>(c);

    if (options) {
      if (c.optimistic && typeof options.optimistic === 'string') {
        diff.fromOptimisticTransaction = true;
      }

      if (
        options.onWatchUpdated &&
          options.onWatchUpdated.call(this, c, diff, lastDiff) === false
      ) {
        // Returning false from the onWatchUpdated callback will prevent
        // calling c.callback(diff) for this watcher.
        return;
      }
    }

    if (!lastDiff || !equal(lastDiff.result, diff.result)) {
      c.callback((c.lastDiff = diff), lastDiff);
    }
  }

  recordOptimisticTransaction(transaction: Transaction<Serializable.GraphSnapshot>, id: string): void {
    this._queryable.transaction(true, id, t => transaction(new ApolloTransaction(t)));
  }

  getCurrentCacheSnapshot(): CacheSnapshot {
    return this._queryable.getSnapshot();
  }

  /**
   * @experimental
   * @internal
   * This is not a stable API - it is used in development builds to expose
   * information to the DevTools.
   * Use at your own risk!
   */
  public getMemoryInternals?: typeof getInMemoryCacheMemoryInternals;
}

if (__DEV__) {
  Hermes.prototype.getMemoryInternals = getInMemoryCacheMemoryInternals;
}
