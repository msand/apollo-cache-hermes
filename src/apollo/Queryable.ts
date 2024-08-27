import { OperationVariables } from '../../apollo-client/src';
import { ApolloCache, Cache, Reference, makeReference, NormalizedCacheObject } from '../../apollo-client/src/cache';
import { removeDirectivesFromDocument } from '../../apollo-client/src/utilities';
import { UnsatisfiedCacheError } from '../errors';
import { JsonObject } from '../primitive';
import { Queryable } from '../Queryable';
import { DocumentNode } from '../util';

import { buildRawOperationFromQuery, buildRawOperationFromFragment } from './util';

/**
 * Apollo-specific interface to the cache.
 */
export abstract class ApolloQueryable extends ApolloCache<NormalizedCacheObject> {
  /** The underlying Hermes cache. */
  protected abstract _queryable: Queryable;

  public diff<TData, TVariables extends OperationVariables = any>(
    options: Cache.DiffOptions<TData, TVariables>
  ): Cache.DiffResult<TData> {
    const rawOperation = buildRawOperationFromQuery(options.query, options.variables);
    const { result, complete, missing, fromOptimisticTransaction } = this._queryable.read(rawOperation, options.optimistic);
    if (options.returnPartialData === false && !complete) {
      // TODO: Include more detail with this error.
      throw new UnsatisfiedCacheError(`diffQuery not satisfied by the cache.`);
    }

    return { result: result as unknown as TData, complete, missing, fromOptimisticTransaction };
  }

  public read<T>(options: Cache.ReadOptions): T | null {
    const rawOperation = buildRawOperationFromQuery(options.query, (options.variables as unknown) as JsonObject, options.rootId);
    const { result, complete } = this._queryable.read(rawOperation, options.optimistic);
    if (complete || options.returnPartialData) {
      return (result ?? null as unknown) as T | null;
    }
    return null;
  }

  readQuery<QueryType, TVariables = any>(options: Cache.ReadQueryOptions<QueryType, TVariables>, optimistic?: boolean): QueryType | null {
    return this.read({
      query: options.query,
      variables: options.variables,
      optimistic: !!optimistic,
      returnPartialData: options.returnPartialData,
      rootId: options.id,
    });
  }

  readFragment<FragmentType, TVariables = any>(options: Cache.ReadFragmentOptions<FragmentType, TVariables>, optimistic?: boolean):
    FragmentType | null {
    // TODO: Support nested fragments.
    const rawOperation = buildRawOperationFromFragment(
      options.fragment,
      options.id!,
      options.variables as any,
      options.fragmentName,
    );
    const { complete, result } = this._queryable.read(rawOperation, optimistic);
    if (complete || options.returnPartialData) {
      return result ?? null as any;
    }
    return null;
  }

  public modify<Entity extends Record<string, any> = Record<string, any>>(
    options: Cache.ModifyOptions<Entity>
  ): boolean {
    return this._queryable.modify(options);
  }

  public write(options: Cache.WriteOptions): Reference | undefined {
    const rawOperation = buildRawOperationFromQuery(options.query, options.variables as JsonObject, options.dataId);
    const ref = this._queryable.write(rawOperation, options.result, options.broadcast);
    return ref ?? makeReference(rawOperation.rootId);
  }

  writeQuery<TData = any, TVariables = any>(options: Cache.WriteQueryOptions<TData, TVariables>): Reference | undefined {
    const rawOperation = buildRawOperationFromQuery(options.query, options.variables as any, options.id);
    const ref = this._queryable.write(rawOperation, options.data as any, options.broadcast);
    return ref ?? makeReference(rawOperation.rootId);
  }

  writeFragment<TData = any, TVariables = any>(options: Cache.WriteFragmentOptions<TData, TVariables>): Reference | undefined {
    // TODO: Support nested fragments.
    const rawOperation = buildRawOperationFromFragment(
      options.fragment,
      options.id!,
      options.variables as any,
      options.fragmentName,
    );
    const ref = this._queryable.write(rawOperation, options.data as any, options.broadcast);
    return ref ?? makeReference(rawOperation.rootId);
  }

  public transformDocument(document: DocumentNode): DocumentNode {
    return this._queryable.transformDocument(document);
  }

  transformForLink(document: DocumentNode): DocumentNode {
    // @static directives are for the cache only.
    return removeDirectivesFromDocument(
      [{ name: 'static' }],
      document
    )!;
  }

  public evict(options: Cache.EvictOptions): boolean {
    return this._queryable.evict(options);
  }
}
