import type { KeyArgsFunction, TypePolicy } from '@apollo/client/cache';
import { canonicalStringify } from '@apollo/client/utilities';
import { argumentsObjectFromField, DeepMerger, getStoreKeyName } from '@apollo/client/utilities/internal';
import type { DirectiveNode, FieldNode } from 'graphql';

import type { JsonObject, JsonValue } from '../primitive';

/**
 * How a field (of a given type, with given arguments) is stored within its
 * container: under its field name (like a field without arguments), or in a
 * parameterized value node identified by `key`.
 *
 * For fields without keyArgs policies (or @connection directives), the key is
 * the JSON of the field's arguments, with their keys sorted (like the
 * arguments of InMemoryCache's store field names, so that the order of the
 * arguments in a query doesn't matter).
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
export type KeySpecifier = ReadonlyArray<string | KeySpecifier>;

/** Like InMemoryCache's KeyFieldsFunction (which @apollo/client/cache does not export). */
export type KeyFieldsFunction = Extract<NonNullable<TypePolicy['keyFields']>, (...args: any[]) => any>;

/** Like InMemoryCache's KeyFieldsContext. */
export type KeyFieldsContext = Parameters<KeyFieldsFunction>[1];

/** The context of a keyFields function, with the key field it found missing (see keyFieldsFnFromSpecifier). */
export type KeyFieldsContextWithMissing = KeyFieldsContext & { missingKeyField?: string };

/** Matches valid GraphQL type and field names (like InMemoryCache's). */
export const TypeOrFieldNameRegExp = /^[_a-z][_0-9a-z]*/i;

/** Like InMemoryCache's fieldNameFromStoreName. */
export function fieldNameFromStoreName(storeFieldName: string): string {
  const match = storeFieldName.match(TypeOrFieldNameRegExp);
  return match ? match[0] : storeFieldName;
}

/** InMemoryCache's implicit keyArgs: false. */
export const simpleKeyArgsFn: KeyArgsFunction = (_args, context) => context.fieldName;

/** Finds the keyArgs function of `typename.fieldName` (per its field policy, which may be inherited). */
export type KeyArgsFunctionLookup = (typename: string, fieldName: string) => KeyArgsFunction | undefined;

/**
 * Computes the storage identity of fields, following their keyArgs policies
 * (and @connection directives) like InMemoryCache's Policies#getStoreFieldName.
 */
export class StoreFieldNames {
  constructor(private readonly _keyFn: KeyArgsFunctionLookup) {}

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
    const keyFn = typeof typename === 'string' ? this._keyFn(typename, fieldName) : undefined;
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
    // Like InMemoryCache's getStoreKeyName, arguments that are all undefined
    // (e.g. optional variables that aren't passed) leave the field unkeyed.
    const key = argsStoreKey(args!);
    return key === '{}' ? undefined : key;
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

/**
 * The store key of a field (without keyArgs policies) stored under its
 * arguments: their JSON, with object keys sorted like InMemoryCache's
 * getStoreKeyName.
 */
export function argsStoreKey(args: JsonObject): string {
  return canonicalStringify(args);
}

/** An InMemoryCache store field name, as produced by getStoreKeyName. */
export interface ParsedStoreFieldName {
  fieldName: string;
  /** The field's arguments (from `field({...})`), if it has any. */
  args?: JsonObject;
  /** Whether the store field name has (custom) directives (`field@directive(...)`). */
  hasDirectives: boolean;
}

/**
 * Parses an InMemoryCache store field name of a field without keyArgs policy,
 * as made by getStoreKeyName: the field name, followed by its arguments as
 * JSON in parentheses (`field({"arg":1})`), followed by its custom directives
 * (`field@upperCase`, `field@dateFormat({"format":"DD-MM-YYYY"})`).
 *
 * Returns undefined if `storeFieldName` is not of that form.
 */
export function parseStoreFieldName(storeFieldName: string): ParsedStoreFieldName | undefined {
  const fieldName = fieldNameFromStoreName(storeFieldName);
  if (fieldName === storeFieldName || !TypeOrFieldNameRegExp.test(fieldName)) return undefined;

  let index = fieldName.length;
  let args: JsonObject | undefined;
  const readParenthesizedJson = (): JsonValue | undefined => {
    if (storeFieldName.charAt(index) !== '(') return undefined;
    const end = jsonEnd(storeFieldName, index + 1);
    if (end === undefined || storeFieldName.charAt(end) !== ')') return undefined;
    try {
      const value = JSON.parse(storeFieldName.slice(index + 1, end)) as JsonValue;
      index = end + 1;
      return value;
    } catch {
      return undefined;
    }
  };

  if (storeFieldName.charAt(index) === '(') {
    const parsed = readParenthesizedJson();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    args = parsed;
  }

  let hasDirectives = false;
  while (storeFieldName.charAt(index) === '@') {
    const directiveName = TypeOrFieldNameRegExp.exec(storeFieldName.slice(index + 1))?.[0];
    if (!directiveName) return undefined;
    index += 1 + directiveName.length;
    if (storeFieldName.charAt(index) === '(' && readParenthesizedJson() === undefined) return undefined;
    hasDirectives = true;
  }

  if (index !== storeFieldName.length) return undefined;
  return args ? { fieldName, args, hasDirectives } : { fieldName, hasDirectives };
}

/** The index just after the JSON object or array starting at `start`. */
function jsonEnd(text: string, start: number): number | undefined {
  const open = text.charAt(start);
  if (open !== '{' && open !== '[') return undefined;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === '"') {
      // Skip the string, and its escaped characters.
      for (i++; i < text.length && text.charAt(i) !== '"'; i++) {
        if (text.charAt(i) === '\\') i++;
      }
    } else if (char === '{' || char === '[') {
      depth++;
    } else if (char === '}' || char === ']') {
      if (--depth === 0) return i + 1;
    }
  }
  return undefined;
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

// The rest is a port of InMemoryCache's key-extractor (for keyArgs and keyFields).

// Like InMemoryCache's, this cache is module-global and unbounded: it holds an
// entry per distinct KeySpecifier, which is fine for the specifiers of type
// policies, but grows with keyArgs/keyFields functions that return a new
// specifier for every call.
const specifierInfoCache: Record<
  string,
  { paths?: string[][]; keyArgsFn?: KeyArgsFunction; keyFieldsFn?: KeyFieldsFunction }
> = Object.create(null);

function lookupSpecifierInfo(spec: KeySpecifier) {
  const cacheKey = JSON.stringify(spec);
  return specifierInfoCache[cacheKey] || (specifierInfoCache[cacheKey] = {});
}

/**
 * Like InMemoryCache's keyFieldsFnFromSpecifier: the id is made of the
 * specified (possibly nested) fields of the object, like
 * `Book:{"title":"…","author":{"name":"…"}}`.
 *
 * Unlike InMemoryCache's, a missing key field does not throw: the object is
 * not identified, and the path of the missing field is reported as the
 * context's `missingKeyField` (writes throw InMemoryCache's error for it).
 */
export function keyFieldsFnFromSpecifier(specifier: KeySpecifier): KeyFieldsFunction {
  const info = lookupSpecifierInfo(specifier);
  if (info.keyFieldsFn) return info.keyFieldsFn;

  const keyFieldsFn: KeyFieldsFunction = (object, context) => {
    const hermesContext = context as KeyFieldsContextWithMissing;
    const extract = (from: Record<string, any>, key: string) => context.readField(key, from);
    let missing: string | undefined;

    const keyObject = (context.keyObject = collectSpecifierPaths(specifier, schemaKeyPath => {
      if (missing !== undefined) return undefined;
      let extracted = extractKeyPath(context.storeObject, schemaKeyPath, extract);

      if (
        extracted === undefined &&
        object !== context.storeObject &&
        Object.prototype.hasOwnProperty.call(object, schemaKeyPath[0])
      ) {
        // Key fields included in the written data are used even if they are
        // not selected (and so cannot be aliased).
        extracted = extractKeyPath(object, schemaKeyPath);
      }

      if (extracted === undefined) missing = schemaKeyPath.join('.');
      return extracted;
    }));

    if (missing !== undefined) {
      hermesContext.missingKeyField = missing;
      return undefined;
    }
    return `${context.typename}:${JSON.stringify(keyObject)}`;
  };
  specifierFns.add(keyFieldsFn);
  return (info.keyFieldsFn = keyFieldsFn);
}

/** The keyFields functions made from KeySpecifier arrays. */
const specifierFns = new WeakSet<KeyFieldsFunction>();

/** Whether a keyFields function was made from a KeySpecifier array (rather than configured). */
export function isKeyFieldsSpecifierFn(fn: KeyFieldsFunction): boolean {
  return specifierFns.has(fn);
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

function extractKeyPath(
  object: Record<string, any>,
  path: string[],
  extract: (from: Record<string, any>, key: string) => any = (from, key) => from[key],
): any {
  return normalize(
    path.reduce(function reducer(obj: any, key: string): any {
      return Array.isArray(obj) ? obj.map(child => reducer(child, key)) : obj && extract(obj, key);
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
