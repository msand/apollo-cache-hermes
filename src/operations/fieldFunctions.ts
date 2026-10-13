import { invariant, InvariantError } from 'ts-invariant';
import { makeReference } from '@apollo/client';
import { stringifyForDisplay } from '@apollo/client/utilities';
import type { FieldFunctionOptions, FieldPolicy, FieldReadFunction } from '@apollo/client/cache/inmemory/policies';
import type { Reference, StoreValue, TypePolicies } from '@apollo/client';
import type { ReadFieldOptions } from '@apollo/client/cache/core/types/common';
import type { StoreObject } from '@apollo/client/utilities';

import type { CacheContext } from '../context';
import type { NodeSnapshot } from '../nodes';
import type { JsonObject, PathPart } from '../primitive';
import type { NodeId } from '../schema';
import * as util from '../util';

import * as snapshotEditor from './SnapshotEditor';

const { deepGet, hasOwn, isReference, lazyImmutableDeepSet, pathBeginsWith, toOutKey } = util;

type ObjectOrReference = StoreObject | Reference;
type ToReference = FieldFunctionOptions['toReference'];

/**
 * Returns the field policy configured for `typename.fieldName`, if any.
 */
export function getFieldPolicy(
  typePolicies: TypePolicies | undefined,
  typename: unknown,
  fieldName: string,
): FieldPolicy<any> | FieldReadFunction<any> | undefined {
  if (!typePolicies || typeof typename !== 'string') return undefined;
  return typePolicies[typename]?.fields?.[fieldName];
}

/**
 * Returns the read function configured for `typename.fieldName`, if any.
 */
export function getReadFunction(typePolicies: TypePolicies | undefined, typename: unknown, fieldName: string) {
  const policy = getFieldPolicy(typePolicies, typename, fieldName);
  return typeof policy === 'function' ? policy : policy?.read;
}

/**
 * The key identifying a field (with its arguments) within its parent object,
 * for the purposes of options.storage.
 */
export function storageFieldName(fieldName: string, args?: JsonObject | null) {
  return args && Object.keys(args).length ? `${fieldName}(${JSON.stringify(args)})` : fieldName;
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
 * Hermes (unlike InMemoryCache's default dataIdFromObject) also normalizes
 * objects without a __typename; those are left as data.
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
  return result;
}

function isUntypedObject(value: unknown) {
  return isNonNullObject(value) && !('__typename' in value);
}

/**
 * Per-field storage objects shared by read and merge functions, keyed by the
 * identity of the object containing the field (and the path to it).
 */
export class FieldStorage {
  private _strong?: Map<unknown, FieldStorage>;
  private _weak?: WeakMap<object, FieldStorage>;
  private _storage?: Record<string, any>;

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

  // Hermes nulls out references to deleted entities, so null can't be read.
  canRead = (value: StoreValue): boolean => {
    return isReference(value) ? this._getNodeSnapshot(value.__ref) !== undefined : isNonNullObject(value);
  };

  /**
   * Reads the stored value of a field (with References for any entities).
   */
  getFieldValue(from: ObjectOrReference, fieldName: string, args?: JsonObject | null): StoreValue {
    if (!isReference(from)) return from[fieldName];

    const id = from.__ref;
    const snapshot = this._getNodeSnapshot(id);
    if (!snapshot) return undefined;

    if (args && Object.keys(args).length) {
      const fieldId = snapshotEditor.nodeIdForParameterizedValue(id, [fieldName], args);
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
    if (id === 'ROOT_QUERY' && fieldName === '__typename') return 'Query';
    return undefined;
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
    const existing = this.getFieldValue(objectOrRef, fieldName, args);
    const read = getReadFunction(this._context.typePolicies, typename, fieldName);
    if (!read) return existing;

    const storageKey = isReference(objectOrRef) ? objectOrRef.__ref : objectOrRef;
    return read(
      existing,
      this.options(objectOrRef, fieldName, fieldName, args, [storageKey, storageFieldName(fieldName, args)]),
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
  ): FieldFunctionOptions {
    const readField = (...readFieldArgs: any[]) => this.readField(readFieldArgs, objectOrReference);
    return {
      args,
      cache: null as any,
      canRead: this.canRead,
      field: null,
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
}
