import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { write } from '../../../../../src/operations';
import { NodeId, StaticNodeId } from '../../../../../src/schema';
import { mapToEntries2, query, strictConfig } from '../../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

// These are really more like integration tests, given the underlying machinery.
//
// It just isn't very fruitful to unit test the individual steps of the write
// workflow in isolation, given the contextual state that must be passed around.
describe(`operations.write`, () => {

  const context = new CacheContext(strictConfig);
  const empty = new GraphSnapshot();
  const entityQuery = query(`{
    foo {
      id
      name
    }
    bar {
      id
      name
    }
  }`);
  const entityIdQuery = query(`{
    foo { id }
    bar { id }
  }`);

  describe(`reference swaps`, () => {
    let baseline: GraphSnapshot, snapshot: GraphSnapshot, editedNodeIds: Set<NodeId>;
    beforeAll(() => {
      const baselineResult = write(context, empty, entityQuery, {
        foo: { id: 1, name: 'Foo' },
        bar: { id: 2, name: 'Bar' },
      });
      baseline = baselineResult.snapshot;

      const result = write(context, baseline, entityIdQuery, {
        foo: { id: 2 },
        bar: { id: 1 },
      });
      snapshot = result.snapshot;
      editedNodeIds = result.editedNodeIds;
    });

    it(`previous versions still have original value`, () => {
      jestExpect(baseline.getNodeData(QueryRootId)).toEqual({
        foo: { id: 1, name: 'Foo' },
        bar: { id: 2, name: 'Bar' },
      });
    });

    it(`preserves unedited nodes from the parent`, () => {
      jestExpect(baseline.getNodeData('1')).toBe(snapshot.getNodeData('1'));
      jestExpect(baseline.getNodeData('2')).toBe(snapshot.getNodeData('2'));
    });

    it(`updates outbound references`, () => {
      const queryRoot = snapshot.getNodeSnapshot(QueryRootId)!;
      jestExpect(mapToEntries2(queryRoot.outbound)).toEqual(jestExpect.arrayContaining([
        { id: '2', path: ['foo'] },
        { id: '1', path: ['bar'] },
      ]));
      jestExpect(mapToEntries2(queryRoot.inbound)).toBe(undefined);
    });

    it(`updates inbound references`, () => {
      const foo = snapshot.getNodeSnapshot('1')!;
      const bar = snapshot.getNodeSnapshot('2')!;
      jestExpect(mapToEntries2(foo.inbound)).toEqual(jestExpect.arrayContaining([{ id: QueryRootId, path: ['bar'] }]));
      jestExpect(mapToEntries2(bar.inbound)).toEqual(jestExpect.arrayContaining([{ id: QueryRootId, path: ['foo'] }]));
    });

    it(`marks the container as edited`, () => {
      jestExpect(Array.from(editedNodeIds)).toEqual(jestExpect.arrayContaining([QueryRootId]));
    });

    it(`contains the correct nodes`, () => {
      jestExpect(snapshot.allNodeIds()).toEqual(jestExpect.arrayContaining([QueryRootId, '1', '2']));
    });
  });
});
