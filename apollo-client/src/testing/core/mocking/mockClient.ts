import type { DocumentNode } from "graphql";

import { ApolloClient } from "../../../core/index";
import type { NormalizedCacheObject } from "../../../cache/index";
import { Hermes } from "apollo-cache-hermes";
import { mockSingleLink } from "./mockLink";

export function createMockClient<TData>(
  data: TData,
  query: DocumentNode,
  variables = {}
): ApolloClient<NormalizedCacheObject> {
  return new ApolloClient({
    link: mockSingleLink({
      request: { query, variables },
      result: { data },
    }).setOnError((error) => {
      throw error;
    }),
    cache: new Hermes({ addTypename: false }),
  });
}
