"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApolloQueryable = void 0;
const client_1 = require("@apollo/client");
const utilities_1 = require("@apollo/client/utilities");
const errors_1 = require("../errors");
const util_1 = require("./util");
/**
 * Apollo-specific interface to the cache.
 */
class ApolloQueryable extends client_1.ApolloCache {
    diff(query) {
        const rawOperation = (0, util_1.buildRawOperationFromQuery)(query.query, query.variables);
        const { result, complete, missing, fromOptimisticTransaction } = this._queryable.read(rawOperation, query.optimistic);
        if (query.returnPartialData === false && !complete) {
            // TODO: Include more detail with this error.
            throw new errors_1.UnsatisfiedCacheError(`diffQuery not satisfied by the cache.`);
        }
        return { result: result, complete, missing, fromOptimisticTransaction };
    }
    read(query) {
        const rawOperation = (0, util_1.buildRawOperationFromQuery)(query.query, query.variables, query.rootId);
        const { result, complete } = this._queryable.read(rawOperation, query.optimistic);
        if (complete || query.returnPartialData) {
            return (result !== null && result !== void 0 ? result : null);
        }
        return null;
    }
    readQuery(options, optimistic) {
        return this.read({
            query: options.query,
            variables: options.variables,
            optimistic: !!optimistic,
            returnPartialData: options.returnPartialData,
            rootId: options.id,
        });
    }
    readFragment(options, optimistic) {
        // TODO: Support nested fragments.
        const rawOperation = (0, util_1.buildRawOperationFromFragment)(options.fragment, options.id, options.variables, options.fragmentName);
        const { complete, result } = this._queryable.read(rawOperation, optimistic);
        if (complete || options.returnPartialData) {
            return result !== null && result !== void 0 ? result : null;
        }
        return null;
    }
    modify(options) {
        return this._queryable.modify(options);
    }
    write(options) {
        const rawOperation = (0, util_1.buildRawOperationFromQuery)(options.query, options.variables, options.dataId);
        const ref = this._queryable.write(rawOperation, options.result, options.broadcast);
        return ref !== null && ref !== void 0 ? ref : (0, client_1.makeReference)(rawOperation.rootId);
    }
    writeQuery(options) {
        const rawOperation = (0, util_1.buildRawOperationFromQuery)(options.query, options.variables, options.id);
        const ref = this._queryable.write(rawOperation, options.data, options.broadcast);
        return ref !== null && ref !== void 0 ? ref : (0, client_1.makeReference)(rawOperation.rootId);
    }
    writeFragment(options) {
        // TODO: Support nested fragments.
        const rawOperation = (0, util_1.buildRawOperationFromFragment)(options.fragment, options.id, options.variables, options.fragmentName);
        const ref = this._queryable.write(rawOperation, options.data, options.broadcast);
        return ref !== null && ref !== void 0 ? ref : (0, client_1.makeReference)(rawOperation.rootId);
    }
    transformDocument(doc) {
        return this._queryable.transformDocument(doc);
    }
    transformForLink(document) {
        // @static directives are for the cache only.
        return (0, utilities_1.removeDirectivesFromDocument)([{ name: 'static' }], document);
    }
    evict(options) {
        return this._queryable.evict(options);
    }
    batchEvict(ids, broadcast) {
        return this._queryable.batchEvict(ids, broadcast);
    }
}
exports.ApolloQueryable = ApolloQueryable;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUXVlcnlhYmxlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiUXVlcnlhYmxlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJDQUE4RTtBQUM5RSx3REFBd0U7QUFFeEUsc0NBQWtEO0FBTWxELGlDQUFtRjtBQUVuRjs7R0FFRztBQUNILE1BQXNCLGVBQTZCLFNBQVEsb0JBQXdCO0lBSWpGLElBQUksQ0FBSSxLQUF3QjtRQUM5QixNQUFNLFlBQVksR0FBRyxJQUFBLGlDQUEwQixFQUFDLEtBQUssQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzlFLE1BQU0sRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxHQUFHLElBQUksQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDdEgsSUFBSSxLQUFLLENBQUMsaUJBQWlCLEtBQUssS0FBSyxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDbkQsNkNBQTZDO1lBQzdDLE1BQU0sSUFBSSw4QkFBcUIsQ0FBQyx1Q0FBdUMsQ0FBQyxDQUFDO1FBQzNFLENBQUM7UUFFRCxPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQXNCLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSx5QkFBeUIsRUFBRSxDQUFDO0lBQzFGLENBQUM7SUFFRCxJQUFJLENBQWdDLEtBQTJDO1FBQzdFLE1BQU0sWUFBWSxHQUFHLElBQUEsaUNBQTBCLEVBQUMsS0FBSyxDQUFDLEtBQUssRUFBRyxLQUFLLENBQUMsU0FBbUMsRUFBRSxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDdkgsTUFBTSxFQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxZQUFZLEVBQUUsS0FBSyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQ2xGLElBQUksUUFBUSxJQUFJLEtB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