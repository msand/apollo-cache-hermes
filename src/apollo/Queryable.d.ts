import { ApolloCache, Cache, Reference } from '@apollo/client';
import { Queryable } from '../Queryable';
import { NodeId } from '../schema';
import { DocumentNode } from '../util';
/**
 * Apollo-specific interface to the cache.
 */
export declare abstract class ApolloQueryable<TSerialized> extends ApolloCache<TSerialized> {
    /** The underlying Hermes cache. */
    protected abstract _queryable: Queryable;
    diff<T>(query: Cache.DiffOptions): Cache.DiffResult<T>;
    read<TData = any, TVariables = any>(query: Cache.ReadOptions<TVariables, TData>): TData | null;
    readQuery<QueryType, TVariables = any>(options: Cache.ReadQueryOptions<QueryType, TVariables>, optimistic?: boolean): QueryType | null;
    readFragment<FragmentType, TVariables = any>(options: Cache.ReadFragmentOptions<FragmentType, TVariables>, optimistic?: boolean): FragmentType | null;
    modify<Entity extends Record<string, any> = Record<string, any>>(options: Cache.ModifyOptions<Entity>): boolean;
    write(options: Cache.WriteOptions): Reference | undefined;
    writeQuery<TData = any, TVariables = any>(options: Cache.WriteQueryOptions<TData, TVariables>): Reference | undefined;
    writeFragment<TData = any, TVariables = any>(options: Cache.WriteFragmentOptions<TData, TVariables>): Reference | undefined;
    transformDocument(doc: DocumentNode): DocumentNode;
    transformForLink(document: DocumentNode): DocumentNode;
    evict(options: Cache.EvictOptions): boolean;
    batchEvict(ids: Iterable<NodeId>, broadcast?: boolean): boolean;
}
//# sourceMappingURL=Queryable.d.ts.map