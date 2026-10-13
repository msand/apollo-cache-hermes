import type { FieldPolicy, FieldReadFunction, KeyArgsFunction, TypePolicies } from '@apollo/client/cache';
import { argumentsObjectFromField, DeepMerger, getStoreKeyName } from '@apollo/client/utilities/internal';
import type { DirectiveNode, FieldNode } from 'graphql';

import type { JsonObject } from '../primitive';

/**
 * How a field (of a given type, with given arguments) is stored within its
 * container: under its field name (like a field without arguments), or in a
 * parameterized value node identified by `key`.
 *
 * For fields without keyArgs policies (or @connection directives), the key is
 * the JSON of the field's arguments, as Hermes has always stored them.
 * Otherwise, it is the store field name InMemoryCache would use (e.g.
 * `feed:{"type":"news"}`), which always starts with the field name, and so
 * never with `{`.
 */
export type StoreKey = string | undefined;

/** Whether a store key is InMemoryCache's store field name (from keyArgs or @connection). */
export function isStoreFieldNameKey(key: string): boolean {
  return key.charAt(0) !== '{';
}

/** Like InMemoryCache's KeySpecifier (which @apollo/client/cache does not export). */
type KeySpecifier = ReadonlyArray<string | KeySpecifier>;

const TypeOrFieldNameRegExp = /^[_a-z][_0-9a-z]*/i;

/** Like InMemoryCache's fieldNameFromStoreName. */
export function fieldNameFromStoreName(storeFieldName: string): string {
  const match = storeFieldName.match(TypeOrFieldNameRegExp);
  return match ? match[0] : storeFieldName;
}

/** InMemoryCache's implicit keyArgs: false. */
const simpleKeyArgsFn: KeyArgsFunction = (_args, context) => context.fieldName;

/**
 * Computes the storage identity of fields, following their keyArgs policies
 * (and @connection directives) like InMemoryCache's Policies#getStoreFieldName.
 */
export class StoreFieldNames {
  /** The keyArgs functions of the configured field policies, by type and field. */
  private readonly _keyFns = new Map<string, Map<string, KeyArgsFunction>>();

  constructor(typePolicies: TypePolicies | undefined) {
    for (const [typename, typePolicy] of Object.entries(typePolicies ?? {})) {
      for (const [fieldName, policy] of Object.entries(typePolicy?.fields ?? {})) {
        const keyFn = keyFnOfPolicy(policy);
        if (!keyFn) continue;
        let fields = this._keyFns.get(typename);
        if (!fields) this._keyFns.set(typename, (fields = new Map()));
        fields.set(fieldName, keyFn);
      }
    }
  }

  /** Whether any field has a keyArgs policy (explicit or implicit). */
  get hasKeyArgs(): boolean {
    return this._keyFns.size > 0;
  }

  /** Like InMemoryCache's Policies#hasKeyArgs. */
  hasKeyArgsFor(typename: unknown, fieldName: string): boolean {
    return typeof typename === 'string' && !!this._keyFns.get(typename)?.has(fieldName);
  }

  /**
   * The key the value of `typename.fieldName` (with `args`, selected by
   * `field`) is stored under: undefined for the field itself, or the key of
   * its parameterized value node (see StoreKey).
   */
  storeKey(
    typename: unknown,
    fieldName: string,
    args: JsonObject | null | undefined,
    field: FieldNode | null | undefined,
    variables: JsonObject | undefined,
  ): StoreKey {
    const hasArgs = !!args && Object.keys(args).length > 0;
    const keyFn = typeof typename === 'string' ? this._keyFns.get(typename)?.get(fieldName) : undefined;
    if (keyFn) {
      return this._keyArgsStoreKey(keyFn, typename as string, fieldName, hasArgs ? args! : null, field, variables);
    }
    if (!hasArgs) return undefined;

    const connection = field?.directives?.find(directive => directive.name.value === 'connection');
    if (connection) {
      const connectionArgs = argumentsObjectFromField(connection, variables) as Record<string, any> | null;
      if (connectionArgs?.key) {
        const storeFieldName = getStoreKeyName(fieldName, args, { connection: connectionArgs });
        return toStoreKey(fieldName, storeFieldName);
      }
    }
    return JSON.stringify(args);
  }

  /**
   * The store field name InMemoryCache would give the field, for the
   * storeFieldName options of read, merge and modifier functions, and for
   * their storage.
   */
  storeFieldName(
    typename: unknown,
    fieldName: string,
    args: JsonObject | null | undefined,
    field: FieldNode | null | undefined,
    variables: JsonObject | undefined,
  ): string {
    return storeFieldNameOf(fieldName, this.storeKey(typename, fieldName, args, field, variables));
  }

  private _keyArgsStoreKey(
    keyFn: KeyArgsFunction,
    typename: string,
    fieldName: string,
    args: JsonObject | null,
    field: FieldNode | null | undefined,
    variables: JsonObject | undefined,
  ): StoreKey {
    const context = { typename, fieldName, field: field ?? null, variables };
    let fn: KeyArgsFunction | undefined = keyFn;
    let storeFieldName: string | false | undefined;
    while (fn) {
      const specifierOrString: ReturnType<KeyArgsFunction> = fn(args as Record<string, any> | null, context);
      if (Array.isArray(specifierOrString)) {
        fn = keyArgsFnFromSpecifier(specifierOrString as KeySpecifier);
      } else {
        // Like InMemoryCache, a falsy value means the field name.
        storeFieldName = (specifierOrString as string | false | undefined) || fieldName;
        break;
      }
    }
    return toStoreKey(fieldName, storeFieldName || fieldName);
  }
}

/** The store field name (as InMemoryCache's) of a field stored under `key`. */
export function storeFieldNameOf(fieldName: string, key: StoreKey, args?: JsonObject | null): string {
  if (key === undefined) return fieldName;
  if (isStoreFieldNameKey(key)) return key;
  return getStoreKeyName(fieldName, args ?? (JSON.parse(key) as JsonObject));
}

/**
 * The store key of a field whose (InMemoryCache) store field name is
 * `storeFieldName`, made to start with the field name like InMemoryCache's.
 */
function toStoreKey(fieldName: string, storeFieldName: string): StoreKey {
  if (storeFieldName === fieldName) return undefined;
  return fieldNameFromStoreName(storeFieldName) === fieldName ? storeFieldName : `${fieldName}:${storeFieldName}`;
}

/** The keyArgs function of a field policy, like InMemoryCache's Policies#setTypePolicies. */
function keyFnOfPolicy(policy: FieldPolicy<any> | FieldReadFunction<any> | undefined): KeyArgsFunction | undefined {
  if (!policy || typeof policy === 'function') return undefined;
  const { keyArgs, read, merge, scalar } = policy;
  const keyFn =
    keyArgs === false
      ? simpleKeyArgsFn
      : Array.isArray(keyArgs)
        ? keyArgsFnFromSpecifier(keyArgs)
        : typeof keyArgs === 'function'
          ? keyArgs
          : undefined;
  // If we have both a read and a merge function, assume keyArgs:false, because
  // read and merge together can take responsibility for interpreting
  // arguments in and out. (Scalar fields' read and merge functions are
  // ignored, like InMemoryCache's.)
  if (!keyFn && !scalar && typeof read === 'function' && merge !== undefined) {
    return simpleKeyArgsFn;
  }
  return keyFn;
}

// The rest is a port of InMemoryCache's key-extractor (for keyArgs).

const specifierInfoCache: Record<string, { paths?: string[][]; keyArgsFn?: KeyArgsFunction }> = Object.create(null);

function lookupSpecifierInfo(spec: KeySpecifier) {
  const cacheKey = JSON.stringify(spec);
  return specifierInfoCache[cacheKey] || (specifierInfoCache[cacheKey] = {});
}

/**
 * Like InMemoryCache's keyArgsFnFromSpecifier: the field key is made of the
 * specified arguments, plus the arguments of `@directive` entries and the
 * values of `$variable` entries.
 */
export function keyArgsFnFromSpecifier(specifier: KeySpecifier): KeyArgsFunction {
  const info = lookupSpecifierInfo(specifier);

  return (info.keyArgsFn ??= (args, { field, variables, fieldName }) => {
    const collected = collectSpecifierPaths(specifier, keyPath => {
      const firstKey = keyPath[0];
      const firstChar = firstKey.charAt(0);

      if (firstChar === '@') {
        if (field && field.directives?.length) {
          const directiveName = firstKey.slice(1);
          // Only the first occurrence of a repeated directive counts.
          const directive = field.directives.find((d: DirectiveNode) => d.name.value === directiveName);
          const directiveArgs = directive && (argumentsObjectFromField(directive, variables) as Record<string, any>);
          // A directive without arguments still counts (as null); a missing
          // one is omitted from the key.
          return directiveArgs && extractKeyPath(directiveArgs, keyPath.slice(1));
        }
        return undefined;
      }

      if (firstChar === '$') {
        const variableName = firstKey.slice(1);
        if (variables && Object.prototype.hasOwnProperty.call(variables, variableName)) {
          const varKeyPath = keyPath.slice(0);
          varKeyPath[0] = variableName;
          return extractKeyPath(variables, varKeyPath);
        }
        return undefined;
      }

      if (args) {
        return extractKeyPath(args, keyPath);
      }
      return undefined;
    });

    const suffix = JSON.stringify(collected);

    // A field without arguments (or other key contributions) is keyed by its
    // name alone.
    if (args || suffix !== '{}') {
      fieldName += `:${suffix}`;
    }

    return fieldName;
  });
}

function collectSpecifierPaths(specifier: KeySpecifier, extractor: (path: string[]) => any): Record<string, any> {
  const merger = new DeepMerger();
  return getSpecifierPaths(specifier).reduce((collected, path) => {
    let toMerge = extractor(path);
    if (toMerge !== undefined) {
      for (let i = path.length - 1; i >= 0; --i) {
        toMerge = { [path[i]]: toMerge };
      }
      collected = merger.merge(collected, toMerge);
    }
    return collected;
  }, {});
}

function getSpecifierPaths(spec: KeySpecifier): string[][] {
  const info = lookupSpecifierInfo(spec);

  if (!info.paths) {
    const paths: string[][] = (info.paths = []);
    const currentPath: string[] = [];

    spec.forEach((s, i) => {
      if (Array.isArray(s)) {
        getSpecifierPaths(s as KeySpecifier).forEach(p => paths.push(currentPath.concat(p)));
        currentPath.length = 0;
      } else {
        currentPath.push(s as string);
        if (!Array.isArray(spec[i + 1])) {
          paths.push(currentPath.slice(0));
          currentPath.length = 0;
        }
      }
    });
  }

  return info.paths;
}

function extractKeyPath(object: Record<string, any>, path: string[]): any {
  return normalize(
    path.reduce(function reducer(obj: any, key: string): any {
      return Array.isArray(obj) ? obj.map(child => reducer(child, key)) : obj && obj[key];
    }, object),
  );
}

function normalize<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      return value.map(normalize) as any;
    }
    return collectSpecifierPaths(Object.keys(value).sort(), path => extractKeyPath(value, path)) as T;
  }
  return value;
}
