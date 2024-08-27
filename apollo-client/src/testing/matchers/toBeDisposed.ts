import type { MatcherFunction } from "expect";

import type { QueryRef } from "../../react/internal/index";
import {
  assertWrappedQueryRef,
  unwrapQueryRef,
} from "../../react/internal/index";

export const toBeDisposed: MatcherFunction<[]> = function (_queryRef) {
  const hint = this.utils.matcherHint("toBeDisposed", "queryRef", "", {
    isNot: this.isNot,
  });

  const queryRef = _queryRef as QueryRef;
  assertWrappedQueryRef(queryRef);

  const pass = unwrapQueryRef(queryRef).disposed;

  return {
    pass,
    message: () => {
      return `${hint}\n\nExpected queryRef ${
        this.isNot ? "not " : ""
      }to be disposed, but it was${this.isNot ? "" : " not"}.`;
    },
  };
};
