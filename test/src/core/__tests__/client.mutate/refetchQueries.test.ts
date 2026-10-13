import { ApolloClient, gql } from '@apollo/client';
import { MockLink } from '@apollo/client/testing';

import { Hermes } from '../../../../../src';

it('applies defaultOptions.watchQuery to refetchQueries query objects', async () => {
  const query = gql`
    query {
      greeting
    }
  `;

  const mutation = gql`
    mutation {
      updateGreeting
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: new MockLink([
      {
        request: { query: mutation },
        result: { data: { updateGreeting: true } },
      },
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

  // With defaultOptions.watchQuery.errorPolicy: "all", the refetch query
  // should not cause the mutation to reject despite returning GraphQL errors.
  await expect(
    client.mutate({
      mutation,
      refetchQueries: [{ query }],
      awaitRefetchQueries: true,
    }),
  ).resolves.toStrictEqualTyped({
    data: { updateGreeting: true },
  });
});
