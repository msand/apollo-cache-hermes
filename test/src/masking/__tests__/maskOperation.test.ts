import { gql } from '@apollo/client/core';
import { spyOnConsole, withProdMode } from '@apollo/client/testing/internal';
import { deepFreeze } from '@apollo/client/utilities/common/maybeDeepFreeze';
import { InvariantError } from '@apollo/client/utilities/globals';
import { maskOperation } from '@apollo/client/masking/maskOperation';
import { loadErrorMessages } from '@apollo/client/dev';

import { Hermes } from '../../../../src';

// Hermes: these tests assert @apollo/client's readable error messages, which the shared env leaves unloaded.
loadErrorMessages();

it('throws when passing document with no operation to maskOperation', () => {
  const document = gql`
    fragment Foo on Bar {
      foo
    }
  `;

  expect(() => maskOperation({}, document, new Hermes())).toThrow(
    new InvariantError('Expected a parsed GraphQL document with a query, mutation, or subscription.'),
  );
});

it('throws when passing string query to maskOperation', () => {
  const document = `
    query Foo {
      foo
    }
  `;

  expect(() =>
    maskOperation(
      {},
      // @ts-expect-error
      document,
      new Hermes(),
    ),
  ).toThrow(
    new InvariantError(
      'Expecting a parsed GraphQL document. Perhaps you need to wrap the query string in a "gql" tag? http://docs.apollostack.com/apollo-client/core.html#gql',
    ),
  );
});

it('throws when passing multiple operations to maskOperation', () => {
  const document = gql`
    query Foo {
      foo
    }

    query Bar {
      bar
    }
  `;

  expect(() => maskOperation({}, document, new Hermes())).toThrow(
    new InvariantError('Ambiguous GraphQL document: contains 2 operations'),
  );
});

it('returns null when data is null', () => {
  const query = gql`
    query {
      foo
      ...QueryFields
    }

    fragment QueryFields on Query {
      bar
    }
  `;

  const data = maskOperation(null, query, new Hermes());

  expect(data).toBe(null);
});

it('returns undefined when data is undefined', () => {
  const query = gql`
    query {
      foo
      ...QueryFields
    }

    fragment QueryFields on Query {
      bar
    }
  `;

  const data = maskOperation(undefined, query, new Hermes());

  expect(data).toBe(undefined);
});

it('strips top-level fragment data from query', () => {
  const query = gql`
    query {
      foo
      ...QueryFields
    }

    fragment QueryFields on Query {
      bar
    }
  `;

  const data = maskOperation({ foo: true, bar: true }, query, new Hermes());

  expect(data).toEqual({ foo: true });
});

it('strips fragment data from nested object', () => {
  const query = gql`
    query {
      user {
        id
        ...UserFields
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const data = maskOperation(
    deepFreeze({ user: { __typename: 'User', id: 1, name: 'Test User' } }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({ user: { __typename: 'User', id: 1 } });
});

it('retains __typename in the result', () => {
  const query = gql`
    query {
      user {
        id
        profile {
          id
        }
        ...UserFields
      }
    }

    fragment UserFields on Query {
      age
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        age: 30,
        profile: { __typename: 'Profile', id: 2 },
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      profile: { __typename: 'Profile', id: 2 },
    },
  });
});

it('masks fragments from nested objects when query gets fields from same object', () => {
  const query = gql`
    query {
      user {
        profile {
          __typename
          id
        }
        ...UserFields
      }
    }
    fragment UserFields on User {
      profile {
        id
        fullName
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        profile: { __typename: 'Profile', id: '1', fullName: 'Test User' },
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      profile: { __typename: 'Profile', id: '1' },
    },
  });
});

// eslint-disable-next-line jest/no-identical-title -- Apollo Client 3.14.1 has two tests with this title.
it('masks fragments from nested objects when query gets fields from same object', () => {
  const query = gql`
    query {
      user {
        ...FragmentA @unmask
        ...FragmentB
        ...FragmentC @unmask
      }
    }

    fragment FragmentA on User {
      this {
        is {
          very {
            deeply {
              nested {
                a
              }
            }
          }
        }
      }
    }
    fragment FragmentB on User {
      this {
        is {
          very {
            deeply {
              nested {
                b
              }
            }
          }
        }
      }
    }
    fragment FragmentC on User {
      this {
        is {
          very {
            deeply {
              nested {
                c
              }
            }
          }
        }
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        this: {
          is: [
            {
              very: {
                deeply: [
                  {
                    nested: {
                      a: 1,
                      b: 2,
                      c: 3,
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      this: {
        is: [
          {
            very: {
              deeply: [
                {
                  nested: {
                    a: 1,
                    c: 3,
                  },
                },
              ],
            },
          },
        ],
      },
    },
  });
});

it('handles nulls in child selection sets', () => {
  const query = gql`
    query {
      user {
        profile {
          id
        }
        ...UserFields
      }
    }
    fragment UserFields on User {
      profile {
        id
        fullName
      }
    }
  `;

  const nullUser = maskOperation(deepFreeze({ user: null }), query, new Hermes());
  const nullProfile = maskOperation(deepFreeze({ user: { __typename: 'User', profile: null } }), query, new Hermes());

  expect(nullUser).toEqual({ user: null });
  expect(nullProfile).toEqual({
    user: { __typename: 'User', profile: null },
  });
});

it('handles nulls in arrays', () => {
  const query = gql`
    query {
      users {
        profile {
          id
        }
        ...UserFields
      }
    }
    fragment UserFields on User {
      profile {
        id
        fullName
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      users: [
        null,
        { __typename: 'User', profile: null },
        {
          __typename: 'User',
          profile: { __typename: 'Profile', id: '1', fullName: 'Test User' },
        },
      ],
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    users: [
      null,
      { __typename: 'User', profile: null },
      { __typename: 'User', profile: { __typename: 'Profile', id: '1' } },
    ],
  });
});

it('deep freezes the masked result if the original data is frozen', () => {
  const query = gql`
    query {
      user {
        id
        ...UserFields
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const frozenData = maskOperation(
    deepFreeze({ user: { __typename: 'User', id: 1, name: 'Test User' } }),
    query,
    new Hermes(),
  );

  const nonFrozenData = maskOperation({ user: { __typename: 'User', id: 1, name: 'Test User' } }, query, new Hermes());

  expect(Object.isFrozen(frozenData)).toBe(true);
  expect(Object.isFrozen(nonFrozenData)).toBe(false);
});

it('strips fragment data from arrays', () => {
  const query = gql`
    query {
      users {
        id
        ...UserFields
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const data = maskOperation(
    deepFreeze({
      users: [
        { __typename: 'User', id: 1, name: 'Test User 1' },
        { __typename: 'User', id: 2, name: 'Test User 2' },
      ],
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    users: [
      { __typename: 'User', id: 1 },
      { __typename: 'User', id: 2 },
    ],
  });
});

it('strips multiple fragments in the same selection set', () => {
  const query = gql`
    query {
      user {
        id
        ...UserProfileFields
        ...UserAvatarFields
      }
    }

    fragment UserProfileFields on User {
      age
    }

    fragment UserAvatarFields on User {
      avatarUrl
    }
  `;

  const data = maskOperation(
    {
      user: {
        __typename: 'User',
        id: 1,
        age: 30,
        avatarUrl: 'https://example.com/avatar.jpg',
      },
    },
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: { __typename: 'User', id: 1 },
  });
});

it('strips multiple fragments across different selection sets', () => {
  const query = gql`
    query {
      user {
        id
        ...UserFields
      }
      post {
        id
        ...PostFields
      }
    }

    fragment UserFields on User {
      name
    }

    fragment PostFields on Post {
      title
    }
  `;

  const data = maskOperation(
    {
      user: {
        __typename: 'User',
        id: 1,
        name: 'test user',
      },
      post: {
        __typename: 'Post',
        id: 1,
        title: 'Test Post',
      },
    },
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: { __typename: 'User', id: 1 },
    post: { __typename: 'Post', id: 1 },
  });
});

it('leaves overlapping fields in query', () => {
  const query = gql`
    query {
      user {
        id
        birthdate
        ...UserProfileFields
      }
    }

    fragment UserProfileFields on User {
      birthdate
      name
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        birthdate: '1990-01-01',
        name: 'Test User',
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: { __typename: 'User', id: 1, birthdate: '1990-01-01' },
  });
});

it('does not strip inline fragments', () => {
  const cache = new Hermes({
    possibleTypes: { Profile: ['UserProfile'] },
  });

  const query = gql`
    query {
      user {
        id
        ... @defer {
          name
        }
      }
      profile {
        ... on UserProfile {
          avatarUrl
        }
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
      },
      profile: {
        __typename: 'UserProfile',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
    }),
    query,
    cache,
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
    },
    profile: {
      __typename: 'UserProfile',
      avatarUrl: 'https://example.com/avatar.jpg',
    },
  });
});

it('strips named fragments inside inline fragments', () => {
  const cache = new Hermes({
    possibleTypes: { Industry: ['TechIndustry'], Profile: ['UserProfile'] },
  });
  const query = gql`
    query {
      user {
        id
        ... @defer {
          name
          ...UserFields
        }
      }
      profile {
        ... on UserProfile {
          avatarUrl
          ...UserProfileFields
        }
        industry {
          ... on TechIndustry {
            ...TechIndustryFields
          }
        }
      }
    }

    fragment UserFields on User {
      age
    }

    fragment UserProfileFields on UserProfile {
      hometown
    }

    fragment TechIndustryFields on TechIndustry {
      favoriteLanguage
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
      },
      profile: {
        __typename: 'UserProfile',
        avatarUrl: 'https://example.com/avatar.jpg',
        industry: {
          __typename: 'TechIndustry',
          primaryLanguage: 'TypeScript',
        },
      },
    }),
    query,
    cache,
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
    },
    profile: {
      __typename: 'UserProfile',
      avatarUrl: 'https://example.com/avatar.jpg',
      industry: { __typename: 'TechIndustry' },
    },
  });
});

it('handles objects with no matching inline fragment condition', () => {
  const cache = new Hermes({
    possibleTypes: {
      Drink: ['HotChocolate', 'Juice'],
    },
  });

  const query = gql`
    query {
      drinks {
        id
        ... on Juice {
          fruitBase
        }
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      drinks: [
        { __typename: 'HotChocolate', id: 1 },
        { __typename: 'Juice', id: 2, fruitBase: 'Strawberry' },
      ],
    }),
    query,
    cache,
  );

  expect(data).toEqual({
    drinks: [
      { __typename: 'HotChocolate', id: 1 },
      { __typename: 'Juice', id: 2, fruitBase: 'Strawberry' },
    ],
  });
});

it('can handle fragment spreads in inline fragments with mix masked and @unmask', () => {
  const query = gql`
    query {
      user {
        id
        ... {
          ...UserFields
          ...ProfileFields @unmask
        }
      }
    }

    fragment UserFields on User {
      name
    }

    fragment ProfileFields on User {
      username
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        username: 'testuser',
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      username: 'testuser',
    },
  });
});

it('can handle overlapping fragment spreads in inline fragments with mix masked and @unmask', () => {
  const query = gql`
    query {
      user {
        id
        ... {
          ...UserFields
          ...ProfileFields @unmask
        }
      }
    }

    fragment UserFields on User {
      username
      name
    }

    fragment ProfileFields on User {
      username
      email
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        username: 'testuser',
        email: 'testuser@example.com',
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      username: 'testuser',
      email: 'testuser@example.com',
    },
  });
});

it('can handle fragment spreads in inline fragments with mix masked and @unmask(mode: "migrate")', () => {
  using _ = spyOnConsole('warn');

  const query = gql`
    query GetUser {
      user {
        id
        ... @defer {
          ...UserFields
          ...ProfileFields @unmask(mode: "migrate")
        }
      }
    }

    fragment UserFields on User {
      name
    }

    fragment ProfileFields on User {
      username
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        username: 'testuser',
      },
    }),
    query,
    new Hermes(),
  );

  data.user.__typename;
  data.user.id;

  expect(console.warn).not.toHaveBeenCalled();

  data.user.username;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'GetUser'",
    'user.username',
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      username: 'testuser',
    },
  });
});

it('can handle overlapping fragment spreads in inline fragments with mix masked and @unmask(mode: "migrate")', () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query GetUser {
      user {
        id
        ... {
          ...UserFields
          ...ProfileFields @unmask(mode: "migrate")
        }
      }
    }

    fragment UserFields on User {
      username
      name
    }

    fragment ProfileFields on User {
      username
      email
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        username: 'testuser',
        email: 'testuser@example.com',
      },
    }),
    query,
    new Hermes(),
  );

  data.user.__typename;
  data.user.id;

  expect(console.warn).not.toHaveBeenCalled();

  data.user.username;
  data.user.email;

  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'GetUser'",
    'user.username',
  );
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'GetUser'",
    'user.email',
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      username: 'testuser',
      email: 'testuser@example.com',
    },
  });
});

it('handles field aliases', () => {
  const query = gql`
    query {
      user {
        id
        fullName: name
        ... @defer {
          userAddress: address
        }
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      user: {
        __typename: 'User',
        id: 1,
        fullName: 'Test User',
        userAddress: '1234 Main St',
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      fullName: 'Test User',
      userAddress: '1234 Main St',
    },
  });
});

it('handles overlapping fields inside multiple inline fragments', () => {
  const cache = new Hermes({
    possibleTypes: {
      Drink: ['Espresso', 'Latte', 'Cappuccino', 'Cortado', 'Juice', 'HotChocolate'],
      Espresso: ['Latte', 'Cappuccino', 'Cortado'],
    },
  });
  const query = gql`
    query {
      drinks {
        id
        ... @defer {
          amount
        }
        ... on Espresso {
          milkType
          ... on Latte {
            flavor {
              name
              ...FlavorFields
            }
          }
          ... on Cappuccino {
            roast
          }
          ... on Cortado {
            ...CortadoFields
          }
        }
        ... on Latte {
          ... @defer {
            shots
          }
        }
        ... on Juice {
          ...JuiceFields
        }
        ... on HotChocolate {
          milkType
          ...HotChocolateFields
        }
      }
    }

    fragment JuiceFields on Juice {
      fruitBase
    }

    fragment HotChocolateFields on HotChocolate {
      chocolateType
    }

    fragment FlavorFields on Flavor {
      sweetness
    }

    fragment CortadoFields on Cortado {
      temperature
    }
  `;

  const data = maskOperation(
    deepFreeze({
      drinks: [
        {
          __typename: 'Latte',
          id: 1,
          amount: 12,
          shots: 2,
          milkType: 'Cow',
          flavor: {
            __typename: 'Flavor',
            name: 'Cookie Butter',
            sweetness: 'high',
          },
        },
        {
          __typename: 'Cappuccino',
          id: 2,
          amount: 12,
          milkType: 'Cow',
          roast: 'medium',
        },
        {
          __typename: 'Cortado',
          id: 3,
          amount: 12,
          milkType: 'Cow',
          temperature: 150,
        },
        { __typename: 'Juice', id: 4, amount: 10, fruitBase: 'Apple' },
        {
          __typename: 'HotChocolate',
          id: 5,
          amount: 8,
          milkType: 'Cow',
          chocolateType: 'dark',
        },
      ],
    }),
    query,
    cache,
  );

  expect(data).toEqual({
    drinks: [
      {
        __typename: 'Latte',
        id: 1,
        amount: 12,
        shots: 2,
        milkType: 'Cow',
        flavor: {
          __typename: 'Flavor',
          name: 'Cookie Butter',
        },
      },
      {
        __typename: 'Cappuccino',
        id: 2,
        amount: 12,
        milkType: 'Cow',
        roast: 'medium',
      },
      {
        __typename: 'Cortado',
        id: 3,
        amount: 12,
        milkType: 'Cow',
      },
      { __typename: 'Juice', id: 4, amount: 10 },
      {
        __typename: 'HotChocolate',
        id: 5,
        amount: 8,
        milkType: 'Cow',
      },
    ],
  });
});

it('does nothing if there are no fragments to mask', () => {
  const query = gql`
    query {
      user {
        id
        name
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({ user: { __typename: 'User', id: 1, name: 'Test User' } }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    user: { __typename: 'User', id: 1, name: 'Test User' },
  });
});

it('maintains referential equality on subtrees that did not change', () => {
  const query = gql`
    query {
      user {
        id
        profile {
          avatarUrl
        }
        ...UserFields
      }
      post {
        id
        title
      }
      authors {
        id
        name
      }
      industries {
        ... on TechIndustry {
          languageRequirements
        }
        ... on FinanceIndustry {
          ...FinanceIndustryFields
        }
        ... on TradeIndustry {
          id
          yearsInBusiness
          ...TradeIndustryFields
        }
      }
      drink {
        ... on SportsDrink {
          saltContent
        }
        ... on Espresso {
          __typename
        }
      }
    }

    fragment UserFields on User {
      name
    }

    fragment FinanceIndustryFields on FinanceIndustry {
      yearsInBusiness
    }

    fragment TradeIndustryFields on TradeIndustry {
      languageRequirements
    }
  `;

  const profile = {
    __typename: 'Profile',
    avatarUrl: 'https://example.com/avatar.jpg',
  };
  const user = { __typename: 'User', id: 1, name: 'Test User', profile };
  const post = { __typename: 'Post', id: 1, title: 'Test Post' };
  const authors = [{ __typename: 'Author', id: 1, name: 'A Author' }];
  const industries = [
    { __typename: 'TechIndustry', languageRequirements: ['TypeScript'] },
    { __typename: 'FinanceIndustry', yearsInBusiness: 10 },
    {
      __typename: 'TradeIndustry',
      id: 10,
      yearsInBusiness: 15,
      languageRequirements: ['English', 'German'],
    },
  ];
  const drink = { __typename: 'Espresso' };
  const originalData = deepFreeze({ user, post, authors, industries, drink });

  const data = maskOperation(originalData, query, new Hermes());

  expect(data).toEqual({
    user: {
      __typename: 'User',
      id: 1,
      profile: {
        __typename: 'Profile',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
    },
    post: { __typename: 'Post', id: 1, title: 'Test Post' },
    authors: [{ __typename: 'Author', id: 1, name: 'A Author' }],
    industries: [
      { __typename: 'TechIndustry', languageRequirements: ['TypeScript'] },
      { __typename: 'FinanceIndustry' },
      { __typename: 'TradeIndustry', id: 10, yearsInBusiness: 15 },
    ],
    drink: { __typename: 'Espresso' },
  });

  expect(data).not.toBe(originalData);
  expect(data.user).not.toBe(user);
  expect(data.user.profile).toBe(profile);
  expect(data.post).toBe(post);
  expect(data.authors).toBe(authors);
  expect(data.industries).not.toBe(industries);
  expect(data.industries[0]).toBe(industries[0]);
  expect(data.industries[1]).not.toBe(industries[1]);
  expect(data.industries[2]).not.toBe(industries[2]);
  expect(data.drink).toBe(drink);
});

it('maintains referential equality the entire result if there are no fragments', () => {
  const query = gql`
    query {
      user {
        id
        name
      }
    }
  `;

  const originalData = deepFreeze({
    user: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
    },
  });

  const data = maskOperation(originalData, query, new Hermes());

  expect(data).toBe(originalData);
});

it('does not mask named fragment fields and returns original object when using `@unmask` directive', () => {
  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask
      }
    }

    fragment UserFields on User {
      age
    }
  `;

  const queryData = deepFreeze({
    currentUser: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
    },
  });

  const data = maskOperation(queryData, query, new Hermes());

  expect(data).toBe(queryData);
});

it('maintains referential equality on subtrees that contain @unmask', () => {
  const query = gql`
    query {
      user {
        id
        profile {
          avatarUrl
        }
        ...UserFields @unmask
      }
      post {
        id
        title
      }
      authors {
        id
        name
      }
      industries {
        ... on TechIndustry {
          ...TechIndustryFields @unmask
        }
        ... on FinanceIndustry {
          ...FinanceIndustryFields
        }
        ... on TradeIndustry {
          id
          yearsInBusiness
          ...TradeIndustryFields @unmask
        }
      }
    }

    fragment UserFields on User {
      name
      ...UserSubfields @unmask
    }

    fragment UserSubfields on User {
      age
    }

    fragment FinanceIndustryFields on FinanceIndustry {
      yearsInBusiness
    }

    fragment TradeIndustryFields on TradeIndustry {
      languageRequirements
    }

    fragment TechIndustryFields on TechIndustry {
      languageRequirements
      ...TechIndustrySubFields
    }

    fragment TechIndustrySubFields on TechIndustry {
      focus
    }
  `;

  const profile = {
    __typename: 'Profile',
    avatarUrl: 'https://example.com/avatar.jpg',
  };
  const user = {
    __typename: 'User',
    id: 1,
    name: 'Test User',
    profile,
    age: 30,
  };
  const post = { __typename: 'Post', id: 1, title: 'Test Post' };
  const authors = [{ __typename: 'Author', id: 1, name: 'A Author' }];
  const industries = [
    {
      __typename: 'TechIndustry',
      languageRequirements: ['TypeScript'],
      focus: 'innovation',
    },
    { __typename: 'FinanceIndustry', yearsInBusiness: 10 },
    {
      __typename: 'TradeIndustry',
      id: 10,
      yearsInBusiness: 15,
      languageRequirements: ['English', 'German'],
    },
  ];
  const originalData = deepFreeze({ user, post, authors, industries });

  const data = maskOperation(originalData, query, new Hermes());

  expect(data).toEqual({
    user: {
      __typename: 'User',
      name: 'Test User',
      id: 1,
      profile: {
        __typename: 'Profile',
        avatarUrl: 'https://example.com/avatar.jpg',
      },
      age: 30,
    },
    post: { __typename: 'Post', id: 1, title: 'Test Post' },
    authors: [{ __typename: 'Author', id: 1, name: 'A Author' }],
    industries: [
      { __typename: 'TechIndustry', languageRequirements: ['TypeScript'] },
      { __typename: 'FinanceIndustry' },
      {
        __typename: 'TradeIndustry',
        id: 10,
        yearsInBusiness: 15,
        languageRequirements: ['English', 'German'],
      },
    ],
  });

  expect(data).not.toBe(originalData);
  expect(data.user).toBe(user);
  expect(data.user.profile).toBe(profile);
  expect(data.post).toBe(post);
  expect(data.authors).toBe(authors);
  expect(data.industries).not.toBe(industries);
  expect(data.industries[0]).not.toBe(industries[0]);
  expect(data.industries[1]).not.toBe(industries[1]);
  expect(data.industries[2]).toBe(industries[2]);
});

it("warns when accessing unmasked fields when using `@unmask` directive with mode 'migrate'", () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      age
    }
  `;

  const anonymousQuery = gql`
    query {
      currentUser {
        id
        name
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      age
    }
  `;

  const currentUser = {
    __typename: 'User',
    id: 1,
    name: 'Test User',
    age: 30,
  };

  const cache = new Hermes();

  const data = maskOperation(deepFreeze({ currentUser }), query, cache);

  const dataFromAnonymous = maskOperation({ currentUser }, anonymousQuery, cache);

  data.currentUser.age;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.age',
  );

  dataFromAnonymous.currentUser.age;

  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    'anonymous query',
    'currentUser.age',
  );

  data.currentUser.age;
  dataFromAnonymous.currentUser.age;

  // Ensure we only warn once for each masked field
  expect(console.warn).toHaveBeenCalledTimes(2);
});

it("does not warn when accessing unmasked fields when using `@unmask` directive with mode 'migrate' in non-DEV mode", () => {
  using _ = withProdMode();
  using __ = spyOnConsole('warn');

  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      age
    }
  `;

  const data = maskOperation(
    deepFreeze({
      currentUser: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
      },
    }),
    query,
    new Hermes(),
  );

  const age = data.currentUser.age;

  expect(age).toBe(30);
  expect(console.warn).not.toHaveBeenCalled();
});

it("warns when accessing unmasked fields in arrays with mode: 'migrate'", () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query UnmaskedQuery {
      users {
        id
        name
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      age
    }
  `;

  const data = maskOperation(
    deepFreeze({
      users: [
        { __typename: 'User', id: 1, name: 'John Doe', age: 30 },
        { __typename: 'User', id: 2, name: 'Jane Doe', age: 30 },
      ],
    }),
    query,
    new Hermes(),
  );

  data.users[0].age;
  data.users[1].age;

  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'users[0].age',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'users[1].age',
  );
});

it('can mix and match masked vs unmasked fragment fields with proper warnings', () => {
  using _ = spyOnConsole('warn');

  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask
      }
    }

    fragment UserFields on User {
      age
      profile {
        email
        ... @defer {
          username
        }
        ...ProfileFields
      }
      skills {
        name
        ...SkillFields @unmask(mode: "migrate")
      }
    }

    fragment ProfileFields on Profile {
      settings {
        darkMode
      }
    }

    fragment SkillFields on Skill {
      description
    }
  `;

  const data = maskOperation(
    deepFreeze({
      currentUser: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
        profile: {
          __typename: 'Profile',
          email: 'testuser@example.com',
          username: 'testuser',
          settings: {
            __typename: 'Settings',
            darkMode: true,
          },
        },
        skills: [
          {
            __typename: 'Skill',
            name: 'Skill 1',
            description: 'Skill 1 description',
          },
          {
            __typename: 'Skill',
            name: 'Skill 2',
            description: 'Skill 2 description',
          },
        ],
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    currentUser: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
      profile: {
        __typename: 'Profile',
        email: 'testuser@example.com',
        username: 'testuser',
      },
      skills: [
        {
          __typename: 'Skill',
          name: 'Skill 1',
          description: 'Skill 1 description',
        },
        {
          __typename: 'Skill',
          name: 'Skill 2',
          description: 'Skill 2 description',
        },
      ],
    },
  });

  expect(console.warn).toHaveBeenCalledTimes(2);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.skills[0].description',
  );
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.skills[1].description',
  );
});

it("masks child fragments of @unmask(mode: 'migrate')", () => {
  using _ = spyOnConsole('warn');

  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      age
      ...UserSubfields
      ...UserSubfields2 @unmask
    }

    fragment UserSubfields on User {
      username
    }

    fragment UserSubfields2 on User {
      email
    }
  `;

  const data = maskOperation(
    deepFreeze({
      currentUser: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
        username: 'testuser',
        email: 'test@example.com',
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    currentUser: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
      email: 'test@example.com',
    },
  });

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.age',
  );
});

it('masks child fragments of @unmask', () => {
  using _ = spyOnConsole('warn');

  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask
      }
    }
    fragment UserFields on User {
      age
      ...UserSubfields
      ...UserSubfields2 @unmask
    }
    fragment UserSubfields on User {
      username
    }
    fragment UserSubfields2 on User {
      email
    }
  `;

  const data = maskOperation(
    deepFreeze({
      currentUser: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
        username: 'testuser',
        email: 'test@example.com',
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    currentUser: {
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
      email: 'test@example.com',
    },
  });
});

it("warns when accessing unmasked fields with complex selections with mode: 'migrate'", () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      age
      profile {
        email
        ... @defer {
          username
        }
        ...ProfileFields @unmask(mode: "migrate")
      }
      skills {
        name
        ...SkillFields @unmask(mode: "migrate")
      }
    }

    fragment ProfileFields on Profile {
      settings {
        dark: darkMode
      }
    }

    fragment SkillFields on Skill {
      description
    }
  `;

  const currentUser = {
    __typename: 'User',
    id: 1,
    name: 'Test User',
    age: 30,
    profile: {
      __typename: 'Profile',
      email: 'testuser@example.com',
      username: 'testuser',
      settings: {
        __typename: 'Settings',
        dark: true,
      },
    },
    skills: [
      {
        __typename: 'Skill',
        name: 'Skill 1',
        description: 'Skill 1 description',
      },
      {
        __typename: 'Skill',
        name: 'Skill 2',
        description: 'Skill 2 description',
      },
    ],
  };

  const data = maskOperation(deepFreeze({ currentUser }), query, new Hermes());

  data.currentUser.age;
  data.currentUser.profile.email;
  data.currentUser.profile.username;
  data.currentUser.profile.settings;
  data.currentUser.profile.settings.dark;
  data.currentUser.skills[0].description;
  data.currentUser.skills[1].description;

  expect(console.warn).toHaveBeenCalledTimes(9);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.age',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.profile',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.profile.email',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.profile.username',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.profile.settings',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.profile.settings.dark',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.skills',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.skills[0].description',
  );

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'UnmaskedQuery'",
    'currentUser.skills[1].description',
  );
});

it("does not warn when accessing fields shared between the query and fragment with mode: 'migrate'", () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        age
        ...UserFields @unmask(mode: "migrate")
        email
      }
    }

    fragment UserFields on User {
      age
      email
    }
  `;

  const data = maskOperation(
    deepFreeze({
      currentUser: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
        email: 'testuser@example.com',
      },
    }),
    query,
    new Hermes(),
  );

  data.currentUser.age;
  data.currentUser.email;

  expect(console.warn).not.toHaveBeenCalled();
});

it('does not warn accessing fields with `@unmask` without mode argument', () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query UnmaskedQuery {
      currentUser {
        id
        name
        ...UserFields @unmask
      }
    }

    fragment UserFields on User {
      age
    }
  `;

  const data = maskOperation(
    deepFreeze({
      currentUser: {
        __typename: 'User',
        id: 1,
        name: 'Test User',
        age: 30,
      },
    }),
    query,
    new Hermes(),
  );

  data.currentUser.age;

  expect(console.warn).not.toHaveBeenCalled();
});

// https://github.com/apollographql/apollo-client/issues/12127
it('handles interface types when using @unmask(mode: "migrate")', async () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query PlaybackStateSubscriberQuery {
      playbackState {
        __typename
        ...PlaybackStateFragment @unmask(mode: "migrate")
      }
    }

    fragment PlaybackStateFragment on PlaybackState {
      item {
        __typename
        id

        ... on Track {
          album {
            __typename
            id
          }
        }

        ... on Episode {
          show {
            __typename
            id
          }
        }
      }
    }
  `;

  const data = maskOperation(
    {
      playbackState: {
        __typename: 'PlaybackState',
        item: {
          __typename: 'Track',
          id: '1',
          album: {
            __typename: 'Album',
            id: '2',
          },
        },
      },
    },
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    playbackState: {
      __typename: 'PlaybackState',
      item: {
        __typename: 'Track',
        id: '1',
        album: {
          __typename: 'Album',
          id: '2',
        },
      },
    },
  });
});

it('handles overlapping types when subtype has accessor warnings with @unmask(mode: "migrate")', async () => {
  using _ = spyOnConsole('warn');
  const query = gql`
    query PlaylistQuery {
      playlist {
        ...PlaylistFragment @unmask(mode: "migrate")
        id
        name
        album {
          id
          tracks {
            id
            __typename
          }
          __typename
        }
        artist {
          id
          topTracks {
            id
            __typename
          }
          __typename
        }
        __typename

        ...PlaylistTitleCell @unmask(mode: "migrate")
      }
    }

    fragment PlaylistFragment on Playlist {
      album {
        id
        images {
          url
          __typename
        }
        tracks {
          id
          name
          __typename
        }
        __typename
      }
    }

    fragment PlaylistTitleCell on Playlist {
      artist {
        id
        images {
          url
          __typename
        }
        topTracks {
          id
          name
          __typename
        }
        __typename
      }
    }
  `;

  const data = maskOperation(
    deepFreeze({
      playlist: {
        id: '1',
        name: 'Playlist',
        album: {
          id: '2RSIoPew2TOy41ASHpzOx3',
          __typename: 'Album',
          images: [{ url: 'https://i.scdn.co/image/1', __typename: 'Image' }],
          tracks: [{ id: '1', name: 'Track 1', __typename: 'Track' }],
        },
        artist: {
          id: '2',
          __typename: 'Artist',
          images: [{ url: 'https://i.scdn.co/image/1', __typename: 'Image' }],
          topTracks: [{ id: '2', name: 'Track 2', __typename: 'Track' }],
        },
      },
    }),
    query,
    new Hermes(),
  );

  expect(console.warn).not.toHaveBeenCalled();

  data.playlist.album;
  data.playlist.album.id;
  data.playlist.album.__typename;
  data.playlist.album.tracks[0].id;
  data.playlist.album.tracks[0].__typename;
  data.playlist.artist;
  data.playlist.artist.id;
  data.playlist.artist.__typename;
  data.playlist.artist.topTracks[0].id;
  data.playlist.artist.topTracks[0].__typename;

  expect(console.warn).not.toHaveBeenCalled();

  data.playlist.album.images;
  data.playlist.album.tracks[0].name;
  data.playlist.artist.images;
  data.playlist.artist.topTracks[0].name;

  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'PlaylistQuery'",
    'playlist.album.images',
  );
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'PlaylistQuery'",
    'playlist.album.tracks[0].name',
  );
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'PlaylistQuery'",
    'playlist.artist.images',
  );
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'PlaylistQuery'",
    'playlist.artist.topTracks[0].name',
  );
  expect(console.warn).toHaveBeenCalledTimes(4);

  expect(data).toEqual({
    playlist: {
      id: '1',
      name: 'Playlist',
      album: {
        id: '2RSIoPew2TOy41ASHpzOx3',
        __typename: 'Album',
        images: [{ url: 'https://i.scdn.co/image/1', __typename: 'Image' }],
        tracks: [{ id: '1', name: 'Track 1', __typename: 'Track' }],
      },
      artist: {
        id: '2',
        __typename: 'Artist',
        images: [{ url: 'https://i.scdn.co/image/1', __typename: 'Image' }],
        topTracks: [{ id: '2', name: 'Track 2', __typename: 'Track' }],
      },
    },
  });
});

it('masks fragments in subscription documents', () => {
  const subscription = gql`
    subscription {
      onUserUpdated {
        id
        ...UserFields
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const data = maskOperation(
    deepFreeze({
      onUserUpdated: { __typename: 'User', id: 1, name: 'Test User' },
    }),
    subscription,
    new Hermes(),
  );

  expect(data).toEqual({ onUserUpdated: { __typename: 'User', id: 1 } });
});

it('honors @unmask used in subscription documents', () => {
  const subscription = gql`
    subscription {
      onUserUpdated {
        id
        ...UserFields @unmask
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const subscriptionData = deepFreeze({
    onUserUpdated: { __typename: 'User', id: 1, name: 'Test User' },
  });

  const data = maskOperation(subscriptionData, subscription, new Hermes());

  expect(data).toBe(subscriptionData);
});

it("warns when accessing unmasked fields used in subscription documents with @unmask(mode: 'migrate')", () => {
  using _ = spyOnConsole('warn');

  const subscription = gql`
    subscription UserUpdatedSubscription {
      onUserUpdated {
        id
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const subscriptionData = deepFreeze({
    onUserUpdated: { __typename: 'User', id: 1, name: 'Test User' },
  });

  const data = maskOperation(subscriptionData, subscription, new Hermes());

  data.onUserUpdated.name;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "subscription 'UserUpdatedSubscription'",
    'onUserUpdated.name',
  );
});

it('masks fragments in mutation documents', () => {
  const mutation = gql`
    mutation {
      updateUser {
        id
        ...UserFields
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const data = maskOperation(
    deepFreeze({
      updateUser: { __typename: 'User', id: 1, name: 'Test User' },
    }),
    mutation,
    new Hermes(),
  );

  expect(data).toEqual({ updateUser: { __typename: 'User', id: 1 } });
});

it('honors @unmask used in mutation documents', () => {
  const mutation = gql`
    mutation {
      updateUser {
        id
        ...UserFields @unmask
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const mutationData = deepFreeze({
    updateUser: { __typename: 'User', id: 1, name: 'Test User' },
  });

  const data = maskOperation(mutationData, mutation, new Hermes());

  expect(data).toBe(mutationData);
});

it("warns when accessing unmasked fields used in mutation documents with @unmask(mode: 'migrate')", () => {
  using _ = spyOnConsole('warn');

  const mutation = gql`
    mutation UpdateUserMutation {
      updateUser {
        id
        ...UserFields @unmask(mode: "migrate")
      }
    }

    fragment UserFields on User {
      name
    }
  `;

  const mutationData = deepFreeze({
    updateUser: { __typename: 'User', id: 1, name: 'Test User' },
  });

  const data = maskOperation(mutationData, mutation, new Hermes());

  data.updateUser.name;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "mutation 'UpdateUserMutation'",
    'updateUser.name',
  );
});

it('masks partial data', () => {
  const query = gql`
    query {
      greeting {
        message
        ...GreetingFragment
      }
    }

    fragment GreetingFragment on Greeting {
      sentAt
      recipient {
        name
      }
    }
  `;

  {
    const data = maskOperation(
      deepFreeze({
        greeting: { message: 'Hello world', __typename: 'Greeting' },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: { message: 'Hello world', __typename: 'Greeting' },
    });
  }

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          sentAt: '2024-01-01',
        },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
      },
    });
  }

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          recipient: { __typename: '__Person' },
        },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
      },
    });
  }
});

it('unmasks partial data with @unmask', () => {
  const query = gql`
    query {
      greeting {
        message
        ...GreetingFragment @unmask
      }
    }

    fragment GreetingFragment on Greeting {
      sentAt
      recipient {
        name
      }
    }
  `;

  {
    const data = maskOperation(
      deepFreeze({
        greeting: { message: 'Hello world', __typename: 'Greeting' },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: { message: 'Hello world', __typename: 'Greeting' },
    });
  }

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          sentAt: '2024-01-01',
        },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
      },
    });
  }

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          recipient: { __typename: '__Person' },
        },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        recipient: { __typename: '__Person' },
      },
    });
  }
});

it('unmasks partial data with warnings with @unmask(mode: "migrate")', () => {
  using consoleSpy = spyOnConsole('warn');

  const query = gql`
    query {
      greeting {
        message
        ...GreetingFragment @unmask(mode: "migrate")
      }
    }

    fragment GreetingFragment on Greeting {
      sentAt
      recipient {
        name
      }
    }
  `;

  {
    const data = maskOperation(
      deepFreeze({
        greeting: { message: 'Hello world', __typename: 'Greeting' },
      }),
      query,
      new Hermes(),
    );

    data.greeting.__typename;
    data.greeting.message;

    expect(console.warn).not.toHaveBeenCalled();

    expect(data).toEqual({
      greeting: { message: 'Hello world', __typename: 'Greeting' },
    });
  }

  consoleSpy.warn.mockClear();

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          sentAt: '2024-01-01',
        },
      }),
      query,
      new Hermes(),
    );

    data.greeting.__typename;
    data.greeting.message;

    expect(console.warn).not.toHaveBeenCalled();

    data.greeting.sentAt;
    expect(console.warn).toHaveBeenCalledTimes(1);

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
      },
    });
  }

  consoleSpy.warn.mockClear();

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          recipient: { __typename: '__Person' },
        },
      }),
      query,
      new Hermes(),
    );

    data.greeting.__typename;
    data.greeting.message;

    expect(console.warn).not.toHaveBeenCalled();

    data.greeting.recipient;
    data.greeting.recipient.__typename;
    expect(console.warn).toHaveBeenCalledTimes(1);

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        recipient: { __typename: '__Person' },
      },
    });
  }
});

it('masks partial deferred data', () => {
  const query = gql`
    query {
      greeting {
        message
        ... @defer {
          sentAt
          ...GreetingFragment
        }
      }
    }

    fragment GreetingFragment on Greeting {
      recipient {
        name
      }
    }
  `;

  {
    const data = maskOperation(
      deepFreeze({
        greeting: { message: 'Hello world', __typename: 'Greeting' },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: { message: 'Hello world', __typename: 'Greeting' },
    });
  }

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          sentAt: '2024-01-01',
          recipient: { __typename: '__Person', name: 'Alice' },
        },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
      },
    });
  }
});

it('unmasks partial deferred data with @unmask', () => {
  const query = gql`
    query {
      greeting {
        message
        ... @defer {
          sentAt
          ...GreetingFragment @unmask
        }
      }
    }

    fragment GreetingFragment on Greeting {
      recipient {
        name
      }
    }
  `;

  {
    const data = maskOperation(
      deepFreeze({
        greeting: { message: 'Hello world', __typename: 'Greeting' },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: { message: 'Hello world', __typename: 'Greeting' },
    });
  }

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          sentAt: '2024-01-01',
          recipient: { __typename: '__Person', name: 'Alice' },
        },
      }),
      query,
      new Hermes(),
    );

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
        recipient: { __typename: '__Person', name: 'Alice' },
      },
    });
  }
});

it('unmasks partial deferred data with warnings with @unmask(mode: "migrate")', () => {
  using consoleSpy = spyOnConsole('warn');

  const query = gql`
    query {
      greeting {
        message
        ... @defer {
          sentAt
          ...GreetingFragment @unmask(mode: "migrate")
        }
      }
    }

    fragment GreetingFragment on Greeting {
      recipient {
        name
      }
    }
  `;

  {
    const data = maskOperation(
      deepFreeze({
        greeting: { message: 'Hello world', __typename: 'Greeting' },
      }),
      query,
      new Hermes(),
    );

    data.greeting.message;
    data.greeting.__typename;

    expect(console.warn).not.toHaveBeenCalled();

    expect(data).toEqual({
      greeting: { message: 'Hello world', __typename: 'Greeting' },
    });
  }

  consoleSpy.warn.mockClear();

  {
    const data = maskOperation(
      deepFreeze({
        greeting: {
          __typename: 'Greeting',
          message: 'Hello world',
          sentAt: '2024-01-01',
          recipient: { __typename: '__Person', name: 'Alice' },
        },
      }),
      query,
      new Hermes(),
    );

    data.greeting.message;
    data.greeting.sentAt;
    data.greeting.__typename;

    expect(console.warn).not.toHaveBeenCalled();

    data.greeting.recipient;
    data.greeting.recipient.name;
    expect(console.warn).toHaveBeenCalledTimes(2);

    expect(data).toEqual({
      greeting: {
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
        recipient: { __typename: '__Person', name: 'Alice' },
      },
    });
  }
});

it('masks results with primitive arrays', () => {
  const query = gql`
    query {
      listing {
        id
        reviews
        ...ListingFragment
      }
    }

    fragment ListingFragment on Listing {
      amenities
    }
  `;

  const data = maskOperation(
    deepFreeze({
      listing: {
        __typename: 'Listing',
        id: '1',
        reviews: [5, 5, 3, 4],
        amenities: ['pool', 'hot tub', 'backyard'],
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    listing: {
      __typename: 'Listing',
      id: '1',
      reviews: [5, 5, 3, 4],
    },
  });
});

it('unmasks results with primitive arrays with @unmask', () => {
  const query = gql`
    query {
      listing {
        id
        reviews
        ...ListingFragment @unmask
      }
    }

    fragment ListingFragment on Listing {
      amenities
    }
  `;

  const data = maskOperation(
    deepFreeze({
      listing: {
        __typename: 'Listing',
        id: '1',
        reviews: [5, 5, 3, 4],
        amenities: ['pool', 'hot tub', 'backyard'],
      },
    }),
    query,
    new Hermes(),
  );

  expect(data).toEqual({
    listing: {
      __typename: 'Listing',
      id: '1',
      reviews: [5, 5, 3, 4],
      amenities: ['pool', 'hot tub', 'backyard'],
    },
  });
});

it('unmasks results with warnings with primitive arrays with @unmask(mode: "migrate")', () => {
  using _ = spyOnConsole('warn');

  const query = gql`
    query GetListing {
      listing {
        id
        reviews
        ...ListingFragment @unmask(mode: "migrate")
      }
    }

    fragment ListingFragment on Listing {
      amenities
    }
  `;

  const data = maskOperation(
    deepFreeze({
      listing: {
        __typename: 'Listing',
        id: '1',
        reviews: [5, 5, 3, 4],
        amenities: ['pool', 'hot tub', 'backyard'],
      },
    }),
    query,
    new Hermes(),
  );

  data.listing.__typename;
  data.listing.id;
  data.listing.reviews;

  expect(console.warn).not.toHaveBeenCalled();

  data.listing.amenities;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "query 'GetListing'",
    'listing.amenities',
  );

  expect(data).toEqual({
    listing: {
      __typename: 'Listing',
      id: '1',
      reviews: [5, 5, 3, 4],
      amenities: ['pool', 'hot tub', 'backyard'],
    },
  });
});
