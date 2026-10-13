import { expect } from 'chai';
import gql from 'graphql-tag';

import { CacheContext } from '../../../src/context';
import { ParsedQueryNode, parseQuery, VariableArgument } from '../../../src/ParsedQueryNode';
import { JsonScalar } from '../../../src/primitive';
import { fragmentMapForDocument, getOperationOrDie } from '../../../src/util';
import { strictConfig } from '../../helpers';

describe(`parseQuery for queries with fragments`, () => {
  const context = new CacheContext(strictConfig);
  // Fields of fragments on Foo are only selected for Foo objects.
  const onFoo = [{ typeConditions: ['Foo'] }];
  function parseOperation(operationString: string) {
    const document = gql(operationString);
    const operation = getOperationOrDie(document);
    const FragmentMap = fragmentMapForDocument(document);
    return parseQuery(context, FragmentMap, operation.selectionSet);
  }

  it(`parses queries with static fragments`, () => {
    const operation = `
      query getThings {
        foo { ...aFoo }
      }

      fragment aFoo on Foo {
        id
        name
      }
    `;
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode({
          id: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, onFoo),
          name: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, onFoo),
        }),
      },
      variables: new Set(),
    });
  });

  it(`parses queries with overlapping fragments`, () => {
    const operation = `
      query getThings {
        foo {
          ...smallFoo
          ...bigFoo
        }
      }

      fragment smallFoo on Foo {
        id
      }

      fragment bigFoo on Foo {
        id
        name
      }
    `;
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode({
          id: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, onFoo),
          name: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, onFoo),
        }),
      },
      variables: new Set(),
    });
  });

  it(`parses queries with inline fragments`, () => {
    const operation = `
      query getThings {
        foo {
          ... on Foo {
            id
          }
          ... on Bar {
            id
            name
          }
        }
      }
    `;
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode({
          id: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, [
            { typeConditions: ['Foo'] },
            { typeConditions: ['Bar'] },
          ]),
          name: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, [
            { typeConditions: ['Bar'] },
          ]),
        }),
      },
      variables: new Set(),
    });
  });

  it(`parses fragments with parameterized fields`, () => {
    const operation = `
      query getThings {
        foo { ...aFoo }
      }

      fragment aFoo on Foo {
        bar(extra: true) {
          baz
        }
      }
    `;
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode(
          {
            bar: new ParsedQueryNode(
              {
                baz: new ParsedQueryNode(),
              },
              undefined,
              { extra: true },
              undefined,
              undefined,
              onFoo,
            ),
          },
          undefined,
          undefined,
          true,
        ),
      },
      variables: new Set(),
    });
  });

  it(`parses fragments with variables`, () => {
    const operation = `
      query getThings($count: Int) {
        foo { ...aFoo }
      }

      fragment aFoo on Foo {
        bar(limit: $count) {
          baz
        }
      }
    `;
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode(
          {
            bar: new ParsedQueryNode<JsonScalar | VariableArgument>(
              {
                baz: new ParsedQueryNode(),
              },
              undefined,
              { limit: new VariableArgument('count') },
              undefined,
              undefined,
              onFoo,
            ),
          },
          undefined,
          undefined,
          true,
        ),
      },
      variables: new Set(['count']),
    });
  });

  it(`keeps the type conditions of nested fragments`, () => {
    const operation = `
      query getThings {
        foo {
          id
          ... on Bar {
            ...aBaz
          }
        }
      }

      fragment aBaz on Baz {
        id
        name
      }
    `;
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode({
          id: new ParsedQueryNode(),
          name: new ParsedQueryNode(undefined, undefined, undefined, undefined, undefined, [
            { typeConditions: ['Bar', 'Baz'] },
          ]),
        }),
      },
      variables: new Set(),
    });
  });

  it(`keeps the child selections of fields selected under different type conditions apart`, () => {
    const operation = `
      query getThings {
        foo {
          bar { id }
          ... on Foo {
            bar { name }
          }
          ... on Baz {
            bar { size }
          }
        }
      }
    `;
    const onBaz = [{ typeConditions: ['Baz'] }];
    expect(parseOperation(operation)).to.deep.eq({
      parsedQuery: {
        foo: new ParsedQueryNode({
          bar: new ParsedQueryNode(
            { id: new ParsedQueryNode(), name: new ParsedQueryNode(), size: new ParsedQueryNode() },
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            [
              { conditions: undefined, children: { id: new ParsedQueryNode() } },
              { conditions: onFoo, children: { name: new ParsedQueryNode() } },
              { conditions: onBaz, children: { size: new ParsedQueryNode() } },
            ],
          ),
        }),
      },
      variables: new Set(),
    });
  });

  it(`does not keep variants for fields selected under the same conditions`, () => {
    const operation = `
      query getThings {
        foo {
          ... on Foo {
            bar { id }
          }
          ... on Foo {
            bar { name }
          }
        }
      }
    `;
    expect(parseOperation(operation).parsedQuery.foo.children!.bar.variants).to.eq(undefined);
  });

  it(`complains if fragments are not declared`, () => {
    const operation = `
      query getThings {
        foo { ...aFoo }
      }
    `;
    expect(() => {
      parseOperation(operation);
    }).to.throw(/aFoo/i);
  });

  it(`complains if parameters do not match`, () => {
    const operation = `
      query getThings {
        foo {
          ...fooOne
          ...fooTwo
        }
      }

      fragment fooOne on Foo {
        bar(limit: 1)
      }

      fragment fooTwo on Foo {
        bar(limit: 2)
      }
    `;
    expect(() => {
      parseOperation(operation);
    }).to.throw(/foo\.bar/i);
  });

  it(`complains if aliases do not match`, () => {
    const operation = `
      query getThings {
        foo {
          ...fooOne
          ...fooTwo
        }
      }

      fragment fooOne on Foo {
        bar: fizz
      }

      fragment fooTwo on Foo {
        bar: buzz
      }
    `;
    expect(() => {
      parseOperation(operation);
    }).to.throw(/foo\.bar/i);
  });
});
