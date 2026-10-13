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
    document: getFragmentQueryDocument(fragmentDocument, fragmentName),
    variables,
    fragmentName,
  };
}

/**
 * Marks a write operation as overwriting existing values, when the write
 * options ask for it (like InMemoryCache's `overwrite` option).
 */
export function withOverwrite(operation: RawOperation, options: { overwrite?: boolean }): RawOperation {
  return options.overwrite ? { ...operation, overwrite: true } : operation;
}
