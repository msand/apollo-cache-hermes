import {
  Cache as CacheInterface,
  DocumentTransform,
} from '@apollo/client';
import type {
  Transaction,
  InMemoryCache,
} from '@apollo/client';
import {
  addTypenameToDocument,
  cacheSizes,
  canonicalStringify,
  defaultCacheSizes,
  Reference,
  StoreObject,
} from '@apollo/client/utilities';
import {
  EntityStore,
  makeVar,
  Policies,
} from '@apollo/client/cache';
import { OptimisticWrapperFunction, wrap } from 'optimism';
import type { DocumentNode } from 'graphql/index';
import { equal } from '@wry/equality';
import { StoreWriter } from '@apollo/client/cache/inmemory/writeToStore';
import { StoreReader } from '@apollo/client/cache/inmemory/readFromStore';
import { shouldCanonizeResults } from '@apollo/client/cache/inmemory/helpers';
import { supportsResultCaching } from '@apollo/client/cache/inmemory/entityStore';

import { CacheContext } from '../context';
import { Cache, MigrationMap } from '../Cache';
import { CacheSnapshot } from '../CacheSnapshot';
import { GraphSnapshot } from '../GraphSnapshot';
import { NodeId } from '../schema';

import { ApolloQueryable } from './Queryable';
import { ApolloTransaction } from './Transaction';
import { buildRawOperationFromQuery } from './util';

import BatchOptions = CacheInterface.BatchOptions;
import Root = EntityStore.Root;

/**
 * Apollo-specific interface to the cache.
 */
export class Hermes<TSerialized = GraphSnapshot> extends ApolloQueryable<TSerialized> {
  /** The underlying Hermes cache. */
  protected _queryable: Cache<TSerialized>;
  public watches = new Set<CacheInterface.WatchOptions>();
  public readonly policies: Policies;
  public readonly config: CacheContext.Configuration<TSerialized> | undefined;

  private addTypename: boolean;
  private storeReader!: StoreReader;
  private storeWriter!: StoreWriter;
  private addTypenameTransform = new DocumentTransform(addTypenameToDocument);
  private maybeBroadcastWatch!: OptimisticWrapperFunction<
      [CacheInterface.WatchOptions, Pick<
          BatchOptions<Hermes<TSerialized>>,
          'optimistic' | 'onWatchUpdated'
      >?],
      any,
      [CacheInterface.WatchOptions]
  >;

  public readonly makeVar = makeVar;

  private data!: EntityStore;
  private optimisticData!: EntityStore;
  private init() {
    // Passing { resultCaching: false } in the InMemoryCache constructor options
    // will completely disable dependency tracking, which will improve memory
    // usage but worsen the performance of repeated reads.
    const rootStore = (this.data = new Root({
      policies: this.policies,
      resultCaching: this.config?.resultCaching,
    }));

    // When no optimistic writes are currently active, cache.optimisticData ===
    // cache.data, so there are no additional layers on top of the actual data.
    // When an optimistic update happens, this.optimisticData will become a
    // linked list of EntityStore Layer objects that terminates with the
    // original this.data cache object.
    this.optimisticData = rootStore.stump;

    this.resetResultCache();
  }

  constructor(configuration?: CacheContext.Configuration<TSerialized>) {
    super();
    this._queryable = new Cache<TSerialized>(configuration, this);
    this.policies = new Policies({
      cache: this as unknown as InMemoryCache,
      dataIdFromObject: this._queryable.entityIdForValue,
      possibleTypes: configuration?.possibleTypes,
      typePolicies: this._queryable.typePolicies,
    });
    this.config = configuration;
    this.addTypename = !!configuration?.addTypename;
    this.resetResultCache();
  }

  private resetResultCache(resetResultIdentities?: boolean) {
    const previousReader = this.storeReader;
    const fragments = this.config?.fragments;

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
        resultCacheMaxSize: this.config?.resultCacheMaxSize,
        canonizeResults: this.config && shouldCanonizeResults(this.config),
        canon:
              resetResultIdentities ? void 0 : (
                previousReader && previousReader.canon
              ),
        fragments,
      })),
      fragments
    );

    this.maybeBroadcastWatch = wrap(
      (c: CacheInterface.WatchOptions, options?: Pick<
            BatchOptions<Hermes<TSerialized>>,
            'optimistic' | 'onWatchUpdated'
        >) => {
        return this._queryable.broadcastWatches(options);
      },
      {
        max:
              this.config?.resultCacheMaxSize ||
              cacheSizes['inMemoryCache.maybeBroadcastWatch'] ||
              defaultCacheSizes['inMemoryCache.maybeBroadcastWatch'],
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
  }

  // This method is wrapped by maybeBroadcastWatch, which is called by
  // broadcastWatches, so that we compute and broadcast results only when
  // the data that would be broadcast might have changed. It would be
  // simpler to check for changes after recomputing a result but before
  // broadcasting it, but this wrapping approach allows us to skip both
  // the recomputation and the broadcast, in most cases.
  private broadcastWatch(c: CacheInterface.WatchOptions, options?: Pick<
    BatchOptions<Hermes<TSerialized>>,
    'optimistic' | 'onWatchUpdated'
  >) {
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

  get txCount(): number {
    return this._txCount;
  }

  private addTypenameToDocument(document: DocumentNode) {
    if (this.addTypename) {
      return this.addTypenameTransform.transformDocument(document);
    }
    return document;
  }

  private addFragmentsToDocument(document: DocumentNode) {
    const fragments = this.config?.fragments;
    return fragments ? fragments.transform(document) : document;
  }

  identify(object: StoreObject | Reference): string | undefined {
    return this._queryable.identify(object);
  }

  // TODO (yuisu): data can be typed better with update of ApolloCache API
  restore(data: any, migrationMap?: MigrationMap, verifyOptions?: CacheInterface.ReadOptions): Hermes<TSerialized> {
    const verifyQuery = verifyOptions && buildRawOperationFromQuery(verifyOptions.query, verifyOptions.variables);
    this._queryable.restore(data, migrationMap, verifyQuery);
    return this;
  }

  // TODO (yuisu): return can be typed better with update of ApolloCache API
  extract(optimistic: boolean = false, pruneOptions?: CacheInterface.ReadOptions): any {
    const pruneQuery = pruneOptions && buildRawOperationFromQuery(pruneOptions.query, pruneOptions.variables);
    return this._queryable.extract(optimistic, pruneQuery);
  }

  reset(): Promise<void> {
    return this._queryable.reset();
  }

  removeOptimistic(id: string): void {
    this._queryable.rollback(id);
  }

  performTransaction(transaction: Transaction<TSerialized>, optimisticId?: string | null): void;
  performTransaction(
    transaction: Transaction<TSerialized>,
    optimisticId?: string | null,
    onWatchUpdated?: BatchOptions<any>['onWatchUpdated'],
    broadcast?: boolean,
  ): void;

  performTransaction(
    transaction: Transaction<TSerialized>,
    optimisticId?: string | null,
    onWatchUpdated?: BatchOptions<any>['onWatchUpdated'],
    broadcast: boolean = true,
  ): void {
    this._queryable.transaction(broadcast, optimisticId, t => transaction(new ApolloTransaction<TSerialized>(t)), onWatchUpdated);
  }

  recordOptimisticTransaction(transaction: Transaction<TSerialized>, id: string): void {
    this._queryable.transaction(true, id, t => transaction(new ApolloTransaction(t)));
  }

  watch(options: CacheInterface.WatchOptions): () => void {
    const query = buildRawOperationFromQuery(options.query, options.variables);
    this.watches.add(options);
    const unwatch = this._queryable.watch(query, options);
    return () => {
      unwatch();
      this.watches.delete(options);
    };
  }

  getCurrentCacheSnapshot(): CacheSnapshot {
    return this._queryable.getSnapshot();
  }

  private _txCount = 0;

  public batch<TUpdateResult>(
    options: CacheInterface.BatchOptions<Hermes<TSerialized>, TUpdateResult>
  ): TUpdateResult {
    const {
      update,
      optimistic = true,
      onWatchUpdated,
    } = options;

    const optimisticId
      = typeof optimistic === 'string'
        ? optimistic
        : optimistic ? undefined : null;

    const alreadyDirty = new Set<CacheInterface.WatchOptions>();

    const willWatch = onWatchUpdated && !this._txCount;
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

    ++this._txCount;
    try {
      this.performTransaction(
        () => (updateResult = update(this)),
        optimisticId,
        onWatchUpdated,
        !willWatch,
      );
    } finally {
      --this._txCount;
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

  protected broadcastWatches(options?: Pick<
    BatchOptions<Hermes<TSerialized>>,
    'optimistic' | 'onWatchUpdated'
  >) {
    this._queryable.broadcastWatches(options);
  }

  gc(): string[] {
    return this._queryable.gc();
  }

  retain(id: NodeId) {
    return this._queryable.retain(id);
  }

  release(id: NodeId) {
    return this._queryable.release(id);
  }
}
