import { Cache as CacheInterface } from '@apollo/client';
import { Reference, StoreObject } from '@apollo/client/utilities';
import { invariant } from '@apollo/client/utilities/globals';

import { CacheSnapshot } from './CacheSnapshot';
import { ChangedFields, CacheTransaction, TransactionHooks } from './CacheTransaction';
import { CacheContext } from './context';
import { GraphSnapshot, NodeSnapshotMap } from './GraphSnapshot';
import { extract, migrate, MigrationMap, prune, QueryObserver, read, restore } from './operations';
import { OptimisticUpdate, OptimisticUpdateQueue } from './OptimisticUpdateQueue';
import { JsonObject, JsonValue } from './primitive';
import { Queryable } from './Queryable';
import { ChangeId, NodeId, RawOperation, Serializable, StaticNodeId } from './schema';
import { addToSet, DocumentNode, hasOwn, setsHaveSomeIntersection } from './util';
import { UnsatisfiedCacheError } from './errors';
import { Hermes } from './apollo';
import { NodeReference } from './nodes';
import { isUncaughtWriteError, missingKeyField, missingKeyFieldError } from './operations/checkWrite';

import BatchOptions = CacheInterface.BatchOptions;

export { MigrationMap };
export type TransactionCallback<TSerialized> = (transaction: CacheTransaction<TSerialized>) => any;

/**
 * The Hermes cache.
 *
 * @see https://github.com/apollographql/apollo-client/issues/1971
 * @see https://github.com/apollographql/apollo-client/blob/2.0-alpha/src/data/cache.ts
 */
export class Cache<TSerialized = GraphSnapshot> implements Queryable {
  /** The cache-wide configuration. */
  private _context: CacheContext<TSerialized>;

  /** The current version of the cache. */
  private _snapshot: CacheSnapshot;

  /** All active query observers. */
  private _observers: QueryObserver<TSerialized>[] = [];
  private _cacheInstance: Hermes<TSerialized> | undefined;
  private _transactions: CacheTransaction<TSerialized>[] = [];
  /**
   * Whether the snapshot changed outside of a transaction (restore, reset)
   * since the last broadcast, so the changed fields of the watched root nodes
   * (in CacheContext#dirty) are not known.
   */
  private _fieldsUntracked = false;
  /** The fields of watched root nodes changed since the last broadcast. */
  private _changedFields: ChangedFields = { baseline: new Map(), optimistic: new Map() };
  private _editedNodeIds: Set<NodeId> = new Set();

  constructor(
    configuration: CacheContext.Configuration<TSerialized> | undefined,
    cacheInstance: Hermes<TSerialized> | undefined = undefined,
  ) {
    const initialGraphSnapshot = new GraphSnapshot();
    this._snapshot = new CacheSnapshot(initialGraphSnapshot, initialGraphSnapshot, new OptimisticUpdateQueue());
    this._context = new CacheContext(configuration);
    this._cacheInstance = cacheInstance;
  }

  // Maps root entity IDs to the number of times they have been retained, minus
  // the number of times they have been released. Retained entities keep other
  // entities they reference (even indirectly) from being garbage collected.
  private _rootIds: {
    [rootId: string]: number;
  } = Object.create(null);

  public retain(rootId: string): number {
    return (this._rootIds[rootId] = (this._rootIds[rootId] || 0) + 1);
  }

  public release(rootId: string): number {
    if (this._rootIds[rootId] > 0) {
      const count = --this._rootIds[rootId];
      if (!count) delete this._rootIds[rootId];
      return count;
    }
    return 0;
  }

  // Return a Set<string> of all the ID strings that have been retained by
  // this layer/root *and* any layers/roots beneath it.
  public getRootIdSet(ids = new Set<string>()) {
    Object.keys(this._rootIds).forEach(ids.add, ids);
    ids.add(StaticNodeId.QueryRoot);
    ids.add(StaticNodeId.MutationRoot);
    return ids;
  }

  // The goal of garbage collection is to remove IDs from the Root layer of the
  // store that are no longer reachable starting from any IDs that have been
  // explicitly retained (see retain and release, above). Returns an array of
  // dataId strings that were removed from the store.
  public gc() {
    const ids = this.getRootIdSet();
    const addRef = (ref: NodeReference) => ids.add(ref.id);
    const addRefs = (refs: NodeReference[]) => refs.forEach(addRef);
    const snapshot = { ...this._snapshot.optimistic._values };
    ids.forEach(id => {
      if (hasOwn.call(snapshot, id)) {
        // Because we are iterating over an ECMAScript Set, the IDs we add here
        // will be visited in later iterations of the forEach loop only if they
        // were not previously contained by the Set.
        const node = snapshot[id];
        node.outbound?.forEach(addRef);
        node.parameterized?.forEach(addRefs);
        // By removing IDs from the snapshot object here, we protect them from
        // getting removed from the root store layer below.
        delete snapshot[id];
      }
    });
    const idsToRemove = Object.keys(snapshot);

    if (idsToRemove.length) {
      this.transaction(false, t => {
        // Like InMemoryCache, only the baseline (root layer) is collected.
        t.batchEvict(idsToRemove, false);
      });
    }
    return idsToRemove;
  }

  identify(object: StoreObject | Reference): string | undefined {
    const id = this._context.entityIdForValue(object);
    if (id === undefined && (globalThis as { __DEV__?: boolean }).__DEV__ !== false && object) {
      // Like InMemoryCache, warn about objects missing their keyFields.
      const keyField = missingKeyField(this._context, object as JsonObject);
      if (keyField !== undefined) invariant.warn(missingKeyFieldError(keyField, object as JsonObject));
    }
    return id;
  }

  transformDocument(document: DocumentNode): DocumentNode {
    return this._context.transformDocument(document);
  }

  restore(data: Serializable.GraphSnapshot, migrationMap?: MigrationMap, verifyQuery?: RawOperation) {
    const { cacheSnapshot, editedNodeIds } = restore(data, this._context);
    const migrated = migrate(cacheSnapshot, migrationMap);
    if (verifyQuery && !read(this._context, verifyQuery, migrated.baseline, Object.create(null), false).complete) {
      throw new UnsatisfiedCacheError(`Restored cache cannot satisfy the verification query`);
    }
    this._fieldsUntracked = true;
    this._setSnapshot(migrated, editedNodeIds);
  }

  extract(optimistic: boolean, pruneQuery?: RawOperation): Serializable.GraphSnapshot {
    // Like InMemoryCache, extracting during a transaction shows its pending
    // edits (and an optimistic transaction's layer, even when not optimistic).
    const activeTx = this._transactions[this._transactions.length - 1];
    const current = activeTx ? activeTx.getSnapshot() : this._snapshot;
    const useOptimistic = activeTx ? activeTx.readsOptimistic(optimistic) : optimistic;
    const cacheSnapshot = useOptimistic ? current.optimistic : current.baseline;
    return extract(
      pruneQuery ? prune(this._context, cacheSnapshot, pruneQuery).snapshot : cacheSnapshot,
      this._context,
    );
  }

  /**
   * Reads the selection expressed by a query from the cache.
   *
   * TODO: Can we drop non-optimistic reads?
   * https://github.com/apollographql/apollo-client/issues/1971#issuecomment-319402170
   */
  read(query: RawOperation, optimistic?: boolean): CacheInterface.DiffResult<JsonValue> {
    // TODO: Can we drop non-optimistic reads?
    // https://github.com/apollographql/apollo-client/issues/1971#issuecomment-319402170
    // Like InMemoryCache, reads made during a transaction see its pending writes.
    const activeTx = this._transactions[this._transactions.length - 1];
    if (activeTx) return activeTx.read(query, optimistic);
    const tempStore: NodeSnapshotMap = Object.create(null);
    const result = read(
      this._context,
      query,
      optimistic ? this._snapshot.optimistic : this._snapshot.baseline,
      tempStore,
    );
    const newKeys = Object.keys(tempStore);
    if (newKeys.length) {
      this.transaction(true, t => {
        t.merge(tempStore);
      });
    }
    return result;
  }

  /**
   * Retrieves the current value of the entity identified by `id`.
   */
  getEntity(id: NodeId) {
    return this._snapshot.optimistic.getNodeData(id);
  }

  /**
   * Registers a callback that should be triggered any time the nodes selected
   * by a particular query have changed.
   */
  watch(query: RawOperation, options: CacheInterface.WatchOptions | CacheInterface.WatchCallback): () => void {
    if (typeof options === 'function') {
      options = {
        callback: options,
        immediate: true,
        optimistic: true,
        query: query.document,
      };
    }
    const snapshot = options.optimistic ? this._snapshot.optimistic : this._snapshot.baseline;
    const observer = new QueryObserver(this._context, query, snapshot, options);
    this._observers.push(observer);

    return () => this._removeObserver(observer);
  }

  modify<Entity extends Record<string, unknown>>(options: CacheInterface.ModifyOptions<Entity>): boolean {
    return this.transaction(options.broadcast ?? true, t => t.modify(options));
  }

  /**
   * Writes values for a selection to the cache.
   */
  write(query: RawOperation, payload: JsonObject, broadcast: boolean | undefined = true): Reference | undefined {
    let ref;
    this.transaction(broadcast, t => {
      ref = t.write(query, payload);
    });
    return ref;
  }

  /**
   * Allows the caller to perform a set of changes to the cache in a
   * transactional manner.
   *
   * If a changeId is provided, the transaction will be recorded as an
   * optimistic update.
   *
   * Returns whether the transaction was successful.
   */
  transaction(broadcast: boolean | undefined, callback: TransactionCallback<TSerialized>): boolean;

  transaction(
    broadcast: boolean | undefined,
    changeIdOrCallback: ChangeId,
    callback: TransactionCallback<TSerialized>,
  ): boolean;

  transaction(
    broadcast: boolean | undefined,
    changeIdOrCallback: ChangeId | null | undefined,
    callback: TransactionCallback<TSerialized>,
    onWatchUpdated?: BatchOptions<Hermes<TSerialized>>['onWatchUpdated'],
  ): boolean;

  transaction(
    broadcast: boolean | undefined,
    changeIdOrCallback: ChangeId | TransactionCallback<TSerialized> | undefined | null,
    callback?: TransactionCallback<TSerialized>,
    onWatchUpdated?: CacheInterface.BatchOptions<Hermes<TSerialized>>['onWatchUpdated'],
  ): boolean {
    const { tracer } = this._context;

    let changeId;
    if (typeof callback !== 'function') {
      callback = changeIdOrCallback as TransactionCallback<TSerialized>;
    } else {
      changeId = changeIdOrCallback as ChangeId;
    }

    // A nested non-optimistic transaction is part of the outer one (so its
    // edits build on the outer transaction's pending edits).  Like
    // InMemoryCache, inside an optimistic transaction it writes into that
    // optimistic layer rather than the baseline.
    const outerTx = this._transactions[this._transactions.length - 1];
    if (outerTx && changeId == null) {
      const nestedResult = callback(outerTx);
      return typeof nestedResult === 'boolean' ? nestedResult : true;
    }

    let tracerContext;
    if (tracer.transactionStart) {
      tracerContext = tracer.transactionStart();
    }

    const transaction = new CacheTransaction(
      this._context,
      outerTx ? outerTx.getSnapshot() : this._snapshot,
      changeId,
      this._transactionHooks(),
    );
    this._transactions.push(transaction);
    let result;
    try {
      result = callback(transaction);
    } catch (error) {
      if (tracer.transactionEnd) {
        if (error instanceof Error) {
          tracer.transactionEnd(error.toString(), tracerContext);
        } else {
          tracer.transactionEnd('unknown error', tracerContext);
        }
      }
      // Like InMemoryCache, some write errors (e.g. missing keyFields) reach the caller.
      if (isUncaughtWriteError(error)) throw error;
      return false;
    } finally {
      this._transactions.pop();
    }

    const { snapshot, editedNodeIds, writtenRootIds } = transaction.commit(callback);
    // Like InMemoryCache, the ids that data is written to explicitly are
    // retained, as roots for garbage collection.
    writtenRootIds.forEach(id => this.retain(id));
    this._setSnapshot(snapshot, editedNodeIds, broadcast, onWatchUpdated);

    if (this._transactions.length) {
      const outer = this._transactions[this._transactions.length - 1];
      outer.markEditedNodeIds(editedNodeIds);
      outer.setSnapshot(snapshot);
    }

    if (tracer.transactionEnd) {
      tracer.transactionEnd(undefined, tracerContext);
    }

    return typeof result === 'boolean' ? result : editedNodeIds.size > 0;
  }

  private _transactionHooks(): TransactionHooks {
    return {
      replayOptimisticUpdate: this._replayOptimisticUpdate,
      watchedRootIds: this._observers.length ? new Set(this._observers.map(o => o.rootId)) : undefined,
      changedFields: this._changedFields,
    };
  }

  /**
   * Re-runs an optimistic update's callback on top of a snapshot, like
   * InMemoryCache re-adds the layers above a removed one.  Reads and writes
   * made through the cache while it runs see the update's own transaction.
   */
  private _replayOptimisticUpdate = (snapshot: CacheSnapshot, update: OptimisticUpdate) => {
    const { tracer } = this._context;
    let tracerContext;
    if (tracer.transactionStart) {
      tracerContext = tracer.transactionStart();
    }

    const transaction = new CacheTransaction(this._context, snapshot, update.id, this._transactionHooks());
    this._transactions.push(transaction);
    try {
      update.callback!(transaction);
    } catch (error) {
      if (tracer.transactionEnd) {
        tracer.transactionEnd(error instanceof Error ? error.toString() : 'unknown error', tracerContext);
      }
      // Keep the update (without its edits), so it is retried if re-run again.
      const optimisticQueue = snapshot.optimisticQueue.enqueue(update.id, [], update.callback);
      return {
        snapshot: new CacheSnapshot(snapshot.baseline, snapshot.optimistic, optimisticQueue),
        editedNodeIds: new Set<NodeId>(),
      };
    } finally {
      this._transactions.pop();
    }

    const result = transaction.commit(update.callback);
    if (tracer.transactionEnd) {
      tracer.transactionEnd(undefined, tracerContext);
    }
    return result;
  };

  /**
   * Roll back a previously enqueued optimistic update.
   */
  rollback(changeId: ChangeId) {
    // Like InMemoryCache, removing an unknown update changes (and broadcasts)
    // nothing.
    const activeTx = this._transactions[this._transactions.length - 1];
    const { optimisticQueue } = activeTx ? activeTx.getSnapshot() : this._snapshot;
    if (!optimisticQueue.has(changeId)) return;
    this.transaction(true, t => t.rollback(changeId));
  }

  getSnapshot(): CacheSnapshot {
    return this._snapshot;
  }

  /**
   * Resets all data tracked by the cache.
   */
  async reset(): Promise<void> {
    const allIds = new Set(this._snapshot.optimistic.allNodeIds());

    const baseline = new GraphSnapshot();
    const optimistic = baseline;
    const optimisticQueue = new OptimisticUpdateQueue();
    this._rootIds = Object.create(null);

    this._fieldsUntracked = true;
    this._setSnapshot(new CacheSnapshot(baseline, optimistic, optimisticQueue), allIds);
  }

  // Internal

  /**
   * Unregister an observer.
   */
  private _removeObserver(observer: QueryObserver<TSerialized>): void {
    const index = this._observers.findIndex(o => o === observer);
    if (index < 0) return;
    this._observers.splice(index, 1);
  }

  /**
   * Point the cache to a new snapshot, and let observers know of the change.
   * Call onChange callback if one exist to notify cache users of any change.
   */
  private _setSnapshot(
    snapshot: CacheSnapshot,
    editedNodeIds: Set<NodeId>,
    broadcast: boolean | undefined = true,
    onWatchUpdated?: BatchOptions<Hermes<TSerialized>>['onWatchUpdated'],
  ): void {
    const lastSnapshot = this._snapshot;
    this._snapshot = snapshot;

    if (lastSnapshot) {
      const { strict } = this._context;
      _copyUnaffectedCachedReads(lastSnapshot.baseline, snapshot.baseline, editedNodeIds, strict);
      // Don't bother copying the optimistic read cache unless it's actually a
      // different snapshot.
      if (snapshot.optimistic !== snapshot.baseline) {
        _copyUnaffectedCachedReads(lastSnapshot.optimistic, snapshot.optimistic, editedNodeIds, strict);
      }
    }

    if (broadcast === false) {
      addToSet(this._editedNodeIds, editedNodeIds);
      return;
    }

    if (this._transactions.length) {
      // Only broadcast after last transaction finishes
      return;
    }

    this._broadcastWatches(editedNodeIds, onWatchUpdated);

    if (this._context.onChange) {
      this._context.onChange(this._snapshot, editedNodeIds);
    }
  }

  /**
   * Makes the next broadcast re-read the given watches.
   */
  public dirtyWatches(watches: Set<CacheInterface.WatchOptions>) {
    for (const observer of this._observers) {
      if (watches.has(observer.options)) observer.markDirty();
    }
  }

  public broadcastWatches(options?: Pick<BatchOptions<Hermes<TSerialized>>, 'optimistic' | 'onWatchUpdated'>) {
    // Like InMemoryCache, watches are broadcast once the outermost transaction
    // (e.g. an optimistic update, which may run cache.batch) completes.
    if (this._transactions.length) return;
    this._broadcastWatches(this._editedNodeIds, options?.onWatchUpdated, options?.optimistic);
  }

  private _broadcastWatches(
    editedNodeIds: Set<NodeId>,
    onWatchUpdated?: BatchOptions<Hermes<TSerialized>>['onWatchUpdated'],
    optimistic?: string | boolean,
  ) {
    const snapshot = this._snapshot;

    let tracerContext;
    if (this._context.tracer.broadcastStart) {
      tracerContext = this._context.tracer.broadcastStart({ snapshot, editedNodeIds });
    }

    // Like InMemoryCache, each watch reads the optimistic or the baseline data,
    // as it asked; broadcasts for an optimistic batch flag optimistic diffs.
    const fromOptimisticTransaction = typeof optimistic === 'string';
    // Like InMemoryCache, watches of baseline data are not affected by changes
    // to optimistic data only.  Invalidated fields count as changed for all.
    let baselineFields: Map<NodeId, Set<string>> | undefined;
    let optimisticFields: Map<NodeId, Set<string>> | undefined;
    if (!this._fieldsUntracked) {
      const { dirty } = this._context;
      baselineFields = mergeFieldMaps(this._changedFields.baseline, dirty);
      optimisticFields = mergeFieldMaps(baselineFields, this._changedFields.optimistic);
    }
    for (const observer of this._observers) {
      const graphSnapshot = observer.optimistic ? snapshot.optimistic : snapshot.baseline;
      observer.consumeChanges(
        graphSnapshot,
        editedNodeIds,
        this._cacheInstance!,
        onWatchUpdated,
        fromOptimisticTransaction && observer.optimistic,
        observer.optimistic ? optimisticFields : baselineFields,
      );
    }

    this._context.dirty.clear();
    this._fieldsUntracked = false;
    this._changedFields = { baseline: new Map(), optimistic: new Map() };

    if (this._context.tracer.broadcastEnd) {
      this._context.tracer.broadcastEnd({ snapshot, editedNodeIds }, tracerContext);
    }
  }

  evict(options: CacheInterface.EvictOptions): boolean {
    return this.transaction(options.broadcast ?? true, t => t.evict(options));
  }

  /**
   * Evicts several entities in one transaction and one snapshot edit; see
   * CacheTransaction#batchEvict.
   */
  batchEvict(ids: Iterable<NodeId>, broadcast: boolean = true): boolean {
    return this.transaction(broadcast, t => t.batchEvict(ids));
  }
}

/**
 * Preserves cached reads for any queries that do not overlap with the edited
 * entities in the new snapshot.
 *
 * TODO: Can we special case ROOT_QUERY somehow; any fields hanging off of it
 * tend to aggressively bust the cache, when we don't really mean to.
 */
function _copyUnaffectedCachedReads(
  lastSnapshot: GraphSnapshot,
  nextSnapshot: GraphSnapshot,
  editedNodeIds: Set<NodeId>,
  strict: boolean,
) {
  for (const [operation, result] of lastSnapshot.readCache) {
    const { complete, entityIds, dynamicNodeIds } = result;
    // We don't care about incomplete results.
    if (!complete) continue;

    // If we're not in strict mode; we can carry completeness forward (and
    // not bother copying results forward, as its cheaper to just fetch again).
    if (!strict) {
      nextSnapshot.readCache.set(operation, { complete: true });
      continue;
    }

    // Nor queries where we don't know which nodes were affected.
    if (!entityIds) continue;

    // If any nodes in the cached read were edited, do not copy.
    if (entityIds && setsHaveSomeIntersection(editedNodeIds, entityIds)) continue;
    // If any dynamic nodes were edited, also do not copy.
    if (dynamicNodeIds && setsHaveSomeIntersection(editedNodeIds, dynamicNodeIds)) continue;

    nextSnapshot.readCache.set(operation, result);
  }
}

/**
 * Combines two maps of the changed fields per node.
 */
function mergeFieldMaps(a: Map<NodeId, Set<string>>, b: Map<NodeId, Set<string>>) {
  const merged = new Map<NodeId, Set<string>>();
  for (const map of [a, b]) {
    for (const [id, fields] of map) {
      const mergedFields = merged.get(id);
      merged.set(id, mergedFields ? new Set([...mergedFields, ...fields]) : fields);
    }
  }
  return merged;
}
