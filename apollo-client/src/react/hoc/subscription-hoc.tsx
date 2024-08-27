import * as React from "rehackt";
import type * as ReactTypes from "react";
import type { DocumentNode } from "graphql";
import hoistNonReactStatics from "hoist-non-react-statics";

import { parser } from "../parser/index";
import type { BaseQueryOptions } from "../types/types";
import { Subscription } from "../components/index";
import {
  getDisplayName,
  GraphQLBase,
  calculateVariablesFromProps,
  defaultMapPropsToOptions,
  defaultMapPropsToSkip,
} from "./hoc-utils";
import type { OperationOption, OptionProps, DataProps } from "./types";

/**
 * @deprecated
 * Official support for React Apollo higher order components ended in March 2020.
 * This library is still included in the `@apollo/client` package, but it no longer receives feature updates or bug fixes.
 */
export function withSubscription<
  TProps extends TGraphQLVariables | {} = {},
  TData extends object = {},
  TGraphQLVariables extends object = {},
  TChildProps extends object = DataProps<TData, TGraphQLVariables>,
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
  const {
    options = defaultMapPropsToOptions,
    skip = defaultMapPropsToSkip,
    alias = "Apollo",
    shouldResubscribe,
  } = operationOptions;

  let mapPropsToOptions = options as (props: any) => BaseQueryOptions;
  if (typeof mapPropsToOptions !== "function")
    mapPropsToOptions = () => options as BaseQueryOptions;

  let mapPropsToSkip = skip as (props: any) => boolean;
  if (typeof mapPropsToSkip !== "function") mapPropsToSkip = () => skip as any;

  // allow for advanced referential equality checks
  let lastResultProps: TChildProps | void;
  return (
    WrappedComponent: ReactTypes.ComponentType<TProps & TChildProps>
  ): ReactTypes.ComponentClass<TProps> => {
    const graphQLDisplayName = `${alias}(${getDisplayName(WrappedComponent)})`;
    class GraphQL extends GraphQLBase<
      TProps,
      TChildProps,
      { resubscribe: boolean }
    > {
      static displayName = graphQLDisplayName;
      static WrappedComponent = WrappedComponent;
      constructor(props: TProps) {
        super(props);
        this.state = { resubscribe: false };
      }

      updateResubscribe(resubscribe: boolean) {
        this.setState({ resubscribe });
      }

      componentDidUpdate(prevProps: TProps) {
        const resubscribe = !!(
          shouldResubscribe && shouldResubscribe(prevProps, this.props)
        );
        if (this.state.resubscribe !== resubscribe) {
          this.updateResubscribe(resubscribe);
        }
      }

      render() {
        let props = this.props;
        const shouldSkip = mapPropsToSkip(props);
        const opts =
          shouldSkip ? Object.create(null) : mapPropsToOptions(props);

        if (!shouldSkip && !opts.variables && operation.variables.length > 0) {
          opts.variables = calculateVariablesFromProps(operation, props);
        }
        return (
          <Subscription
            {...opts}
            displayName={graphQLDisplayName}
            skip={shouldSkip}
            subscription={document}
            shouldResubscribe={this.state.resubscribe}
          >
            {({ data, ...r }: any) => {
              if (operationOptions.withRef) {
                this.withRef = true;
                props = Object.assign({}, props, {
                  ref: this.setWrappedInstance,
                });
              }
              // if we have skipped, no reason to manage any reshaping
              if (shouldSkip) {
                return (
                  <WrappedComponent
                    {...(props as TProps)}
                    {...({} as TChildProps)}
                  />
                );
              }

              // the HOC's historically hoisted the data from the execution result
              // up onto the result since it was passed as a nested prop
              // we massage the Query components shape here to replicate that
              const result = Object.assign(r, data || {});
              const name = operationOptions.name || "data";
              let childProps = { [name]: result };
              if (operationOptions.props) {
                const newResult: OptionProps<TProps, TData, TGraphQLVariables> =
                  {
                    [name]: result,
                    ownProps: props as TProps,
                  };
                lastResultProps = operationOptions.props(
                  newResult,
                  lastResultProps
                );
                childProps = lastResultProps;
              }

              return (
                <WrappedComponent
                  {...(props as TProps)}
                  {...(childProps as TChildProps)}
                />
              );
            }}
          </Subscription>
        );
      }
    }

    // Make sure we preserve any custom statics on the original component.
    return hoistNonReactStatics(GraphQL, WrappedComponent, {});
  };
}
