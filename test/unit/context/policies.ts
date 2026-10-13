import { expect } from 'chai';
import { gql } from '@apollo/client';
import type { TypePolicies } from '@apollo/client/cache';

import { Hermes } from '../../../src';
import { Policies } from '../../../src/context/policies';

describe(`context.Policies`, () => {
  // Only field policies that can change what a read returns make reads look
  // for policies (rather than return the stored data of static queries).
  describe(`hasFieldPolicies`, () => {
    const fieldPolicies = (fields: any): TypePolicies => ({ Query: { fields } });
    const cases: [string, TypePolicies, boolean, boolean?][] = [
      [`no field policies`, {}, false],
      [`keyArgs: false`, fieldPolicies({ feed: { keyArgs: false } }), false],
      [`keyArgs of arguments`, fieldPolicies({ feed: { keyArgs: ['type', ['nested']] } }), false],
      [`merge functions`, fieldPolicies({ feed: { merge: (_: unknown, incoming: unknown) => incoming } }), false],
      [`merge: true`, fieldPolicies({ feed: { merge: true } }), false],
      [`read functions`, fieldPolicies({ feed: { read: (existing: unknown) => existing } }), true],
      [`read function shorthands`, fieldPolicies({ feed: (existing: unknown) => existing }), true],
      [`keyArgs functions`, fieldPolicies({ feed: { keyArgs: () => 'feed' } }), true],
      [`keyArgs of variables`, fieldPolicies({ feed: { keyArgs: ['$type'] } }), true],
      [`keyArgs of directives`, fieldPolicies({ feed: { keyArgs: [['nested'], '@connection', ['key']] } }), true],
      [`scalar fields, without custom scalars`, fieldPolicies({ at: { scalar: 'Date' } }), false],
      [`scalar fields, with custom scalars`, fieldPolicies({ at: { scalar: 'Date' } }), true, true],
    ];
    for (const [description, typePolicies, expected, scalars] of cases) {
      it(`is ${expected} for ${description}`, () => {
        expect(new Policies({ typePolicies, scalars }).hasFieldPolicies).to.eq(expected);
      });
    }

    it(`is updated by addTypePolicies`, () => {
      const policies = new Policies({ typePolicies: fieldPolicies({ feed: { keyArgs: false } }) });
      policies.addTypePolicies({ Item: { fields: { name: { read: (existing: unknown) => existing } } } });
      expect(policies.hasFieldPolicies).to.eq(true);
      expect(policies.hasReadFunctions).to.eq(true);
    });
  });

  it(`applies policies added for a type after the type's policy was used`, () => {
    const policies = new Policies({ typePolicies: { User: { keyFields: ['id'] } } });
    expect(policies.identify({ __typename: 'User', id: 1, email: 'a' })[0]).to.eq('User:{"id":1}');
    policies.addTypePolicies({ User: { keyFields: ['email'] } });
    expect(policies.identify({ __typename: 'User', id: 1, email: 'a' })[0]).to.eq('User:{"email":"a"}');
    expect(policies.hasKeyFieldsFunction('User')).to.eq(false);
  });

  it(`identifies objects by __typename and id without keyFields or dataIdFromObject`, () => {
    const policies = new Policies({ typePolicies: { Query: { fields: { feed: { keyArgs: false } } } } });
    expect(policies.identify({ __typename: 'User', id: 1 })[0]).to.eq('User:1');
    expect(policies.identify({ __typename: 'User', _id: 'a' })[0]).to.eq('User:a');
    expect(policies.identify({ __typename: 'Query', id: 1 })[0]).to.eq('ROOT_QUERY');
    expect(policies.identify({ id: 1 })[0]).to.eq(undefined);
  });

  it(`reads static fields keyed by variables`, () => {
    const cache = new Hermes({ typePolicies: { Query: { fields: { feed: { keyArgs: ['$type'] } } } } });
    const query = gql`
      query ($type: String) {
        feed
      }
    `;
    cache.writeQuery({ query, variables: { type: 'a' }, data: { feed: 'A' } });
    cache.writeQuery({ query, variables: { type: 'b' }, data: { feed: 'B' } });
    expect(cache.readQuery<any>({ query, variables: { type: 'a' } })?.feed).to.eq('A');
    expect(cache.readQuery<any>({ query, variables: { type: 'b' } })?.feed).to.eq('B');
  });

  describe(`reactive variable changes`, () => {
    const query = gql`
      {
        feed
      }
    `;
    function cachedReads(typePolicies: TypePolicies) {
      const cache = new Hermes({ typePolicies });
      cache.writeQuery({ query, data: { feed: 1 } });
      cache.readQuery({ query });
      // What a reactive variable calls when it changes.
      cache.broadcastWatches();
      return cache.getCurrentCacheSnapshot().baseline.readCache.size;
    }

    it(`keep cached reads without read functions`, () => {
      expect(cachedReads({ Query: { fields: { feed: { keyArgs: false, merge: true } } } })).to.eq(1);
    });

    it(`drop cached reads with read functions`, () => {
      expect(cachedReads({ Query: { fields: { other: { read: () => 1 } } } })).to.eq(0);
    });
  });
});
