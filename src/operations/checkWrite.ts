import { invariant, InvariantError } from '@apollo/client/utilities/globals';
import {
  addTypenameToDocument,
  argumentsObjectFromField,
  createFragmentMap,
  getDefaultValues,
  getFragmentDefinitions,
  getFragmentFromSelection,
  getMainDefinition,
  getOperationDefinition,
  isField,
  isReference,
  resultKeyNameFromField,
  shouldInclude,
  stringifyForDisplay,
} from '@apollo/client/utilities';
import type { FragmentMap } from '@apollo/client/utilities';
import type { FieldNode, SelectionNode, SelectionSetNode } from 'graphql';

import type { CacheContext } from '../context';
import type { JsonObject, JsonValue } from '../primitive';
import type { DocumentNode } from '../util';

/** Errors that must escape the cache transaction they are thrown in. */
const uncaughtErrors = new WeakSet<object>();

/**
 * Whether an error thrown while writing should propagate to the caller (like
 * InMemoryCache's), rather than just roll back the transaction.
 */
export function isUncaughtWriteError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && uncaughtErrors.has(error);
}

/**
 * The error InMemoryCache throws when an object is missing one of the
 * keyFields of its type policy.
 */
export function missingKeyFieldError(fieldName: string, object: JsonObject): InvariantError {
  return new InvariantError(
    `Missing field '${fieldName}' while extracting keyFields from ${stringifyForDisplay(object, 2)}`,
  );
}

/**
 * The first keyField (of a type policy with a keyFields array) that `object`
 * does not provide, if any, when the object cannot be identified otherwise.
 */
export function missingKeyField<TSerialized>(
  context: CacheContext<TSerialized>,
  object: JsonObject,
  storeObject: JsonObject = object,
): string | undefined {
  const { __typename } = object;
  if (typeof __typename !== 'string') return undefined;
  const keyFields = context.typePolicies?.[__typename]?.keyFields;
  if (!Array.isArray(keyFields)) return undefined;
  for (const keyField of keyFields) {
    if (typeof keyField !== 'string') continue;
    if (storeObject[keyField] === undefined && object[keyField] === undefined) {
      // A custom entityIdForNode/dataIdFromObject may identify it anyway.
      return context.entityIdForValue({ ...object, ...storeObject }) === undefined ? keyField : undefined;
    }
  }
  return undefined;
}

interface FieldContext {
  clientOnly: boolean;
  deferred: boolean;
}

/**
 * Walks a result about to be written, like InMemoryCache's StoreWriter does:
 * in development, it reports the selected fields missing from the result
 * (other than @client and deferred fields, the __typename fields added by the
 * cache, and fields with read functions), and it throws when an object misses
 * one of its keyFields.
 */
export function checkWrite<TSerialized>(
  context: CacheContext<TSerialized>,
  document: DocumentNode,
  variables: JsonObject | undefined,
  result: JsonObject,
  rootTypename: string | undefined,
): void {
  const dev = (globalThis as { __DEV__?: boolean }).__DEV__ !== false;
  // In production, there is only something to check with keyFields policies.
  if (!dev && !Object.values(context.typePolicies ?? {}).some(policy => Array.isArray(policy.keyFields))) return;
  const allVariables = { ...getDefaultValues(getOperationDefinition(document)), ...variables };
  const fragmentMap: FragmentMap = createFragmentMap(getFragmentDefinitions(document));
  const lookupFragment = (name: string) => fragmentMap[name];

  // Like InMemoryCache's policies.fragmentMatches (with possibleTypes).
  const fragmentMatches = (typeCondition: string | undefined, typename: string | undefined) =>
    !typeCondition || (!!typename && context.fragmentMatches(typeCondition, typename, true));

  const hasReadFunction = (typename: string | undefined, fieldName: string) => {
    const policy = typename ? context.typePolicies?.[typename]?.fields?.[fieldName] : undefined;
    return typeof policy === 'function' || typeof policy?.read === 'function';
  };

  // Hermes writes do not fail on @skip/@include variables that are not provided.
  const included = (selection: SelectionNode) => {
    try {
      return shouldInclude(selection, allVariables);
    } catch {
      return true;
    }
  };

  // The fields of each selection set, by the __typename they are flattened for.
  const flattened = new Map<SelectionSetNode, Map<string | undefined, Map<FieldNode, FieldContext>>>();

  function flattenFields(selectionSet: SelectionSetNode, typename: string | undefined) {
    let byTypename = flattened.get(selectionSet);
    if (!byTypename) flattened.set(selectionSet, (byTypename = new Map()));
    let fieldMap = byTypename.get(typename);
    if (!fieldMap) byTypename.set(typename, (fieldMap = flattenFieldsOnce(selectionSet, typename)));
    return fieldMap;
  }

  function flattenFieldsOnce(selectionSet: SelectionSetNode, typename: string | undefined) {
    const fieldMap = new Map<FieldNode, FieldContext>();
    // Like InMemoryCache, each selection set is flattened once per inherited context.
    const visited = new Map<SelectionSetNode, Set<string>>();
    (function flatten(selectionSet: SelectionSetNode, inherited: FieldContext) {
      const visitKey = `${inherited.clientOnly}:${inherited.deferred}`;
      let visitedKeys = visited.get(selectionSet);
      if (!visitedKeys) visited.set(selectionSet, (visitedKeys = new Set()));
      if (visitedKeys.has(visitKey)) return;
      visitedKeys.add(visitKey);
      for (const selection of selectionSet.selections) {
        if (!included(selection)) continue;
        let { clientOnly, deferred } = inherited;
        for (const directive of selection.directives ?? []) {
          const name = directive.name.value;
          if (name === 'client') clientOnly = true;
          if (name === 'defer') {
            const args = argumentsObjectFromField(directive, allVariables) as { if?: unknown } | null;
            if (!args || args.if !== false) deferred = true;
          }
        }
        if (isField(selection)) {
          const existing = fieldMap.get(selection);
          if (existing) {
            clientOnly = clientOnly && existing.clientOnly;
            deferred = deferred && existing.deferred;
          }
          fieldMap.set(selection, { clientOnly, deferred });
        } else {
          const fragment = getFragmentFromSelection(selection, lookupFragment);
          if (fragment && fragmentMatches(fragment.typeCondition?.name.value, typename)) {
            flatten(fragment.selectionSet, { clientOnly, deferred });
          }
        }
      }
    })(selectionSet, { clientOnly: false, deferred: false });
    return fieldMap;
  }

  function checkValue(value: JsonValue | undefined, selectionSet: SelectionSetNode) {
    if (Array.isArray(value)) {
      for (const item of value) checkValue(item, selectionSet);
    } else if (value && typeof value === 'object' && !isReference(value)) {
      checkObject(value as JsonObject, selectionSet, undefined, false);
    }
  }

  function checkObject(
    object: JsonObject,
    selectionSet: SelectionSetNode,
    typename: string | undefined,
    isRoot: boolean,
  ) {
    if (typeof object.__typename === 'string') typename = object.__typename;
    // The fields of the object by their schema names (rather than aliases).
    const storeObject: JsonObject = {};
    flattenFields(selectionSet, typename).forEach(({ clientOnly, deferred }, field) => {
      const value = object[resultKeyNameFromField(field)];
      if (value !== undefined) {
        storeObject[field.name.value] = value;
        if (field.selectionSet) checkValue(value, field.selectionSet);
      } else if (
        dev &&
        !clientOnly &&
        !deferred &&
        !addTypenameToDocument.added(field) &&
        // A read function may provide the field (or a default value).
        !hasReadFunction(typename, field.name.value)
      ) {
        invariant.error(`Missing field '%s' while writing result %o`, resultKeyNameFromField(field), object);
      }
    });

    // Like InMemoryCache, the written root object has an id already.
    const keyField = isRoot ? undefined : missingKeyField(context, object, storeObject);
    if (keyField !== undefined) {
      const error = missingKeyFieldError(keyField, object);
      uncaughtErrors.add(error);
      throw error;
    }
  }

  checkObject(result, getMainDefinition(document).selectionSet, rootTypename, true);
}
