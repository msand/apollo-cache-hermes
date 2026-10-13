import type { OperationVariables } from '@apollo/client';
import type { FieldPolicy, FieldReadFunction, InputObjectsOption, Scalar, TypePolicies } from '@apollo/client/cache';
import { getOperationDefinition, isPlainObject, unwrapScalarType } from '@apollo/client/utilities/internal';
import { invariant } from '@apollo/client/utilities/invariant';
import type { DocumentNode, OperationTypeNode, TypeNode } from 'graphql';

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
 * parsed when read (by a read function this adds to each scalar field).
 */
export class ScalarConfig {
  /** The read functions this adds, by the read function they wrap (if any). */
  private readonly _wrappedReads = new WeakMap<FieldReadFunction, FieldReadFunction | undefined>();

  constructor(
    private readonly _scalars: Record<string, AnyScalar> | undefined,
    private readonly _inputObjects: InputObjectsOption | undefined,
    private readonly _typePolicies: TypePolicies | undefined,
    /** Whether `typename` is `supertype` or one of its possibleTypes subtypes. */
    private readonly _isSubtype: (supertype: string, typename: string) => boolean = (a, b) => a === b,
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
   * The scalar type configured for `typename.fieldName`: on the type itself,
   * or else (like InMemoryCache) on one of its possibleTypes supertypes.
   */
  getScalarTypeForField(typename: string, fieldName: string): string | undefined {
    const own = this._fieldScalar(typename, fieldName);
    if (own) return own;
    for (const supertype of Object.keys(this._typePolicies ?? {})) {
      const scalarType = this._fieldScalar(supertype, fieldName);
      if (scalarType && this._isSubtype(supertype, typename)) return scalarType;
    }
    return undefined;
  }

  private _fieldScalar(typename: string, fieldName: string): string | undefined {
    const policy = this._typePolicies?.[typename]?.fields?.[fieldName];
    return typeof policy === 'object' ? policy.scalar : undefined;
  }

  /**
   * The typename of an operation's root type: the type whose policy sets
   * `queryType`/`mutationType`/`subscriptionType`, or else `Query`/`Mutation`/
   * `Subscription` (like InMemoryCache#getRootTypename). Apollo Client uses it
   * to find the scalar fields of root types.
   */
  getRootTypename(operation: OperationTypeNode): string {
    const flag = `${operation}Type` as 'queryType' | 'mutationType' | 'subscriptionType';
    for (const [typename, policy] of Object.entries(this._typePolicies ?? {})) {
      if (policy?.[flag]) return typename;
    }
    return operation.charAt(0).toUpperCase() + operation.slice(1);
  }

  /**
   * The type policies, with read functions that parse the values of scalar
   * fields (and then call the field's own read function, if any).
   */
  withScalarReads(typePolicies: TypePolicies | undefined): TypePolicies | undefined {
    if (!this._scalars || !typePolicies) return typePolicies;
    const result: TypePolicies = {};
    for (const [typename, typePolicy] of Object.entries(typePolicies)) {
      let fields = typePolicy?.fields;
      for (const [fieldName, policy] of Object.entries(fields ?? {})) {
        if (typeof policy !== 'object' || !policy.scalar) continue;
        const scalarType = policy.scalar;
        const coordinate = `${typename}.${fieldName}`;
        const ownRead = policy.read;
        const read: FieldReadFunction = (existing, options) => {
          // Parse a stored value once (per entity field), so every read of it
          // returns the same parsed object, like InMemoryCache's parsed store.
          const storage = options?.storage as { [lastParsed]?: { stored: unknown; parsed: unknown } } | undefined;
          let parsed: unknown;
          if (storage?.[lastParsed] && storage[lastParsed].stored === existing) {
            parsed = storage[lastParsed].parsed;
          } else {
            parsed = this.coerce(existing, toParsed, scalarType, coordinate);
            if (storage) storage[lastParsed] = { stored: existing, parsed };
          }
          return ownRead ? ownRead(parsed, options) : parsed;
        };
        this._wrappedReads.set(read, ownRead);
        fields = { ...fields, [fieldName]: { ...policy, read } as FieldPolicy };
      }
      result[typename] = fields === typePolicy?.fields ? typePolicy : { ...typePolicy, fields };
    }
    return result;
  }

  /** The read function a field was configured with (rather than one this added). */
  ownReadFunction(read: FieldReadFunction | undefined): FieldReadFunction | undefined {
    return read && this._wrappedReads.has(read) ? this._wrappedReads.get(read) : read;
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
