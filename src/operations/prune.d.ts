import { CacheContext } from '../context';
import { GraphSnapshot } from '../GraphSnapshot';
import { RawOperation } from '../schema';
/**
 * Return a new graph snapshot pruned to just the shape of the given query
 */
export declare function prune<TSerialized>(context: CacheContext<TSerialized>, snapshot: GraphSnapshot, raw: RawOperation): {
    snapshot: GraphSnapshot;
    complete: boolean;
};
//# sourceMappingURL=prune.d.ts.map