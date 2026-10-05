import { Transaction, Cache as CacheInterface } from '@apollo/client';
import { Reference, StoreObject } from '@apollo/client/utilities';
import { CacheContext } from '../context';
import { Cache, MigrationMap } from '../Cache';
import { CacheSnapshot } from '../CacheSnapshot';
import { GraphSnapshot } from '../GraphSnapshot';
import { NodeId } from '../schema';
import { ApolloQueryable } from './Queryable';
import BatchOptions = CacheInterface.BatchOptions;
/**
 * Apollo-specific interface to the cache.
 */
export declare class Hermes<TSerialized = GraphSnapshot> extends ApolloQueryable<TSerialized> {
    /** The underlying Hermes cache. */
    protected _queryable: Cache<TSerialized>;
    watches: Set<CacheInterface.WatchOptions<any, any>>;
    constructor(configuration?: CacheContext.Configuration<TSerialized>);
    identify(object: StoreObject | Reference): string | undefined;
    restore(data: any, migrationMap?: MigrationMap, verifyOptions?: CacheInterface.ReadOptions): Hermes<TSerialized>;
    extract(optimistic?: boolean, pruneOptions?: CacheInterface.ReadOptions): any;
    reset(): Promise<void>;
    removeOptimistic(id: string): void;
    performTransaction(transaction: Transaction<TSerialized>, optimisticId?: string | null): void;
    performTransaction(transaction: Transaction<TSerialized>, optimisticId?: string | null, onWatchUpdated?: BatchOptions<any>['onWatchUpdated'], broadcast?: boolean): void;
    recordOptimisticTransaction(transaction: Transaction<TSerialized>, id: string): void;
    watch(options: CacheInterface.WatchOptions): () => void;
    getCurrentCacheSnapshot(): CacheSnapshot;
    private _txCount;
    batch<TUpdateResult>(options: CacheInterface.BatchOptions<Hermes<TSerialized>, TUpdateResult>): TUpdateResult;
    protected broadcastWatches(options?: Pick<BatchOptions<Hermes<TSerialized>>, 'optimistic' | 'onWatchUpdated'>): void;
    gc(): string[];
    retain(id: NodeId): number;
    release(id: NodeId): number;
}
//# sourceMappingURL=Hermes.d.ts.map