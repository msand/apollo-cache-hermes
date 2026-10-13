import { invariant, InvariantError } from 'ts-invariant';
import { makeReference, stringifyForDisplay } from '@apollo/client/utilities/internal';
import type {
  FieldFunctionOptions,
  FieldMergeFunctionOptions,
  ReadFieldOptions,
  Reference,
  StoreValue,
} from '@apollo/client/cache';
import type { StoreObject } from '@apollo/client/utilities';
import type { FieldNode } from 'graphql';

import type { CacheContext } from '../context';
import { storedTypename } from '../context/helpers';
import type { NodeSnapshot } from '../nodes';
import type { JsonObject, PathPart } from '../primitive';
import type { NodeId } from '../schema';
import * as util from '../util';

import * as snapshotEditor from './SnapshotEditor';

const { deepFreeze, deepGet, hasOwn, isReference, lazyImmutableDeepSet, pathBeginsWith, toOutKey } = util;

type ObjectOrReference = StoreObject | Reference;
type ToReference = FieldFunctionOptions['toReference'];

/**
 * Returns the read function for `typename.fieldName`, if any: the one its
 * field policy configures, or (for custom scalar fields) the one that parses
 * its stored value.
 */
export function getReadFunction(context: CacheContext<any>, typename: unknown, fieldName: string) {
  return context.policies.getReadFunction(typename, fieldName) ?? context.scalars.getParseRead(typename, fieldName);
}

/**
 * Like InMemoryCache's mergeObjects helper, given a way to merge an object into
 * a referenced entity.
 */
export function makeMergeObjects(
  getTypename: (value: ObjectOrReference) => unknown,
  mergeIntoEntity: (ref: Reference, value: StoreObject, valueIsOlder?: boolean) => void,
) {
  return function mergeObjects<T extends StoreObject | Reference>(existing: T, incoming: T): T {
    if (Array.isArray(existing) || Array.isArray(incoming)) {
      throw new InvariantError('Cannot automatically merge arrays');
    }
    if (isNonNullObject(existing) && isNonNullObject(incoming)) {
      const existingType = getTypename(existing);
      const incomingType = getTypename(incoming);
      if (existingType && incomingType && existingType !== incomingType) {
        return incoming;
      }
      if (isReference(existing) && !isReference(incoming)) {
        mergeIntoEntity(existing, incoming as StoreObject);
        return existing;
      }
      if (!isReference(existing) && isReference(incoming)) {
        // The entity's own fields take precedence over the existing object's.
        mergeIntoEntity(incoming, existing as StoreObject, true);
        return incoming;
      }
      if (!isReference(existing) && !isReference(incoming)) {
        return { ...existing, ...incoming };
      }
    }
    return incoming;
  };
}

function isNonNullObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/**
 * Returns `value` (found at `path` within the node `snapshot`) as it would be
 * stored by InMemoryCache: with References in place of the entities that the
 * node points to.
 *
 * Objects without a __typename (which a custom dataIdFromObject may still
 * normalize) are left as data.
 */
export function withReferences(snapshot: Readonly<NodeSnapshot> | undefined, path: PathPart[], value: any): any {
  const outbound = snapshot?.outbound;
  if (!outbound) return value;
  const direct = outbound.get(toOutKey(path));
  if (direct) return isUntypedObject(value) ? value : makeReference(direct.id);
  if (value === null || typeof value !== 'object') return value;

  let result = value;
  for (const { id, path: refPath } of outbound.values()) {
    if (refPath.length > path.length && pathBeginsWith(refPath, path)) {
      const relativePath = refPath.slice(path.length);
      if (isUntypedObject(deepGet(value, relativePath))) continue;
      result = lazyImmutableDeepSet(result, value, relativePath, makeReference(id));
    }
  }
  // Like InMemoryCache's (frozen) store values, the copy is frozen if the
  // stored value is.
  return result !== value && Object.isFrozen(value) ? deepFreeze(result) : result;
}

function isUntypedObject(value: unknown) {
  return isNonNullObject(value) && !('__typename' in value);
}

/**
 * Per-field storage objects shared by read and merge functions, keyed by the
 * identity of the object containing the field (and the path to it).
 *
 * The storage of a node's fields (whose keys start with the node's id) is
 * dropped when the node is removed from the cache (see delete), and all of it
 * when the cache is reset.
 */
export class FieldStorage {
  private _strong?: Map<unknown, FieldStorage>;
  private _weak?: WeakMap<object, FieldStorage>;
  private _storage?: Record<string, any>;

  /** Drops the storage objects whose keys start with `key` (e.g. a node's id). */
  delete(key: unknown): void {
    if (key !== null && typeof key === 'object') {
      this._weak?.delete(key);
    } else {
      this._strong?.delete(key);
    }
  }

  /** Drops every storage object. */
  clear(): void {
    this._strong = undefined;
    this._weak = undefined;
    this._storage = undefined;
  }

  get(keys: unknown[]): Record<string, any> {
    let node: FieldStorage = this;
    for (const key of keys) {
      node = node._child(key);
    }
    return (node._storage ??= Object.create(null));
  }

  private _child(key: unknown): FieldStorage {
    let child;
    if (key !== null && typeof key === 'object') {
      this._weak ??= new WeakMap();
      child = this._weak.get(key);
      if (!child) this._weak.set(key, (child = new FieldStorage()));
    } else {
      this._strong ??= new Map();
      child = this._strong.get(key);
      if (!child) this._strong.set(key, (child = new FieldStorage()));
    }
    return child;
  }
}

/**
 * Builds the options passed to read and merge functions, and implements their
 * readField helper on top of Hermes' node snapshots.
 */
export class FieldFunctions<TSerialized> {
  readonly mergeObjects: FieldFunctionOptions['mergeObjects'];

  constructor(
    private readonly _context: CacheContext<TSerialized>,
    private readonly _getNodeSnapshot: (id: NodeId) => Readonly<NodeSnapshot> | undefined,
    private readonly _variables: JsonObject | undefined,
    readonly toReference: ToReference,
    mergeIntoEntity: (ref: Reference, value: StoreObject, valueIsOlder?: boolean) => void,
  ) {
    this.mergeObjects = makeMergeObjects(value => this.getFieldValue(value, '__typename'), mergeIntoEntity);
  }

  // Like InMemoryCache: a Reference can be read if its entity exists (references
  // to deleted entities are kept, dangling), and other values if they are objects.
  canRead = (value: StoreValue): boolean => {
    return isReference(value) ? this._getNodeSnapshot(value.__ref) !== undefined : isNonNullObject(value);
  };

  /**
   * Reads the stored value of a field (with References for any entities).
   */
  getFieldValue(
    from: ObjectOrReference,
    fieldName: string,
    args?: JsonObject | null,
    typename?: unknown,
    field?: FieldNode | null,
  ): StoreValue {
    if (!isReference(from)) return from[fieldName];

    const id = from.__ref;
    const snapshot = this._getNodeSnapshot(id);
    if (!snapshot) return undefined;

    // Fields are stored as their keyArgs policies say (by default, under all
    // their arguments).
    const storeKey = this.storeKey(id, snapshot, fieldName, args, typename, field);
    if (storeKey !== undefined) {
      const fieldId = snapshotEditor.nodeIdForStoreKey(id, [fieldName], storeKey);
      const fieldSnapshot = this._getNodeSnapshot(fieldId);
      return fieldSnapshot && withReferences(fieldSnapshot, [], fieldSnapshot.data);
    }

    const data = snapshot.data;
    if (data && typeof data === 'object' && fieldName in data) {
      return withReferences(snapshot, [fieldName], (data as JsonObject)[fieldName]);
    }
    const out = snapshot.outbound?.get(fieldName);
    if (out) return makeReference(out.id);
    // Fields with arguments read without them resolve to (one of) their values.
    const parameterized = snapshot.parameterized?.get(fieldName)?.[0];
    if (parameterized) {
      const fieldSnapshot = this._getNodeSnapshot(parameterized.id);
      return fieldSnapshot && withReferences(fieldSnapshot, [], fieldSnapshot.data);
    }
    if (fieldName === '__typename') return this._context.rootTypename(id);
    return undefined;
  }

  /**
   * The store key (see StoreKey) of a field of the entity `id`.
   */
  storeKey(
    id: NodeId,
    snapshot: Readonly<NodeSnapshot> | undefined,
    fieldName: string,
    args: JsonObject | null | undefined,
    typename?: unknown,
    field?: FieldNode | null,
  ) {
    if (typename === undefined) typename = storedTypename(this._context.policies, id, snapshot?.data);
    return this._context.storeFieldNames.storeKey(typename, fieldName, args, field, this._variables);
  }

  /**
   * Implements options.readField for a read or merge function whose current
   * object is `objectOrReference`.
   */
  readField(readFieldArgs: any[], objectOrReference: ObjectOrReference | undefined): any {
    const [fieldNameOrOptions, from] = readFieldArgs;
    let options: ReadFieldOptions;
    if (typeof fieldNameOrOptions === 'string') {
      // Default to the current object only when no `from` argument was passed,
      // not when it was explicitly passed as undefined.
      options = { fieldName: fieldNameOrOptions, from: readFieldArgs.length > 1 ? from : objectOrReference };
    } else {
      options = { ...fieldNameOrOptions };
      if (!hasOwn.call(options, 'from')) options.from = objectOrReference;
    }
    if (options.from === undefined) {
      invariant.warn(
        `Undefined 'from' passed to readField with arguments %s`,
        stringifyForDisplay(Array.from(readFieldArgs)),
      );
    }

    const objectOrRef = options.from;
    const fieldName = options.field?.name.value ?? options.fieldName;
    if (!objectOrRef || !fieldName) return undefined;

    const typename = options.typename ?? this.getFieldValue(objectOrRef, '__typename');
    const args = (options.args as JsonObject | undefined) ?? null;
    const field = options.field ?? null;
    const existing = this.getFieldValue(objectOrRef, fieldName, args, typename, field);
    // (Like InMemoryCache, the scalar policies of fields with selection sets are ignored.)
    const read = field?.selectionSet
      ? this._context.policies.getReadFunction(typename, fieldName)
      : getReadFunction(this._context, typename, fieldName);
    if (!read) return existing;

    const storeFieldName = this._context.storeFieldNames.storeFieldName(
      typename,
      fieldName,
      args,
      field,
      this._variables,
    );
    const storageKey = isReference(objectOrRef) ? objectOrRef.__ref : objectOrRef;
    return read(
      existing,
      this.options(objectOrRef, fieldName, storeFieldName, args, [storageKey, storeFieldName], field),
    );
  }

  /**
   * Builds the options for a read or merge function call.
   */
  options(
    objectOrReference: ObjectOrReference | undefined,
    fieldName: string,
    storeFieldName: string,
    args: JsonObject | null,
    storageKeys: unknown[],
    field: FieldNode | null = null,
  ): FieldFunctionOptions {
    const readField = (...readFieldArgs: any[]) => this.readField(readFieldArgs, objectOrReference);
    return {
      args,
      cache: null as any,
      canRead: this.canRead,
      field,
      fieldName,
      isReference,
      mergeObjects: this.mergeObjects,
      readField: readField as FieldFunctionOptions['readField'],
      storage: this._context.fieldStorage.get(storageKeys),
      storeFieldName,
      toReference: this.toReference,
      variables: this._variables,
    };
  }

  /**
   * Builds the options for a merge function call; like InMemoryCache, they
   * include the write's extensions, the existing value and (for the chunks of
   * `@stream` fields) the chunk's streamFieldInfo.
   */
  mergeOptions(
    fieldName: string,
    storeFieldName: string,
    args: JsonObject | null,
    storageKeys: unknown[],
    extensions: Record<string, unknown> | undefined,
    existingData: unknown,
    field?: FieldNode | null,
    streamFieldInfo?: FieldMergeFunctionOptions['streamFieldInfo'],
  ): FieldMergeFunctionOptions {
    const options: FieldMergeFunctionOptions = {
      ...this.options(undefined, fieldName, storeFieldName, args, storageKeys, field),
      extensions,
      existingData,
    };
    if (streamFieldInfo) options.streamFieldInfo = streamFieldInfo;
    return options;
  }
}
