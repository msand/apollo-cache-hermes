import { ApolloClient, CombinedGraphQLErrors, gql } from '@apollo/client';
import { MockLink } from '@apollo/client/testing';

import { Hermes } from '../../../../../src';

it('uses defaultOptions from `query` key', async () => {
  const query = gql`
    query {
      greeting
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: new MockLink([
      {
        request: { query },
        result: { data: { greeting: null }, errors: [{ message: 'Oops' }] },
      },
    ]),
    defaultOptions: {
      query: {
        // @ts-expect-error - default options types not declared
        errorPolicy: 'all',
      },
    },
  });

  await expect(client.query({ query })).resolves.toStrictEqualTyped({
    data: { greeting: null },
    error: new CombinedGraphQLErrors({
      data: { greeting: null },
      errors: [{ message: 'Oops' }],
    }),
  });
});

it('does not use defaultOptions from `watchQuery` key', async () => {
  const query = gql`
    query {
      greeting
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: new MockLink([
      {
        request: { query },
        result: { data: { greeting: null }, errors: [{ message: 'Oops' }] },
      },
    ]),
    defaultOptions: {
      watchQuery: {
        // @ts-expect-error - default options types not declared
        errorPolicy: 'all',
      },
    },
  });

  await expect(client.query({ query })).rejects.toThrow(
    new CombinedGraphQLErrors({
      data: { greeting: null },
      errors: [{ message: 'Oops' }],
    }),
  );
});
