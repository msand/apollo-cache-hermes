import { addTypenameToDocument, canonicalStringify, print } from '@apollo/client/utilities';
import type {
  FragmentRegistryAPI,
  InputObjectsOption,
  PossibleTypesMap,
  Scalar,
  TypePolicies,
} from '@apollo/client/cache';

import { ApolloTransaction } from '../apollo/Transaction';
import { CacheSnapshot } from '../CacheSnapshot';
import { areChildrenDynamic, expandVariables, SelectionCondition, setSelectionSetOf } from '../ParsedQueryNode';
import { JsonObject } from '../primitive';
import { EntityId, NodeId, OperationInstance, RawOperation } from '../schema';
import { DocumentNode, isObject } from '../util';
import type { SelectionSetNode } from '../util';
import { GraphSnapshot } from '../GraphSnapshot';
import { FieldStorage } from '../operations/fieldFunctions';
import type { CheckedSubtrees, OverlaidEntities } from '../operations/read';

import { ConsoleTracer } from './ConsoleTracer';
import { QueryInfo } from './QueryInfo';
import { Policies } from './policies';
import { ScalarConfig } from './scalars';
import { StoreFieldNames } from './storeFieldNames';
import type { KeyFieldsContext } from './storeFieldNames';
import { Tracer } from './Tracer';

export namespace CacheContext {
  export type EntityIdForNode = (node: JsonObject) => EntityId | undefined;
  export type EntityIdForValue = (
    value: any,
    partialContext?: Partial<KeyFieldsContext>,
    getStoreObject?: () => JsonObject,
  ) => EntityId | undefined;
  /** Like InMemoryCache's dataIdFromObject, which is also passed the KeyFieldsContext. */
  export type EntityIdMapper = (node: JsonObject, context?: KeyFieldsContext) => string | number | undefined;
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
  /**
   * Retrieve the EntityId for a given node, if any (see Policies#identify for
   * the optional arguments).
   */
  readonly entityIdForValue: CacheContext.EntityIdForValue = (value, partialContext, getStoreObject) => {
    if (!isObject(value)) return undefined;
    return this.policies.identify(value as JsonObject, partialContext, getStoreObject)[0];
  };

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

  /** The parsed operations of each known document (by its cache key; see parseOperation). */
  private readonly _documentOperations = new Map<string, DocumentOperations<TSerialized>>();

  /** The parsed operations of each document object (by fragment name), to skip computing its cache key. */
  private readonly _operationsByDocument = new WeakMap<
    DocumentNode,
    Map<string | undefined, DocumentOperations<TSerialized>>
  >();

  public readonly dirty = new Map<NodeId, Set<string>>();

  /** The type policies and possibleTypes (like InMemoryCache's policies). */
  public readonly policies: Policies;

  /** Custom scalar support. */
  public readonly scalars: ScalarConfig;

  public readonly fragments: FragmentRegistryAPI | undefined;

  /** Called when type policies or possibleTypes are added to the cache. */
  private readonly _policiesListeners = new Set<() => void>();

  /** What reads found checking entity data against static selections (see CheckedSubtree). */
  public checkedSubtrees: CheckedSubtrees = new WeakMap();

  /** What reads made of entities' data, with the values of read functions overlaid (see OverlaidEntity). */
  public overlaidEntities: OverlaidEntities = new WeakMap();

  /** The options.storage objects of read and merge functions. */
  public readonly fieldStorage = new FieldStorage();

  /** The storage identities of fields (per their keyArgs policies). */
  public readonly storeFieldNames: StoreFieldNames;

  constructor(config: CacheContext.Configuration<TSerialized> = {}) {
    // Infer dev mode from NODE_ENV, by convention.
    const nodeEnv = typeof process !== 'undefined' ? process.env.NODE_ENV : 'development';

    this.policies = new Policies(
      {
        dataIdFromObject: config.entityIdForNode ?? config.dataIdFromObject,
        possibleTypes: config.possibleTypes,
        typePolicies: config.typePolicies,
        scalars: !!config.scalars,
      },
      () => this._policiesListeners.forEach(listener => listener()),
    );
    this.entityTransformer = config.entityTransformer;
    this.freezeSnapshots = 'freeze' in config ? !!config.freeze : nodeEnv !== 'production';

    this.strict = typeof config.strict === 'boolean' ? config.strict : true;
    this.verbose = !!config.verbose;
    this.resolverRedirects = config.resolverRedirects || {};
    this.onChange = config.onChange;
    this.entityUpdaters = config.entityUpdaters || {};
    this.tracer = config.tracer || new ConsoleTracer(!!config.verbose, config.logger);

    this.addTypename = config.addTypename ?? true;
    this.scalars = new ScalarConfig(config.scalars, config.inputObjects, this.policies);
    this.storeFieldNames = new StoreFieldNames((typename, fieldName) =>
      this.policies.getKeyArgsFunction(typename, fieldName),
    );
    this.fragments = config.fragments;
    // Policies (e.g. keyFields and possibleTypes) decide what data satisfies a selection.
    this.onPoliciesChange(() => {
      this.checkedSubtrees = new WeakMap();
      this._conditionMatches = new WeakMap();
      this.forgetOverlaidEntities();
    });
  }

  /**
   * Forgets what reads made of entities with read functions' values, when
   * those may have changed without the data they read changing (e.g. when
   * reactive variables change).
   */
  forgetOverlaidEntities(): void {
    this.overlaidEntities = new WeakMap();
  }

  /** Calls `listener` whenever type policies or possibleTypes are added to the cache. */
  onPoliciesChange(listener: () => void): void {
    this._policiesListeners.add(listener);
  }

  /** The __typename of the root object `id` (e.g. ROOT_QUERY's is Query, unless renamed by queryType). */
  rootTypename(id: NodeId): string | undefined {
    return this.policies.rootTypename(id);
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
    // (Without fuzzy subtypes, which are inferred from values, the result only
    // depends on the conditions and the typename.)
    const memoize = !this.policies.hasFuzzySubtypes;
    let byTypename = memoize ? this._conditionMatches.get(conditions) : undefined;
    const known = byTypename?.get(typename);
    if (known !== undefined) return known;
    const matches = conditions.some(
      ({ typeConditions }) =>
        !typeConditions || typeConditions.every(supertype => this.fragmentMatches(supertype, typename, hasValue)),
    );
    if (memoize) {
      if (!byTypename) this._conditionMatches.set(conditions, (byTypename = new Map()));
      byTypename.set(typename, matches);
    }
    return matches;
  }

  /** What conditionsMatch found, by conditions and typename (forgotten when policies change). */
  private _conditionMatches = new WeakMap<readonly SelectionCondition[], Map<string, boolean>>();

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
    return this.policies.fragmentMatches(supertype, typename, checkFuzzySubtypes);
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
   * values, and can be used as an identity for a specific operation. (The
   * operations of a document are kept like an LRU cache: those not used
   * recently are eventually dropped, and parsed again when next used.)
   */
  parseOperation(raw: RawOperation): OperationInstance<TSerialized> {
    // It appears like Apollo or someone upstream is cloning or otherwise
    // modifying the queries that are passed down.  Thus, the operation source
    // is a more reliable cache key…
    // ApolloClient passes documents it already transformed with transformDocument.
    // Their __typename fields are part of the query as the client sees it.
    const pretransformed = this._transformedOutputs.has(raw.document);
    let byFragment = this._operationsByDocument.get(raw.document);
    let operations = byFragment?.get(raw.fragmentName);
    if (!operations) {
      const cacheKey = `${operationCacheKey(raw.document, raw.fragmentName)}${pretransformed ? '❖transformed' : ''}`;
      operations = this._documentOperations.get(cacheKey);
      if (!operations) {
        operations = new DocumentOperations();
        this._documentOperations.set(cacheKey, operations);
      }
      if (!byFragment) this._operationsByDocument.set(raw.document, (byFragment = new Map()));
      byFragment.set(raw.fragmentName, operations);
    }

    // Like InMemoryCache, custom scalar variables are serialized.
    const { variables, key: variablesKey } = operations.variablesOf(raw.variables, () =>
      this.scalars.serializeVariables(raw.document, raw.variables),
    );
    // Do we already have a copy of this guy?
    const key = `${raw.rootId}\u0000${variablesKey}`;
    const existing = operations.get(key);
    if (existing) return existing;

    const updateRaw: RawOperation = {
      ...raw,
      variables,
      document: this.transformDocument(raw.document),
    };

    operations.info ??= new QueryInfo(this, updateRaw, pretransformed);
    const { info } = operations;
    const fullVariables = { ...info.variableDefaults, ...updateRaw.variables } as JsonObject;
    // Like InMemoryCache, treat variables without a value as undefined (e.g. @export variables before they are resolved).
    for (const name of info.variables) {
      if (!(name in fullVariables)) fullVariables[name] = undefined as any;
    }
    const operation = {
      info,
      document: raw.document,
      rootId: updateRaw.rootId,
      parsedQuery: withSelectionSet(expandVariables(info.parsed, fullVariables), info.operation.selectionSet),
      // (Field policies, which may be added later, make reads dynamic too.)
      isStatic: !areChildrenDynamic(info.parsed),
      variables: updateRaw.variables,
      propMap: info.propMap,
    };
    operations.set(key, operation);

    return operation;
  }
}

/**
 * The parsed operations of a document (its QueryInfo, and the operation
 * instances for the root ids and variables it was read or written with).
 *
 * Instances are kept in two generations, like an LRU cache: when the current
 * generation is full, it becomes the previous one (dropping the one before),
 * and instances still in use move back to the current generation.
 */
class DocumentOperations<TSerialized> {
  /** The number of instances in a generation. */
  static readonly generationSize = 1000;

  info: QueryInfo<TSerialized> | undefined;

  private _current = new Map<string, OperationInstance<TSerialized>>();
  private _previous = new Map<string, OperationInstance<TSerialized>>();

  /**
   * The (serialized) variables objects of the operations, and their keys, by
   * the variables objects passed in: like Apollo Client, Hermes treats
   * variables objects as immutable.
   */
  private readonly _variables = new WeakMap<JsonObject, { variables: JsonObject | undefined; key: string }>();

  get(key: string): OperationInstance<TSerialized> | undefined {
    const current = this._current.get(key);
    if (current) return current;
    const previous = this._previous.get(key);
    if (previous) {
      this._previous.delete(key);
      this.set(key, previous);
    }
    return previous;
  }

  set(key: string, operation: OperationInstance<TSerialized>) {
    if (this._current.size >= DocumentOperations.generationSize) {
      this._previous = this._current;
      this._current = new Map();
    }
    this._current.set(key, operation);
  }

  /** The serialized variables of an operation (see `serialize`), and a key for them. */
  variablesOf(
    raw: JsonObject | undefined,
    serialize: () => JsonObject | undefined,
  ): { variables: JsonObject | undefined; key: string } {
    if (!raw) return { variables: raw, key: '' };
    let entry = this._variables.get(raw);
    if (!entry) {
      const variables = serialize();
      entry = { variables, key: canonicalStringify(variables) };
      this._variables.set(raw, entry);
    }
    return entry;
  }
}

function withSelectionSet<T extends object>(parsed: T, selectionSet: SelectionSetNode): T {
  setSelectionSetOf(parsed, selectionSet);
  return parsed;
}

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
