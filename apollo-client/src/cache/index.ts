import "../utilities/globals/index";

export type {
  Transaction,
  WatchFragmentOptions,
  WatchFragmentResult,
} from "./core/cache";
export { ApolloCache } from "./core/cache";
export { Cache } from "./core/types/Cache";
export type { DataProxy } from "./core/types/DataProxy";
export type {
  MissingTree,
  Modifier,
  Modifiers,
  ModifierDetails,
  ReadFieldOptions,
} from "./core/types/common";
export { MissingFieldError } from "./core/types/common";

export type { Reference } from "../utilities/index";
export {
  isReference,
  makeReference,
  canonicalStringify,
} from "../utilities/index";

export { EntityStore } from "./inmemory/entityStore";
export {
  fieldNameFromStoreName,
  defaultDataIdFromObject,
} from "./inmemory/helpers";

export { InMemoryCache } from "./inmemory/inMemoryCache";

export type { ReactiveVar } from "./inmemory/reactiveVars";
export { makeVar, cacheSlot } from "./inmemory/reactiveVars";

export type {
  TypePolicies,
  TypePolicy,
  FieldPolicy,
  FieldReadFunction,
  FieldMergeFunction,
  FieldFunctionOptions,
  PossibleTypesMap,
} from "./inmemory/policies";
export { Policies } from "./inmemory/policies";

export type { FragmentRegistryAPI } from "./inmemory/fragmentRegistry";
export { createFragmentRegistry } from "./inmemory/fragmentRegistry";

export * from "./inmemory/types";
