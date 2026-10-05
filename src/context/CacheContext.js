"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheContext = void 0;
exports._makeEntityIdMapper = _makeEntityIdMapper;
exports.defaultEntityIdMapper = defaultEntityIdMapper;
exports.operationCacheKey = operationCacheKey;
const tslib_1 = require("tslib");
const utilities_1 = require("@apollo/client/utilities");
const equality_1 = tslib_1.__importDefault(require("@wry/equality"));
const ParsedQueryNode_1 = require("../ParsedQueryNode");
const util_1 = require("../util");
const ConsoleTracer_1 = require("./ConsoleTracer");
const QueryInfo_1 = require("./QueryInfo");
/**
 * Configuration and shared state used throughout the cache's operation.
 */
class CacheContext {
    constructor(config = {}) {
        var _a, _b;
        /** All currently known & processed GraphQL documents. */
        this._queryInfoMap = new Map();
        /** All currently known & parsed queries, for identity mapping. */
        this._operationMap = new Map();
        this.dirty = new Map();
        // Infer dev mode from NODE_ENV, by convention.
        const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';
        this.entityIdForValue = _makeEntityIdMapper(((_a = config.entityIdForNode) !== null && _a !== void 0 ? _a : config.dataIdFromObject), config.typePolicies);
        this.entityTransformer = config.entityTransformer;
        this.freezeSnapshots = 'freeze' in config ? !!config.freeze : nodeEnv !== 'production';
        this.strict = typeof config.strict === 'boolean' ? config.strict : true;
        this.verbose = !!config.verbose;
        this.resolverRedirects = config.resolverRedirects || {};
        this.onChange = config.onChange;
        this.entityUpdaters = config.entityUpdaters || {};
        this.tracer = config.tracer || new ConsoleTracer_1.ConsoleTracer(!!config.verbose, config.logger);
        this.addTypename = (_b = config.addTypename) !== null && _b !== void 0 ? _b : true;
        this.typePolicies = config.typePolicies;
    }
    /**
     * Performs any transformations of operation documents.
     *
     * Cache consumers should call this on any operation document prior to calling
     * any other method in the cache.
     */
    transformDocument(document) {
        if (this.addTypename && !document.hasBeenTransformed) {
            const transformedDocument = (0, utilities_1.addTypenameToDocument)(document);
            transformedDocument.hasBeenTransformed = true;
            return transformedDocument;
        }
        return document;
    }
    /**
     * Returns a memoized & parsed operation.
     *
     * To aid in various cache lookups, the result is memoized by all of its
     * values, and can be used as an identity for a specific operation.
     */
    parseOperation(raw) {
        var _a, _b, _c;
        // It appears like Apollo or someone upstream is cloning or otherwise
        // modifying the queries that are passed down.  Thus, the operation source
        // is a more reliable cache key…
        const cacheKey = operationCacheKey(raw.document, raw.fragmentName);
        let operationInstances = this._operationMap.get(cacheKey);
        if (!operationInstances) {
            operationInstances = [];
            this._operationMap.set(cacheKey, operationInstances);
        }
        // Do we already have a copy of this guy?
        for (const instance of operationInstances) {
            if (instance.rootId !== raw.rootId)
                continue;
            if (!(0, equality_1.default)(instance.variables, raw.variables))
                continue;
            return instance;
        }
        const updateRaw = Object.assign(Object.assign({}, raw), { document: this.transformDocument(raw.document) });
        const rootHasReadPolicy = Object.keys((_c = (_b = (_a = this.typePolicies) === null || _a === void 0 ? void 0 : _a.Query) === null || _b === void 0 ? void 0 : _b.fields) !== null && _c !== void 0 ? _c : {}).length > 0;
        const info = this._queryInfo(cacheKey, updateRaw);
        const fullVariables = Object.assign(Object.assign({}, info.variableDefaults), updateRaw.variables);
        const operation = {
            info,
            rootId: updateRaw.rootId,
            parsedQuery: (0, ParsedQueryNode_1.expandVariables)(info.parsed, fullVariables),
            isStatic: !(0, ParsedQueryNode_1.areChildrenDynamic)(info.parsed) && !rootHasReadPolicy,
            variables: updateRaw.variables,
            propMap: info.propMap,
        };
        operationInstances.push(operation);
        return operation;
    }
    /**
     * Retrieves a memoized QueryInfo for a given GraphQL document.
     */
    _queryInfo(cacheKey, raw) {
        if (!this._queryInfoMap.has(cacheKey)) {
            this._queryInfoMap.set(cacheKey, new QueryInfo_1.QueryInfo(this, raw));
        }
        return this._queryInfoMap.get(cacheKey);
    }
}
exports.CacheContext = CacheContext;
/**
 * Wrap entityIdForNode so that it coerces all values to strings.
 */
function _makeEntityIdMapper(idForNode, typePolicies) {
    const mapper = idForNode || (!typePolicies ? defaultEntityIdMapper
        : (node) => {
            if (!node) {
                return undefined;
            }
            const { __typename } = node;
            if (typeof __typename === 'string' && __typename in typePolicies) {
                const keyFields = typePolicies[__typename].keyFields;
                if (Array.isArray(keyFields)) {
                    const keys = {};
                    for (const key of keyFields) {
                        const value = node[key];
                        if (value === undefined) {
                            return undefined;
                        }
                        keys[key] = value;
                    }
                    return `${__typename}:${JSON.stringify(keys)}`;
                }
            }
            const { id } = node;
            const idType = typeof id;
            if (idType !== 'string' && idType !== 'number') {
                return undefined;
            }
            return __typename ? `${__typename}:${id}` : `${id}`;
        });
    return function entityIdForNode(node) {
        if (!(0, util_1.isObject)(node))
            return undefined;
        // We don't trust upstream implementations.
        const entityId = mapper(node);
        if (typeof entityId === 'string')
            return entityId;
        if (typeof entityId === 'number')
            return String(entityId);
        return undefined;
    };
}
function defaultEntityIdMapper({ __typename, _id, id = _id }) {
    if (id == null) {
        return undefined;
    }
    const idType = typeof id;
    const numberOrString = idType === 'number' || idType === 'string';
    if (typeof __typename === 'string') {
        return `${__typename}:${numberOrString ? id : JSON.stringify(id)}`;
    }
    return numberOrString ? `${id}` : undefined;
}
function operationCacheKey(document, fragmentName) {
    if (fragmentName) {
        return `${fragmentName}❖${document.loc.source.body}`;
    }
    return document.loc.source.body;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ2FjaGVDb250ZXh0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiQ2FjaGVDb250ZXh0LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQXVTQSxrREEwQ0M7QUFFRCxzREFVQztBQUVELDhDQUtDOztBQXBXRCx3REFBaUU7QUFDakUscUVBQW9DO0FBS3BDLHdEQUF5RTtBQUd6RSxrQ0FBaUQ7QUFHakQsbURBQWdEO0FBQ2hELDJDQUF3QztBQStJeEM7O0dBRUc7QUFDSCxNQUFhLFlBQVk7SUF5Q3ZCLFlBQVksU0FBa0QsRUFBRTs7UUFUaEUseURBQXlEO1FBQ3hDLGtCQUFhLEdBQUcsSUFBSSxHQUFHLEVBQWtDLENBQUM7UUFDM0Usa0VBQWtFO1FBQ2pELGtCQUFhLEdBQUcsSUFBSSxHQUFHLEVBQTRDLENBQUM7UUFFckUsVUFBSyxHQUFHLElBQUksR0FBRyxFQUF1QixDQUFDO1FBS3JELCtDQUErQztRQUMvQyxNQUFNLE9BQU8sR0FBRyxPQUFPLE9BQU8sS0FBSyxXQUFXLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxhQUFhLENBQUM7UUFFdEYsSUFBSSxDQUFDLGdCQUFnQixHQUFHLG1CQUFtQixDQUFDLENBQUMsTUFBQSxNQUFNLENBQUMsZUFBZSxtQ0FBSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxNQUFNLENBQUMsWUFBWSxDQUFDLENBQUM7UUFDdEgsSUFBSSxDQUFDLGlCQUFpQixHQUFHLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBQztRQUNsRCxJQUFJLENBQUMsZUFBZSxHQUFHLFFBQVEsSUFBSSxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxPQUFPLEtBQUssWUFBWSxDQUFDO1FBRXZGLElBQUksQ0FBQyxNQUFNLEdBQUcsT0FBTyxNQUFNLENBQUMsTUFBTSxLQUFLLFNBQVMsQ0FBQyxDQUFDLENBQUMsTUFBTSxD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