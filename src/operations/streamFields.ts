import { equal } from '@wry/equality';
import type { FieldMergeFunction } from '@apollo/client/cache';
import type { Incremental } from '@apollo/client/incremental';
import { isStreamField, streamInfoSymbol } from '@apollo/client/utilities/internal';
import type { ExtensionsWithStreamInfo, StreamInfoTrie } from '@apollo/client/utilities/internal';
import type { FieldNode } from 'graphql';

import type { JsonObject, PathPart } from '../primitive';

/**
 * The `@stream` info Apollo Client attaches to the extensions of the writes of
 * incremental results (under its internal `streamInfoSymbol` key): a WeakRef
 * to a trie of the streamed lists' chunk info, keyed by their paths.
 */
export type StreamInfoRef = NonNullable<ExtensionsWithStreamInfo[typeof streamInfoSymbol]>;

/** The `@stream` info of a write's extensions, if any. */
export function streamInfoOf(extensions: Record<string, unknown> | undefined): StreamInfoRef | undefined {
  return (extensions as ExtensionsWithStreamInfo | undefined)?.[streamInfoSymbol];
}

/**
 * The entry of a streamed list in a write's `@stream` info: like
 * InMemoryCache, the path is the field-name path (with list indices) from the
 * root of the write.
 */
export function streamEntryAt(streamInfo: StreamInfoRef | undefined, path: PathPart[]) {
  return (streamInfo?.deref() as StreamInfoTrie | undefined)?.peekArray(path);
}

/**
 * Whether InMemoryCache would merge a field's incoming value with its default
 * `@stream` merge function: the write carries `@stream` info, and the value is
 * a list of a field with an active `@stream` directive.
 */
export function usesDefaultStreamMerge(
  streamInfo: StreamInfoRef | undefined,
  field: FieldNode | null | undefined,
  value: unknown,
  variables: JsonObject | undefined,
): field is FieldNode {
  return !!streamInfo && !!field && Array.isArray(value) && isStreamField(field, variables);
}

/**
 * Like Policies#runMergeFunction, calls a merge function for a (possibly)
 * streamed field: the merge function sees the field's `streamFieldInfo` for
 * the current chunk, and a chunk that is written again (with the same incoming
 * value and chunk info) reuses the previous result.
 */
export function runStreamAwareMerge<T>(
  streamInfo: StreamInfoRef | undefined,
  path: PathPart[],
  incoming: unknown,
  merge: (streamFieldInfo: Incremental.StreamFieldInfo | undefined) => T,
): T {
  const entry = streamEntryAt(streamInfo, path);
  if (!entry) return merge(undefined);

  const { current, previous } = entry;
  if (previous && equal(previous.incoming, incoming) && equal(previous.streamFieldInfo, current)) {
    return previous.result as T;
  }

  const result = merge(current);
  entry.previous = { incoming, streamFieldInfo: current, result };
  return result;
}

/**
 * InMemoryCache's merge function for `@stream` lists without one of their own:
 * the cached items beyond the ones streamed so far are kept until the last
 * chunk, which truncates the list to its final length.
 */
export const defaultStreamFieldMergeFn: FieldMergeFunction<any[]> = (
  existing,
  incoming,
  { streamFieldInfo, existingData },
) => {
  if (!existing && !existingData) {
    return incoming;
  }

  const results: any[] = [];
  const previous = existing ?? (existingData as any[]);
  const length = streamFieldInfo?.isLastChunk ? incoming.length : Math.max(previous.length, incoming.length);

  for (let i = 0; i < length; i++) {
    results[i] = incoming[i] === undefined ? previous[i] : incoming[i];
  }

  return results;
};
