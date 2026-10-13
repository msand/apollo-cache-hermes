import { ApolloClient, ApolloLink } from '@apollo/client';
import { LocalState } from '@apollo/client/local-state';

import { Hermes } from '../../../../../src';

import { gql } from './testUtils';

it('resolves @client fields mixed with aliased server fields', async () => {
  const document = gql`
    query Aliased {
      foo @client {
        bar
      }
      baz: bar {
        foo
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const remoteResult = {
    data: {
      baz: { foo: true, __typename: 'Bar' },
    },
  };

  const localState = new LocalState({
    resolvers: {
      Query: {
        foo: () => ({ bar: true, __typename: 'Foo' }),
      },
    },
  });

  await expect(
    localState.execute({
      document,
      client,
      context: {},
      remoteResult,
      variables: {},
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: {
      foo: { bar: true, __typename: 'Foo' },
      baz: { foo: true, __typename: 'Bar' },
    },
  });
});

it('resolves aliased @client fields', async () => {
  const document = gql`
    query Test {
      fie: foo @client {
        bar
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const fie = jest.fn();
  const localState = new LocalState({
    resolvers: {
      Query: {
        foo: () => ({ bar: true, __typename: 'Foo' }),
        fie,
      },
    },
  });

  await expect(
    localState.execute({
      client,
      document,
      context: {},
      variables: {},
      remoteResult: undefined,
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: { fie: { bar: true, __typename: 'Foo' } },
  });

  expect(fie).not.toHaveBeenCalled();
});

it('resolves deeply nested aliased @client fields', async () => {
  const document = gql`
    query Test {
      user {
        id
        bestFriend {
          first: firstName
          last: lastName
          name: fullName @client
        }
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const remoteResult = {
    data: {
      user: {
        __typename: 'User',
        id: 1,
        bestFriend: {
          __typename: 'User',
          first: 'Test',
          last: 'User',
        },
      },
    },
  };

  const localState = new LocalState({
    resolvers: {
      User: {
        fullName: user => `${user.firstName} ${user.lastName}`,
      },
    },
  });

  await expect(
    localState.execute({
      client,
      document,
      context: {},
      remoteResult,
      variables: {},
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: {
      user: {
        __typename: 'User',
        id: 1,
        bestFriend: {
          __typename: 'User',
          first: 'Test',
          last: 'User',
          name: 'Test User',
        },
      },
    },
  });
});

it('respects aliases for *nested fields* on the @client-tagged node', async () => {
  const document = gql`
    query Test {
      fie: foo @client {
        fum: bar
      }
      baz: bar {
        foo
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const remoteResult = { data: { baz: { foo: true, __typename: 'Baz' } } };

  const fie = jest.fn();
  const localState = new LocalState({
    resolvers: {
      Query: {
        foo: () => ({ bar: true, __typename: 'Foo' }),
        fie,
      },
    },
  });

  await expect(
    localState.execute({
      client,
      document,
      context: {},
      remoteResult,
      variables: {},
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: {
      fie: { fum: true, __typename: 'Foo' },
      baz: { foo: true, __typename: 'Baz' },
    },
  });

  expect(fie).not.toHaveBeenCalled();
});

it('does not confuse fields aliased to each other', async () => {
  const document = gql`
    query Test {
      fie: foo @client {
        fum: bar
        bar: fum
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const localState = new LocalState({
    resolvers: {
      Query: {
        foo: () => ({ bar: 'fum', fum: 'bar', __typename: 'Foo' }),
      },
    },
  });

  await expect(
    localState.execute({
      client,
      document,
      context: {},
      variables: {},
      remoteResult: undefined,
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: {
      fie: { fum: 'fum', bar: 'bar', __typename: 'Foo' },
    },
  });
});

it('does not confuse fields aliased to each other with boolean values', async () => {
  const document = gql`
    query Test {
      fie: foo @client {
        fum: bar
        bar: fum
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const localState = new LocalState({
    resolvers: {
      Query: {
        foo: () => ({ bar: true, fum: false, __typename: 'Foo' }),
      },
    },
  });

  await expect(
    localState.execute({
      client,
      document,
      context: {},
      variables: {},
      remoteResult: undefined,
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: {
      fie: { fum: true, bar: false, __typename: 'Foo' },
    },
  });
});

it('resolves client fields that are child fields of aliased server fields', async () => {
  const document = gql`
    query Test {
      fie: foo {
        bar
        baz @client
      }
    }
  `;

  const client = new ApolloClient({
    cache: new Hermes(),
    link: ApolloLink.empty(),
  });

  const remoteResult = {
    data: {
      fie: { bar: true, __typename: 'Foo' },
    },
  };

  const localState = new LocalState({
    resolvers: {
      Foo: {
        baz: () => true,
      },
    },
  });

  await expect(
    localState.execute({
      client,
      document,
      context: {},
      variables: {},
      remoteResult,
      fetchPolicy: 'cache-first',
    }),
  ).resolves.toStrictEqualTyped({
    data: {
      fie: { bar: true, baz: true, __typename: 'Foo' },
    },
  });
});
