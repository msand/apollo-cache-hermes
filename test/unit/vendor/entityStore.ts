// noinspection GraphQLUnresolvedReference

import gql from 'graphql-tag';

import { Cache, makeReference, MissingFieldError, Reference } from '../../../apollo-client/src';
import { Hermes } from '../../../src';

const expect = jestExpect;

describe('EntityStore', () => {
  it('supports toReference(obj, true) to persist obj', () => {
    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            book(_, { args, toReference, readField }) {
              const ref = toReference(
                {
                  __typename: 'Book',
                  isbn: args!.isbn,
                },
                true
              ) as Reference;

              expect(readField('__typename', ref)).toEqual('Book');
              const isbn = readField<string>('isbn', ref);
              expect(isbn).toEqual(args!.isbn);
              expect(readField('title', ref)).toEqual(titlesByISBN.get(isbn!));

              return ref;
            },

            books: {
              merge(
                existing: Reference[] = [],
                incoming: any[],
                { isReference, toReference, readField }
              ) {
                incoming.forEach((book) => {
                  expect(isReference(book)).toBe(false);
                  expect(book.__typename).toBeUndefined();
                });

                const refs = incoming.map(
                  book =>
                                        toReference(
                                          {
                                            __typename: 'Book',
                                            title: titlesByISBN.get(book.isbn),
                                            ...book,
                                          },
                                          true
                                        ) as Reference
                );

                refs.forEach((ref, i) => {
                  expect(isReference(ref)).toBe(true);
                  expect(readField('__typename', ref)).toBe('Book');
                  const isbn = readField<string>('isbn', ref);
                  expect(typeof isbn).toBe('string');
                  expect(isbn).toBe(readField('isbn', incoming[i]));
                });

                return [...existing, ...refs];
              },
            },
          },
        },

        Book: {
          keyFields: ['isbn'],
        },
      },
    });

    const booksQuery = gql`
            query {
                books {
                    isbn
                }
            }
        `;

    const bookQuery = gql`
            query {
                book(isbn: $isbn) {
                    isbn
                    title
                }
            }
        `;

    const titlesByISBN = new Map<string, string>([
      ['9781451673319', 'Fahrenheit 451'],
      ['1603589082', 'Eager'],
      ['1760641790', 'How To Do Nothing'],
    ]);

    cache.writeQuery({
      query: booksQuery,
      data: {
        books: [
          {
            // Note: intentionally omitting __typename:"Book" here.
            isbn: '9781451673319',
          },
          {
            isbn: '1603589082',
          },
        ],
      },
    });

    const twoBookSnapshot = {
      'Book:{"isbn":"1603589082"}': {
        data: {
          __typename: 'Book',
          isbn: '1603589082',
          title: 'Eager',
        },
        inbound: [
          {
            id: 'ROOT_QUERY',
            path: [
              'books',
              1,
            ],
          },
        ],
        type: 0,
      },
      'Book:{"isbn":"9781451673319"}': {
        data: {
          __typename: 'Book',
          isbn: '9781451673319',
          title: 'Fahrenheit 451',
        },
        inbound: [
          {
            id: 'ROOT_QUERY',
            path: [
              'books',
              0,
            ],
          },
        ],
        type: 0,
      },
      ROOT_QUERY: {
        data: {
          books: [
            undefined,
            undefined,
          ],
        },
        outbound: [
          {
            id: 'Book:{"isbn":"9781451673319"}',
            path: [
              'books',
              0,
            ],
          },
          {
            id: 'Book:{"isbn":"1603589082"}',
            path: [
              'books',
              1,
            ],
          },
        ],
        type: 0,
      },
    };

    // Check that the __typenames were appropriately added.
    expect(cache.extract()).toEqual(twoBookSnapshot);

    cache.writeQuery({
      query: booksQuery,
      data: {
        books: [
          {
            isbn: '1760641790',
          },
        ],
      },
    });

    const threeBookSnapshot = {
      ...twoBookSnapshot,
      ROOT_QUERY: {
        ...twoBookSnapshot.ROOT_QUERY,
        data: {
          ...twoBookSnapshot.ROOT_QUERY.data,
          books: [
            ...twoBookSnapshot.ROOT_QUERY.data.books,
            undefined,
          ],
        },
        outbound: [...twoBookSnapshot.ROOT_QUERY.outbound,
          {
            id: 'Book:{"isbn":"1760641790"}',
            path: [
              'books',
              2,
            ],
          }],
      },
      'Book:{"isbn":"1760641790"}': {
        data: {
          __typename: 'Book',
          isbn: '1760641790',
          title: 'How To Do Nothing',
        },
        inbound: [
          {
            id: 'ROOT_QUERY',
            path: [
              'books',
              2,
            ],
          },
        ],
        type: 0,
      },
    };

    expect(cache.extract()).toEqual(threeBookSnapshot);

    const howToDoNothingResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '1760641790',
      },
    });

    expect(howToDoNothingResult).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '1760641790',
        title: 'How To Do Nothing',
      },
    });

    // Check that reading the query didn't change anything.
    expect(cache.extract()).toEqual(threeBookSnapshot);

    const f451Result = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '9781451673319',
      },
    });

    expect(f451Result).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '9781451673319',
        title: 'Fahrenheit 451',
      },
    });

    const cuckoosCallingDiffResult = cache.diff({
      query: bookQuery,
      optimistic: true,
      variables: {
        isbn: '031648637X',
      },
    });

    expect(cuckoosCallingDiffResult).toMatchObject({
      complete: false,
      result: {
        book: {
          __typename: 'Book',
          isbn: '031648637X',
        },
      },
      missing: [
        new MissingFieldError(
          'Can\'t find field \'title\' on Book:{"isbn":"031648637X"} object',
          {
            book: {
              title:
                                'Can\'t find field \'title\' on Book:{"isbn":"031648637X"} object',
            },
          },
          expect.anything(), // query
          expect.anything() // variables
        ),
      ],
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        data: {
          __typename: 'Book',
          isbn: '031648637X',
        },
        type: 0,
      },
    });

    const cuckoosCallingId = cache.identify({
      __typename: 'Book',
      isbn: '031648637X',
    })!;

    expect(cuckoosCallingId).toBe('Book:{"isbn":"031648637X"}');

    cache.writeQuery({
      id: cuckoosCallingId,
      query: gql`
                {
                    title
                }
            `,
      data: {
        title: 'The Cuckoo\'s Calling',
      },
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        data: {
          __typename: 'Book',
          isbn: '031648637X',
          title: 'The Cuckoo\'s Calling',
        },
        type: 0,
      },
    });

    cache.modify({
      id: cuckoosCallingId,
      fields: {
        title(title: string, { isReference, toReference, readField }) {
          const book = {
            __typename: 'Book',
            isbn: readField('isbn'),
            author: 'J.K. Rowling',
          };

          // By not passing true as the second argument to toReference, we
          // get back a Reference object, but the book.author field is not
          // persisted into the store.
          const refWithoutAuthor = toReference(book);
          expect(isReference(refWithoutAuthor)).toBe(true);
          expect(
            readField('author', refWithoutAuthor as Reference)
          ).toBeUndefined();

          // Update this very Book entity before we modify its title.
          // Passing true for the second argument causes the extra
          // book.author field to be persisted into the store.
          const ref = toReference(book, true);
          expect(isReference(ref)).toBe(true);
          expect(readField('author', ref as Reference)).toBe('J.K. Rowling');

          // In fact, readField doesn't need the ref if we're reading from
          // the same entity that we're modifying.
          expect(readField('author')).toBe('J.K. Rowling');

          // Typography matters!
          return title.split('\'').join('’');
        },
      },
    });

    expect(cache.extract()).toEqual({
      ...threeBookSnapshot,
      // This book was added as a side effect of the read function.
      'Book:{"isbn":"031648637X"}': {
        data: {
          __typename: 'Book',
          isbn: '031648637X',
          title: 'The Cuckoo’s Calling',
          author: 'J.K. Rowling',
        },
        type: 0,
      },
    });
  });

  it('supports toReference(id)', () => {
    const cache = new Hermes({
      typePolicies: {
        Book: {
          fields: {
            favorited(_, { readField, toReference }) {
              const rootQueryRef = toReference('ROOT_QUERY');
              const ref = makeReference('ROOT_QUERY');
              expect(rootQueryRef).toEqual(ref);
              const favoritedBooks = readField<Reference[]>(
                'favoritedBooks',
                rootQueryRef
              );
              const isbn = readField('isbn');
              return favoritedBooks!.some((bookRef) => {
                return isbn === readField('isbn', bookRef);
              });
            },
          },
          keyFields: ['isbn'],
        },
        Query: {
          fields: {
            book(_, { args, toReference }) {
              const ref = toReference(
                {
                  __typename: 'Book',
                  isbn: args!.isbn,
                  title: titlesByISBN.get(args!.isbn),
                },
                true
              );

              return ref;
            },
          },
        },
      },
    });

    cache.writeQuery({
      query: gql`
                {
                    favoritedBooks {
                        isbn
                        title
                    }
                }
            `,
      data: {
        favoritedBooks: [
          {
            __typename: 'Book',
            isbn: '9781784295547',
            title: 'Shrill',
            author: 'Lindy West',
          },
        ],
      },
    });

    const titlesByISBN = new Map<string, string>([
      ['9780062569714', 'Hunger'],
      ['9781784295547', 'Shrill'],
      ['9780807083109', 'Kindred'],
    ]);

    const bookQuery = gql`
            query {
                book(isbn: $isbn) {
                    isbn
                    title
                    favorited @client
                }
            }
        `;

    const shrillResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '9781784295547',
      },
    });

    expect(shrillResult).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '9781784295547',
        title: 'Shrill',
        favorited: true,
      },
    });

    const kindredResult = cache.readQuery({
      query: bookQuery,
      variables: {
        isbn: '9780807083109',
      },
    });

    expect(kindredResult).toMatchObject({
      book: {
        __typename: 'Book',
        isbn: '9780807083109',
        title: 'Kindred',
        favorited: false,
      },
    });
  });

  it('should not over-invalidate fields with keyArgs', () => {
    const isbnsWeHaveRead: string[] = [];

    const cache = new Hermes({
      typePolicies: {
        Query: {
          fields: {
            book: {
              // The presence of this keyArgs configuration permits the
              // cache to track result caching dependencies at the level
              // of individual Books, so writing one Book does not
              // invalidate other Books with different ISBNs. If the cache
              // doesn't know which arguments are "important," it can't
              // make any assumptions about the relationships between
              // field values with the same field name but different
              // arguments, so it has to err on the side of invalidating
              // all Query.book data whenever any Book is written.
              keyArgs: ['isbn'],

              read(book, { args, toReference }) {
                isbnsWeHaveRead.push(args!.isbn);
                return (
                  book ||
                                    toReference({
                                      __typename: 'Book',
                                      isbn: args!.isbn,
                                    })
                );
              },
            },
          },
        },

        Book: {
          keyFields: ['isbn'],
        },
      },
    });

    const query = gql`
            query Book($isbn: string) {
                book(isbn: $isbn) {
                    title
                    isbn
                    author {
                        name
                    }
                }
            }
        `;

    const diffs: Cache.DiffResult<any>[] = [];
    cache.watch({
      query,
      optimistic: true,
      variables: {
        isbn: '1449373321',
      },
      callback(diff) {
        diffs.push(diff);
      },
    });

    const ddiaData = {
      book: {
        __typename: 'Book',
        isbn: '1449373321',
        title: 'Designing Data-Intensive Applications',
        author: {
          __typename: 'Author',
          name: 'Martin Kleppmann',
        },
      },
    };

    expect(isbnsWeHaveRead).toEqual([]);

    cache.writeQuery({
      query,
      variables: {
        isbn: '1449373321',
      },
      data: ddiaData,
    });

    expect(isbnsWeHaveRead).toEqual(['1449373321']);

    expect(diffs).toMatchObject([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    const theEndData = {
      book: {
        __typename: 'Book',
        isbn: '1982103558',
        title: 'The End of Everything',
        author: {
          __typename: 'Author',
          name: 'Katie Mack',
        },
      },
    };

    cache.writeQuery({
      query,
      variables: {
        isbn: '1982103558',
      },
      data: theEndData,
    });

    // This list does not include the book we just wrote, because the
    // cache.watch we started above only depends on the Query.book field
    // value corresponding to the 1449373321 ISBN.
    expect(diffs).toMatchObject([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    // Likewise, this list is unchanged, because we did not need to read
    // the 1449373321 Book again after writing the 1982103558 data.
    expect(isbnsWeHaveRead).toEqual(['1449373321']);

    const theEndResult = cache.readQuery({
      query,
      variables: {
        isbn: '1982103558',
      },
      // TODO It's a regrettable accident of history that cache.readQuery is
      // non-optimistic by default. Perhaps the default can be swapped to true
      // in the next major version of Apollo Client.
      optimistic: true,
    });

    expect(theEndResult).toEqual(theEndData);

    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558']);

    expect(
      cache.readQuery({
        query,
        variables: {
          isbn: '1449373321',
        },
        optimistic: true,
      })
    ).toBe(diffs[0].result);

    expect(
      cache.readQuery({
        query,
        variables: {
          isbn: '1982103558',
        },
        optimistic: true,
      })
    ).toBe(theEndResult);

    // Still no additional reads, because both books are cached.
    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558']);

    // Evicting the 1982103558 Book should not invalidate the 1449373321
    // Book, so diffs and isbnsWeHaveRead should remain unchanged.
    expect(
      cache.evict({
        id: cache.identify({
          __typename: 'Book',
          isbn: '1982103558',
        }),
      })
    ).toBe(true);

    expect(diffs).toMatchObject([
      {
        complete: true,
        result: ddiaData,
      },
    ]);

    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558']);

    expect(
      cache.readQuery({
        query,
        variables: {
          isbn: '1449373321',
        },
        // Read this query non-optimistically, to test that the read function
        // runs again, adding "1449373321" again to isbnsWeHaveRead.
        optimistic: false,
      })
    ).toBe(diffs[0].result);

    /*
    This does not appear to make sense,
    baseline and optimistic graph snapshots are the same, read should be cached.
    expect(isbnsWeHaveRead).toEqual(['1449373321', '1982103558', '1449373321']);
    */
  });
});
