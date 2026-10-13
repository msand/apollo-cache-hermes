import type { OperationVariables } from '@apollo/client';
import type { FieldReadFunction, InputObjectsOption, Scalar } from '@apollo/client/cache';
import { getOperationDefinition, isPlainObject, unwrapScalarType } from '@apollo/client/utilities/internal';
import { invariant } from '@apollo/client/utilities/invariant';
import type { DocumentNode, TypeNode } from 'graphql';

import type { Policies } from './policies';
import { fieldNameFromStoreName } from './storeFieldNames';

type AnyScalar = Scalar<any, any>;
type Coerce = (scalar: AnyScalar, value: unknown) => unknown;

const toParsed: Coerce = (scalar, value) => scalar.coerceToParsed(value);
const toSerialized: Coerce = (scalar, value) => scalar.coerceToSerialized(value);

/** Where a scalar field's read function remembers its last parsed value, in the field's storage. */
const lastParsed = Symbol('lastParsed');

/** Matches list types, like `[Date]`, capturing the type of their items. */
const listTypePattern = /^\[(.*)\]$/;

/** The scalar type of a variable or input field, like `Date` or `[Date]`. */
function scalarTypeFromTypeNode(node: TypeNode): string {
  if (node.kind === 'NamedType') return node.name.value;
  if (node.kind === 'ListType') return `[${scalarTypeFromTypeNode(node.type)}]`;
  return scalarTypeFromTypeNode(node.type);
}

/**
 * Custom scalar support, like InMemoryCache's `scalars` and `inputObjects`
 * options and `scalar` field policies.
 *
 * Unlike InMemoryCache (which stores parsed values), Hermes stores serialized
 * values (so its snapshots stay JSON): values are serialized when written, and
 * parsed when read (by the read function getParseRead provides for each scalar
 * field).
 */
export class ScalarConfig {
  /** The read functions that parse scalar fields, by field coordinate. */
  private readonly _parseReads = new Map<string, { scalarType: string; read: FieldReadFunction }>();

  constructor(
    private readonly _scalars: Record<string, AnyScalar> | undefined,
    private readonly _inputObjects: InputObjectsOption | undefined,
    private readonly _policies: Policies,
  ) {}

  /** The scalar implementation registered under `name`. */
  getScalar(name: string): AnyScalar | undefined {
    return this._scalars?.[name];
  }

  /** Whether any custom scalars are configured. */
  configuresScalars(): boolean {
    return !!this._scalars;
  }

  /**
   * The scalar type configured for `typename.fieldName`, by its own field
   * policy or one it inherits from a possibleTypes supertype (like
   * InMemoryCache).
   */
  getScalarTypeForField(typename: unknown, fieldName: string): string | undefined {
    return this._policies.getScalarTypeForField(typename, fieldName);
  }

  /**
   * The read function that parses the (stored, serialized) value of a scalar
   * field, if `typename.fieldName` is one (and custom scalars are configured).
   *
   * It parses a stored value once (per field storage), so every read of it
   * returns the same parsed object, like InMemoryCache's parsed store.
   */
  getParseRead(typename: unknown, fieldName: string): FieldReadFunction | undefined {
    if (!this._scalars) return undefined;
    const scalarType = this.getScalarTypeForField(typename, fieldName);
    if (!scalarType) return undefined;
    const coordinate = `${typename as string}.${fieldName}`;
    let entry = this._parseReads.get(coordinate);
    if (!entry || entry.scalarType !== scalarType) {
      const read: FieldReadFunction = (existing, options) => {
        const storage = options?.storage as { [lastParsed]?: { stored: unknown; parsed: unknown } } | undefined;
        if (storage?.[lastParsed] && storage[lastParsed].stored === existing) {
          return storage[lastParsed].parsed;
        }
        const parsed = this.coerce(existing, toParsed, scalarType, coordinate);
        if (storage) storage[lastParsed] = { stored: existing, parsed };
        return parsed;
      };
      this._parseReads.set(coordinate, (entry = { scalarType, read }));
    }
    return entry.read;
  }

  /**
   * The (stored) value of `typename.fieldName` with its scalar values parsed,
   * including those of the fields of objects within it, as InMemoryCache
   * stores it (and passes it to cache.modify modifiers).
   */
  parseStoreValue(typename: unknown, fieldName: string, value: unknown): unknown {
    return this._coerceStoreValue(typename, fieldName, value, toParsed);
  }

  /**
   * The value to store for `typename.fieldName` (e.g. as returned by a
   * cache.modify modifier): with its scalar values serialized, including those
   * of the fields of objects within it.
   */
  serializeStoreValue(typename: unknown, fieldName: string, value: unknown): unknown {
    return this._coerceStoreValue(typename, fieldName, value, toSerialized);
  }

  /** An object to store, with the scalar values of its fields serialized (like serializeStoreValue). */
  serializeStoreObject<T>(object: T, typename?: unknown): T {
    if (!this._scalars || !isPlainObject(object)) return object;
    return this._coerceStoreObject(object, toSerialized, typename ?? object.__typename) as T;
  }

  private _coerceStoreValue(typename: unknown, fieldName: string, value: unknown, coerce: Coerce): unknown {
    if (!this._scalars || value == null || typeof typename !== 'string') return value;
    return this._coerceValue(
      value,
      coerce,
      this.getScalarTypeForField(typename, fieldName),
      `${typename}.${fieldName}`,
    );
  }

  /** Like InMemoryCache's EntityStore#coerceStoreObject. */
  private _coerceStoreObject(object: Record<string, unknown>, coerce: Coerce, typename: unknown) {
    if (typeof typename !== 'string' || !typename) return object;
    let changed = false;
    const entries = Object.entries(object).map(([storeFieldName, value]) => {
      const fieldName = fieldNameFromStoreName(storeFieldName);
      const newValue = this._coerceValue(
        value,
        coerce,
        this.getScalarTypeForField(typename, fieldName),
        `${typename}.${fieldName}`,
      );
      changed ||= newValue !== value;
      return [storeFieldName, newValue];
    });
    return changed ? Object.fromEntries(entries) : object;
  }

  /** Like InMemoryCache's EntityStore#coerceValue. */
  private _coerceValue(value: unknown, coerce: Coerce, scalarType: string | undefined, coordinate: string): unknown {
    if (value == null) return value;
    if (scalarType) return this.coerce(value, coerce, scalarType, coordinate);
    if (Array.isArray(value)) {
      let changed = false;
      const items = value.map(item => {
        const newItem = this._coerceValue(item, coerce, undefined, coordinate);
        changed ||= newItem !== item;
        return newItem;
      });
      return changed ? items : value;
    }
    if (isPlainObject(value) && '__typename' in value) {
      return this._coerceStoreObject(value, coerce, value.__typename);
    }
    return value;
  }

  /** The value to store for `typename.fieldName`: serialized, if it is a scalar field. */
  serializeField(typename: unknown, fieldName: string, value: unknown): unknown {
    if (!this._scalars || value == null || typeof typename !== 'string') return value;
    const scalarType = this.getScalarTypeForField(typename, fieldName);
    return scalarType ? this.coerce(value, toSerialized, scalarType, `${typename}.${fieldName}`) : value;
  }

  /** Coerces a (list of) scalar value(s) of the given type, like InMemoryCache. */
  coerce(value: unknown, coerce: Coerce, scalarType: string, coordinate: string): unknown {
    if (value == null) return value;
    const match = scalarType.match(listTypePattern);
    if (match) {
      if (Array.isArray(value)) {
        return value.map(item => this.coerce(item, coerce, match[1], coordinate));
      }
      invariant.warn(
        "The custom scalar configuration for '%s' uses list type '%s', but the value is not an array. The value was coerced as '%s' anyway.",
        coordinate,
        scalarType,
        unwrapScalarType(scalarType),
      );
    }
    const scalar = this.getScalar(unwrapScalarType(scalarType));
    if (scalar) return coerce(scalar, value);
    if (Array.isArray(value)) {
      return value.map(item => this.coerce(item, coerce, scalarType, coordinate));
    }
    return value;
  }

  /** Serializes the scalar values of an operation's variables (like InMemoryCache#serializeVariables). */
  serializeVariables<TVariables extends OperationVariables>(
    document: DocumentNode,
    variables: TVariables | undefined,
  ): TVariables | undefined {
    if (!variables || Object.keys(variables).length === 0 || (!this._scalars && !this._inputObjects)) {
      return variables;
    }
    const variableTypes: Record<string, string> = {};
    for (const node of getOperationDefinition(document)?.variableDefinitions ?? []) {
      variableTypes[node.variable.name.value] = scalarTypeFromTypeNode(node.type);
    }
    if (Object.keys(variableTypes).length === 0) return variables;
    return this._serializeValue(variables, variableTypes) as TVariables;
  }

  private _serializeValue(
    value: unknown,
    variableTypes: Record<string, string>,
    scalarType?: string,
    coordinate?: string,
  ): unknown {
    if (value == null) return value;
    if (scalarType) {
      const match = scalarType.match(listTypePattern);
      if (match) {
        if (Array.isArray(value)) return this._serializeArray(value, variableTypes, match[1], coordinate);
        invariant.warn(
          "The variable '%s' has list type '%s', but the value is not an array. The value was coerced as '%s' anyway.",
          coordinate,
          scalarType,
          unwrapScalarType(scalarType),
        );
      }
      const scalar = this.getScalar(unwrapScalarType(scalarType));
      if (scalar) return scalar.coerceToSerialized(value);
    }
    if (Array.isArray(value)) return this._serializeArray(value, variableTypes, undefined, coordinate);
    if (isPlainObject(value)) return this._serializeObject(value, variableTypes, coordinate);
    return value;
  }

  private _serializeArray(
    value: unknown[],
    variableTypes: Record<string, string>,
    scalarType?: string,
    coordinate?: string,
  ) {
    let changed = false;
    const newValue = value.map(item => {
      const newItem = this._serializeValue(item, variableTypes, scalarType, coordinate);
      changed ||= newItem !== item;
      return newItem;
    });
    return changed ? newValue : value;
  }

  private _serializeObject(value: Record<string, unknown>, variableTypes: Record<string, string>, coordinate?: string) {
    let changed = false;
    const entries = Object.entries(value).map(([name, fieldValue]) => {
      const type = variableTypes[name];
      if (!type) return [name, fieldValue];
      const fieldCoordinate = coordinate ? `${coordinate}.${name}` : name;
      const inputObject = this._inputObjects?.[unwrapScalarType(type)];
      const newValue = inputObject
        ? this._serializeValue(fieldValue, inputObject.fields, undefined, fieldCoordinate)
        : this._serializeValue(fieldValue, variableTypes, type, fieldCoordinate);
      changed ||= newValue !== fieldValue;
      return [name, newValue];
    });
    return changed ? Object.fromEntries(entries) : value;
  }
}
