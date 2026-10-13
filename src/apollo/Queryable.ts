import { ApolloCache, Cache, Reference, Unmasked, makeReference } from '@apollo/client';
import { removeDirectivesFromDocument, stringifyForDisplay } from '@apollo/client/utilities';
import { InvariantError } from '@apollo/client/utilities/globals';

import { UnsatisfiedCacheError } from '../errors';
import { JsonObject } from '../primitive';
import { Queryable } from '../Queryable';
import { NodeId } from '../schema';
import { DocumentNode, isObject } from '../util';

import { buildRawOperationFromQuery, buildRawOperationFromFragment } from './util';

const EMPTY_RESULT = Object.freeze({});

/**
 * Apollo-specific interface to the cache.
 */
export abstract class ApolloQueryable<TSerialized> extends ApolloCache<TSerialized> {
  /** The underlying Hermes cache. */
  protected abstract _queryable: Queryable;

  diff<T>(query: Cache.DiffOptions): Cache.DiffResult<T> {
    const rawOperation = buildRawOperationFromQuery(query.query, query.variables, query.id);
    const { result, complete, missing, fromOptimisticTransaction } = this._queryable.read(
      rawOperation,
      query.optimistic,
    );
    if (query.returnPartialData === false && !complete) {
      // Like InMemoryCache, throw the MissingFieldError describing what is missing.
      throw missing?.[0] ?? new UnsatisfiedCacheError(`diffQuery not satisfied by the cache.`);
    }

    // Like InMemoryCache, an empty read is an empty (incomplete) object rather than undefined; and
    // like its canonized results, the same (frozen) one each time.
    const empty = result === undefined || (isObject(result) && Object.keys(result).length === 0);
    return { result: (empty ? EMPTY_RESULT : result) as unknown as T, complete, missing, fromOptimisticTransaction };
  }

  read<TData = any, TVariables = any>(query: Cache.ReadOptions<TVariables, TData>): Unmasked<TData> | null {
    const rawOperation = buildRawOperationFromQuery(
      query.query,
      query.variables as unknown as JsonObject,
      query.rootId,
    );
    const { result, complete } = this._queryable.read(rawOperation, query.optimistic);
    if (complete || query.returnPartialData) {
      return (result ?? (null as unknown)) as Unmasked<TData> | null;
    }
    return null;
  }

  readQuery<QueryType, TVariables = any>(
    options: Cache.ReadQueryOptions<QueryType, TVariables>,
    // Like ApolloCache, options.optimistic is the default.
    optimistic = !!options.optimistic,
  ): Unmasked<QueryType> | null {
    return this.read({
      query: options.query,
      variables: options.variables,
      optimistic: !!optimistic,
      returnPartialData: options.returnPartialData,
      rootId: options.id,
    });
  }

  readFragment<FragmentType, TVariables = any>(
    options: Cache.ReadFragmentOptions<FragmentType, TVariables>,
    optimistic = !!options.optimistic,
  ): Unmasked<FragmentType> | null {
    // TODO: Support nested fragments.
    const rawOperation = buildRawOperationFromFragment(
      options.fragment,
      options.id!,
      options.variables as any,
      options.fragmentName,
    );
    const { complete, result } = this._queryable.read(rawOperation, optimistic);
    if (complete || options.returnPartialData) {
      return result ?? (null as any);
    }
    return null;
  }

  modify<Entity extends Record<string, any> = Record<string, any>>(options: Cache.ModifyOptions<Entity>): boolean {
    return this._queryable.modify(options);
  }

  write(options: Cache.WriteOptions): Reference | undefined {
    const rawOperation = buildRawOperationFromQuery(options.query, options.variables as JsonObject, options.dataId);
    const ref = this._queryable.write(rawOperation, options.result, options.broadcast);
    return ref ?? makeReference(rawOperation.rootId);
  }

  writeQuery<TData = any, TVariables = any>(
    options: Cache.WriteQueryOptions<TData, TVariables>,
  ): Reference | undefined {
    const rawOperation = buildRawOperationFromQuery(options.query, options.variables as any, options.id);
    const ref = this._queryable.write(rawOperation, options.data as any, options.broadcast);
    return ref ?? makeReference(rawOperation.rootId);
  }

  writeFragment<TData = any, TVariables = any>(
    options: Cache.WriteFragmentOptions<TData, TVariables>,
  ): Reference | undefined {
    const id = options.id ?? this.identify(options.data as any);
    // Like InMemoryCache.
    if (typeof id !== 'string') {
      throw new InvariantError(`Could not identify object ${stringifyForDisplay(options.data, 2)}`);
    }
    // TODO: Support nested fragments.
    const rawOperation = buildRawOperationFromFragment(
      options.fragment,
      id,
      options.variables as any,
      options.fragmentName,
    );
    const ref = this._queryable.write(rawOperation, options.data as any, options.broadcast);
    return ref ?? makeReference(rawOperation.rootId);
  }

  transformDocument(doc: DocumentNode): DocumentNode {
    return this._queryable.transformDocument(doc);
  }

  transformForLink(document: DocumentNode): DocumentNode {
    // @static directives are for the cache only.
    return removeDirectivesFromDocument([{ name: 'static' }], document)!;
  }

  evict(options: Cache.EvictOptions): boolean {
    return this._queryable.evict(options);
  }

  batchEvict(ids: Iterable<NodeId>, broadcast?: boolean): boolean {
    return this._queryable.batchEvict(ids, broadcast);
  }
}
