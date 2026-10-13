import { Observable } from 'rxjs';
import { ApolloClient, ApolloLink, gql, InMemoryCache } from '@apollo/client';
import { CombinedGraphQLErrors, CombinedProtocolErrors, LinkError, UnconventionalError } from '@apollo/client/errors';
import { MockLink, MockSubscriptionLink } from '@apollo/client/testing';

import { mockMultipartSubscriptionStream, ObservableStream, spyOnConsole } from '@apollo/client/testing/internal';

import { Hermes } from '../../../../src';

const query = gql`
  query {
    foo
  }
`;

const mutation = gql`
  mutation {
    foo
  }
`;

const subscription = gql`
  subscription {
    foo
  }
`;

function createErrorLink(error: unknown) {
  return new ApolloLink(() => {
    return new Observable(observer => {
      observer.error(error);
    });
  });
}

it('error is not registered until emitted from the link chain', async () => {
  const error = new Error('Oops');
  const client = new ApolloClient({
    link: createErrorLink(error),
    cache: new Hermes(),
  });

  // Error has not yet been emitted from the link chain
  expect(LinkError.is(error)).toBe(false);

  const actual = await client.query({ query }).catch(error => error);
  expect(actual).toBe(error);

  // We've run the operation and the error has been emitted from the link chain,
  expect(LinkError.is(actual)).toBe(true);
});

it('handles errors emitted as strings', async () => {
  const client = new ApolloClient({
    link: createErrorLink('Oops'),
    cache: new Hermes(),
  });

  const error = await client.query({ query }).catch(error => error);
  expect(error).toEqual(new Error('Oops'));

  expect(LinkError.is(error)).toBe(true);
});

it('handles errors emitted from unconventional types', async () => {
  const symbol = Symbol();
  const client = new ApolloClient({
    link: createErrorLink(symbol),
    cache: new Hermes(),
  });

  const error = await client.query({ query }).catch(error => error);
  expect(error).toEqual(new UnconventionalError(symbol));

  expect(LinkError.is(error)).toBe(true);
});

describe('client.query', () => {
  it('errors emitted from the link chain are network errors', async () => {
    const error = new Error('Oops');
    const client = new ApolloClient({
      link: createErrorLink(error),
      cache: new Hermes(),
    });

    const actual = await client.query({ query }).catch(error => error);
    expect(actual).toBe(error);

    expect(LinkError.is(actual)).toBe(true);
  });

  it('does not register GraphQL errors as network errors', async () => {
    const client = new ApolloClient({
      link: new MockLink([{ request: { query }, result: { errors: [{ message: 'Oops' }] } }]),
      cache: new Hermes(),
    });

    const error = await client.query({ query }).catch(error => error);
    expect(error).toEqual(new CombinedGraphQLErrors({ errors: [{ message: 'Oops' }] }));

    expect(LinkError.is(error)).toBe(false);
  });
});

describe('client.watchQuery', () => {
  it('errors emitted from the link chain are network errors', async () => {
    const error = new Error('Oops');
    const client = new ApolloClient({
      link: createErrorLink(error),
      cache: new Hermes(),
    });

    const stream = new ObservableStream(client.watchQuery({ query, notifyOnNetworkStatusChange: false }));

    const result = await stream.takeNext();

    expect(result.error).toBe(error);
    expect(LinkError.is(result.error)).toBe(true);
  });

  it('does not register GraphQL errors as network errors', async () => {
    const client = new ApolloClient({
      link: new MockLink([{ request: { query }, result: { errors: [{ message: 'Oops' }] } }]),
      cache: new Hermes(),
    });

    const stream = new ObservableStream(client.watchQuery({ query, notifyOnNetworkStatusChange: false }));

    const result = await stream.takeNext();

    expect(result.error).toEqual(new CombinedGraphQLErrors({ errors: [{ message: 'Oops' }] }));
    expect(LinkError.is(result.error)).toBe(false);
  });
});

describe('client.mutate', () => {
  it('errors emitted from the link chain are network errors', async () => {
    const error = new Error('Oops');
    const client = new ApolloClient({
      link: createErrorLink(error),
      cache: new Hermes(),
    });

    const actual = await client.mutate({ mutation }).catch(error => error);
    expect(actual).toBe(error);

    expect(LinkError.is(actual)).toBe(true);
  });

  it('does not register GraphQL errors as network errors', async () => {
    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: mutation },
          result: { errors: [{ message: 'Oops' }] },
        },
      ]),
      cache: new Hermes(),
    });

    const error = await client.mutate({ mutation }).catch(error => error);
    expect(error).toEqual(new CombinedGraphQLErrors({ errors: [{ message: 'Oops' }] }));

    expect(LinkError.is(error)).toBe(false);
  });

  it('does not report as a network error if error is thrown when updating the cache', async () => {
    const error = new Error('Error updating cache');
    const client = new ApolloClient({
      link: new MockLink([
        {
          request: { query: mutation },
          result: { data: { foo: 'bar' } },
        },
      ]),
      cache: new Hermes(),
    });

    const actual = await client
      .mutate({
        mutation,
        update: () => {
          throw error;
        },
      })
      .catch(error => error);
    expect(actual).toBe(error);

    expect(LinkError.is(actual)).toBe(false);
  });
});

describe('client.subscribe', () => {
  it('errors emitted from the link chain are network errors', async () => {
    const error = new Error('Oops');
    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Hermes(),
    });

    const stream = new ObservableStream(client.subscribe({ query: subscription }));
    link.simulateResult({ error });

    const result = await stream.takeNext();
    expect(result.error).toBe(error);

    expect(LinkError.is(result.error)).toBe(true);
  });

  it('does not register GraphQL errors as network errors', async () => {
    const link = new MockSubscriptionLink();
    const client = new ApolloClient({
      link,
      cache: new Hermes(),
    });

    const stream = new ObservableStream(client.subscribe({ query: subscription }));
    link.simulateResult({ result: { errors: [{ message: 'Oops' }] } });

    const result = await stream.takeNext();
    expect(result.error).toEqual(new CombinedGraphQLErrors({ errors: [{ message: 'Oops' }] }));

    expect(LinkError.is(result.error)).toBe(false);
  });

  it('does not register protocol errors as network errors', async () => {
    // silence warning for cache write
    using _ = spyOnConsole('error');
    const { httpLink, enqueueProtocolErrors } = mockMultipartSubscriptionStream();

    const client = new ApolloClient({
      link: httpLink,
      cache: new Hermes(),
    });

    const stream = new ObservableStream(client.subscribe({ query: subscription }));

    enqueueProtocolErrors([{ message: 'Oops' }]);

    const result = await stream.takeNext();
    expect(result.error).toEqual(new CombinedProtocolErrors([{ message: 'Oops' }]));

    expect(LinkError.is(result.error)).toBe(false);
  });
});
