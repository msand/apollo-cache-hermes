import { expect } from 'chai';
import gql from 'graphql-tag';

import { CacheContext } from '../../../../src/context';

describe(`context.CacheContext`, () => {
  describe(`parseQuery`, () => {
    const simpleQuery = gql`
      {
        foo
      }
    `;

    it(`memoizes identical queries w/o variables`, () => {
      const context = new CacheContext();
      const parsed1 = context.parseOperation({ rootId: 'root', document: simpleQuery });
      const parsed2 = context.parseOperation({ rootId: 'root', document: simpleQuery });

      expect(parsed1).to.eq(parsed2);
    });

    it(`memoizes identical queries w/ the same variables`, () => {
      const context = new CacheContext();
      const parsed1 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a: 1 } });
      const parsed2 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a: 1 } });

      expect(parsed1).to.eq(parsed2);
    });

    it(`considers the rootId part of a query's identity`, () => {
      const context = new CacheContext();
      const parsed1 = context.parseOperation({ rootId: 'root1', document: simpleQuery, variables: { a: 1 } });
      const parsed2 = context.parseOperation({ rootId: 'root2', document: simpleQuery, variables: { a: 1 } });

      expect(parsed1).to.not.eq(parsed2);
    });

    it(`considers variables part of a query's identity`, () => {
      const context = new CacheContext();
      const parsed1 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a: 1 } });
      const parsed2 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a: 2 } });

      expect(parsed1).to.not.eq(parsed2);
    });

    it(`doesn't get tripped up by undefined variables`, () => {
      const context = new CacheContext();
      const parsed1 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a: 1 } });
      const parsed2 = context.parseOperation({ rootId: 'root', document: simpleQuery });

      expect(parsed1).to.not.eq(parsed2);
    });

    it(`memoizes queries w/ equal variables in different objects (in any key order)`, () => {
      const context = new CacheContext();
      const parsed1 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a: 1, b: 2 } });
      const parsed2 = context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { b: 2, a: 1 } });

      expect(parsed1).to.eq(parsed2);
    });

    it(`eventually drops the operations of variables that are no longer used`, () => {
      const context = new CacheContext();
      const parse = (a: number) => context.parseOperation({ rootId: 'root', document: simpleQuery, variables: { a } });
      const first = parse(0);
      const kept = parse(1);
      for (let a = 2; a < 2500; a++) {
        parse(a);
        // Operations in use are kept.
        if (a % 100 === 0) expect(parse(1)).to.eq(kept);
      }

      expect(parse(2499)).to.eq(parse(2499));
      expect(parse(1)).to.eq(kept);
      expect(parse(0)).to.not.eq(first);
      expect(parse(0).variables).to.deep.eq({ a: 0 });
    });
  });
});
