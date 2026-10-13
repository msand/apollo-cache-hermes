import { gql } from '@apollo/client';
import { maskFragment } from '@apollo/client/masking';
import { InvariantError } from '@apollo/client/utilities/invariant';
// not exported
// eslint-disable-next-line import/no-unresolved -- not exported; Jest resolves it (test/env/resolver.ts).
import { deepFreeze } from '@apollo/client/utilities/internal/deepFreeze';

import { spyOnConsole } from '@apollo/client/testing/internal';

import { Hermes } from '../../../../src';

it('returns null when data is null', () => {
  const fragment = gql`
    fragment Foo on Query {
      foo
      ...QueryFields
    }

    fragment QueryFields on Query {
      bar
    }
  `;

  const data = maskFragment(null, fragment, new Hermes(), 'Foo');

  expect(data).toBe(null);
});

it('returns undefined when data is undefined', () => {
  const fragment = gql`
    fragment Foo on Query {
      foo
      ...QueryFields
    }

    fragment QueryFields on Query {
      bar
    }
  `;

  const data = maskFragment(undefined, fragment, new Hermes(), 'Foo');

  expect(data).toBe(undefined);
});
it('masks named fragments in fragment documents', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      ...UserProfile
    }

    fragment UserProfile on User {
      age
    }
  `;

  const data = maskFragment(deepFreeze({ __typename: 'User', id: 1, age: 30 }), fragment, new Hermes(), 'UserFields');

  expect(data).toEqual({ __typename: 'User', id: 1 });
});

it('masks named fragments in nested fragment objects', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      profile {
        ...UserProfile
      }
    }

    fragment UserProfile on User {
      age
    }
  `;

  const data = maskFragment(
    deepFreeze({
      __typename: 'User',
      id: 1,
      profile: { __typename: 'Profile', age: 30 },
    }),
    fragment,
    new Hermes(),
    'UserFields',
  );

  expect(data).toEqual({
    __typename: 'User',
    id: 1,
    profile: { __typename: 'Profile' },
  });
});

it('handles nulls in child selection sets', () => {
  const fragment = gql`
    fragment UserFields on User {
      profile {
        id
      }
      ...ProfileFields
    }
    fragment ProfileFields on User {
      profile {
        id
        fullName
      }
    }
  `;

  const data = maskFragment(deepFreeze({ __typename: 'User', profile: null }), fragment, new Hermes(), 'UserFields');

  expect(data).toEqual({ __typename: 'User', profile: null });
});

it('handles nulls in arrays', () => {
  const fragment = gql`
    fragment UserFields on Query {
      users {
        profile {
          id
        }
        ...ProfileFields
      }
    }
    fragment ProfileFields on User {
      profile {
        id
        fullName
      }
    }
  `;

  const data = maskFragment(
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
    fragment,
    new Hermes(),
    'UserFields',
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
  const fragment = gql`
    fragment UserFields on User {
      id
      profile {
        ...UserProfile
      }
    }

    fragment UserProfile on User {
      age
    }
  `;

  const frozenData = maskFragment(
    deepFreeze({
      __typename: 'User',
      id: 1,
      profile: { __typename: 'Profile', age: 30 },
    }),
    fragment,
    new Hermes(),
    'UserFields',
  );

  const nonFrozenData = maskFragment(
    {
      __typename: 'User',
      id: 1,
      profile: { __typename: 'Profile', age: 30 },
    },
    fragment,
    new Hermes(),
    'UserFields',
  );

  expect(Object.isFrozen(frozenData)).toBe(true);
  expect(Object.isFrozen(nonFrozenData)).toBe(false);
});

it('does not mask inline fragment in fragment documents', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      ... @defer {
        age
      }
    }
  `;

  const data = maskFragment(deepFreeze({ __typename: 'User', id: 1, age: 30 }), fragment, new Hermes(), 'UserFields');

  expect(data).toEqual({ __typename: 'User', id: 1, age: 30 });
});

it('throws when document contains more than 1 fragment without a fragmentName', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      ...UserProfile
    }

    fragment UserProfile on User {
      age
    }
  `;

  expect(() => maskFragment(deepFreeze({ __typename: 'User', id: 1, age: 30 }), fragment, new Hermes())).toThrow(
    new InvariantError('Found 2 fragments. `fragmentName` must be provided when there is not exactly 1 fragment.'),
  );
});

it('throws when fragment cannot be found within document', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      ...UserProfile
    }

    fragment UserProfile on User {
      age
    }
  `;

  expect(() =>
    maskFragment(deepFreeze({ __typename: 'User', id: 1, age: 30 }), fragment, new Hermes(), 'ProfileFields'),
  ).toThrow(new InvariantError('Could not find fragment with name "ProfileFields".'));
});

it('maintains referential equality on fragment subtrees that did not change', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      profile {
        ...ProfileFields
      }
      post {
        id
        title
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
      drinks {
        ... on SportsDrink {
          ...SportsDrinkFields
        }
        ... on Espresso {
          __typename
        }
      }
    }

    fragment ProfileFields on Profile {
      age
    }

    fragment FinanceIndustryFields on FinanceIndustry {
      yearsInBusiness
    }

    fragment TradeIndustryFields on TradeIndustry {
      languageRequirements
    }

    fragment SportsDrinkFields on SportsDrink {
      saltContent
    }
  `;

  const profile = {
    __typename: 'Profile',
    age: 30,
  };
  const post = { __typename: 'Post', id: 1, title: 'Test Post' };
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
  const drinks = [{ __typename: 'Espresso' }, { __typename: 'SportsDrink', saltContent: '1000mg' }];
  const user = deepFreeze({
    __typename: 'User',
    id: 1,
    profile,
    post,
    industries,
    drinks,
  });

  const data = maskFragment(user, fragment, new Hermes(), 'UserFields');

  expect(data).toEqual({
    __typename: 'User',
    id: 1,
    profile: { __typename: 'Profile' },
    post: { __typename: 'Post', id: 1, title: 'Test Post' },
    industries: [
      { __typename: 'TechIndustry', languageRequirements: ['TypeScript'] },
      { __typename: 'FinanceIndustry' },
      { __typename: 'TradeIndustry', id: 10, yearsInBusiness: 15 },
    ],
    drinks: [{ __typename: 'Espresso' }, { __typename: 'SportsDrink' }],
  });

  expect(data).not.toBe(user);
  expect(data.profile).not.toBe(profile);
  expect(data.post).toBe(post);
  expect(data.industries).not.toBe(industries);
  expect(data.industries[0]).toBe(industries[0]);
  expect(data.industries[1]).not.toBe(industries[1]);
  expect(data.industries[2]).not.toBe(industries[2]);
  expect(data.drinks).not.toBe(drinks);
  expect(data.drinks[0]).toBe(drinks[0]);
  expect(data.drinks[1]).not.toBe(drinks[1]);
});

it('maintains referential equality on fragment when no data is masked', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      age
    }
  `;

  const user = { __typename: 'User', id: 1, age: 30 };

  const data = maskFragment(deepFreeze(user), fragment, new Hermes());

  expect(data).toBe(user);
});

it('does not mask named fragments and returns original object when using `@unmask` directive', () => {
  const fragment = gql`
    fragment UnmaskedFragment on User {
      id
      name
      ...UserFields @unmask
    }

    fragment UserFields on User {
      age
    }
  `;

  const fragmentData = deepFreeze({
    __typename: 'User',
    id: 1,
    name: 'Test User',
    age: 30,
  });

  const data = maskFragment(fragmentData, fragment, new Hermes(), 'UnmaskedFragment');

  expect(data).toBe(fragmentData);
});

it("warns when accessing unmasked fields when using `@unmask` directive with mode 'migrate'", () => {
  using _ = spyOnConsole('warn');
  const fragment = gql`
    fragment UnmaskedFragment on User {
      id
      name
      ...UserFields @unmask(mode: "migrate")
    }

    fragment UserFields on User {
      age
    }
  `;

  const data = maskFragment(
    deepFreeze({
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
    }),
    fragment,
    new Hermes(),
    'UnmaskedFragment',
  );

  data.__typename;
  data.id;
  data.name;

  expect(console.warn).not.toHaveBeenCalled();

  data.age;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "fragment 'UnmaskedFragment'",
    'age',
  );

  data.age;

  // Ensure we only warn once for each masked field
  expect(console.warn).toHaveBeenCalledTimes(1);
});

it('maintains referential equality on `@unmask` fragment subtrees', () => {
  const fragment = gql`
    fragment UserFields on User {
      id
      profile {
        ...ProfileFields @unmask
      }
      post {
        id
        title
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
      drinks {
        ... on SportsDrink {
          ...SportsDrinkFields @unmask
        }
        ... on Espresso {
          __typename
        }
      }
    }

    fragment ProfileFields on Profile {
      age
      ...ProfileSubfields @unmask
    }

    fragment ProfileSubfields on Profile {
      name
    }

    fragment FinanceIndustryFields on FinanceIndustry {
      yearsInBusiness
    }

    fragment TradeIndustryFields on TradeIndustry {
      languageRequirements
    }

    fragment SportsDrinkFields on SportsDrink {
      saltContent
    }
  `;

  const profile = {
    __typename: 'Profile',
    age: 30,
    name: 'Test User',
  };
  const post = { __typename: 'Post', id: 1, title: 'Test Post' };
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
  const drinks = [{ __typename: 'Espresso' }, { __typename: 'SportsDrink', saltContent: '1000mg' }];
  const user = deepFreeze({
    __typename: 'User',
    id: 1,
    profile,
    post,
    industries,
    drinks,
  });

  const data = maskFragment(user, fragment, new Hermes(), 'UserFields');

  expect(data).toEqual({
    __typename: 'User',
    id: 1,
    profile: { __typename: 'Profile', age: 30, name: 'Test User' },
    post: { __typename: 'Post', id: 1, title: 'Test Post' },
    industries: [
      { __typename: 'TechIndustry', languageRequirements: ['TypeScript'] },
      { __typename: 'FinanceIndustry' },
      { __typename: 'TradeIndustry', id: 10, yearsInBusiness: 15 },
    ],
    drinks: [{ __typename: 'Espresso' }, { __typename: 'SportsDrink', saltContent: '1000mg' }],
  });

  expect(data).not.toBe(user);
  expect(data.profile).toBe(profile);
  expect(data.post).toBe(post);
  expect(data.industries).not.toBe(industries);
  expect(data.industries[0]).toBe(industries[0]);
  expect(data.industries[1]).not.toBe(industries[1]);
  expect(data.industries[2]).not.toBe(industries[2]);
  expect(data.drinks).toBe(drinks);
  expect(data.drinks[0]).toBe(drinks[0]);
  expect(data.drinks[1]).toBe(drinks[1]);
});

it("masks child fragments of @unmask(mode: 'migrate')", () => {
  using _ = spyOnConsole('warn');

  const fragment = gql`
    fragment UnmaskedUser on User {
      id
      name
      ...UserFields @unmask(mode: "migrate")
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

  const data = maskFragment(
    deepFreeze({
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
      username: 'testuser',
      email: 'test@example.com',
    }),
    fragment,
    new Hermes(),
    'UnmaskedUser',
  );

  expect(data).toEqual({
    __typename: 'User',
    id: 1,
    name: 'Test User',
    age: 30,
    email: 'test@example.com',
  });

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "fragment 'UnmaskedUser'",
    'age',
  );
});

it('masks child fragments of @unmask', () => {
  using _ = spyOnConsole('warn');

  const fragment = gql`
    fragment UnmaskedUser on User {
      id
      name
      ...UserFields @unmask
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

  const data = maskFragment(
    deepFreeze({
      __typename: 'User',
      id: 1,
      name: 'Test User',
      age: 30,
      username: 'testuser',
      email: 'test@example.com',
    }),
    fragment,
    new Hermes(),
    'UnmaskedUser',
  );

  expect(data).toEqual({
    __typename: 'User',
    id: 1,
    name: 'Test User',
    age: 30,
    email: 'test@example.com',
  });
});

it('masks partial data', () => {
  const fragment = gql`
    fragment GreetingFields on Greeting {
      message
      ...AdditionalFields
    }

    fragment AdditionalFields on Greeting {
      sentAt
      recipient {
        name
      }
    }
  `;

  {
    const data = maskFragment(
      deepFreeze({ message: 'Hello world', __typename: 'Greeting' }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      message: 'Hello world',
      __typename: 'Greeting',
    });
  }

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
    });
  }

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        recipient: { __typename: '__Person' },
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
    });
  }
});

it('unmasks partial data with @unmask', () => {
  const fragment = gql`
    fragment GreetingFields on Greeting {
      message
      ...AdditionalFields @unmask
    }

    fragment AdditionalFields on Greeting {
      sentAt
      recipient {
        name
      }
    }
  `;

  {
    const data = maskFragment(
      deepFreeze({ message: 'Hello world', __typename: 'Greeting' }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      message: 'Hello world',
      __typename: 'Greeting',
    });
  }

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      sentAt: '2024-01-01',
    });
  }

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        recipient: { __typename: '__Person' },
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      recipient: { __typename: '__Person' },
    });
  }
});

it('unmasks partial data with warnings with @unmask(mode: "migrate")', () => {
  using consoleSpy = spyOnConsole('warn');

  const fragment = gql`
    fragment GreetingFields on Greeting {
      message
      ...AdditionalFields @unmask(mode: "migrate")
    }

    fragment AdditionalFields on Greeting {
      sentAt
      recipient {
        name
      }
    }
  `;

  {
    const data = maskFragment(
      deepFreeze({ message: 'Hello world', __typename: 'Greeting' }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    data.message;
    data.__typename;

    expect(console.warn).not.toHaveBeenCalled();

    expect(data).toEqual({
      message: 'Hello world',
      __typename: 'Greeting',
    });
  }

  consoleSpy.warn.mockClear();

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    data.__typename;
    data.message;

    expect(console.warn).not.toHaveBeenCalled();

    data.sentAt;
    expect(console.warn).toHaveBeenCalledTimes(1);

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      sentAt: '2024-01-01',
    });
  }

  consoleSpy.warn.mockClear();

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        recipient: { __typename: '__Person' },
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    data.__typename;
    data.message;

    expect(console.warn).not.toHaveBeenCalled();

    data.recipient;
    // We do not warn on access to __typename
    data.recipient.__typename;
    expect(console.warn).toHaveBeenCalledTimes(1);

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      recipient: { __typename: '__Person' },
    });
  }
});

it('masks partial deferred data', () => {
  const fragment = gql`
    fragment GreetingFields on Greeting {
      message
      ... @defer {
        sentAt
        ...AdditionalFields
      }
    }

    fragment AdditionalFields on Greeting {
      recipient {
        name
      }
    }
  `;

  {
    const data = maskFragment(
      deepFreeze({ message: 'Hello world', __typename: 'Greeting' }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      message: 'Hello world',
      __typename: 'Greeting',
    });
  }

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
        recipient: { __typename: '__Person', name: 'Alice' },
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      sentAt: '2024-01-01',
    });
  }
});

it('unmasks partial deferred data with @unmask', () => {
  const fragment = gql`
    fragment GreetingFields on Greeting {
      message
      ... @defer {
        sentAt
        ...AdditionalFields @unmask
      }
    }

    fragment AdditionalFields on Greeting {
      recipient {
        name
      }
    }
  `;

  {
    const data = maskFragment(
      deepFreeze({ message: 'Hello world', __typename: 'Greeting' }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      message: 'Hello world',
      __typename: 'Greeting',
    });
  }

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
        recipient: { __typename: '__Person', name: 'Alice' },
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      sentAt: '2024-01-01',
      recipient: { __typename: '__Person', name: 'Alice' },
    });
  }
});

it('unmasks partial deferred data with warnings with @unmask(mode: "migrate")', () => {
  using consoleSpy = spyOnConsole('warn');

  const fragment = gql`
    fragment GreetingFields on Greeting {
      message
      ... @defer {
        sentAt
        ...AdditionalFields @unmask(mode: "migrate")
      }
    }

    fragment AdditionalFields on Greeting {
      recipient {
        name
      }
    }
  `;

  {
    const data = maskFragment(
      deepFreeze({ message: 'Hello world', __typename: 'Greeting' }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    expect(data).toEqual({
      message: 'Hello world',
      __typename: 'Greeting',
    });
  }

  consoleSpy.warn.mockClear();

  {
    const data = maskFragment(
      deepFreeze({
        __typename: 'Greeting',
        message: 'Hello world',
        sentAt: '2024-01-01',
        recipient: { __typename: '__Person', name: 'Alice' },
      }),
      fragment,
      new Hermes(),
      'GreetingFields',
    );

    data.message;
    data.sentAt;
    data.__typename;

    expect(console.warn).not.toHaveBeenCalled();

    data.recipient;
    data.recipient.name;
    // We do not warn on access to __typename
    data.recipient.__typename;
    expect(console.warn).toHaveBeenCalledTimes(2);

    expect(data).toEqual({
      __typename: 'Greeting',
      message: 'Hello world',
      sentAt: '2024-01-01',
      recipient: { __typename: '__Person', name: 'Alice' },
    });
  }
});

it('masks results with primitive arrays', () => {
  const fragment = gql`
    fragment ListingFragment on Listing {
      id
      reviews
      ...ListingFields
    }

    fragment ListingFields on Listing {
      amenities
    }
  `;

  const data = maskFragment(
    deepFreeze({
      __typename: 'Listing',
      id: '1',
      reviews: [5, 5, 3, 4],
      amenities: ['pool', 'hot tub', 'backyard'],
    }),
    fragment,
    new Hermes(),
    'ListingFragment',
  );

  expect(data).toEqual({
    __typename: 'Listing',
    id: '1',
    reviews: [5, 5, 3, 4],
  });
});

it('unmasks results with primitive arrays with @unmask', () => {
  const fragment = gql`
    fragment ListingFragment on Listing {
      id
      reviews
      ...ListingFields @unmask
    }

    fragment ListingFields on Listing {
      amenities
    }
  `;

  const data = maskFragment(
    deepFreeze({
      __typename: 'Listing',
      id: '1',
      reviews: [5, 5, 3, 4],
      amenities: ['pool', 'hot tub', 'backyard'],
    }),
    fragment,
    new Hermes(),
    'ListingFragment',
  );

  expect(data).toEqual({
    __typename: 'Listing',
    id: '1',
    reviews: [5, 5, 3, 4],
    amenities: ['pool', 'hot tub', 'backyard'],
  });
});

it('unmasks results with warnings with primitive arrays with @unmask(mode: "migrate")', () => {
  using _ = spyOnConsole('warn');

  const fragment = gql`
    fragment ListingFragment on Listing {
      id
      reviews
      ...ListingFields @unmask(mode: "migrate")
    }

    fragment ListingFields on Listing {
      amenities
    }
  `;

  const data = maskFragment(
    deepFreeze({
      __typename: 'Listing',
      id: '1',
      reviews: [5, 5, 3, 4],
      amenities: ['pool', 'hot tub', 'backyard'],
    }),
    fragment,
    new Hermes(),
    'ListingFragment',
  );

  data.__typename;
  data.id;
  data.reviews;

  expect(console.warn).not.toHaveBeenCalled();

  data.amenities;

  expect(console.warn).toHaveBeenCalledTimes(1);
  expect(console.warn).toHaveBeenCalledWith(
    "Accessing unmasked field on %s at path '%s'. This field will not be available when masking is enabled. Please read the field from the fragment instead.",
    "fragment 'ListingFragment'",
    'amenities',
  );

  expect(data).toEqual({
    __typename: 'Listing',
    id: '1',
    reviews: [5, 5, 3, 4],
    amenities: ['pool', 'hot tub', 'backyard'],
  });
});
