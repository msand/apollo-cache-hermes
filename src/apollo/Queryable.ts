import type { OperationVariables, TypedDocumentNode } from '@apollo/client';
import { ApolloCache } from '@apollo/client/cache';
import type { Cache, DiffIncrementalInfo, Reference, ScalarType, StoreObject } from '@apollo/client/cache';
import { isReference } from '@apollo/client/utilities';
import type { FragmentDefinitionNode, InlineFragmentNode, OperationTypeNode } from 'graphql';
import type { Unmasked } from '@apollo/client/masking';
import {
  handleIncrementalSymbol,
  makeReference,
  removeDirectivesFromDocument,
  stringifyForDisplay,
} from '@apollo/client/utilities/internal';
import { InvariantError } from '@apollo/client/utilities/invariant';

import type { Policies } from '../context/policies';
import { toDiffResult } from '../operations/read';
import { JsonObject } from '../primitive';
import { Queryable } from '../Queryable';
import { NodeId, StaticNodeId } from '../schema';
import { DocumentNode } from '../util';

import { buildRawOperationFromQuery, buildRawOperationFromFragment, withOverwrite } from './util';

/**
 * Apollo-specific interface to the cache.
 */
export abstract class ApolloQueryable extends ApolloCache {
  /** The underlying Hermes cache. */
  protected abstract _queryable: Queryable;

  // The same overloads as ApolloCache#diff. Hermes does not yet use the
  // incremental (@defer/@stream) info, so it always returns a plain diff result.
  diff<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.DiffOptions<TData, TVariables> & { [handleIncrementalSymbol]: DiffIncrementalInfo | undefined },
  ): Cache.InternalDiffResultWithDataState<TData> | Cache.DiffResult<TData>;
  diff<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.DiffOptions<TData, TVariables>,
  ): Cache.DiffResult<TData>;
  diff<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.DiffOptions<TData, TVariables>,
  ): Cache.DiffResult<TData> {
    const rawOperation = buildRawOperationFromQuery(options.query, options.variables as JsonObject, options.id);
    // Like InMemoryCache, an incomplete result does not throw: it is null
    // unless partial data is requested (the default) and some was found.
    return toDiffResult<TData>(this._queryable.read(rawOperation, options.optimistic), options.returnPartialData);
  }

  read<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.ReadOptions<TData, TVariables>,
  ): Unmasked<TData> | null {
    const rawOperation = buildRawOperationFromQuery(
      options.query,
      options.variables as JsonObject | undefined,
      options.rootId,
    );
    // Like InMemoryCache, read only returns partial data when asked to.
    const diff = toDiffResult<TData>(
      this._queryable.read(rawOperation, options.optimistic),
      options.returnPartialData ?? false,
    );
    return diff.result as Unmasked<TData> | null;
  }

  readFragment<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.ReadFragmentOptions<TData, TVariables>,
    optimistic = !!options.optimistic,
  ): Unmasked<TData> | null {
    // TODO: Support nested fragments.
    const rawOperation = buildRawOperationFromFragment(
      options.fragment,
      this._fragmentRootId(options)!,
      options.variables as JsonObject | undefined,
      options.fragmentName,
    );
    const diff = toDiffResult<TData>(
      this._queryable.read(rawOperation, optimistic),
      options.returnPartialData ?? false,
    );
    return diff.result as Unmasked<TData> | null;
  }

  modify<Entity extends Record<string, any> = Record<string, any>>(options: Cache.ModifyOptions<Entity>): boolean {
    return this._queryable.modify(options);
  }

  write<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.WriteOptions<TData, TVariables>,
  ): Reference | undefined {
    const rawOperation = buildRawOperationFromQuery(
      options.query,
      options.variables as JsonObject | undefined,
      options.dataId,
      options.extensions,
    );
    const ref = this._queryable.write(
      withOverwrite(rawOperation, options),
      options.result as JsonObject,
      options.broadcast,
    );
    return ref ?? makeReference(rawOperation.rootId);
  }

  writeQuery<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.WriteQueryOptions<TData, TVariables>,
  ): Reference | undefined {
    const rawOperation = buildRawOperationFromQuery(
      options.query,
      options.variables as JsonObject | undefined,
      options.id,
      options.extensions,
    );
    const ref = this._queryable.write(
      withOverwrite(rawOperation, options),
      options.data as JsonObject,
      options.broadcast,
    );
    return ref ?? makeReference(rawOperation.rootId);
  }

  writeFragment<TData = unknown, TVariables extends OperationVariables = OperationVariables>(
    options: Cache.WriteFragmentOptions<TData, TVariables>,
  ): Reference | undefined {
    const id = this._fragmentRootId(options) ?? this.identify(options.data as JsonObject);
    // Like InMemoryCache.
    if (typeof id !== 'string') {
      throw new InvariantError(`Could not identify object ${stringifyForDisplay(options.data, 2)}`);
    }
    // TODO: Support nested fragments.
    const rawOperation = buildRawOperationFromFragment(
      options.fragment,
      id,
      options.variables as JsonObject | undefined,
      options.fragmentName,
    );
    const ref = this._queryable.write(
      withOverwrite(rawOperation, options),
      options.data as JsonObject,
      options.broadcast,
    );
    return ref ?? makeReference(rawOperation.rootId);
  }

  identify(object: StoreObject | Reference): string | undefined {
    if (isReference(object)) return object.__ref;
    // Like InMemoryCache, objects of the root query type identify ROOT_QUERY.
    if (object?.__typename && object.__typename === this._queryable.policies.rootTypenamesById.ROOT_QUERY) {
      return StaticNodeId.QueryRoot;
    }
    return this._queryable.identify(object);
  }

  fragmentMatches(fragment: InlineFragmentNode | FragmentDefinitionNode, typename: string): boolean {
    return this._queryable.fragmentMatches(fragment, typename);
  }

  lookupFragment(fragmentName: string): FragmentDefinitionNode | null {
    return this._queryable.lookupFragment(fragmentName);
  }

  /**
   * Whether a read function provides `typename.fieldName`, so Apollo's
   * LocalState leaves @client fields without a resolver to the cache (like
   * InMemoryCache#resolvesClientField).
   */
  resolvesClientField(typename: string, fieldName: string): boolean {
    return this._queryable.resolvesClientField(typename, fieldName);
  }

  /**
   * The type policies and possibleTypes of the cache, like InMemoryCache's
   * `policies` (with its addTypePolicies and addPossibleTypes methods).
   */
  get policies(): Policies {
    return this._queryable.policies;
  }

  // Custom scalars (like InMemoryCache's `scalars` option).

  getScalar<TKey extends keyof ApolloCache.Scalars>(key: TKey): ApolloCache.GetScalarType<TKey> | undefined {
    return this._queryable.scalars.getScalar(key as string) as ApolloCache.GetScalarType<TKey> | undefined;
  }

  getScalarTypeForField(typename: string, fieldName: string): ScalarType | undefined {
    return this._queryable.scalars.getScalarTypeForField(typename, fieldName) as ScalarType | undefined;
  }

  getRootTypename(operation: OperationTypeNode): string {
    return this._queryable.policies.getRootTypename(operation);
  }

  configuresScalars(): boolean {
    return this._queryable.scalars.configuresScalars();
  }

  serializeVariables<TVariables extends OperationVariables = OperationVariables>(
    document: DocumentNode | TypedDocumentNode<any, TVariables>,
    variables: NoInfer<TVariables>,
  ): TVariables;

  serializeVariables<TVariables extends OperationVariables = OperationVariables>(
    document: DocumentNode | TypedDocumentNode<any, TVariables>,
    variables: NoInfer<TVariables> | undefined,
  ): TVariables | undefined;

  serializeVariables<TVariables extends OperationVariables = OperationVariables>(
    document: DocumentNode | TypedDocumentNode<any, TVariables>,
    variables: NoInfer<TVariables> | undefined,
  ): TVariables | undefined {
    return this._queryable.scalars.serializeVariables(document, variables);
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

  /**
   * The id of the entity a fragment is read from or written to: like
   * ApolloCache, the `from` option (an id, Reference or object) takes
   * precedence over `id`.
   */
  private _fragmentRootId(options: Cache.CacheIdentifierOption<unknown>): string | undefined {
    const { from } = options;
    if (from === undefined) return options.id;
    if (typeof from === 'string') return from;
    return from ? this.identify(from as Reference) : undefined;
  }
}
