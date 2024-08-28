export { getSuspenseCache } from "./cache/getSuspenseCache";
export type { CacheKey, QueryKey } from "./cache/types";
export type {
  QueryReference,
  QueryRef,
  PreloadedQueryRef,
} from "./cache/QueryReference";
export {
  InternalQueryReference,
  getWrappedPromise,
  unwrapQueryRef,
  updateWrappedQueryRef,
  wrapQueryRef,
  assertWrappedQueryRef,
} from "./cache/QueryReference";
export type { SuspenseCacheOptions } from "./cache/SuspenseCache";
export type { HookWrappers } from "../hooks/internal/wrapHook";
