export { DEV, maybe } from "./globals/index";

export type { DirectiveInfo, InclusionDirectives } from "./graphql/directives";
export {
  shouldInclude,
  hasDirectives,
  hasAnyDirectives,
  hasAllDirectives,
  hasClientExports,
  getDirectiveNames,
  getInclusionDirectives,
} from "./graphql/directives";

export type { DocumentTransformCacheKey } from "./graphql/DocumentTransform";
export { DocumentTransform } from "./graphql/DocumentTransform";

export type { FragmentMap, FragmentMapFunction } from "./graphql/fragments";
export {
  createFragmentMap,
  getFragmentQueryDocument,
  getFragmentFromSelection,
} from "./graphql/fragments";

export {
  checkDocument,
  getOperationDefinition,
  getOperationName,
  getFragmentDefinitions,
  getQueryDefinition,
  getFragmentDefinition,
  getMainDefinition,
  getDefaultValues,
} from "./graphql/getFromAST";

export { print } from "./graphql/print";

export type {
  StoreObject,
  AsStoreObject,
  Reference,
  StoreValue,
  Directives,
  VariableValue,
} from "./graphql/storeUtils";
export {
  makeReference,
  isDocumentNode,
  isReference,
  isField,
  isInlineFragment,
  valueToObjectRepresentation,
  storeKeyNameFromField,
  argumentsObjectFromField,
  resultKeyNameFromField,
  getStoreKeyName,
  getTypenameFromResult,
} from "./graphql/storeUtils";

export type {
  RemoveNodeConfig,
  GetNodeConfig,
  RemoveDirectiveConfig,
  GetDirectiveConfig,
  RemoveArgumentsConfig,
  GetFragmentSpreadConfig,
  RemoveFragmentSpreadConfig,
  RemoveFragmentDefinitionConfig,
  RemoveVariableDefinitionConfig,
} from "./graphql/transform";
export {
  addTypenameToDocument,
  buildQueryFromSelectionSet,
  removeDirectivesFromDocument,
  removeConnectionDirectiveFromDocument,
  removeArgumentsFromDocument,
  removeFragmentSpreadFromDocument,
  removeClientSetsFromDocument,
} from "./graphql/transform";

export {
  isMutationOperation,
  isQueryOperation,
  isSubscriptionOperation,
} from "./graphql/operations";

export {
  concatPagination,
  offsetLimitPagination,
  relayStylePagination,
} from "./policies/pagination";

export type {
  Observer,
  ObservableSubscription,
} from "./observables/Observable";
export { Observable } from "./observables/Observable";

export type { PromiseWithState } from "./promises/decoration";
export {
  isStatefulPromise,
  createFulfilledPromise,
  createRejectedPromise,
  wrapPromiseWithState,
} from "./promises/decoration";

export * from "./common/mergeDeep";
export * from "./common/cloneDeep";
export * from "./common/maybeDeepFreeze";
export * from "./observables/iteration";
export * from "./observables/asyncMap";
export * from "./observables/Concast";
export * from "./observables/subclassing";
export * from "./common/arrays";
export * from "./common/objects";
export * from "./common/errorHandling";
export * from "./common/canUse";
export * from "./common/compact";
export * from "./common/makeUniqueId";
export * from "./common/stringifyForDisplay";
export * from "./common/mergeOptions";
export * from "./common/incrementalResult";

export { canonicalStringify } from "./common/canonicalStringify";
export { omitDeep } from "./common/omitDeep";
export { stripTypename } from "./common/stripTypename";

export * from "./types/IsStrictlyAny";
export type { DeepOmit } from "./types/DeepOmit";
export type { DeepPartial } from "./types/DeepPartial";
export type { OnlyRequiredProperties } from "./types/OnlyRequiredProperties";

export {
  AutoCleanedStrongCache,
  AutoCleanedWeakCache,
  cacheSizes,
  defaultCacheSizes,
} from "./caching/index";
export type { CacheSizes } from "./caching/index";
