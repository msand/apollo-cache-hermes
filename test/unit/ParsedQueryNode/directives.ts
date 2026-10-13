import { expect } from 'chai';
import gql from 'graphql-tag';

import { CacheContext } from '../../../src/context';
import { ParsedQueryNode, parseQuery } from '../../../src/ParsedQueryNode';
import { fragmentMapForDocument, getOperationOrDie } from '../../../src/util';
import { strictConfig } from '../../helpers';

describe(`parseQuery with queries with directives`, () => {
  const context = new CacheContext(strictConfig);
  function parseOperation(operationString: string) {
    const document = gql(operationString);
    const operation = getOperationOrDie(document);
    const FragmentMap = fragmentMapForDocument(document);
    return parseQuery(context, FragmentMap, operation.selectionSet);
  }

  it(`collects variables in directives on fields`, () => {
    const operation = `{
      foo {
        bar @simple(arg: $varA)
        baz(bat: "bad") @complex(arg0: $varB, arg1: $varC)
      }
    }`;
    expect(parseOperation(operation).variables).to.deep.eq(new Set(['varA', 'varB', 'varC']));
  });

  it(`collects variables in directives in and on fragments`, () => {
    const operation = `
      query getThings {
        foo {
          ...smallFoo @simple(arg0: $varD)
          ...bigFoo
        }
      }

      fragment smallFoo on Foo {
        id
      }

      fragment bigFoo on Foo {
        id @simple(var0: $varA)
        name @complex(arg0: $varB, arg1: $varC)
      }
    `;
    expect(parseOperation(operation).variables).to.deep.eq(new Set(['varA', 'varB', 'varC', 'varD']));
  });

  it(`omits selections that are statically skipped`, () => {
    const operation = `
      query getThings {
        foo {
          id @include(if: true)
          name @skip(if: true)
          ...aFoo @include(if: false)
          ... @skip(if: false) {
            size
          }
        }
        bar @skip(if: true)
      }

      fragment aFoo on Foo {
        color
      }
    `;
    expect(parseOperation(operation).parsedQuery).to.deep.eq({
      foo: new ParsedQueryNode({
        id: new ParsedQueryNode(),
        size: new ParsedQueryNode(),
      }),
    });
  });

  it(`records selections that depend on variables as conditional`, () => {
    const operation = `
      query getThings($a: Boolean, $b: Boolean) {
        foo {
          id @include(if: $a)
          ... on Foo @skip(if: $b) {
            name
          }
        }
      }
    `;
    expect(parseOperation(operation).parsedQuery).to.deep.eq({
      foo: new ParsedQueryNode(
        {
          id: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, [
            { directives: [{ variable: 'a', include: true }] },
          ]),
          name: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, [
            { typeConditions: ['Foo'], directives: [{ variable: 'b', include: false }] },
          ]),
        },
        undefined,
        undefined,
        true,
      ),
    });
  });
});
