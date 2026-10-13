import gql from 'graphql-tag';

import { Hermes } from '../../../src';

// Like InMemoryCache's StoreWriter, writes do not report the fields of
// `@defer` fragments (that have not arrived yet) as missing. As in
// InMemoryCache, the selection sets of the fields of a deferred fragment are
// checked as usual, and `@defer(if: false)` fragments are not deferred.
describe(`writes with @defer`, () => {
  let errorSpy: jest.SpyInstance;
  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  const missingFields = () =>
    errorSpy.mock.calls
      .filter(([message]) => String(message).includes('while writing result'))
      .map(([, field]) => field as string);

  it(`does not warn about missing fields of an inline @defer fragment`, () => {
    new Hermes().writeQuery({
      query: gql`
        query {
          greeting {
            message
            ... on Greeting @defer {
              recipient {
                name
              }
            }
          }
        }
      `,
      data: { greeting: { __typename: 'Greeting', message: 'Hello' } },
    });
    jestExpect(missingFields()).toEqual([]);
  });

  it(`does not warn about missing fields of a deferred named fragment spread`, () => {
    new Hermes().writeQuery({
      query: gql`
        query {
          greeting {
            message
            ...GreetingRecipient @defer
          }
        }

        fragment GreetingRecipient on Greeting {
          recipient {
            name
          }
        }
      `,
      data: { greeting: { __typename: 'Greeting', message: 'Hello' } },
    });
    jestExpect(missingFields()).toEqual([]);
  });

  it(`still warns about missing fields within a delivered deferred field's selection set`, () => {
    new Hermes().writeQuery({
      query: gql`
        query {
          greeting {
            message
            ... on Greeting @defer {
              recipient {
                name
                email
              }
            }
          }
        }
      `,
      data: {
        greeting: { __typename: 'Greeting', message: 'Hello', recipient: { __typename: 'Person', name: 'Alice' } },
      },
    });
    jestExpect(missingFields()).toEqual(['email']);
  });

  it(`warns about missing fields of a @defer(if: false) fragment`, () => {
    new Hermes().writeQuery({
      query: gql`
        query {
          greeting {
            message
            ... on Greeting @defer(if: false) {
              recipient {
                name
              }
            }
          }
        }
      `,
      data: { greeting: { __typename: 'Greeting', message: 'Hello' } },
    });
    jestExpect(missingFields()).toEqual(['recipient']);
  });
});
