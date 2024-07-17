
import * as React from 'rehackt';
import type * as ReactTypes from 'react';
import type { DocumentNode } from 'graphql';
// eslint-disable-next-line import/no-extraneous-dependencies
import hoistNonReactStatics from 'hoist-non-react-statics';
import {
  ApolloCache,
  BaseMutationOptions,
  MutationResult,
  DefaultContext,
  OperationVariables,
  parser,
  MutationFunctionOptions, FetchResult,
} from '@apollo/client';
import { Mutation } from '@apollo/client/react/components';
import { MutateProps, OperationOption, OptionProps } from '@apollo/client/react/hoc';

import {
  defaultMapPropsToOptions,
  getDisplayName,
  calculateVariablesFromProps,
  GraphQLBase,
} from './hoc-utils';

/**
 * @deprecated
 * Official support for React Apollo higher order components ended in March 2020.
 * This library is still included in the `@apollo/client` package, but it no longer receives feature updates or bug fixes.
 */
export function withMutation<
  TProps extends TGraphQLVariables | {} = {},
  TData extends Record<string, any> = {},
  TGraphQLVariables extends OperationVariables = {},
  TChildProps = MutateProps<TData, TGraphQLVariables>,
  TContext extends Record<string, any> = DefaultContext,
  TCache extends ApolloCache<any> = ApolloCache<any>,
>(
  document: DocumentNode,
  operationOptions: OperationOption<
    TProps,
    TData,
    TGraphQLVariables,
    TChildProps
  > = {}
) {
  // this is memoized so if coming from `graphql` there is nearly no extra cost
  const operation = parser(document);
  // extract options

  const { options = defaultMapPropsToOptions, alias = 'Apollo' }
    = operationOptions;

  let mapPropsToOptions = options as (
    props: TProps
  ) => BaseMutationOptions<TData>;
  if (typeof mapPropsToOptions !== 'function') {
    mapPropsToOptions = () =>
      options as BaseMutationOptions<TData>;
  }

  return (
    WrappedComponent: ReactTypes.ComponentType<TProps & TChildProps>
  ): ReactTypes.ComponentClass<TProps> => {
    const graphQLDisplayName = `${alias}(${getDisplayName(WrappedComponent)})`;
    class GraphQL extends GraphQLBase<TProps, TChildProps> {
      static displayName = graphQLDisplayName;
      static WrappedComponent = WrappedComponent;
      render() {
        let props = this.props as TProps;
        const opts = mapPropsToOptions(props);

        if (operationOptions.withRef) {
          this.withRef = true;
          props = Object.assign({}, props, {
            ref: this.setWrappedInstance,
          });
        }
        if (!opts.variables && operation.variables.length > 0) {
          opts.variables = calculateVariablesFromProps(
            operation,
            props
          ) as TGraphQLVariables;
        }

        return (
          // noinspection XmlDeprecatedElement
          <Mutation ignoreResults {...opts} mutation={document}>
            {(
              mutate: <TData>(options?: MutationFunctionOptions<TData, OperationVariables, DefaultContext, ApolloCache<any>>) => Promise<FetchResult<TData>>,
              { data, ...r }: MutationResult<TData>
            ) => {
              // the HOC's historically hoisted the data from the execution result
              // up onto the result since it was passed as a nested prop
              // we massage the Mutation component's shape here to replicate that
              // this matches the query HoC
              const result = Object.assign(r, data || {});
              const name = operationOptions.name || 'mutate';
              const resultName
                = operationOptions.name ? `${name}Result` : 'result';
              let childProps = {
                [name]: mutate,
                [resultName]: result,
              } as any as TChildProps;
              if (operationOptions.props) {
                const newResult: OptionProps<TProps, TData, TGraphQLVariables>
                  = {
                    [name]: mutate,
                    [resultName]: result,
                    ownProps: props,
                  };
                childProps = operationOptions.props(newResult) as any;
              }

              return <WrappedComponent {...props} {...childProps} />;
            }}
          </Mutation>
        );
      }
    }

    // Make sure we preserve any custom statics on the original component.
    return hoistNonReactStatics(GraphQL, WrappedComponent, {});
  };
}
