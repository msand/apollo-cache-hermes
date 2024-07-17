import * as React from 'react';
import { render } from '@testing-library/react';
import { InvariantError } from 'ts-invariant';
import { ApolloClient, ApolloLink, ApolloProvider } from '@apollo/client';

import { useApolloClient } from '../useApolloClient';
import { Hermes } from '../../../../../src';

describe('useApolloClient Hook', () => {
  it('should return a client instance from the context if available', () => {
    const client = new ApolloClient({
      cache: new Hermes(),
      link: ApolloLink.empty(),
    });

    function App() {
      expect(useApolloClient()).toEqual(client);
      return null;
    }

    render(
      <ApolloProvider client={client}>
        <App />
      </ApolloProvider>
    );
  });

  it('should error if a client instance can\'t be found in the context', () => {
    function App() {
      expect(() => useApolloClient()).toThrow(InvariantError);
      return null;
    }

    render(<App />);
  });
});
