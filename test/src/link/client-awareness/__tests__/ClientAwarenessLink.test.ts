import { ApolloClient, gql, InMemoryCache, version } from '@apollo/client';
import { ClientAwarenessLink } from '@apollo/client/link/client-awareness';
import { MockSubscriptionLink } from '@apollo/client/testing';

import { Hermes } from '../../../../../src';

const query = gql`
  query {
    hello
  }
`;

describe('feature: client awareness', () => {
  it('does not add headers without options', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
    });

    void client.query({ query });
    // note that the headers are not set to default values, but `headers` itself is still defined
    // as an empty object - this is okay
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual({});
  });

  it('can be enabled from `ApolloClient` options', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
      clientAwareness: {
        name: 'test-client',
        version: '1.0.0',
      },
    });

    void client.query({ query });
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual({
      'apollographql-client-name': 'test-client',
      'apollographql-client-version': '1.0.0',
    });
  });

  it('can be enabled from context', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
    });

    void client.query({
      query,
      context: {
        clientAwareness: {
          name: 'test-client',
          version: '1.0.0',
        },
      },
    });
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual({
      'apollographql-client-name': 'test-client',
      'apollographql-client-version': '1.0.0',
    });
  });

  it('can be enabled from `ClientAwarenessLink` constructor', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink({
        clientAwareness: {
          name: 'test-client',
          version: '1.0.0',
        },
      }).concat(terminatingLink),
      cache: new Hermes(),
    });

    void client.query({ query });
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual({
      'apollographql-client-name': 'test-client',
      'apollographql-client-version': '1.0.0',
    });
  });

  it('can be disabled from `ClientAwarenessLink` constructor, even with options present', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink({
        clientAwareness: { transport: false },
      }).concat(terminatingLink),
      cache: new Hermes(),
      clientAwareness: {
        name: 'test-client',
        version: '1.0.0',
      },
    });

    void client.query({ query });
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual(undefined);
  });

  it('can set `name` without setting `version`', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
      clientAwareness: {
        name: 'test-client',
      },
    });

    void client.query({ query });
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual({
      'apollographql-client-name': 'test-client',
    });
  });

  it('can set `version` without setting `name`', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
      clientAwareness: {
        version: '1.0.0',
      },
    });

    void client.query({ query });
    const headers = terminatingLink.operation?.getContext().headers;
    expect(headers).toStrictEqual({
      'apollographql-client-version': '1.0.0',
    });
  });

  describe('option priorities', () => {
    it('context overrides `ApolloClient` options', () => {
      const terminatingLink = new MockSubscriptionLink();
      const client = new ApolloClient({
        link: new ClientAwarenessLink().concat(terminatingLink),
        cache: new Hermes(),
        clientAwareness: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      void client.query({
        query,
        context: {
          clientAwareness: {
            name: 'overridden-client',
            version: '2.0.0',
          },
        },
      });

      const headers = terminatingLink.operation?.getContext().headers;
      expect(headers).toStrictEqual({
        'apollographql-client-name': 'overridden-client',
        'apollographql-client-version': '2.0.0',
      });
    });

    it('context overrides `ClientAwarenessLink` options', () => {
      const terminatingLink = new MockSubscriptionLink();
      const client = new ApolloClient({
        link: new ClientAwarenessLink({
          clientAwareness: {
            name: 'test-client',
            version: '1.0.0',
          },
        }).concat(terminatingLink),
        cache: new Hermes(),
      });

      void client.query({
        query,
        context: {
          clientAwareness: {
            name: 'overridden-client',
            version: '2.0.0',
          },
        },
      });
      const headers = terminatingLink.operation?.getContext().headers;
      expect(headers).toStrictEqual({
        'apollographql-client-name': 'overridden-client',
        'apollographql-client-version': '2.0.0',
      });
    });

    it('`ClientAwarenessLink` options override `ApolloClient` options', () => {
      const terminatingLink = new MockSubscriptionLink();
      const client = new ApolloClient({
        link: new ClientAwarenessLink({
          clientAwareness: {
            name: 'overridden-client',
            version: '2.0.0',
          },
        }).concat(terminatingLink),
        cache: new Hermes(),
        clientAwareness: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      void client.query({ query });
      const headers = terminatingLink.operation?.getContext().headers;
      expect(headers).toStrictEqual({
        'apollographql-client-name': 'overridden-client',
        'apollographql-client-version': '2.0.0',
      });
    });

    it('merge-overrides `ClientAwarenessLink` and `ApolloClient` options', () => {
      const terminatingLink = new MockSubscriptionLink();
      const client = new ApolloClient({
        link: new ClientAwarenessLink({
          clientAwareness: {
            version: '2.0.0',
          },
        }).concat(terminatingLink),
        cache: new Hermes(),
        clientAwareness: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      void client.query({ query });
      const headers = terminatingLink.operation?.getContext().headers;
      expect(headers).toStrictEqual({
        'apollographql-client-name': 'test-client',
        'apollographql-client-version': '2.0.0',
      });
    });

    it('merge-overrides `context` and `ApolloClient` options', () => {
      const terminatingLink = new MockSubscriptionLink();
      const client = new ApolloClient({
        link: new ClientAwarenessLink().concat(terminatingLink),
        cache: new Hermes(),
        clientAwareness: {
          name: 'test-client',
          version: '1.0.0',
        },
      });

      void client.query({
        query,
        context: {
          clientAwareness: {
            version: '2.0.0',
          },
        },
      });
      const headers = terminatingLink.operation?.getContext().headers;
      expect(headers).toStrictEqual({
        'apollographql-client-name': 'test-client',
        'apollographql-client-version': '2.0.0',
      });
    });

    it('merge-overrides `ClientAwarenessLink` and `context` options', () => {
      const terminatingLink = new MockSubscriptionLink();
      const client = new ApolloClient({
        link: new ClientAwarenessLink({
          clientAwareness: {
            name: 'test-client',
            version: '1.0.0',
          },
        }).concat(terminatingLink),
        cache: new Hermes(),
      });

      void client.query({
        query,
        context: {
          clientAwareness: {
            version: '2.0.0',
          },
        },
      });
      const headers = terminatingLink.operation?.getContext().headers;
      expect(headers).toStrictEqual({
        'apollographql-client-name': 'test-client',
        'apollographql-client-version': '2.0.0',
      });
    });
  });
});

describe('feature: enhanced client awareness', () => {
  it('is enabled by default', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
    });

    void client.query({ query });
    expect(terminatingLink.operation?.extensions).toStrictEqual({
      clientLibrary: {
        name: '@apollo/client',
        version,
      },
    });
  });

  it('can use `headers` as transport', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink({
        enhancedClientAwareness: { transport: 'headers' },
      }).concat(terminatingLink),
      cache: new Hermes(),
    });

    void client.query({ query });
    const headers = terminatingLink.operation?.getContext().headers;
    const extensions = terminatingLink.operation?.extensions;
    expect(headers).toStrictEqual({
      'apollographql-library-name': '@apollo/client',
      'apollographql-library-version': version,
    });
    expect(extensions).not.toHaveProperty('clientLibrary');
  });

  it('can be disabled from `ApolloClient` options', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink().concat(terminatingLink),
      cache: new Hermes(),
      enhancedClientAwareness: { transport: false },
    });

    void client.query({ query });
    expect(terminatingLink.operation?.extensions).toStrictEqual({});
  });

  it('can be disabled from `ClientAwarenessLink` constructor', () => {
    const terminatingLink = new MockSubscriptionLink();
    const client = new ApolloClient({
      link: new ClientAwarenessLink({
        enhancedClientAwareness: { transport: false },
      }).concat(terminatingLink),
      cache: new Hermes(),
    });

    void client.query({ query });
    expect(terminatingLink.operation?.extensions).toStrictEqual({});
  });
});
