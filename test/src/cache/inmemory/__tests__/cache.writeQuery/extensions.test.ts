import { gql } from '@apollo/client';

import { Hermes } from '../../../../../../src';

it('extensions are available in merge functions', () => {
  const extensions = {
    customField: 'customValue',
    metadata: { version: 1 },
  };

  const merge = jest.fn((_, incoming) => incoming);

  const cache = new Hermes({
    typePolicies: {
      Query: {
        fields: {
          book: {
            merge,
          },
        },
      },
    },
  });

  cache.writeQuery({
    query: gql`
      query {
        book {
          title
        }
      }
    `,
    data: {
      book: {
        __typename: 'Book',
        title: 'Test Book',
      },
    },
    extensions,
  });

  expect(merge).toHaveBeenCalledTimes(1);
  expect(merge).toHaveBeenCalledWith(
    undefined,
    { __typename: 'Book', title: 'Test Book' },
    expect.objectContaining({ extensions }),
  );
});

it('extensions are undefined when not provided', () => {
  const merge = jest.fn((_, incoming) => incoming);

  const cache = new Hermes({
    typePolicies: {
      Query: {
        fields: {
          book: {
            merge,
          },
        },
      },
    },
  });

  cache.writeQuery({
    query: gql`
      query {
        book {
          title
        }
      }
    `,
    data: {
      book: {
        __typename: 'Book',
        title: 'Test Book',
      },
    },
  });

  expect(merge).toHaveBeenCalledTimes(1);
  expect(merge).toHaveBeenCalledWith(
    undefined,
    { __typename: 'Book', title: 'Test Book' },
    expect.objectContaining({ extensions: undefined }),
  );
});
