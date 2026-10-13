import type { Cache } from '@apollo/client/cache';
import isEqual from '@wry/equality';

import { CacheContext } from '../context';
import { GraphSnapshot } from '../GraphSnapshot';
import { JsonObject } from '../primitive';
import { NodeId, RawOperation } from '../schema';
import { Hermes } from '../apollo';

import { QueryResult, read, toDiffResult } from './read';

type WatchOptions = Cache.WatchOptions;

/**
 * Observes a query, triggering a callback when nodes within it have changed.
 *
 * @internal
 */
export class QueryObserver<TSerialized> {
  /** Cache configuration/context to use when executing queries. */
  private _context: CacheContext<TSerialized>;
  /** The query being observed. */
  private _query: RawOperation;
  /** The most recent result */
  private _result: QueryResult;
  /** The most recent result, as the Cache.DiffResult delivered to the callback. */
  private _diff: Cache.DiffResult<unknown> | undefined;
  /** The callback to trigger when observed nodes have changed. */
  private _options: WatchOptions;
  /** Whether the next broadcast should re-read the query regardless of edits. */
  private _dirty = false;
  /** Whether onWatchUpdated cancelled delivering the last computed result. */
  private _cancelled = false;

  constructor(context: CacheContext<TSerialized>, query: RawOperation, snapshot: GraphSnapshot, options: WatchOptions) {
    this._context = context;
    this._query = query;
    this._options = options;
    if (options.immediate) {
      this._result = read(context, query, snapshot, Object.create(null), context.strict);
      this._diff = toDiffResult(this._result, options.returnPartialData);
      options.lastDiff = this._diff;
      this._update();
    } else {
      this._result = {
        complete: false,
      };
    }
  }

  /** The watch options this observer was created with. */
  get options(): WatchOptions {
    return this._options;
  }

  /**
   * Makes the next broadcast re-read the query (and deliver a result that
   * differs from the last one), like InMemoryCache's maybeBroadcastWatch.dirty.
   */
  markDirty(): void {
    this._dirty = true;
  }

  /** The id of the node the observed query is rooted at. */
  get rootId(): NodeId {
    return this._query.rootId;
  }

  /** Whether the observer reads optimistic data. */
  get optimistic(): boolean {
    return !!this._options.optimistic;
  }

  /**
   * We expect the cache to tell us whenever there is a new snapshot, and which
   * nodes have changed.
   */
  consumeChanges(
    snapshot: GraphSnapshot,
    changedNodeIds: Set<NodeId>,
    cacheInstance: Hermes<TSerialized>,
    onWatchUpdated?: Cache.BatchOptions<Hermes<TSerialized>>['onWatchUpdated'],
    fromOptimisticTransaction?: boolean,
    changedRootFields?: Map<NodeId, Set<string>>,
  ): void {
    const lastDiff = this._options.lastDiff;
    // Like InMemoryCache's memoized maybeBroadcastWatch, skip watches whose
    // last computed result (delivered, or cancelled by onWatchUpdated) is
    // unaffected by the changes.
    if ((lastDiff || this._cancelled) && !this._dirty && !this._hasUpdate(changedNodeIds, changedRootFields)) {
      return;
    }
    this._dirty = false;
    this._cancelled = false;
    // Note that if strict mode is disabled, we _do not_ ask for node ids.
    //
    // This effectively circumvents the logic in _hasUpdate (entityIds will be
    // undefined).
    const operation = this._context.parseOperation(this._query);
    const readResult = read(this._context, this._query, snapshot, Object.create(null), this._context.strict);
    this._result = readResult;
    // Like InMemoryCache (and Hermes#diff), the watch's diff has a null result
    // when incomplete, unless partial data is requested and some was found.
    let diff = toDiffResult(readResult, this._options.returnPartialData);
    if (fromOptimisticTransaction) diff = { ...diff, fromOptimisticTransaction };
    this._diff = diff;
    const result = diff.result as JsonObject | null;
    this._options.lastDiff = diff;
    const rootKeys = Object.keys(operation.parsedQuery);
    const lastResult = lastDiff?.result as JsonObject | null | undefined;
    // Skip empty incomplete results, unless they are the watcher's first result (like
    // InMemoryCache, which delivers a watch's first diff), or replace data the watcher has seen
    // (e.g. after evicting every root field), so Apollo can refetch like it does with InMemoryCache.
    const hadRootKeys = !!lastResult && rootKeys.some(key => key in lastResult);
    if (lastDiff && !diff.complete && (!result || !rootKeys.some(key => key in result)) && !hadRootKeys) {
      return;
    }
    const sameAsBefore = result && lastResult && rootKeys.every(key => isEqual(result[key], lastResult[key]));
    // Changed (or invalidated) fields call onWatchUpdated even if the result is
    // unchanged.
    const dirtyKeys = (changedRootFields ?? this._context.dirty).get(operation.rootId);
    if (sameAsBefore && !(dirtyKeys && rootKeys.some(key => dirtyKeys.has(key)))) {
      return;
    }
    const shouldCancel = onWatchUpdated?.call(cacheInstance, this._options, diff, lastDiff) === false;
    if (shouldCancel) {
      // Returning false from the onWatchUpdated callback will prevent
      // calling c.callback(diff) for this watcher.  Like InMemoryCache, the
      // watch keeps its last diff, so a later broadcast still delivers this
      // result.
      this._options.lastDiff = lastDiff;
      this._cancelled = true;
      return;
    }
    if (sameAsBefore) {
      return;
    }
    this._update();
  }

  /**
   * Whether there are any changed nodes that overlap with the ones we're
   * observing.
   *
   * If the fields changed on the root node are known, a root node change only
   * counts if it is to a field we select (like InMemoryCache's field-level
   * dependency tracking), unless field policies may read other fields.
   */
  private _hasUpdate(_changedNodeIds: Set<NodeId>, changedRootFields?: Map<NodeId, Set<string>>): boolean {
    const { complete, entityIds, dynamicNodeIds } = this._result!;
    if (!complete) return true;
    // We can't know if we have no ids to test against. Favor updating.
    if (!entityIds) return true;

    const { rootId } = this._query;
    for (const nodeId of _changedNodeIds) {
      if (!entityIds.has(nodeId) && !(dynamicNodeIds && dynamicNodeIds.has(nodeId))) continue;
      if (
        nodeId === rootId &&
        changedRootFields &&
        // Field policies may make the result depend on any field (e.g. a
        // read function reading other fields), rather than just the selected ones.
        !this._context.policies.hasFieldPolicies &&
        !this._selectsAny(changedRootFields.get(rootId))
      ) {
        continue;
      }
      return true;
    }

    return false;
  }

  /**
   * Whether the query selects any of the given fields of its root node.
   */
  private _selectsAny(fields: Set<string> | undefined): boolean {
    if (!fields || !fields.size) return false;
    const { parsedQuery } = this._context.parseOperation(this._query);
    for (const key of Object.keys(parsedQuery)) {
      if (fields.has(key) || fields.has(parsedQuery[key].schemaName!)) return true;
    }
    return false;
  }

  /**
   * Trigger the callback.
   */
  private _update(): void {
    this._options.callback(this._diff!);
  }
}
