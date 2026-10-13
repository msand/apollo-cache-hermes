import type { FieldFunctionOptions, Reference, StoreObject } from '@apollo/client/cache';
import { makeReference, stringifyForDisplay } from '@apollo/client/utilities/internal';
import { invariant, InvariantError } from '@apollo/client/utilities/invariant';
import type { FragmentDefinitionNode, InlineFragmentNode } from 'graphql';

import type { JsonObject } from '../primitive';
import { isRootNodeId } from '../schema';
import type { NodeId } from '../schema';
import { hasOwn, isObject } from '../util/primitive';
import { isReference } from '../util/references';

import type { Policies } from './policies';

/*
 * Small helpers shared by the cache's internals (writes, reads, policies and
 * transactions), so that each of these questions has one answer:
 *
 * - isRootNodeId: whether an id is that of a root object (ROOT_QUERY etc).
 * - hasOwn: Object.prototype.hasOwnProperty (call it with `.call`).
 * - isDev: whether development-only checks and warnings are enabled.
 * - typenameOf / storedTypename: the __typename of a value, or of a stored node.
 * - fragmentMatches: whether a fragment applies to a __typename.
 * - identify / makeToReference: the id of an object (or Reference), and the
 *   toReference helper of read, merge and modifier functions.
 */

export { hasOwn, isRootNodeId };

/** The toReference helper of read, merge and modifier functions. */
export type ToReference = FieldFunctionOptions['toReference'];

/**
 * Whether development-only checks and warnings are enabled: unless __DEV__ is
 * set to false, like Apollo Client.
 */
export function isDev(): boolean {
  return (globalThis as { __DEV__?: boolean }).__DEV__ !== false;
}

/** The __typename of a value, if it is an object with a string __typename. */
export function typenameOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const typename = (value as { __typename?: unknown }).__typename;
  return typeof typename === 'string' ? typename : undefined;
}

/**
 * The __typename of the stored node `id` (whose data is `data`): like
 * InMemoryCache, a root object has its root type's __typename (whatever its
 * data says), and other nodes the __typename stored in their data.
 */
export function storedTypename(
  policies: Pick<Policies, 'rootTypename'>,
  id: NodeId,
  data: unknown,
): string | undefined {
  return policies.rootTypename(id) ?? typenameOf(data);
}

/**
 * Whether a fragment (or inline fragment) applies to objects of the given
 * __typename, considering possibleTypes (like InMemoryCache#fragmentMatches).
 */
export function fragmentMatches(
  policies: Pick<Policies, 'fragmentMatches'>,
  fragment: InlineFragmentNode | FragmentDefinitionNode,
  typename: string,
): boolean {
  if (!fragment.typeCondition) return true;
  // A fragment with a type condition cannot match an object without __typename.
  if (!typename) return false;
  return policies.fragmentMatches(fragment.typeCondition.name.value, typename);
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
 * The id of an object, like InMemoryCache#identify: a Reference's id, or the
 * id its type policy (or dataIdFromObject) gives it. Objects of the root query
 * type are ROOT_QUERY. In development, it warns about an object that is
 * missing one of its keyFields.
 */
export function identify(policies: Policies, object: StoreObject | Reference | null | undefined): string | undefined {
  if (isReference(object)) return object.__ref;
  if (!isObject(object)) return undefined;
  const [id, missingKeyField] = policies.identify(object as JsonObject);
  if (id === undefined && missingKeyField !== undefined && isDev()) {
    invariant.warn(missingKeyFieldError(missingKeyField, object as JsonObject));
  }
  return id;
}

/**
 * Builds a toReference helper (like InMemoryCache's): it accepts an id, a
 * Reference, or an object to identify, which (with `mergeIntoStore`) is
 * merged into the entity it identifies via `mergeIntoEntity`.
 */
export function makeToReference(
  identifyValue: (value: StoreObject) => NodeId | undefined,
  mergeIntoEntity: (id: NodeId, value: StoreObject) => void,
): ToReference {
  return (objOrIdOrRef, mergeIntoStore) => {
    if (typeof objOrIdOrRef === 'string') return makeReference(objOrIdOrRef);
    if (isReference(objOrIdOrRef)) return objOrIdOrRef;
    const id = identifyValue(objOrIdOrRef);
    if (id === undefined) return undefined;
    if (mergeIntoStore) mergeIntoEntity(id, objOrIdOrRef);
    return makeReference(id);
  };
}
