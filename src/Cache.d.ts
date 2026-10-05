import { Cache as CacheInterface } from '@apollo/client';
import { Reference, StoreObject } from '@apollo/client/utilities';
import { CacheSnapshot } from './CacheSnapshot';
import { CacheTransaction } from './CacheTransaction';
import { CacheContext } from './context';
import { GraphSnapshot } from './GraphSnapshot';
import { MigrationMap } from './operations';
import { JsonObject, JsonValue } from './primitive';
import { Queryable } from './Queryable';
import { ChangeId, NodeId, RawOperation, Serializable } from './schema';
import { DocumentNode } from './util';
import { Hermes } from './apollo';
import BatchOptions = CacheInterface.BatchOptions;
export { MigrationMap };
export type TransactionCallback<TSerialized> = (transaction: CacheTransaction<TSerialized>) => any;
/**
 * The Hermes cache.
 *
 * @see https://github.com/apollographql/apollo-client/issues/1971
 * @see https://github.com/apollographql/apollo-client/blob/2.0-alpha/src/data/cache.ts
 */
export declare class Cache<TSerialized = GraphSnapshot> implements Queryable {
    /** The cache-wide configuration. */
    private _context;
    /** The current version of the cache. */
    private _snapshot;
    /** All active query observers. */
    private _observers;
    private _cacheInstance;
    private _transactions;
    private _editedNodeIds;
    constructor(configuration: CacheContext.Configuration<TSerialized> | undefined, cacheInstance?: Hermes<TSerialized> | undefined);
    private _rootIds;
    retain(rootId: string): number;
    release(rootId: string): number;
    getRootIdSet(ids?: Set<string>): Set<string>;
    gc(): string[];
    identify(object: StoreObject | Reference): string | undefined;
    transformDocument(document: DocumentNode): DocumentNode;
    restore(data: Serializable.GraphSnapshot, migrationMap?: MigrationMap, verifyQuery?: RawOperation): void;
    extract(optimistic: boolean, pruneQuery?: RawOperation): Serializable.GraphSnapshot;
    /**
     * Reads the selection expressed by a query from the cache.
     *
     * TODO: Can we drop non-optimistic reads?
     * https://github.com/apollographql/apollo-client/issues/1971#issuecomment-319402170
     */
    read(query: RawOperation, optimistic?: boolean): CacheInterface.DiffResult<JsonValue>;
    /**
     * Retrieves the current value of the entity identified by `id`.
     */
    getEntity(id: NodeId): any;
    /**
     * Registers a callback that should be triggered any time the nodes selected
     * by a particular query have changed.
     */
    watch(query: RawOperation, options: CacheInterface.WatchOptions | CacheInterface.WatchCallback): () => void;
    modify<Entity extends Record<string, unknown>>(options: CacheInterface.ModifyOptions<Entity>): boolean;
    /**
     * Writes values for a selection to the cache.
     */
    write(query: RawOperation, payload: JsonObject, broadcast?: boolean | undefined): Reference | undefined;
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
    transaction(broadcast: boolean | undefined, changeIdOrCallback: ChangeId, callback: TransactionCallback<TSerialized>): boolean;
    transaction(broadcast: boolean | undefined, changeIdOrCallback: ChangeId | null | undefined, callback: TransactionCallback<TSerialized>, onWatchUpdated?: BatchOptions<Hermes<TSerialized>>['onWatchUpdated']): boolean;
    /**
     * Roll back a previously enqueued optimistic update.
     */
    rollback(changeId: ChangeId): void;
    getSnapshot(): CacheSnapshot;
    /**
     * Resets all data tracked by the cache.
     */
    reset(): Promise<void>;
    /**
     * Unregister an observer.
     */
    private _removeObserver;
    /**
     * Point the cache to a new snapshot, and let observers know of the change.
     * Call onChange callback if one exist to notify cache users of any change.
     */
    private _setSnapshot;
    broadcastWatches(options?: Pick<BatchOptions<Hermes<TSerialized>>, 'optimistic' | 'onWatchUpdated'>): void;
    private _broadcastWatches;
    evict(options: CacheInterface.EvictOptions): boolean;
    /**
     * Evicts several entities in one transaction and one snapshot edit; see
     * CacheTransaction#batchEvict.
     */
    batchEvict(ids: Iterable<NodeId>, broadcast?: boolean): boolean;
}
//# sourceMappingURL=Cache.d.ts.map