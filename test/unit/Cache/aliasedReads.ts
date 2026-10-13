import { gql, InMemoryCache } from '@apollo/client';
import type { DocumentNode, TypePolicies } from '@apollo/client';

import { Hermes } from '../../../src';

// Reads of aliased fields only change their own response keys, like
// InMemoryCache's.
describe(`aliased reads`, () => {
  function bothCaches(typePolicies?: TypePolicies) {
    return [new Hermes({ typePolicies }), new InMemoryCache({ typePolicies })] as const;
  }

  function diffBoth(write: DocumentNode, data: object, query: DocumentNode, typePolicies?: TypePolicies) {
    return bothCaches(typePolicies).map(cache => {
      cache.writeQuery({ query: write, data });
      const { result, complete, missing } = cache.diff<any>({ query, optimistic: false });
      return { result, complete, message: missing?.message };
    });
  }

  describe(`with a read function that returns undefined for some arguments`, () => {
    const typePolicies: TypePolicies = {
      Query: {
        fields: {
          b: {
            read: (existing, { args }) => (args?.x === 1 ? undefined : existing),
          },
        },
      },
    };

    for (const [order, query] of [
      [
        `after the field`,
        gql`
          {
            b
            a: b(x: 1)
          }
        `,
      ],
      [
        `before the field`,
        gql`
          {
            a: b(x: 1)
            b
          }
        `,
      ],
    ] as const) {
      it(`keeps the field selected under its schema name (aliased selection ${order})`, () => {
        const [hermes, inMemory] = diffBoth(
          gql`
            {
              b
            }
          `,
          { b: 5 },
          query,
          typePolicies,
        );
        expect(hermes).toEqual({
          result: { b: 5 },
          complete: false,
          message: "Can't find field 'b' on ROOT_QUERY object",
        });
        expect(hermes).toEqual(inMemory);
      });
    }

    it(`passes the stored value to the read functions of other aliases`, () => {
      const policies: TypePolicies = {
        Query: { fields: { b: { ...(typePolicies.Query!.fields!.b as object), keyArgs: false } } },
      };
      const query = gql`
        {
          a: b(x: 1)
          c: b(x: 2)
        }
      `;
      const [hermes, inMemory] = diffBoth(
        gql`
          {
            b
          }
        `,
        { b: 5 },
        query,
        policies,
      );
      expect(hermes.result).toEqual({ c: 5 });
      expect(hermes.complete).toBe(false);
      expect(hermes.result).toEqual(inMemory.result);
    });
  });

  it(`does not read a stored field named like a missing field's alias`, () => {
    const query = gql`
      {
        a: b
      }
    `;
    const [hermes, inMemory] = diffBoth(
      gql`
        {
          a
        }
      `,
      { a: 1 },
      query,
    );
    expect(hermes).toEqual({ result: null, complete: false, message: "Can't find field 'b' on ROOT_QUERY object" });
    expect(hermes).toEqual(inMemory);
  });

  it(`does not read a stored field named like a missing nested field's alias`, () => {
    const write = gql`
      {
        user {
          id
          n
        }
      }
    `;
    const query = gql`
      {
        user {
          id
          n: name
        }
      }
    `;
    const data = { user: { __typename: 'User', id: 1, n: 'stored n' } };
    const [hermes, inMemory] = diffBoth(write, data, query);
    expect(hermes.complete).toBe(false);
    expect(hermes.result?.user?.n).toBeUndefined();
    expect(hermes.message).toEqual(inMemory.message);
  });
});
