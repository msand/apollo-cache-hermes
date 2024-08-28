import * as React from "react";

import type { DefaultOptions } from "../../core/index";
import { ApolloClient } from "../../core/index";
import { ApolloProvider } from "../../react/context/index";
import type { MockedResponse } from "../core/index";
import { MockLink } from "../core/index";
import type { ApolloLink } from "../../link/core/index";
import type { Resolvers } from "../../core/index";
import type { ApolloCache } from "../../cache/index";
import { Hermes } from "../../../../src";

export interface MockedProviderProps<TSerializedCache = {}> {
  mocks?: ReadonlyArray<MockedResponse<any, any>>;
  addTypename?: boolean;
  defaultOptions?: DefaultOptions;
  cache?: ApolloCache<TSerializedCache>;
  resolvers?: Resolvers;
  childProps?: object;
  children?: any;
  link?: ApolloLink;
  showWarnings?: boolean;
  /**
   * If set to true, the MockedProvider will try to connect to the Apollo DevTools.
   * Defaults to false.
   */
  connectToDevTools?: boolean;
}

export interface MockedProviderState {
  client: ApolloClient<any>;
}

export class MockedProvider extends React.Component<
  MockedProviderProps,
  MockedProviderState
> {
  public static defaultProps: MockedProviderProps = {
    addTypename: true,
  };

  constructor(props: MockedProviderProps) {
    super(props);

    const {
      mocks,
      addTypename,
      defaultOptions,
      cache,
      resolvers,
      link,
      showWarnings,
      connectToDevTools = false,
    } = this.props;
    const client = new ApolloClient({
      cache: cache || new Hermes({ addTypename }),
      defaultOptions,
      connectToDevTools,
      link: link || new MockLink(mocks || [], addTypename, { showWarnings }),
      resolvers,
    });

    this.state = {
      client,
    };
  }

  public render() {
    const { children, childProps } = this.props;
    const { client } = this.state;

    return React.isValidElement(children) ?
        <ApolloProvider client={client}>
          {React.cloneElement(React.Children.only(children), { ...childProps })}
        </ApolloProvider>
      : null;
  }

  public componentWillUnmount() {
    // Since this.state.client was created in the constructor, it's this
    // MockedProvider's responsibility to terminate it.
    this.state.client.stop();
  }
}
