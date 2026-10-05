"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApolloTransaction = void 0;
const util_1 = require("../util");
const Queryable_1 = require("./Queryable");
function getOriginalFieldArguments(id) {
    // Split `${containerId}❖${JSON.stringify(path)}❖${JSON.stringify(args)}`
    const idComponents = id.split('❖');
    if (idComponents.length < 3) {
        return undefined;
    }
    return JSON.parse(idComponents[2]);
}
/**
 * Apollo-specific transaction interface.
 */
class ApolloTransaction extends Queryable_1.ApolloQueryable {
    constructor(
    /** The underlying transaction. */
    _queryable) {
        super();
        this._queryable = _queryable;
        this.updateListOfReferences = this.updateParameterizedReferences;
    }
    reset() {
        throw new Error(`reset() is not allowed within a transaction`);
    }
    removeOptimistic(_id) {
        throw new Error(`removeOptimistic() is not allowed within a transaction`);
    }
    performTransaction(transaction) {
        transaction(this);
    }
    recordOptimisticTransaction(_transaction, _id) {
        throw new Error(`recordOptimisticTransaction() is not allowed within a transaction`);
    }
    watch(_query) {
        throw new Error(`watch() is not allowed within a transaction`);
    }
    restore() {
        throw new Error(`restore() is not allowed within a transaction`);
    }
    extract() {
        throw new Error(`extract() is not allowed within a transaction`);
    }
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
    updateParameterizedReferences(containerId, pathToParameterizedField, { writeFragment, writeFragmentName }, { readFragment, readFragmentName }, updateFieldCallback) {
        const currentContainerNode = this._queryable.getCurrentNodeSnapshot(containerId);
        if (!currentContainerNode || !currentContainerNode.parameterized) {
            return;
        }
        for (const { id: outboundId, path } of (0, util_1.iterParameterized)(currentContainerNode.parameterized)) {
            if (pathToParameterizedField.every((part, i) => part === path[i])) {
                const fieldArguments = getOriginalFieldArguments(outboundId);
                if (fieldArguments) {
                    let cacheResult;
                    try {
                        cacheResult = this.readFragment({
                            id: containerId,
                            fragment: readFragment,
                            fragmentName: readFragmentName,
                            variables: fieldArguments,
                        }, this._queryable.isOptimisticTransaction());
                    }
                    catch (error) {
                        continue;
                    }
                    const previousData = (0, util_1.deepGet)(cacheResult, path);
                    // if previousData is not object or null or array,
                    // we won't allow the field to be updated
                    if (!Array.isArray(previousData) && typeof previousData !== 'object') {
                        const details = `${(0, util_1.verboseTypeof)(previousData)} at ContainerId ${containerId} with readFragment ${readFragmentName}`;
                        throw new Error(`updateParameterizedReferences() expects previousData to be an array or object instead got ${details}`);
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
exports.ApolloTransaction = ApolloTransaction;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVHJhbnNhY3Rpb24uanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJUcmFuc2FjdGlvbi50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFLQSxrQ0FBa0Y7QUFFbEYsMkNBQThDO0FBRTlDLFNBQVMseUJBQXlCLENBQUMsRUFBVTtJQUMzQyx5RUFBeUU7SUFDekUsTUFBTSxZQUFZLEdBQUcsRUFBRSxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsQ0FBQztJQUNuQyxJQUFJLFlBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7UUFDNUIsT0FBTyxTQUFTLENBQUM7SUFDbkIsQ0FBQztJQUNELE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQyxZQUFZLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztBQUNyQyxDQUFDO0FBRUQ7O0dBRUc7QUFDSCxNQUFhLGlCQUErQixTQUFRLDJCQUE0QjtJQUU5RTtJQUNFLGtDQUFrQztJQUN4QixVQUF5QztRQUVuRCxLQUFLLEVBQUUsQ0FBQztRQUZFLGVBQVUsR0FBVixVQUFVLENBQStCO1FBaUNyRCwyQkFBc0IsR0FBRyxJQUFJLENBQUMsNkJBQTZCLENBQUM7SUE5QjVELENBQUM7SUFFRCxLQUFLO1FBQ0gsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsQ0FBQyxDQUFDO0lBQ2pFLENBQUM7SUFFRCxnQkFBZ0IsQ0FBQyxHQUFXO1FBQzFCLE1BQU0sSUFBSSxLQUFLLENBQUMsd0RBQXdELENBQUMsQ0FBQztJQUM1RSxDQUFDO0lBRUQsa0JBQWtCLENBQUMsV0FBcUM7UUFDdEQsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3BCLENBQUM7SUFFRCwyQkFBMkIsQ0FBQyxZQUFzQyxFQUFFLEdBQVc7UUFDN0UsTUFBTSxJQUFJLEtBQUssQ0FBQyxtRUFBbUUsQ0FBQyxDQUFDO0lBQ3ZGLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBMEI7UUFDOUIsTUFBTSxJQUFJLEtBQUssQ0FBQyw2Q0FBNkMsQ0FBQyxD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