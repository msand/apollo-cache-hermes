import { getFragmentQueryDocument } from '@apollo/client/utilities/internal';

import { JsonObject } from '../primitive';
import { NodeId, RawOperation, StaticNodeId } from '../schema';
import { DocumentNode } from '../util';

/**
 * Builds a query.
 */
export function buildRawOperationFromQuery(
  document: DocumentNode,
  variables?: JsonObject,
  rootId?: NodeId,
  extensions?: Record<string, unknown>,
): RawOperation {
  return {
    rootId: rootId || StaticNodeId.QueryRoot,
    document,
    variables,
    ...(extensions && { extensions }),
  };
}

export function buildRawOperationFromFragment(
  fragmentDocument: DocumentNode,
  rootId: NodeId,
  variables?: JsonObject,
  fragmentName?: string,
): RawOperation {
  return {
    rootId,
    document: fragmentQueryDocument(fragmentDocument, fragmentName),
    variables,
    fragmentName,
  };
}

/** The query documents made of fragment documents (by fragment name), like ApolloCache#getFragmentDoc. */
const fragmentQueryDocuments = new WeakMap<DocumentNode, Map<string | undefined, DocumentNode>>();

/**
 * getFragmentQueryDocument, memoized: the same document each time, so that
 * what is known about it (e.g. its parsed operations) is reused.
 */
function fragmentQueryDocument(fragmentDocument: DocumentNode, fragmentName?: string): DocumentNode {
  let byName = fragmentQueryDocuments.get(fragmentDocument);
  if (!byName) fragmentQueryDocuments.set(fragmentDocument, (byName = new Map()));
  let document = byName.get(fragmentName);
  if (!document) byName.set(fragmentName, (document = getFragmentQueryDocument(fragmentDocument, fragmentName)));
  return document;
}

/**
 * Marks a write operation as overwriting existing values, when the write
 * options ask for it (like InMemoryCache's `overwrite` option).
 */
export function withOverwrite(operation: RawOperation, options: { overwrite?: boolean }): RawOperation {
  return options.overwrite ? { ...operation, overwrite: true } : operation;
}
