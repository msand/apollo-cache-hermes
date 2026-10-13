import { expect } from 'chai';
import gql from 'graphql-tag';

import { CacheContext } from '../../../src/context';
import { ConflictingFieldsError } from '../../../src/errors';
import {
  alternativeForType,
  expandVariables,
  ParsedQueryNode,
  parseQuery,
  VariableArgument,
} from '../../../src/ParsedQueryNode';
import { fragmentMapForDocument, getOperationOrDie } from '../../../src/util';
import { strictConfig } from '../../helpers';

// GraphQL allows a response key to select different fields (or the same field
// with different arguments) under type conditions that cannot apply to the
// same object; Hermes keeps them as alternatives of the key's node.
describe(`parseQuery for response keys with alternative fields`, () => {
  const context = new CacheContext(strictConfig);
  const on = (...typeConditions: string[]) => [{ typeConditions }];
  function parseOperation(operationString: string) {
    const document = gql(operationString);
    const operation = getOperationOrDie(document);
    return parseQuery(context, fragmentMapForDocument(document), operation.selectionSet).parsedQuery;
  }

  it(`keeps different fields aliased alike under different type conditions`, () => {
    const parsed = parseOperation(`{
      search {
        ... on Book { size: pages }
        ... on Movie { size: runtime }
      }
    }`);
    const movie = new ParsedQueryNode(undefined, 'runtime', undefined, undefined, undefined, on('Movie'));
    const book = new ParsedQueryNode(undefined, 'pages', undefined, undefined, undefined, on('Book'), undefined, [
      movie,
    ]);
    expect(parsed.search.children).to.deep.eq({ size: book });
    expect(parsed.search.hasParameterizedChildren).to.eq(true);
  });

  it(`keeps the same field with different arguments under different type conditions`, () => {
    const parsed = parseOperation(`query ($n: Int) {
      search {
        ... on Book { related(limit: 2) { id } }
        ... on Movie { related(limit: $n) { id } }
        ... on Song { related(limit: 2) { id title } }
      }
    }`);
    const { related } = parsed.search.children!;
    expect(related.args).to.deep.eq({ limit: 2 });
    // The selections of the same field (and arguments) are merged.
    expect(related.conditions).to.deep.eq([{ typeConditions: ['Book'] }, { typeConditions: ['Song'] }]);
    expect(Object.keys(related.children!)).to.deep.eq(['id', 'title']);
    expect(related.alternatives).to.have.length(1);
    expect(related.alternatives![0].args).to.deep.eq({ limit: new VariableArgument('n') });
    expect(related.alternatives![0].conditions).to.deep.eq(on('Movie'));
  });

  it(`keeps alternatives through named fragments and nested selections`, () => {
    const parsed = parseOperation(`{
      search {
        ...book
        ...movie
      }
    }
    fragment book on Book { size: pages author { name } }
    fragment movie on Movie { size: runtime }`);
    const { size } = parsed.search.children!;
    expect(size.schemaName).to.eq('pages');
    expect(size.alternatives!.map(alternative => alternative.schemaName)).to.deep.eq(['runtime']);
  });

  it(`allows conflicting child selections of fields under disjoint type conditions`, () => {
    const parsed = parseOperation(`{
      search {
        ... on Book { info { size: pages } }
        ... on Movie { info { size: runtime } }
      }
    }`);
    const { info } = parsed.search.children!;
    // The children of each type condition apply to its objects...
    expect(info.variants!.map(variant => variant.children!.size.schemaName)).to.deep.eq(['pages', 'runtime']);
    // ...and the first to objects of unknown type.
    expect(info.children!.size.schemaName).to.eq('pages');
  });

  describe(`picking the alternative for an object's type`, () => {
    const parsed = parseOperation(`{
      search {
        ... on Book { size: pages }
        ... on Movie { size: runtime }
      }
    }`);
    // (Parsed operations are read-only.)
    const size = parsed.search.children!.size as ParsedQueryNode<any>;

    it(`picks the alternative whose type condition matches`, () => {
      expect(alternativeForType(context, size, 'Book')!.schemaName).to.eq('pages');
      expect(alternativeForType(context, size, 'Movie')!.schemaName).to.eq('runtime');
    });

    it(`picks none for other types`, () => {
      expect(alternativeForType(context, size, 'Song')).to.eq(undefined);
    });

    it(`picks the first for objects of unknown type`, () => {
      expect(alternativeForType(context, size, undefined)!.schemaName).to.eq('pages');
    });

    it(`picks the first matching one for types several alternatives match`, () => {
      const withPossibleTypes = new CacheContext({ ...strictConfig, possibleTypes: { Movie: ['Book'] } });
      expect(alternativeForType(withPossibleTypes, size, 'Book')!.schemaName).to.eq('pages');
    });
  });

  describe(`conflicts`, () => {
    function expectConflict(operation: string, message: RegExp) {
      expect(() => parseOperation(operation)).to.throw(ConflictingFieldsError, message);
    }

    it(`throws for different fields aliased alike without type conditions`, () => {
      expectConflict(`{ search { size: pages size: runtime } }`, /alias mismatch/);
    });

    it(`throws for different arguments without type conditions`, () => {
      expectConflict(`{ search { related(limit: 1) related(limit: 2) } }`, /parameterization mismatch/);
    });

    it(`throws for different fields under the same type condition`, () => {
      expectConflict(`{ search { ... on Book { size: pages } ... on Book { size: runtime } } }`, /alias mismatch/);
    });

    it(`throws for a field under a type condition and one without`, () => {
      expectConflict(`{ search { size: pages ... on Movie { size: runtime } } }`, /alias mismatch/);
    });

    it(`throws for a field under a type condition and one under nested type conditions including it`, () => {
      expectConflict(`{ search { ... on Media { size: bytes ... on Movie { size: runtime } } } }`, /alias mismatch/);
    });

    it(`throws for conflicting alternatives selected under the same type condition`, () => {
      expectConflict(
        `{
          search {
            ... on Book { size: pages }
            ... on Movie { size: runtime }
            ... on Movie { size: frames }
          }
        }`,
        /alias mismatch/,
      );
    });

    it(`throws for alternatives that differ only by @skip/@include directives`, () => {
      expectConflict(
        `query ($x: Boolean) { search { size: pages @include(if: $x) size: runtime @skip(if: $x) } }`,
        /alias mismatch/,
      );
    });

    it(`throws for conflicting child selections under the same type condition`, () => {
      expectConflict(
        `{ search { ... on Book { info { size: pages } } ... on Book { info { size: runtime } } } }`,
        /alias mismatch/,
      );
    });
  });

  describe(`expandVariables`, () => {
    it(`drops the alternatives skipped for the variables`, () => {
      const parsed = parseOperation(`query ($withBooks: Boolean, $n: Int) {
        search {
          ... on Book @include(if: $withBooks) { related(limit: 2) }
          ... on Movie { related(limit: $n) }
        }
      }`);
      const withBooks = expandVariables(parsed, { withBooks: true, n: 3 }).search.children!.related;
      expect(withBooks.args).to.deep.eq({ limit: 2 });
      expect(withBooks.alternatives!.map(alternative => alternative.args)).to.deep.eq([{ limit: 3 }]);

      const withoutBooks = expandVariables(parsed, { withBooks: false, n: 3 }).search.children!.related;
      expect(withoutBooks.args).to.deep.eq({ limit: 3 });
      expect(withoutBooks.alternatives).to.eq(undefined);
      expect(withoutBooks.conditions).to.deep.eq(on('Movie'));
    });
  });
});
