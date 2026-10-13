import type {
  FieldMergeFunction,
  FieldReadFunction,
  KeyArgsFunction,
  PossibleTypesMap,
  ReadFieldOptions,
  TypePolicies,
  TypePolicy,
} from '@apollo/client/cache';
import { isReference } from '@apollo/client/utilities';
import { invariant } from '@apollo/client/utilities/invariant';

import type { JsonObject } from '../primitive';
import { isObject } from '../util';

import { hasOwn, isDev } from './helpers';
import {
  isKeyFieldsSpecifierFn,
  keyArgsFnFromSpecifier,
  keyFieldsFnFromSpecifier,
  simpleKeyArgsFn,
  TypeOrFieldNameRegExp,
} from './storeFieldNames';
import type { KeyFieldsContext, KeyFieldsContextWithMissing, KeyFieldsFunction } from './storeFieldNames';

/**
 * A field policy, as InMemoryCache's Policies keeps them: the policies a type
 * declares for a field (or inherits from a supertype) merged together.
 */
export interface InternalFieldPolicy {
  /** The type whose policy declared the field policy (a supertype, if inherited). */
  typename: string;
  keyFn?: KeyArgsFunction;
  read?: FieldReadFunction<any>;
  /** A merge function, or the merge: true/false shorthand. */
  merge?: FieldMergeFunction<any> | boolean;
  scalar?: string;
}

/** A type policy, as InMemoryCache's Policies keeps them. */
export interface InternalTypePolicy {
  keyFn?: KeyFieldsFunction;
  /** A merge function, or the merge: true/false shorthand. */
  merge?: FieldMergeFunction<any> | boolean;
  fields: Record<string, InternalFieldPolicy>;
}

/** Identifies an object (like InMemoryCache's dataIdFromObject option). */
export type DataIdFromObject = (object: JsonObject, context?: KeyFieldsContext) => string | number | undefined;

/** The root operation types, by the ids of their root objects. */
export type RootId = 'ROOT_QUERY' | 'ROOT_MUTATION' | 'ROOT_SUBSCRIPTION';

const nullKeyFieldsFn: KeyFieldsFunction = () => undefined;

/**
 * The type policies and possibleTypes of a cache, like InMemoryCache's
 * Policies (and with its API for adding to them: addTypePolicies and
 * addPossibleTypes).
 *
 * Like InMemoryCache's, a type inherits the policies (keyFields, merge, and
 * field policies) of its possibleTypes supertypes, when its policy is first
 * used; policies may be added in any order until then.
 */
export class Policies {
  private readonly _typePolicies: Record<string, InternalTypePolicy> = Object.create(null);

  /** Type policies to merge into a type's policy the next time it is used. */
  private readonly _toBeAdded: Record<string, TypePolicy[]> = Object.create(null);

  /** The (transitive, once matched) supertypes of each type in possibleTypes. */
  private readonly _supertypeMap = new Map<string, Set<string>>();

  /** possibleTypes subtypes that are regular expressions, by their source. */
  private readonly _fuzzySubtypes = new Map<string, RegExp>();

  /** The ids of the root objects, by their __typename. */
  readonly rootIdsByTypename: Record<string, RootId> = Object.create(null);

  /** The __typename of each root object, by its id. */
  readonly rootTypenamesById: Record<RootId, string> = Object.create(null);

  /** Whether any type policy configures fields (directly or through inheritance). */
  hasFieldPolicies = false;

  /** Whether any type policy configures keyFields. */
  hasKeyFields = false;

  constructor(
    config: {
      dataIdFromObject?: DataIdFromObject;
      possibleTypes?: PossibleTypesMap;
      typePolicies?: TypePolicies;
    } = {},
    /** Called when policies (or possibleTypes) are added to a cache already in use. */
    private readonly _onChange?: () => void,
  ) {
    this._dataIdFromObject = config.dataIdFromObject;
    this._setRootTypename('Query');
    this._setRootTypename('Mutation');
    this._setRootTypename('Subscription');
    if (config.possibleTypes) this._addPossibleTypes(config.possibleTypes);
    if (config.typePolicies) this._addTypePolicies(config.typePolicies);
  }

  private readonly _dataIdFromObject: DataIdFromObject | undefined;

  /** Whether possibleTypes has (fuzzy) regular expression subtypes. */
  get hasFuzzySubtypes(): boolean {
    return this._fuzzySubtypes.size > 0;
  }

  /**
   * The id of an object (like InMemoryCache's Policies#identify): per its
   * type's keyFields (or the dataIdFromObject option, or the default of
   * __typename and id).
   *
   * Returns the id, and the path of the key field the object is missing (if
   * that is why it could not be identified).
   *
   * `getStoreObject` lazily provides the object's fields by their schema names
   * (the context's storeObject), for keyFields policies.
   */
  identify(
    object: JsonObject,
    partialContext?: Partial<KeyFieldsContext>,
    getStoreObject?: () => JsonObject,
  ): [string?, string?] {
    const typename = partialContext?.typename || partialContext?.storeObject?.__typename || object.__typename;
    const keyFn = typeof typename === 'string' ? this.getTypePolicy(typename).keyFn : undefined;

    if (!keyFn) {
      const id = this._dataIdFromObject ? this._dataIdFromObject(object) : defaultDataIdFromObject(object);
      // Unlike InMemoryCache, ids may be numbers (made strings).
      return [typeof id === 'string' ? id : typeof id === 'number' ? String(id) : undefined];
    }

    const storeObject = (partialContext?.storeObject ?? getStoreObject?.() ?? object) as JsonObject;
    const context: KeyFieldsContextWithMissing = {
      ...partialContext,
      typename: typename as string,
      storeObject,
      readField:
        partialContext?.readField ??
        (((...args: any[]) => {
          const [fieldNameOrOptions, from] = args;
          const options: ReadFieldOptions =
            typeof fieldNameOrOptions === 'string'
              ? { fieldName: fieldNameOrOptions, from: args.length > 1 ? from : storeObject }
              : { from: storeObject, ...fieldNameOrOptions };
          const fieldName = options.field?.name.value ?? options.fieldName;
          // Hermes only reads key fields from (non-normalized) objects.
          if (!options.from || isReference(options.from) || !fieldName) return undefined;
          return (options.from as JsonObject)[fieldName];
        }) as KeyFieldsContext['readField']),
    };

    let id: unknown;
    let fn: KeyFieldsFunction | undefined = keyFn;
    const merged = storeObject === object ? object : { ...object, ...storeObject };
    while (fn) {
      const specifierOrId = fn(merged, context);
      if (Array.isArray(specifierOrId)) {
        fn = keyFieldsFnFromSpecifier(specifierOrId);
      } else {
        id = specifierOrId;
        break;
      }
    }

    if (typeof id === 'number') id = String(id);
    return [typeof id === 'string' && id ? id : undefined, context.missingKeyField];
  }

  /** Whether the type's policy identifies its objects with a keyFields function. */
  hasKeyFieldsFunction(typename: unknown): boolean {
    if (typeof typename !== 'string') return false;
    const { keyFn } = this.getTypePolicy(typename);
    return !!keyFn && keyFn !== nullKeyFieldsFn && !isKeyFieldsSpecifierFn(keyFn);
  }

  /** Adds type policies (like InMemoryCache's Policies#addTypePolicies). */
  addTypePolicies(typePolicies: TypePolicies): void {
    this._addTypePolicies(typePolicies);
    this._onChange?.();
  }

  /** Adds possibleTypes (like InMemoryCache's Policies#addPossibleTypes). */
  addPossibleTypes(possibleTypes: PossibleTypesMap): void {
    this._addPossibleTypes(possibleTypes);
    this._onChange?.();
  }

  private _addTypePolicies(typePolicies: TypePolicies) {
    for (const typename of Object.keys(typePolicies)) {
      const { queryType, mutationType, subscriptionType, ...incoming } = typePolicies[typename];

      // Root types cannot be inherited, so they are set right away.
      if (queryType) this._setRootTypename('Query', typename);
      if (mutationType) this._setRootTypename('Mutation', typename);
      if (subscriptionType) this._setRootTypename('Subscription', typename);

      if (incoming.fields && Object.keys(incoming.fields).length) this.hasFieldPolicies = true;
      if (incoming.keyFields !== undefined) this.hasKeyFields = true;

      if (hasOwn.call(this._toBeAdded, typename)) {
        this._toBeAdded[typename].push(incoming);
      } else {
        this._toBeAdded[typename] = [incoming];
      }
    }
  }

  private _updateTypePolicy(
    typename: string,
    incoming: TypePolicy,
    existingFieldPolicies: Record<string, InternalFieldPolicy>,
  ) {
    const existing = this.getTypePolicy(typename);
    const { keyFields, fields } = incoming;

    // Type policies can define merge functions, as an alternative to using
    // field policies to merge child objects.
    if (incoming.merge !== undefined) existing.merge = incoming.merge;

    existing.keyFn =
      // Pass false to disable normalization for this typename.
      keyFields === false
        ? nullKeyFieldsFn
        : // Pass an array of strings to use those fields to compute a
          // composite ID for objects of this typename.
          Array.isArray(keyFields)
          ? keyFieldsFnFromSpecifier(keyFields)
          : // Pass a function to take full control over identification.
            typeof keyFields === 'function'
            ? (keyFields as KeyFieldsFunction)
            : // Leave existing.keyFn unchanged if above cases fail.
              existing.keyFn;

    if (!fields) return;
    for (const fieldName of Object.keys(fields)) {
      let existingField: InternalFieldPolicy | undefined = existingFieldPolicies[fieldName];
      // Field policy inheritance is atomic/shallow: an inherited field policy
      // is replaced rather than updated.
      if (!existingField || existingField.typename !== typename) {
        existingField = existingFieldPolicies[fieldName] = { typename };
      }
      const incomingField = fields[fieldName];

      if (typeof incomingField === 'function') {
        if (existingField.scalar) {
          if (isDev()) warnAboutScalarConfig(typename, fieldName, existingField.scalar, 'read');
        } else {
          existingField.read = incomingField;
        }
      } else {
        const { keyArgs, scalar } = incomingField;
        let { read, merge } = incomingField;

        if (scalar) existingField.scalar = scalar;

        if (existingField.scalar) {
          if (isDev()) {
            if (read !== undefined || existingField.read !== undefined) {
              warnAboutScalarConfig(typename, fieldName, existingField.scalar, 'read');
            }
            if (merge !== undefined || existingField.merge !== undefined) {
              warnAboutScalarConfig(typename, fieldName, existingField.scalar, 'merge');
            }
          }
          existingField.read = read = undefined;
          existingField.merge = merge = undefined;
        }

        existingField.keyFn =
          // Pass false to disable argument-based differentiation of field identities.
          keyArgs === false
            ? simpleKeyArgsFn
            : // Pass an array of strings to use named arguments to compute a
              // composite identity for the field.
              Array.isArray(keyArgs)
              ? keyArgsFnFromSpecifier(keyArgs)
              : // Pass a function to take full control over field identity.
                typeof keyArgs === 'function'
                ? keyArgs
                : // Leave existing.keyFn unchanged if above cases fail.
                  existingField.keyFn;

        if (typeof read === 'function') existingField.read = read;
        if (merge !== undefined) existingField.merge = merge;
      }

      if (existingField.read && existingField.merge !== undefined) {
        // If we have both a read and a merge function, assume keyArgs:false,
        // because read and merge together can take responsibility for
        // interpreting arguments in and out.
        existingField.keyFn = existingField.keyFn || simpleKeyArgsFn;
      }
    }
  }

  private _setRootTypename(which: 'Query' | 'Mutation' | 'Subscription', typename: string = which) {
    const rootId = `ROOT_${which.toUpperCase()}` as RootId;
    const old = this.rootTypenamesById[rootId];
    if (typename !== old) {
      invariant(!old || old === which, `Cannot change root %s __typename more than once`, which);
      if (old) delete this.rootIdsByTypename[old];
      this.rootIdsByTypename[typename] = rootId;
      this.rootTypenamesById[rootId] = typename;
    }
  }

  /** The __typename of the root type of an operation (like InMemoryCache#getRootTypename). */
  getRootTypename(operation: 'query' | 'mutation' | 'subscription'): string {
    return this.rootTypenamesById[`ROOT_${operation.toUpperCase()}` as RootId];
  }

  /** The __typename of a root object, if `id` is the id of one. */
  rootTypename(id: string): string | undefined {
    return hasOwn.call(this.rootTypenamesById, id) ? this.rootTypenamesById[id as RootId] : undefined;
  }

  private _addPossibleTypes(possibleTypes: PossibleTypesMap) {
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
   * The policy of a type (like InMemoryCache's Policies#getTypePolicy): when
   * first used, it inherits the policies of the type's supertypes, and then
   * any policies added for the type are merged into it.
   */
  getTypePolicy(typename: string): InternalTypePolicy {
    if (!hasOwn.call(this._typePolicies, typename)) {
      const policy: InternalTypePolicy = (this._typePolicies[typename] = { fields: Object.create(null) });

      let supertypes = this._supertypeMap.get(typename);
      if (!supertypes && this._fuzzySubtypes.size) {
        // Unknown typenames inherit from the supertypes of the fuzzy subtypes
        // that match them directly.
        supertypes = this._getSupertypeSet(typename);
        this._fuzzySubtypes.forEach((regExp, fuzzy) => {
          if (regExp.test(typename)) {
            this._supertypeMap.get(fuzzy)?.forEach(supertype => supertypes!.add(supertype));
          }
        });
      }
      supertypes?.forEach(supertype => {
        const { fields, ...rest } = this.getTypePolicy(supertype);
        Object.assign(policy, rest);
        Object.assign(policy.fields, fields);
      });
    }

    const inbox = this._toBeAdded[typename];
    if (inbox && inbox.length) {
      // Merge the pending policies in the order they were added.
      for (const policy of inbox.splice(0)) {
        this._updateTypePolicy(typename, policy, this._typePolicies[typename].fields);
      }
    }

    return this._typePolicies[typename];
  }

  /** The policy of `typename.fieldName` (own or inherited), if any. */
  getFieldPolicy(typename: unknown, fieldName: string): InternalFieldPolicy | undefined {
    if (typeof typename !== 'string' || !typename) return undefined;
    return this.getTypePolicy(typename).fields[fieldName];
  }

  /** The read function of `typename.fieldName` (none for scalar fields). */
  getReadFunction(typename: unknown, fieldName: string): FieldReadFunction | undefined {
    return this.getFieldPolicy(typename, fieldName)?.read;
  }

  /** The keyArgs function of `typename.fieldName`, if any. */
  getKeyArgsFunction(typename: string, fieldName: string): KeyArgsFunction | undefined {
    return this.getFieldPolicy(typename, fieldName)?.keyFn;
  }

  /**
   * The merge policy for a value of `parentTypename.fieldName`: the field's,
   * or else that of the value's type (like InMemoryCache's getMergeFunction).
   */
  getMergeFunction(
    parentTypename: unknown,
    fieldName: string,
    childTypename: unknown,
  ): FieldMergeFunction<any> | boolean | undefined {
    let merge = this.getFieldPolicy(parentTypename, fieldName)?.merge;
    if (merge === undefined && typeof childTypename === 'string' && childTypename) {
      merge = this.getTypePolicy(childTypename).merge;
    }
    return merge;
  }

  /** The scalar type of `typename.fieldName`, if its policy has one. */
  getScalarTypeForField(typename: unknown, fieldName: string): string | undefined {
    return this.getFieldPolicy(typename, fieldName)?.scalar;
  }

  private _getSupertypeSet(subtype: string): Set<string> {
    let supertypeSet = this._supertypeMap.get(subtype);
    if (!supertypeSet) {
      this._supertypeMap.set(subtype, (supertypeSet = new Set()));
    }
    return supertypeSet;
  }

  /**
   * Whether a fragment with the type condition `supertype` applies to objects
   * of type `typename` (like InMemoryCache's Policies#fragmentMatches).
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
        if (!typenameSupertypeSet.has(supertype)) {
          // Like InMemoryCache, report subtypes inferred from fuzzy possibleTypes.
          if (checkingFuzzySubtypes) invariant.warn('Inferring subtype %s of supertype %s', typename, supertype);
          // Record positive results for faster future lookup.
          typenameSupertypeSet.add(supertype);
        }
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
}

/**
 * The default ids of objects: their __typename and id (or _id), like
 * InMemoryCache's defaultDataIdFromObject.  Like InMemoryCache, objects
 * without a __typename are not normalized.
 */
export function defaultDataIdFromObject(object: JsonObject): string | undefined {
  if (!isObject(object)) return undefined;
  const { __typename, _id } = object;
  const { id = _id } = object;
  if (id == null || typeof __typename !== 'string') return undefined;
  const numberOrString = typeof id === 'number' || typeof id === 'string';
  return `${__typename}:${numberOrString ? id : JSON.stringify(id)}`;
}

function warnAboutScalarConfig(typename: string, fieldName: string, scalar: string, kind: 'read' | 'merge') {
  invariant.warn(
    "The field policy for '%s' is configured with the '%s' scalar, so its '%s' function is ignored. Scalar configuration cannot be used with custom read or merge functions.",
    `${typename}.${fieldName}`,
    scalar,
    kind,
  );
}
