import { expect } from "@jest/globals";
import { toMatchDocument } from "./toMatchDocument";
import { toHaveSuspenseCacheEntryUsing } from "./toHaveSuspenseCacheEntryUsing";
import { toRerender, toRenderExactlyTimes } from "./ProfiledComponent";
import { toBeGarbageCollected } from "./toBeGarbageCollected";
import { toBeDisposed } from "./toBeDisposed";

expect.extend({
  toBeDisposed,
  toHaveSuspenseCacheEntryUsing,
  toMatchDocument,
  toRerender,
  toRenderExactlyTimes,
  toBeGarbageCollected,
});
