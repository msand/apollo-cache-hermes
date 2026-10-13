import { Transaction, Cache as CacheInterface, makeVar } from '@apollo/client';
import { isReference, Reference, StoreObject } from '@apollo/client/utilities';

import { CacheContext } from '../context';
import { Cache, MigrationMap } from '../Cache';
import { CacheSnapshot } from '../CacheSnapshot';
import { GraphSnapshot } from '../GraphSnapshot';
import { NodeId, StaticNodeId } from '../schema';

import { ApolloQueryable } from './Queryable';
import { ApolloTransaction } from './Transaction';
import { buildRawOperationFromQuery } from './util';

import BatchOptions = CacheInterface.BatchOptions;

/**
 * Apollo-specific interface to the cache.
 */
export class Hermes<TSerialized = GraphSnapshot> extends ApolloQueryable<TSerialized> {
  /** The underlying Hermes cache. */
  protected _queryable: Cache<TSerialized>;
  public watches = new Set<CacheInterface.WatchOptions>();

  /** Reactive variables bound to this cache, like InMemoryCache#makeVar. */
  public readonly makeVar = makeVar;

  constructor(configuration?: CacheContext.Configuration<TSerialized>) {
    super();
    this._queryable = new Cache<TSerialized>(configuration, this);
  }

  identify(object: StoreObject | Reference): string | undefined {
    if (isReference(object)) return object.__ref;
    if (object?.__typename === 'Query') return StaticNodeId.QueryRoot;
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

  reset(options?: CacheInterface.ResetOptions): Promise<void> {
    // Like InMemoryCache, discardWatches cancels every watch.
    if (options?.discardWatches) {
      this.watches.clear();
      this._queryable.discardWatches();
    }
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
    this._queryable.transaction(
      broadcast,
      optimisticId,
      t => transaction(new ApolloTransaction<TSerialized>(t)),
      onWatchUpdated,
    );
  }

  recordOptimisticTransaction(transaction: Transaction<TSerialized>, id: string): void {
    this._queryable.transaction(true, id, t => transaction(new ApolloTransaction(t)));
  }

  watch(options: CacheInterface.WatchOptions): () => void {
    const query = buildRawOperationFromQuery(options.query, options.variables, options.id);
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

  public batch<TUpdateResult>(options: CacheInterface.BatchOptions<Hermes<TSerialized>, TUpdateResult>): TUpdateResult {
    const { update, optimistic = true, removeOptimistic, onWatchUpdated } = options;

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
    // The transaction rolls back if the update throws; like InMemoryCache,
    // batch then throws the error.
    let failure: { error: unknown } | undefined;

    const perform = () => {
      try {
        updateResult = update(this);
      } catch (error) {
        failure ??= { error };
        throw error;
      }
    };

    ++this._txCount;
    try {
      this._queryable.transaction(
        !willWatch,
        null,
        t => {
          if (typeof optimistic === 'string') {
            // The update is recorded as an optimistic update, and re-run when
            // an optimistic update beneath it is removed.
            this._queryable.transaction(true, optimistic, perform);
          } else if (optimistic === false) {
            // Like InMemoryCache, optimistic data is invisible to the update.
            t.withBaselineReads(perform);
          } else {
            perform();
          }
          // Like InMemoryCache, drop the optimistic layer after the update
          // (which typically writes the real data), in the same transaction.
          if (typeof removeOptimistic === 'string') this._queryable.rollback(removeOptimistic);
        },
        onWatchUpdated,
      );
    } finally {
      --this._txCount;
    }
    if (failure) throw failure.error;

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
        this._queryable.dirtyWatches(alreadyDirty);
      }
    } else {
      // If alreadyDirty is empty or we don't have an onWatchUpdated
      // function, we don't need to go to the trouble of wrapping
      // options.onWatchUpdated.
      this._queryable.broadcastWatches(options);
    }

    return updateResult!;
  }

  public broadcastWatches(options?: Pick<BatchOptions<Hermes<TSerialized>>, 'optimistic' | 'onWatchUpdated'>) {
    // Like InMemoryCache, watches are broadcast once the outermost batch completes.
    if (this._txCount) return;
    // Reactive variables call broadcastWatches() when they change.
    if (!options) this._queryable.dirtyReactiveReads();
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
