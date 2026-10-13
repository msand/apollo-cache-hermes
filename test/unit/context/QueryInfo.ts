import { expect } from 'chai';
import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

import { buildRawOperationFromQuery } from '../../../src/apollo/util';
import { CacheContext, QueryInfo } from '../../../src/context';
import { strictConfig } from '../../helpers';

describe(`context.QueryInfo`, () => {
  const context = new CacheContext(strictConfig);

  describe(`with a valid query document`, () => {
    let query: DocumentNode, info: QueryInfo;
    beforeAll(() => {
      query = gql`
        fragment completeStuff on Stuff {
          id
          name
        }

        query getThings($ids: [ID]!) {
          stuff {
            ...completeStuff
          }
          things(ids: $ids) {
            ...completeThing
          }
        }

        fragment completeThing on Thing {
          id
          name
          extra
        }
      `;

      info = new QueryInfo(context, buildRawOperationFromQuery(query));
    });

    it(`hangs onto the document, with no changes`, () => {
      expect(info.document).to.eq(query);
    });

    it(`extracts the operation`, () => {
      expect(info.operation.name!.value).to.eq('getThings');
      expect(info.operation.operation).to.eq('query');
    });

    it(`extracts the operation name`, () => {
      expect(info.operationName).to.eq('getThings');
    });

    it(`builds a fragment map`, () => {
      expect(info.fragmentMap).to.have.all.keys('completeStuff', 'completeThing');
    });

    it(`collects the variables that are used`, () => {
      expect(info.variables).to.deep.eq(new Set(['ids']));
    });
  });

  describe(`with variable defaults`, () => {
    let query: DocumentNode, info: QueryInfo;
    beforeAll(() => {
      query = gql`
        mutation makeCheesy($ids: [ID]!, $name: String = "Munster", $stinky: Boolean) {
          updateCheesiness(ids: $ids, name: $name, stinky: $stinky)
        }
      `;

      info = new QueryInfo(context, buildRawOperationFromQuery(query));
    });

    it(`collects the variables that are used`, () => {
      expect(info.variables).to.deep.eq(new Set(['ids', 'name', 'stinky']));
    });

    it(`collects default values for operation parameters`, () => {
      expect(info.variableDefaults['name']).to.eq('Munster');
    });

    // Like InMemoryCache, optional variables without a default are undefined.
    it(`excludes optional parameters without a default value`, () => {
      expect(info.variableDefaults).to.not.have.key('stinky');
    });

    it(`excludes required parameters from the defaults`, () => {
      expect(info.variableDefaults).to.not.have.key('ids');
    });
  });

  // Like InMemoryCache, Hermes doesn't validate variable declarations: a
  // variable that is used but neither declared nor passed reads as undefined.
  describe(`undeclared variables`, () => {
    it(`allows variables that are used but not declared`, () => {
      expect(() => {
        new QueryInfo(
          context,
          buildRawOperationFromQuery(gql`
            query whoops($foo: Number) {
              thing(foo: $foo, bar: $bar, baz: $baz)
            }
          `),
        );
      }).to.not.throw();
    });

    it(`allows variables that are used but not declared, via fragments`, () => {
      expect(() => {
        new QueryInfo(
          context,
          buildRawOperationFromQuery(gql`
            query whoops($foo: Number) {
              thing {
                ...stuff
              }
            }

            fragment stuff on Thing {
              stuff(foo: $foo, bar: $bar, baz: $baz)
            }
          `),
        );
      }).to.not.throw();
    });

    it(`collects undeclared variables with the used ones`, () => {
      const info = new QueryInfo(
        context,
        buildRawOperationFromQuery(gql`
          query whoops($foo: Number) {
            thing(foo: $foo, bar: $bar)
          }
        `),
      );
      expect(info.variables).to.deep.eq(new Set(['foo', 'bar']));
      expect(info.variableDefaults).to.deep.eq({});
    });
  });
});
