// eslint-disable-next-line import/no-extraneous-dependencies
import * as PropTypes from "prop-types";
import type * as ReactTypes from "react";
import { OperationVariables, useMutation } from "@apollo/client";
import { MutationComponentOptions } from "@apollo/client/react/components";

/**
 * @deprecated
 * Official support for React Apollo render prop components ended in March 2020.
 * This library is still included in the `@apollo/client` package,
 * but it no longer receives feature updates or bug fixes.
 */
export function Mutation<
  TData = any,
  TVariables extends OperationVariables = OperationVariables,
>(
  props: MutationComponentOptions<TData, TVariables>
): ReactTypes.JSX.Element | null {
  const [runMutation, result] = useMutation(props.mutation, props);
  return props.children ? props.children(runMutation, result) : null;
}

export interface Mutation<TData, TVariables> {
  propTypes: PropTypes.InferProps<MutationComponentOptions<TData, TVariables>>;
}

Mutation.propTypes = {
  mutation: PropTypes.object.isRequired,
  variables: PropTypes.object,
  optimisticResponse: PropTypes.oneOfType([PropTypes.object, PropTypes.func]),
  refetchQueries: PropTypes.oneOfType([
    PropTypes.arrayOf(
      PropTypes.oneOfType([PropTypes.string, PropTypes.object])
    ),
    PropTypes.func,
  ]),
  awaitRefetchQueries: PropTypes.bool,
  update: PropTypes.func,
  children: PropTypes.func.isRequired,
  onCompleted: PropTypes.func,
  onError: PropTypes.func,
  fetchPolicy: PropTypes.string,
} as Mutation<any, any>["propTypes"];
