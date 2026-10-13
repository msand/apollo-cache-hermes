import { addTypenameToDocument, print } from '@apollo/client/utilities';
import { invariant } from '@apollo/client/utilities/invariant';
import isEqual from '@wry/equality';
import type {
  FragmentRegistryAPI,
  InputObjectsOption,
  PossibleTypesMap,
  Scalar,
  TypePolicies,
} from '@apollo/client/cache';

import { ApolloTransaction } from '../apollo/Transaction';
import { CacheSnapshot } from '../CacheSnapshot';
import { areChildrenDynamic, expandVariables, SelectionCondition } from '../ParsedQueryNode';
import { JsonObject } from '../primitive';
import { EntityId, NodeId, OperationInstance, RawOperation } from '../schema';
import { DocumentNode, isObject } from '../util';
import { GraphSnapshot } from '../GraphSnapshot';
import { FieldStorage } from '../operations/fieldFunctions';

import { ConsoleTracer } from './ConsoleTracer';
import { QueryInfo } from './QueryInfo';
import { ScalarConfig } from './scalars';
import { StoreFieldNames } from './storeFieldNames';
import { Tracer } from './Tracer';

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
      [fieldName: string]: ResolverRedirect;
    };
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

  /**
   * Configuration for a Hermes cache.
   */
  export interface Configuration<TSerialized = GraphSnapshot> {
    typePolicies?: TypePolicies;

    /**
     * Custom scalar implementations, by scalar type name (like InMemoryCache's
     * option); fields use them through `scalar` field policies.
     */
    scalars?: Record<string, Scalar<any, any>>;

    /**
     * The scalar types of input object fields, for serializing variables (like
     * InMemoryCache's option).
     */
    inputObjects?: InputObjectsOption;

    /**
     * Whether __typename should be injected into nodes in queries.
     *
     * Defaults to true, matching InMemoryCache in @apollo/client 4, which
     * always adds __typename (and no longer has this option). Passing false is
     * still supported for backwards compatibility.
     */
    addTypename?: boolean;

    /** Fragments that operations may spread without defining them (like InMemoryCache's option). */
    fragments?: FragmentRegistryAPI;

    /**
     * The subtypes of abstract (interface/union) types, used to match fragment
     * type conditions against __typename (like InMemoryCache's option).
     *
     * Subtypes that are not valid type names are treated as regular expressions.
     */
    possibleTypes?: PossibleTypesMap;

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
  /** Transformed documents by input; @apollo/client matches documents by identity (e.g. refetchQueries). */
  private readonly _transformedDocuments = new WeakMap<DocumentNode, DocumentNode>();
  /**
   * Documents this context produced, which need no further transformation.
   * Because react-apollo can call us without doing transformDocument, we always
   * transform, and skip documents we already transformed. (Tracked by identity
   * rather than a flag on the document, which copies made by e.g. graphql's
   * visit() in a custom DocumentTransform would inherit while still needing
   * fragments from the registry.)
   */
  private readonly _transformedOutputs = new WeakSet<DocumentNode>();

  private readonly _queryInfoMap = new Map<string, QueryInfo<TSerialized>>();
  /** All currently known & parsed queries, for identity mapping. */
  private readonly _operationMap = new Map<string, OperationInstance<TSerialized>[]>();

  public readonly dirty = new Map<NodeId, Set<string>>();

  /** The type policies (with read functions that parse custom scalar fields). */
  public readonly typePolicies: TypePolicies | undefined;

  /** Custom scalar support. */
  public readonly scalars: ScalarConfig;

  public readonly fragments: FragmentRegistryAPI | undefined;

  /** The (transitive, once matched) supertypes of each type in possibleTypes. */
  private readonly _supertypeMap = new Map<string, Set<string>>();

  /** possibleTypes subtypes that are regular expressions, by their source. */
  private readonly _fuzzySubtypes = new Map<string, RegExp>();

  /** Whether possibleTypes has (fuzzy) regular expression subtypes. */
  get hasFuzzySubtypes(): boolean {
    return this._fuzzySubtypes.size > 0;
  }

  /** The options.storage objects of read and merge functions. */
  public readonly fieldStorage = new FieldStorage();

  /** The storage identities of fields (per their keyArgs policies). */
  public readonly storeFieldNames: StoreFieldNames;

  constructor(config: CacheContext.Configuration<TSerialized> = {}) {
    // Infer dev mode from NODE_ENV, by convention.
    const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';

    this.entityIdForValue = _makeEntityIdMapper(config.entityIdForNode ?? config.dataIdFromObject, config.typePolicies);
    this.entityTransformer = config.entityTransformer;
    this.freezeSnapshots = 'freeze' in config ? !!config.freeze : nodeEnv !== 'production';

    this.strict = typeof config.strict === 'boolean' ? config.strict : true;
    this.verbose = !!config.verbose;
    this.resolverRedirects = config.resolverRedirects || {};
    this.onChange = config.onChange;
    this.entityUpdaters = config.entityUpdaters || {};
    this.tracer = config.tracer || new ConsoleTracer(!!config.verbose, config.logger);

    this.addTypename = config.addTypename ?? true;
    this.scalars = new ScalarConfig(config.scalars, config.inputObjects, config.typePolicies, (supertype, typename) =>
      this.fragmentMatches(supertype, typename),
    );
    this.typePolicies = this.scalars.withScalarReads(config.typePolicies);
    this.storeFieldNames = new StoreFieldNames(config.typePolicies);
    this.fragments = config.fragments;
    if (config.possibleTypes) {
      this.addPossibleTypes(config.possibleTypes);
    }
  }

  /**
   * Registers subtypes of abstract types (like InMemoryCache's
   * policies.addPossibleTypes).
   */
  addPossibleTypes(possibleTypes: PossibleTypesMap) {
    for (const supertype of Object.keys(possibleTypes)) {
      // Make sure all supertypes have an entry, so that fragmentMatches can
      // return false immediately for unknown supertypes.
      this._getSupertypeSet(supertype);
      for (const subtype of possibleTypes[supertype]) {
        this._getSupertypeSet(subtype).add(supertype);
        const match = subtype.match(TypeOrFieldNameRegExp);
        if (!match || match[0] !== subtype) {
          this._fuzzySubtypes.set(subtype, new RegExp(subtype));
        }
      }
    }
  }

  /**
   * Whether a field selected under `conditions` applies to an object with the
   * given __typename.
   *
   * Like Hermes always has (and unlike InMemoryCache), fields of fragments
   * apply to objects of unknown type.  When writing, pass `hasValue` (whether
   * the payload has a value for the field) to also consider fuzzy subtypes.
   */
  conditionsMatch(
    conditions: readonly SelectionCondition[] | undefined,
    typename: unknown,
    hasValue?: boolean | (() => boolean),
  ) {
    if (!conditions || typeof typename !== 'string') return true;
    return conditions.some(
      ({ typeConditions }) =>
        !typeConditions || typeConditions.every(supertype => this.fragmentMatches(supertype, typename, hasValue)),
    );
  }

  /**
   * Whether a fragment with the type condition `supertype` applies to objects
   * of type `typename` (mirroring InMemoryCache's policies.fragmentMatches).
   *
   * Fuzzy (regular expression) subtypes are only considered when
   * `checkFuzzySubtypes` is set (or, as a function, returns true, like
   * InMemoryCache's check that the result has the fragment's fields); positive
   * matches are remembered.
   */
  fragmentMatches(supertype: string, typename: string, checkFuzzySubtypes?: boolean | (() => boolean)): boolean {
    // Common case: the type condition and __typename are the same.
    if (typename === supertype) return true;
    if (!this._supertypeMap.has(supertype)) return false;

    const typenameSupertypeSet = this._getSupertypeSet(typename);
    const workQueue = [typenameSupertypeSet];
    const maybeEnqueue = (subtype: string) => {
      const supertypeSet = this._supertypeMap.get(subtype);
      if (supertypeSet && supertypeSet.size && workQueue.indexOf(supertypeSet) < 0) {
        workQueue.push(supertypeSet);
      }
    };

    let needToCheckFuzzySubtypes = !!checkFuzzySubtypes && this._fuzzySubtypes.size > 0;
    let checkingFuzzySubtypes = false;
    // Note that workQueue can grow while we're iterating over it.
    for (let i = 0; i < workQueue.length; ++i) {
      const supertypeSet = workQueue[i];
      if (supertypeSet.has(supertype)) {
        // Like InMemoryCache, report subtypes inferred from fuzzy possibleTypes.
        if (checkingFuzzySubtypes) invariant.warn('Inferring subtype %s of supertype %s', typename, supertype);
        // Record positive results for faster future lookup.
        typenameSupertypeSet.add(supertype);
        return true;
      }
      supertypeSet.forEach(maybeEnqueue);

      // Check fuzzy subtypes only after exhausting all non-fuzzy subtypes.
      if (
        needToCheckFuzzySubtypes &&
        i === workQueue.length - 1 &&
        (typeof checkFuzzySubtypes !== 'function' || checkFuzzySubtypes())
      ) {
        needToCheckFuzzySubtypes = false;
        checkingFuzzySubtypes = true;
        this._fuzzySubtypes.forEach((regExp, fuzzyString) => {
          const match = typename.match(regExp);
          if (match && match[0] === typename) {
            maybeEnqueue(fuzzyString);
          }
        });
      }
    }

    return false;
  }

  private _getSupertypeSet(subtype: string) {
    let supertypeSet = this._supertypeMap.get(subtype);
    if (!supertypeSet) {
      this._supertypeMap.set(subtype, (supertypeSet = new Set()));
    }
    return supertypeSet;
  }

  /**
   * Performs any transformations of operation documents.
   *
   * Cache consumers should call this on any operation document prior to calling
   * any other method in the cache.
   */
  transformDocument(document: DocumentNode): DocumentNode {
    if (this._transformedOutputs.has(document) || (!this.addTypename && !this.fragments)) return document;

    let transformedDocument = this._transformedDocuments.get(document);
    if (!transformedDocument) {
      transformedDocument = this.fragments ? this.fragments.transform(document) : document;
      if (this.addTypename) transformedDocument = addTypenameToDocument(transformedDocument);
      // A document the transforms left unchanged is still the caller's own document.
      if (transformedDocument !== document) this._transformedOutputs.add(transformedDocument);
      this._transformedDocuments.set(document, transformedDocument);
    }
    return transformedDocument;
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
    // ApolloClient passes documents it already transformed with transformDocument.
    // Their __typename fields are part of the query as the client sees it.
    // Like InMemoryCache, custom scalar variables are serialized.
    const variables = this.scalars.serializeVariables(raw.document, raw.variables);
    if (variables !== raw.variables) raw = { ...raw, variables };
    const pretransformed = this._transformedOutputs.has(raw.document);
    const cacheKey = `${operationCacheKey(raw.document, raw.fragmentName)}${pretransformed ? '❖transformed' : ''}`;
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

    const rootHasReadPolicy = Object.values(this.typePolicies ?? {}).some(
      policy => Object.keys(policy?.fields ?? {}).length > 0,
    );

    const info = this._queryInfo(cacheKey, updateRaw, pretransformed);
    const fullVariables = { ...info.variableDefaults, ...updateRaw.variables } as JsonObject;
    // Like InMemoryCache, treat variables without a value as undefined (e.g. @export variables before they are resolved).
    for (const name of info.variables) {
      if (!(name in fullVariables)) fullVariables[name] = undefined as any;
    }
    const operation = {
      info,
      document: raw.document,
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
  private _queryInfo(cacheKey: string, raw: RawOperation, pretransformed: boolean): QueryInfo<TSerialized> {
    if (!this._queryInfoMap.has(cacheKey)) {
      this._queryInfoMap.set(cacheKey, new QueryInfo(this, raw, pretransformed));
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
  const mapper =
    idForNode ||
    (!typePolicies
      ? defaultEntityIdMapper
      : (node: JsonObject): string | number | undefined => {
          if (!node) {
            return undefined;
          }
          const { __typename } = node;
          if (typeof __typename === 'string' && __typename in typePolicies) {
            const keyFields = typePolicies[__typename].keyFields;
            // Like InMemoryCache, keyFields: false disables normalization.
            if (keyFields === false) return undefined;
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
          // Like InMemoryCache, objects without a __typename are not normalized.
          return __typename ? `${__typename}:${id}` : undefined;
        });
  return function entityIdForNode(node: JsonObject) {
    if (!isObject(node)) return undefined;

    // We don't trust upstream implementations.
    const entityId = mapper(node);
    if (typeof entityId === 'string') return entityId;
    if (typeof entityId === 'number') return String(entityId);
    return undefined;
  };
}

export function defaultEntityIdMapper({ __typename, _id, id = _id }: { __typename?: any; _id?: any; id?: any }) {
  if (id == null) {
    return undefined;
  }
  const idType = typeof id;
  const numberOrString = idType === 'number' || idType === 'string';
  // Like InMemoryCache, objects without a __typename are not normalized.
  if (typeof __typename !== 'string') {
    return undefined;
  }
  return `${__typename}:${numberOrString ? id : JSON.stringify(id)}`;
}

// Matches valid GraphQL type names (like InMemoryCache's).
const TypeOrFieldNameRegExp = /^[_a-z][_0-9a-z]*/i;

export function operationCacheKey(document: DocumentNode, fragmentName?: string) {
  if (fragmentName) {
    return `${fragmentName}❖${documentSource(document)}`;
  }
  return documentSource(document);
}

// Documents are keyed by their printed form, not by loc.source.body: documents built by visit()
// (document transforms, directive removal) keep the original document's loc, so its source body
// would make a transformed document share the original's parsed operation.
const printedDocuments = new WeakMap<DocumentNode, string>();
function documentSource(document: DocumentNode): string {
  let printed = printedDocuments.get(document);
  if (printed === undefined) printedDocuments.set(document, (printed = print(document)));
  return printed;
}
