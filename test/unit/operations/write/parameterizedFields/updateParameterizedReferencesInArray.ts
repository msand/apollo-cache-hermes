import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { nodeIdForParameterizedValue } from '../../../../../src/operations/SnapshotEditor';
import { write } from '../../../../../src/operations';
import { NodeId, StaticNodeId } from '../../../../../src/schema';
import { query, strictConfig } from '../../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

// These are really more like integration tests, given the underlying machinery.
//
// It just isn't very fruitful to unit test the individual steps of the write
// workflow in isolation, given the contextual state that must be passed around.
describe(`operations.write`, () => {

  const context = new CacheContext(strictConfig);
  const empty = new GraphSnapshot();

  describe(`updates parameterized references in an array`, () => {

    let baseline: GraphSnapshot, snapshot: GraphSnapshot, parameterizedId: NodeId;
    beforeAll(() => {
      const parameterizedQuery = query(`query getAFoo($id: ID!) {
        foo(id: $id, withExtra: true) {
          id
          name
          extra
        }
      }`, { id: 1 });

      parameterizedId = nodeIdForParameterizedValue(QueryRootId, ['foo'], { id: 1, withExtra: true });

      const baselineResult = write(context, empty, parameterizedQuery, {
        foo: [
          { id: 1, name: 'Foo', extra: false },
          { id: 2, name: 'Bar', extra: true },
          { id: 3, name: 'Baz', extra: false },
        ],
      });
      baseline = baselineResult.snapshot;

      const result = write(context, baseline, parameterizedQuery, {
        foo: [
          { id: 1, name: 'Foo', extra: true },
          { id: 2, name: 'Bar', extra: false },
          { id: 3, name: 'Baz', extra: true },
        ],
      });
      snapshot = result.snapshot;
    });

    it(`writes nodes for each entity`, () => {
      jestExpect(baseline.getNodeData('1')).toEqual({ id: 1, name: 'Foo', extra: false });
      jestExpect(baseline.getNodeData('2')).toEqual({ id: 2, name: 'Bar', extra: true });
      jestExpect(baseline.getNodeData('3')).toEqual({ id: 3, name: 'Baz', extra: false });
    });

    it(`updates nodes for each entity`, () => {
      jestExpect(snapshot.getNodeData('1')).toEqual({ id: 1, name: 'Foo', extra: true });
      jestExpect(snapshot.getNodeData('2')).toEqual({ id: 2, name: 'Bar', extra: false });
      jestExpect(snapshot.getNodeData('3')).toEqual({ id: 3, name: 'Baz', extra: true });
    });

    it(`writes an array for the parameterized node`, () => {
      jestExpect(snapshot.getNodeData(parameterizedId)).toEqual([
        { id: 1, name: 'Foo', extra: true },
        { id: 2, name: 'Bar', extra: false },
        { id: 3, name: 'Baz', extra: true },
      ]);
    });

  });
});
