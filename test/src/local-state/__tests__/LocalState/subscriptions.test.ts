import { ApolloClient } from '@apollo/client';
import { ApolloLink } from '@apollo/client/link';
import { LocalState } from '@apollo/client/local-state';
import { InvariantError } from '@apollo/client/utilities/invariant';

import { Hermes } from '../../../../../src';

import { gql } from './testUtils';

it('throws when given a subscription with no client fields', async () => {
  const subscription = gql`
    subscription {
      field
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const localState = new LocalState();

  await expect(
    localState.execute({
      document: subscription,
      client,
      context: {},
      variables: {},
      remoteResult: { data: { field: 1 } },
      fetchPolicy: 'cache-first',
    }),
  ).rejects.toEqual(new InvariantError('Expected document to contain `@client` fields.'));
});

it('adds @client fields with subscription results', async () => {
  const subscription = gql`
    subscription {
      field
      count @client
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  let subCounter = 0;
  const localState = new LocalState({
    resolvers: {
      Subscription: {
        count: () => {
          subCounter += 1;
          return subCounter;
        },
      },
    },
  });

  await expect(
    localState.execute({
      document: subscription,
      client,
      context: {},
      variables: {},
      remoteResult: { data: { field: 1 } },
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: { field: 1, count: 1 },
  });

  await expect(
    localState.execute({
      document: subscription,
      client,
      context: {},
      variables: {},
      remoteResult: { data: { field: 2 } },
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: { field: 2, count: 2 },
  });
});
