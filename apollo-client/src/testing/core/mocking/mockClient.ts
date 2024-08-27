import type { DocumentNode } from "graphql";
import { ApolloClient, NormalizedCacheObject } from "@apollo/client";

import { Hermes } from "../../../../../src";

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
