import { expect } from 'chai';
import { gql } from '@apollo/client';

import { Hermes } from '../../../../src';
import { Policies } from '../../../../src/context/policies';
import { StoreFieldNames } from '../../../../src/context/storeFieldNames';

// Writes only look up the policies that are configured.
describe(`operations.write`, () => {
  describe(`policy lookups`, () => {
    const query = gql`
      {
        user {
          id
          name
          friends {
            id
            name
          }
        }
      }
    `;
    const data = {
      user: {
        __typename: 'User',
        id: 1,
        name: 'a',
        friends: [
          { __typename: 'User', id: 2, name: 'b' },
          { __typename: 'User', id: 3, name: 'c' },
        ],
      },
    };

    /** Counts calls of the given methods while `callback` runs. */
    function countCalls(methods: [object, string][], callback: () => void): number {
      let count = 0;
      const originals = methods.map(([target, name]) => {
        const original = (target as any)[name];
        (target as any)[name] = function (this: unknown, ...args: unknown[]) {
          count++;
          return original.apply(this, args);
        };
        return original;
      });
      try {
        callback();
      } finally {
        methods.forEach(([target, name], i) => ((target as any)[name] = originals[i]));
      }
      return count;
    }

    const lookups: [object, string][] = [
      [Policies.prototype, 'getTypePolicy'],
      [StoreFieldNames.prototype, 'storeKey'],
    ];

    it(`look up no type or field policies without policies`, () => {
      const cache = new Hermes();
      expect(countCalls(lookups, () => cache.writeQuery({ query, data }))).to.eq(0);
    });

    it(`look up no type or field policies with policies that don't apply to writes`, () => {
      const cache = new Hermes({ typePolicies: { User: { fields: { name: { read: (name: unknown) => name } } } } });
      expect(countCalls(lookups, () => cache.writeQuery({ query, data }))).to.eq(0);
    });

    it(`look up merge policies when there are some`, () => {
      const cache = new Hermes({ typePolicies: { User: { fields: { friends: { merge: false } } } } });
      expect(countCalls(lookups, () => cache.writeQuery({ query, data }))).to.be.greaterThan(0);
    });

    describe(`with keyFields`, () => {
      let dev: boolean | undefined;
      beforeEach(() => {
        dev = (globalThis as any).__DEV__;
        (globalThis as any).__DEV__ = false;
      });
      afterEach(() => {
        (globalThis as any).__DEV__ = dev;
      });

      it(`identify each written object once, in production`, () => {
        const cache = new Hermes({ typePolicies: { User: { keyFields: ['id'] } } });
        const identifications = countCalls([[Policies.prototype, 'identify']], () => cache.writeQuery({ query, data }));
        expect(identifications).to.eq(3);
      });

      it(`still fail for objects missing their keyFields, in production`, () => {
        const cache = new Hermes({ typePolicies: { User: { keyFields: ['id'] } } });
        expect(() =>
          cache.writeQuery({ query, data: { user: { ...data.user, friends: [{ __typename: 'User', name: 'b' }] } } }),
        ).to.throw(/Missing field 'id' while extracting keyFields/);
      });
    });
  });
});
