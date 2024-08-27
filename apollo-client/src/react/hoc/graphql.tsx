import type { DocumentNode } from "graphql";
import type * as ReactTypes from "react";
import { OperationVariables } from "@apollo/client";
import {
  OperationOption,
  DataProps,
  MutateProps,
} from "@apollo/client/react/hoc";

import { parser, DocumentType } from "../parser/index";

import { withQuery } from "./query-hoc";
import { withMutation } from "./mutation-hoc";
import { withSubscription } from "./subscription-hoc";

/**
 * @deprecated
 * Official support for React Apollo higher order components ended in March 2020.
 * This library is still included in the `@apollo/client` package, but it no longer receives feature updates or bug fixes.
 */
export function graphql<
  TProps extends TGraphQLVariables | {} = {},
  TData extends object = {},
  TGraphQLVariables extends OperationVariables = {},
  TChildProps extends object = Partial<DataProps<TData, TGraphQLVariables>> &
    Partial<MutateProps<TData, TGraphQLVariables>>,
>(
  document: DocumentNode,
  operationOptions: OperationOption<
    TProps,
    TData,
    TGraphQLVariables,
    TChildProps
  > = {}
): (
  WrappedComponent: ReactTypes.ComponentType<TProps & TChildProps>
) => ReactTypes.ComponentClass<TProps> {
  switch (parser(document).type) {
    case DocumentType.Mutation:
      return withMutation(document, operationOptions);
    case DocumentType.Subscription:
      return withSubscription(document, operationOptions);
    case DocumentType.Query:
    default:
      return withQuery(document, operationOptions);
  }
}
