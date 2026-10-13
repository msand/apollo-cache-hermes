import { expect } from 'chai';
import { gql } from '@apollo/client';

import { Hermes } from '../../../src';
import { parseStoreFieldName } from '../../../src/context/storeFieldNames';

describe(`InMemoryCache store field names`, () => {
  describe(`parseStoreFieldName`, () => {
    it(`parses arguments`, () => {
      expect(parseStoreFieldName('field({"a":1,"b":"x"})')).to.deep.eq({
        fieldName: 'field',
        args: { a: 1, b: 'x' },
        hasDirectives: false,
      });
    });

    it(`parses arguments containing parentheses, braces and escaped quotes`, () => {
      expect(parseStoreFieldName('field({"a":"(}\\")"})')).to.deep.eq({
        fieldName: 'field',
        args: { a: '(}")' },
        hasDirectives: false,
      });
    });

    it(`parses directives, with and without arguments`, () => {
      expect(parseStoreFieldName('lastName@upperCase')).to.deep.eq({ fieldName: 'lastName', hasDirectives: true });
      expect(parseStoreFieldName('birthDate@dateFormat({"format":"DD-MM-YYYY"})')).to.deep.eq({
        fieldName: 'birthDate',
        hasDirectives: true,
      });
      expect(parseStoreFieldName('field({"a":1})@one@two({"b":2})')).to.deep.eq({
        fieldName: 'field',
        args: { a: 1 },
        hasDirectives: true,
      });
    });

    it(`does not parse plain field names, keyArgs store field names, or malformed ones`, () => {
      expect(parseStoreFieldName('field')).to.eq(undefined);
      expect(parseStoreFieldName('feed:{"type":"news"}')).to.eq(undefined);
      expect(parseStoreFieldName('field({"a":1}')).to.eq(undefined);
      expect(parseStoreFieldName('field({"a":1})x')).to.eq(undefined);
      expect(parseStoreFieldName('field@')).to.eq(undefined);
    });
  });

  describe(`restore() of an InMemoryCache extract`, () => {
    const query = gql`
      query ($id: ID, $stringArg: String, $intArg: Int, $floatArg: Float) {
        stringField(arg: $stringArg)
        numberField(intArg: $intArg, floatArg: $floatArg)
        lastName @upperCase
        birthDate @dateFormat(format: "DD-MM-YYYY")
        user(id: $id) {
          id
          name
        }
      }
    `;
    const variables = { id: 1, stringArg: 'a (string)', intArg: 5, floatArg: 3.14 };

    let cache: Hermes;
    beforeEach(() => {
      cache = new Hermes();
      cache.restore({
        ROOT_QUERY: {
          __typename: 'Query',
          'stringField({"arg":"a (string)"})': 'Heyo',
          'numberField({"floatArg":3.14,"intArg":5})': 5,
          'lastName@upperCase': 'BOND',
          'birthDate@dateFormat({"format":"DD-MM-YYYY"})': '20-05-1940',
          'user({"id":1})': { __ref: 'User:1' },
        },
        'User:1': { __typename: 'User', id: 1, name: 'James' },
      } as any);
    });

    it(`reads fields with arguments (in any order) and with directives`, () => {
      expect(cache.readQuery({ query, variables })).to.deep.include({
        stringField: 'Heyo',
        numberField: 5,
        lastName: 'BOND',
        birthDate: '20-05-1940',
      });
    });

    it(`restores references from fields with arguments`, () => {
      const result = cache.readQuery<any>({ query, variables });
      expect(result.user).to.deep.include({ id: 1, name: 'James' });

      cache.writeQuery({
        query: gql`
          query {
            user(id: 1) {
              id
              name
            }
          }
        `,
        data: { user: { __typename: 'User', id: 1, name: 'Bond' } },
      });
      expect(cache.readQuery<any>({ query, variables }).user).to.deep.include({ id: 1, name: 'Bond' });
    });

    it(`stores fields with arguments as parameterized values`, () => {
      expect(Object.keys(cache.extract())).to.have.members([
        'ROOT_QUERY',
        'ROOT_QUERY❖["stringField"]❖{"arg":"a (string)"}',
        'ROOT_QUERY❖["numberField"]❖{"floatArg":3.14,"intArg":5}',
        'ROOT_QUERY❖["user"]❖{"id":1}',
        'User:1',
      ]);
    });
  });

  it(`stores fields the same, whatever the order of their arguments`, () => {
    const cache = new Hermes();
    cache.writeQuery({
      query: gql`
        query {
          field(b: 1, a: { d: 2, c: 3 })
        }
      `,
      data: { field: 'value' },
    });
    expect(
      cache.readQuery({
        query: gql`
          query {
            field(a: { c: 3, d: 2 }, b: 1)
          }
        `,
      }),
    ).to.deep.include({ field: 'value' });
    expect(Object.keys(cache.extract())).to.have.members([
      'ROOT_QUERY',
      'ROOT_QUERY❖["field"]❖{"a":{"c":3,"d":2},"b":1}',
    ]);
  });
});
