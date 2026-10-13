import type { Cache, Reference, StoreObject } from '@apollo/client/cache';
import type { FragmentDefinitionNode, InlineFragmentNode } from 'graphql';

import type { ScalarConfig } from './context/scalars';
import type { QueryResult } from './operations/read';
import { JsonObject } from './primitive';
import { NodeId, RawOperation } from './schema';
import { DocumentNode } from './util';

/**
 * Represents a queryable portion of our cache (the cache itself, transactions,
 * views, etc).
 */
export interface Queryable {
  /**
   * Performs any transformations of operation documents.
   *
   * Cache consumers should call this on any operation document prior to calling
   * any other method in the cache.
   */
  transformDocument(document: DocumentNode): DocumentNode;

  /** The cache id of an object (or Reference), if it can be identified. */
  identify(object: StoreObject | Reference): string | undefined;

  /** Whether a fragment applies to objects of the given __typename. */
  fragmentMatches(fragment: InlineFragmentNode | FragmentDefinitionNode, typename: string): boolean;

  /** The fragment registered under `fragmentName`, if any. */
  lookupFragment(fragmentName: string): FragmentDefinitionNode | null;

  /** Custom scalar support. */
  readonly scalars: ScalarConfig;

  /** Whether a read function provides the field. */
  resolvesClientField(typename: string, fieldName: string): boolean;

  /**
   * Reads the selection expressed by a query from the cache.
   *
   * TODO: Can we drop non-optimistic reads?
   * https://github.com/apollographql/apollo-client/issues/1971#issuecomment-319402170
   */
  read(query: RawOperation, optimistic?: boolean): QueryResult;

  /**
   * Writes values for a selection to the cache.
   */
  write(query: RawOperation, payload: JsonObject, broadcast: boolean | undefined): Reference | undefined;

  modify<Entity extends Record<string, unknown>>(options: Cache.ModifyOptions<Entity>): boolean;

  evict(options: Cache.EvictOptions): boolean;

  /**
   * Evicts several entities at once, as one edit of the cache. Ids that are not
   * in the cache are skipped. Returns whether any entity was evicted.
   */
  batchEvict(ids: Iterable<NodeId>, broadcast?: boolean): boolean;
}
