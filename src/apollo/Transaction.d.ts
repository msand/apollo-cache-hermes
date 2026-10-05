import { Cache, Transaction } from '@apollo/client';
import { CacheTransaction } from '../CacheTransaction';
import { PathPart, JsonValue } from '../primitive';
import { NodeId } from '../schema';
import { DocumentNode } from '../util';
import { ApolloQueryable } from './Queryable';
/**
 * Apollo-specific transaction interface.
 */
export declare class ApolloTransaction<TSerialized> extends ApolloQueryable<TSerialized> {
    /** The underlying transaction. */
    protected _queryable: CacheTransaction<TSerialized>;
    constructor(
    /** The underlying transaction. */
    _queryable: CacheTransaction<TSerialized>);
    reset(): Promise<void>;
    removeOptimistic(_id: string): void;
    performTransaction(transaction: Transaction<TSerialized>): void;
    recordOptimisticTransaction(_transaction: Transaction<TSerialized>, _id: string): void;
    watch(_query: Cache.WatchOptions): () => void;
    restore(): any;
    extract(): any;
    updateListOfReferences: (containerId: NodeId, pathToParameterizedField: PathPart[], { writeFragment, writeFragmentName }: {
        writeFragment: DocumentNode;
        writeFragmentName?: string;
    }, { readFragment, readFragmentName }: {
        readFragment: DocumentNode;
        readFragmentName?: string;
    }, updateFieldCallback: (previousList: JsonValue[], fieldArgs?: {
        [argName: string]: string;
    }) => any) => void;
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
    updateParameterizedReferences(containerId: NodeId, pathToParameterizedField: PathPart[], { writeFragment, writeFragmentName }: {
        writeFragment: DocumentNode;
        writeFragmentName?: string;
    }, { readFragment, readFragmentName }: {
        readFragment: DocumentNode;
        readFragmentName?: string;
    }, updateFieldCallback: (previousList: JsonValue[], fieldArgs?: {
        [argName: string]: string;
    }) => any): void;
}
//# sourceMappingURL=Transaction.d.ts.map