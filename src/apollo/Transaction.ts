import type { Cache, Transaction } from '@apollo/client/cache';

import { CacheTransaction } from '../CacheTransaction';
import { fieldNameFromStoreName, isStoreFieldNameKey } from '../context/storeFieldNames';
import { storeKeyOfNode } from '../operations/SnapshotEditor';
import { PathPart, JsonValue } from '../primitive';
import { NodeId } from '../schema';
import { DocumentNode, verboseTypeof, deepGet, iterParameterized } from '../util';

import { ApolloQueryable } from './Queryable';

/**
 * The arguments of the field whose parameterized value node `id` is at `path`
 * within the node `containerId`: those its id was made from (see
 * nodeIdForStoreKey). For a field stored per its keyArgs (or @connection
 * directive), these are the arguments in its store field name (e.g. `type`
 * of `feed:{"type":"news"}`), if it has them as JSON.
 */
function getOriginalFieldArguments(
  containerId: NodeId,
  path: PathPart[],
  id: NodeId,
): { [argName: string]: string } | undefined {
  const storeKey = storeKeyOfNode(containerId, path, id);
  if (storeKey === undefined) return undefined;
  let json = storeKey;
  if (isStoreFieldNameKey(storeKey)) {
    const fieldName = fieldNameFromStoreName(storeKey);
    if (storeKey.charAt(fieldName.length) !== ':') return undefined;
    json = storeKey.slice(fieldName.length + 1);
  }
  try {
    const args = JSON.parse(json);
    return args !== null && typeof args === 'object' && !Array.isArray(args) ? args : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Apollo-specific transaction interface.
 */
export class ApolloTransaction<TSerialized> extends ApolloQueryable {
  constructor(
    /** The underlying transaction. */
    protected _queryable: CacheTransaction<TSerialized>,
  ) {
    super();
  }

  reset(): Promise<void> {
    throw new Error(`reset() is not allowed within a transaction`);
  }

  removeOptimistic(_id: string): void {
    throw new Error(`removeOptimistic() is not allowed within a transaction`);
  }

  performTransaction(transaction: Transaction): void {
    transaction(this);
  }

  recordOptimisticTransaction(_transaction: Transaction, _id: string): void {
    throw new Error(`recordOptimisticTransaction() is not allowed within a transaction`);
  }

  watch(_query: Cache.WatchOptions<any, any>): () => void {
    throw new Error(`watch() is not allowed within a transaction`);
  }

  restore(): this {
    throw new Error(`restore() is not allowed within a transaction`);
  }

  extract(): never {
    throw new Error(`extract() is not allowed within a transaction`);
  }

  updateListOfReferences = this.updateParameterizedReferences;
  /**
   * A helper function to be used when doing EntityUpdate.
   * The method enable users to iterate different parameterized at an editPath
   * of a given container Id.
   *
   * The 'updateFieldCallback' is a callback to compute new value given previous
   * list of references and an object literal of parameterized arguments at the
   * given path.
   *
   * @param containerId {string} an id of a container node to look for editPath.
   * @param pathToParameterizedField {(string|number)[]} an array of paths to
   *    parameterized field in container.
   * @param writeFragment
   * @param writeFragmentName
   * @param readFragment
   * @param readFragmentName
   * @param updateFieldCallback
   */
  updateParameterizedReferences(
    containerId: NodeId,
    pathToParameterizedField: PathPart[],
    { writeFragment, writeFragmentName }: { writeFragment: DocumentNode; writeFragmentName?: string },
    { readFragment, readFragmentName }: { readFragment: DocumentNode; readFragmentName?: string },
    updateFieldCallback: (previousList: JsonValue[], fieldArgs?: { [argName: string]: string }) => any,
  ) {
    const currentContainerNode = this._queryable.getCurrentNodeSnapshot(containerId);
    if (!currentContainerNode || !currentContainerNode.parameterized) {
      return;
    }

    for (const { id: outboundId, path } of iterParameterized(currentContainerNode.parameterized)) {
      if (pathToParameterizedField.every((part, i) => part === path[i])) {
        const fieldArguments = getOriginalFieldArguments(containerId, path, outboundId);
        if (fieldArguments) {
          let cacheResult: any;
          try {
            cacheResult = this.readFragment(
              {
                id: containerId,
                fragment: readFragment,
                fragmentName: readFragmentName,
                variables: fieldArguments,
              },
              this._queryable.isOptimisticTransaction(),
            );
          } catch (error) {
            continue;
          }
          const previousData = deepGet(cacheResult, path);

          // if previousData is not object or null or array,
          // we won't allow the field to be updated
          if (!Array.isArray(previousData) && typeof previousData !== 'object') {
            const details = `${verboseTypeof(previousData)} at ContainerId ${containerId} with readFragment ${readFragmentName}`;
            throw new Error(
              `updateParameterizedReferences() expects previousData to be an array or object instead got ${details}`,
            );
          }

          const updateData = updateFieldCallback(previousData, fieldArguments);
          if (updateData !== previousData) {
            this.writeFragment({
              id: outboundId,
              fragment: writeFragment,
              fragmentName: writeFragmentName,
              variables: fieldArguments,
              data: updateData,
            });
          }
        }
      }
    }
  }
}
