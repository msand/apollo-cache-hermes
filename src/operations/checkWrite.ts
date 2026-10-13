import { invariant, InvariantError } from '@apollo/client/utilities/invariant';
import { addTypenameToDocument, getMainDefinition, isReference } from '@apollo/client/utilities';
import {
  argumentsObjectFromField,
  checkDocument,
  createFragmentMap,
  getDefaultValues,
  getFragmentDefinitions,
  getFragmentFromSelection,
  getOperationDefinition,
  isField,
  resultKeyNameFromField,
  shouldInclude,
  stringifyForDisplay,
} from '@apollo/client/utilities/internal';
import type { FragmentMap } from '@apollo/client/utilities/internal';
import type { FieldNode, FragmentDefinitionNode, InlineFragmentNode, SelectionNode, SelectionSetNode } from 'graphql';

import type { CacheContext } from '../context';
import type { JsonObject, JsonValue } from '../primitive';
import type { DocumentNode } from '../util';

/**
 * Whether a result has every field a selection set selects (fragments aside),
 * like InMemoryCache's selectionSetMatchesResult (which @apollo/client 4 no
 * longer exports).
 */
function selectionSetMatchesResult(
  selectionSet: SelectionSetNode,
  result: unknown,
  variables?: Record<string, unknown>,
): boolean {
  if (typeof result !== 'object' || result === null) return false;
  if (Array.isArray(result)) return result.every(item => selectionSetMatchesResult(selectionSet, item, variables));
  return selectionSet.selections.every(field => {
    if (isField(field) && shouldInclude(field, variables)) {
      const key = resultKeyNameFromField(field);
      return (
        Object.prototype.hasOwnProperty.call(result, key) &&
        (!field.selectionSet ||
          selectionSetMatchesResult(field.selectionSet, (result as Record<string, unknown>)[key], variables))
      );
    }
    // Skipped selections do not count against matching, and fragments are
    // matched when they are visited.
    return true;
  });
}

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
 * Validates a written document (e.g. that it does not alias a field to
 * __typename), like InMemoryCache, whose writes throw these errors to the
 * caller rather than rolling back a transaction.
 */
export function checkWriteDocument(document: DocumentNode): void {
  try {
    checkDocument(document);
  } catch (error) {
    if (typeof error === 'object' && error !== null) uncaughtErrors.add(error);
    throw error;
  }
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
 * The (path of the) first key field that `object` does not provide, if its
 * type's keyFields (a KeySpecifier array, or a function that returns one)
 * need one that is missing.
 */
export function missingKeyField<TSerialized>(
  context: CacheContext<TSerialized>,
  object: JsonObject,
  storeObject?: JsonObject,
  partialContext?: { selectionSet?: SelectionSetNode; fragmentMap?: FragmentMap },
): string | undefined {
  if (typeof object.__typename !== 'string' || !context.policies.hasKeyFields) return undefined;
  return context.policies.identify(object, { ...partialContext, storeObject })[1];
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
  // In production, there is only something to check with keyFields policies (or
  // fuzzy possibleTypes subtypes to infer).
  if (!dev && !context.hasFuzzySubtypes && !context.policies.hasKeyFields) {
    return;
  }
  const allVariables = { ...getDefaultValues(getOperationDefinition(document)), ...variables };
  const fragmentMap: FragmentMap = createFragmentMap(getFragmentDefinitions(document));
  const lookupFragment = (name: string) => fragmentMap[name];

  // Like InMemoryCache's policies.fragmentMatches (with possibleTypes): a fuzzy
  // subtype is only inferred for a result that has all the fragment's fields.
  const fragmentMatches = (
    fragment: FragmentDefinitionNode | InlineFragmentNode,
    typename: string | undefined,
    object: JsonObject,
  ) =>
    !fragment.typeCondition ||
    (!!typename &&
      context.fragmentMatches(fragment.typeCondition.name.value, typename, () =>
        selectionSetMatchesResult(fragment.selectionSet, object, allVariables),
      ));

  // Like InMemoryCache, scalar fields have no read functions.
  const hasReadFunction = (typename: string | undefined, fieldName: string) =>
    !!context.policies.getReadFunction(typename, fieldName);

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

  // Like InMemoryCache's StoreWriter, the first object decides any fuzzy subtypes.
  function flattenFields(selectionSet: SelectionSetNode, typename: string | undefined, object: JsonObject) {
    let byTypename = flattened.get(selectionSet);
    if (!byTypename) flattened.set(selectionSet, (byTypename = new Map()));
    let fieldMap = byTypename.get(typename);
    if (!fieldMap) byTypename.set(typename, (fieldMap = flattenFieldsOnce(selectionSet, typename, object)));
    return fieldMap;
  }

  function flattenFieldsOnce(selectionSet: SelectionSetNode, typename: string | undefined, object: JsonObject) {
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
          if (!fragment && selection.kind === 'FragmentSpread') {
            // Like InMemoryCache, writing with an undefined fragment fails.
            const error = new InvariantError(`No fragment named ${selection.name.value}`);
            uncaughtErrors.add(error);
            throw error;
          }
          if (fragment && fragmentMatches(fragment, typename, object)) {
            flatten(fragment.selectionSet, { clientOnly, deferred });
          }
        }
      }
    })(selectionSet, { clientOnly: false, deferred: false });
    return fieldMap;
  }

  /** Checks a value, returning it with its objects' fields by their schema names. */
  function checkValue(value: JsonValue | undefined, selectionSet: SelectionSetNode): JsonValue | undefined {
    if (Array.isArray(value)) {
      return value.map(item => checkValue(item, selectionSet)) as JsonValue;
    } else if (value && typeof value === 'object' && !isReference(value)) {
      return checkObject(value as JsonObject, selectionSet, undefined, false);
    }
    return value;
  }

  function checkObject(
    object: JsonObject,
    selectionSet: SelectionSetNode,
    typename: string | undefined,
    isRoot: boolean,
  ): JsonObject {
    if (typeof object.__typename === 'string') typename = object.__typename;
    // The fields of the object by their schema names (rather than aliases).
    const storeObject: JsonObject = {};
    flattenFields(selectionSet, typename, object).forEach(({ clientOnly, deferred }, field) => {
      const value = object[resultKeyNameFromField(field)];
      if (value !== undefined) {
        storeObject[field.name.value] = field.selectionSet ? checkValue(value, field.selectionSet)! : value;
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
    const keyField = isRoot ? undefined : missingKeyField(context, object, storeObject, { selectionSet, fragmentMap });
    if (keyField !== undefined) {
      const error = missingKeyFieldError(keyField, object);
      uncaughtErrors.add(error);
      throw error;
    }
    return storeObject;
  }

  checkObject(result, getMainDefinition(document).selectionSet, rootTypename, true);
}
