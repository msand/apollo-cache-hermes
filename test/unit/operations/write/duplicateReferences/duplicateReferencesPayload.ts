import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { write } from '../../../../../src/operations';
import { StaticNodeId } from '../../../../../src/schema';
import {mapToEntries, query, strictConfig} from '../../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

describe(`operations.write`, () => {

  const context = new CacheContext(strictConfig);
  const empty = new GraphSnapshot();
  const listQuery = query(`{
    foo {
      id
      bar { id }
    }
    baz {
      id
      bar { id }
    }
  }`);

  describe(`write duplicate-references payload`, () => {

    let snapshot: GraphSnapshot;
    beforeAll(() => {
      const result = write(context, empty, listQuery, {
        foo: [
          { id: 'a', bar: { id: 1 } },
          { id: 'a', bar: { id: 1 } },
          { id: 'b', bar: { id: 1 } },
          { id: 'a', bar: { id: 1 } },
          { id: 'b', bar: { id: 1 } },
        ],
        baz: {
          id: 'a', bar: { id: 1 },
        },
      });
      snapshot = result.snapshot;
    });

    it(`writes the complete graph`, () => {
      jestExpect(snapshot.getNodeData(QueryRootId)).toEqual({
        foo: [
          { id: 'a', bar: { id: 1 } },
          { id: 'a', bar: { id: 1 } },
          { id: 'b', bar: { id: 1 } },
          { id: 'a', bar: { id: 1 } },
          { id: 'b', bar: { id: 1 } },
        ],
        baz: {
          id: 'a', bar: { id: 1 },
        },
      });
    });

    it(`doesn't insert duplicate outbound references`, () => {
      jestExpect(mapToEntries(snapshot.getNodeSnapshot('a')!.outbound)).toEqual(jestExpect.arrayContaining([
        { id: '1', path: ['bar'] },
      ]));
      jestExpect(mapToEntries(snapshot.getNodeSnapshot('b')!.outbound)).toEqual(jestExpect.arrayContaining([
        { id: '1', path: ['bar'] },
      ]));
    });

    it(`doesn't insert duplicate inbound references for targets`, () => {
      jestExpect(mapToEntries(snapshot.getNodeSnapshot('1')!.inbound)).toEqual(jestExpect.arrayContaining([
        { id: 'a', path: ['bar'] },
        { id: 'b', path: ['bar'] },
      ]));
    });
  });
});
