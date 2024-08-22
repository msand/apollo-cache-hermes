import { addTypenameToDocument } from '@apollo/client/utilities';
import isEqual from '@wry/equality';
import { TypePolicies, InMemoryCacheConfig } from '@apollo/client';

import { ApolloTransaction } from '../apollo/Transaction';
import { CacheSnapshot } from '../CacheSnapshot';
import { areChildrenDynamic, expandVariables } from '../ParsedQueryNode';
import { JsonObject } from '../primitive';
import { EntityId, NodeId, OperationInstance, RawOperation } from '../schema';
import { DocumentNode, isObject } from '../util';
import { GraphSnapshot } from '../GraphSnapshot';

import { ConsoleTracer } from './ConsoleTracer';
import { QueryInfo } from './QueryInfo';
import { Tracer } from './Tracer';

// Augment DocumentNode type with Hermes's properties
// Because react-apollo can call us without doing transformDocument
// to be safe, we will always call transformDocument then flag that
// we have already done so to not repeating the process.
declare module 'graphql/language/ast' {
  export interface DocumentNode {
    /** Indicating that query has already ran transformDocument */
    hasBeenTransformed?: boolean;
  }
}

export namespace CacheContext {

  export type EntityIdForNode = (node: JsonObject) => EntityId | undefined;
  export type EntityIdForValue = (value: any) => EntityId | undefined;
  export type EntityIdMapper = (node: JsonObject) => string | number | undefined;
  export type EntityTransformer = (node: JsonObject) => void;
  export type OnChangeCallback = (newCacheShapshot: CacheSnapshot, editedNodeIds: Set<String>) => void;

  /**
   * Expected to return an EntityId or undefined, but we loosen the restrictions
   * for ease of declaration.
   */
  export type ResolverRedirect = (args: JsonObject) => any;
  export type ResolverRedirects = {
    [typeName: string]: {
      [fieldName: string]: ResolverRedirect,
    },
  };

  /**
   * Callback that is triggered when an entity is edited within the cache.
   */
  export interface EntityUpdater<TSerialized = GraphSnapshot> {
    // TODO: It's a bit odd that this is the _only_ Apollo-specific interface
    // that we're exposing.  Do we want to keep that?  It does mirror a
    // mutation's update callback nicely.
    (dataProxy: ApolloTransaction<TSerialized>, entity: any, previous: any): void;
  }

  export interface EntityUpdaters<TSerialized = GraphSnapshot> {
    [typeName: string]: EntityUpdater<TSerialized>;
  }

  export type PossibleTypesMap = {
    [supertype: string]: string[],
  };

  /**
   * Configuration for a Hermes cache.
   */
  export interface Configuration<TSerialized = GraphSnapshot> {

    typePolicies?: TypePolicies;

    /** Whether __typename should be injected into nodes in queries. */
    addTypename?: boolean;
    possibleTypes?: PossibleTypesMap;
    fragments?: InMemoryCacheConfig['fragments'];
    /**
     * @deprecated
     * Using `canonizeResults` can result in memory leaks so we generally do not
     * recommend using this option anymore.
     * A future version of Apollo Client will contain a similar feature.
     */
    canonizeResults?: boolean;

    /**
     * Given a node, determines a _globally unique_ identifier for it to be used
     * by the cache.
     *
     * Generally, any node that is considered to be an entity (domain object) by
     * the application should be given an id.  All entities are normalized
     * within the cache; everything else is not.
     */
    entityIdForNode?: EntityIdMapper;
    dataIdFromObject?: EntityIdMapper;

    /**
     * Transformation function to be run on entity nodes that change during
     * write operation; an entity node is defined by `entityIdForNode`.
     */
    entityTransformer?: EntityTransformer;

    /**
     * Whether values in the graph should be frozen.
     *
     * Defaults to true unless process.env.NODE_ENV === 'production'
     */
    freeze?: boolean;

    /**
     * Parameterized fields that should redirect to entities in the cache when
     * there is no value currently cached for their location.
     *
     * Note that you may only redirect to _entities_ within the graph.
     * Redirection to arbitrary nodes is not supported.
     */
    resolverRedirects?: ResolverRedirects;

    /**
     * Callbacks that are triggered when entities of a given type are changed.
     *
     * These provide the opportunity to make edits to the cache based on the
     * values that were edited within entities.  For example: keeping a filtered
     * list in sync w/ the values within it.
     *
     * Note that these callbacks are called immediately before a transaction is
     * committed.  You will not see their effect _during_ a transaction.
     */
    entityUpdaters?: EntityUpdaters<TSerialized>;

    /**
     * Callback that is triggered when there is a change in the cache.
     *
     * This allow the cache to be integrated with external tools such as Redux.
     * It allows other tools to be notified when there are changes.
     */
    onChange?: OnChangeCallback;

    /**
     * The tracer to instrument the cache with.
     *
     * If not supplied, a ConsoleTracer will be constructed, with `verbose` and
     * `logger` passed as its arguments.
     */
    tracer?: Tracer;

    /**
     * Whether strict mode is enabled (defaults to true).
     */
    strict?: boolean;

    /**
     * Whether debugging information should be logged out.
     *
     * Enabling this will cause the cache to emit log events for most operations
     * performed against it.
     *
     * Ignored if `tracer` is supplied.
     */
    verbose?: boolean;

    /**
     * The logger to use when emitting messages. By default, `console`.
     *
     * Ignored if `tracer` is supplied.
     */
    logger?: ConsoleTracer.Logger;
  }

}

/**
 * Configuration and shared state used throughout the cache's operation.
 */
export class CacheContext<TSerialized = GraphSnapshot> {

  /** Retrieve the EntityId for a given node, if any. */
  readonly entityIdForValue: CacheContext.EntityIdForValue;

  /** Run transformation on changed entity node, if any. */
  readonly entityTransformer: CacheContext.EntityTransformer | undefined;

  /** Whether we should freeze snapshots after writes. */
  readonly freezeSnapshots: boolean;

  /** Whether the cache should emit debug level log events. */
  readonly verbose: boolean;

  /** Configured resolver redirects. */
  readonly resolverRedirects: CacheContext.ResolverRedirects;

  /** Configured entity updaters. */
  readonly entityUpdaters: CacheContext.EntityUpdaters<TSerialized>;

  /** Configured on-change callback */
  readonly onChange: CacheContext.OnChangeCallback | undefined;

  /** Whether the cache should operate in strict mode. */
  readonly strict: boolean;

  /** The tracer we should use. */
  readonly tracer: Tracer;

  /** Whether __typename should be injected into nodes in queries. */
  readonly addTypename: boolean;

  /** All currently known & processed GraphQL documents. */
  private readonly _queryInfoMap = new Map<string, QueryInfo<TSerialized>>();
  /** All currently known & parsed queries, for identity mapping. */
  private readonly _operationMap = new Map<string, OperationInstance<TSerialized>[]>();

  public readonly dirty = new Map<NodeId, Set<string>>();

  public readonly typePolicies: TypePolicies | undefined;

  constructor(config: CacheContext.Configuration<TSerialized> = {}) {
    // Infer dev mode from NODE_ENV, by convention.
    const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';

    this.entityIdForValue = _makeEntityIdMapper((config.entityIdForNode ?? config.dataIdFromObject), config.typePolicies);
    this.entityTransformer = config.entityTransformer;
    this.freezeSnapshots = 'freeze' in config ? !!config.freeze : nodeEnv !== 'production';

    this.strict = typeof config.strict === 'boolean' ? config.strict : true;
    this.verbose = !!config.verbose;
    this.resolverRedirects = config.resolverRedirects || {};
    this.onChange = config.onChange;
    this.entityUpdaters = config.entityUpdaters || {};
    this.tracer = config.tracer || new ConsoleTracer(!!config.verbose, config.logger);

    this.addTypename = config.addTypename ?? true;
    this.typePolicies = config.typePolicies;
  }

  /**
   * Performs any transformations of operation documents.
   *
   * Cache consumers should call this on any operation document prior to calling
   * any other method in the cache.
   */
  transformDocument(document: DocumentNode): DocumentNode {
    if (this.addTypename && !document.hasBeenTransformed) {
      const transformedDocument = addTypenameToDocument(document);
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
  parseOperation(raw: RawOperation): OperationInstance<TSerialized> {
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
      if (instance.rootId !== raw.rootId) continue;
      if (!isEqual(instance.variables, raw.variables)) continue;
      return instance;
    }

    const updateRaw: RawOperation = {
      ...raw,
      document: this.transformDocument(raw.document),
    };

    const rootHasReadPolicy = Object.keys(this.typePolicies?.Query?.fields ?? {}).length > 0;

    const info = this._queryInfo(cacheKey, updateRaw);
    const fullVariables = { ...info.variableDefaults, ...updateRaw.variables } as JsonObject;
    const operation = {
      info,
      rootId: updateRaw.rootId,
      parsedQuery: expandVariables(info.parsed, fullVariables),
      isStatic: !areChildrenDynamic(info.parsed) && !rootHasReadPolicy,
      variables: updateRaw.variables,
      propMap: info.propMap,
    };
    operationInstances.push(operation);

    return operation;
  }

  /**
   * Retrieves a memoized QueryInfo for a given GraphQL document.
   */
  private _queryInfo(cacheKey: string, raw: RawOperation): QueryInfo<TSerialized> {
    if (!this._queryInfoMap.has(cacheKey)) {
      this._queryInfoMap.set(cacheKey, new QueryInfo(this, raw));
    }
    return this._queryInfoMap.get(cacheKey)!;
  }

}

/**
 * Wrap entityIdForNode so that it coerces all values to strings.
 */
export function _makeEntityIdMapper(
  idForNode: CacheContext.EntityIdMapper | undefined,
  typePolicies: TypePolicies | undefined,
): CacheContext.EntityIdForValue {
  const mapper = idForNode || (
    !typePolicies ? defaultEntityIdMapper
      : (node: JsonObject): string | number | undefined => {
        if (!node) {
          return undefined;
        }
        const { __typename } = node;
        if (typeof __typename === 'string' && __typename in typePolicies) {
          const keyFields = typePolicies[__typename].keyFields;
          if (Array.isArray(keyFields)) {
            const keys: Record<string, unknown> = {};
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
      }
  );
  return function entityIdForNode(node: JsonObject) {
    if (!isObject(node)) return undefined;

    // We don't trust upstream implementations.
    const entityId = mapper(node);
    if (typeof entityId === 'string') return entityId;
    if (typeof entityId === 'number') return String(entityId);
    return undefined;
  };
}

export function defaultEntityIdMapper({ __typename, _id, id = _id }: { __typename?: any, _id?: any, id?: any }) {
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

export function operationCacheKey(document: DocumentNode, fragmentName?: string) {
  if (fragmentName) {
    return `${fragmentName}❖${document.loc!.source.body}`;
  }
  return document.loc!.source.body;
}
