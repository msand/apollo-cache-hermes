import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { write } from '../../../../../src/operations';
import { NodeId, StaticNodeId } from '../../../../../src/schema';
import { mapToEntries, query, strictConfig } from '../../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

// These are really more like integration tests, given the underlying machinery.
//
// It just isn't very fruitful to unit test the individual steps of the write
// workflow in isolation, given the contextual state that must be passed around.
describe(`operations.write`, () => {

  const context = new CacheContext(strictConfig);
  const empty = new GraphSnapshot();
  const rootValuesQuery = query(`{
    foo {
      id
      name
    }
    bar {
      id
      name
    }
  }`);

  describe(`orphans a subgraph`, () => {
    let baseline: GraphSnapshot, snapshot: GraphSnapshot, editedNodeIds: Set<NodeId>;
    beforeAll(() => {
      const baselineResult = write(context, empty, rootValuesQuery, {
        foo: { id: 1, name: 'Foo' },
        bar: { id: 2, name: 'Bar' },
      });
      baseline = baselineResult.snapshot;

      const result = write(context, baseline, query(`{ bar { id } }`), {
        bar: null,
      });
      snapshot = result.snapshot;
      editedNodeIds = result.editedNodeIds;
    });

    it(`replaces the reference with null`, () => {
      jestExpect(snapshot.getNodeData(QueryRootId)).toEqual({
        foo: { id: 1, name: 'Foo' },
        bar: null,
      });
    });

    it(`updates outbound references`, () => {
      const queryRoot = snapshot.getNodeSnapshot(QueryRootId)!;
      jestExpect(mapToEntries(queryRoot.outbound)).toEqual(jestExpect.arrayContaining([{ id: '1', path: ['foo'] }]));
    });

    it(`marks the container and orphaned node as edited`, () => {
      jestExpect(Array.from(editedNodeIds)).toEqual(jestExpect.arrayContaining([QueryRootId, '2']));
    });

    it(`contains the correct nodes`, () => {
      jestExpect(snapshot.allNodeIds()).toEqual(jestExpect.arrayContaining([QueryRootId, '1']));
    });

  });

  describe(`when orphaning a subgraph`, () => {
    let baseline: GraphSnapshot, snapshot: GraphSnapshot, editedNodeIds: Set<NodeId>;
    beforeAll(() => {
      const subgraphQuery = query(`{
        foo {
          id
          name
          two {
            id
          }
        }
        bar {
          id
          one {
            id
          }
          two {
            id
          }
          three {
            id
            foo {
              id
            }
          }
        }
      }`);
      const baselineResult = write(context, empty, subgraphQuery, {
        foo: {
          id: 1,
          name: 'Foo',
          two: { id: 222 },
        },
        bar: {
          id: 2,
          one: { id: 111 },
          two: { id: 222 },
          three: {
            id: 333,
            foo: { id: 1 },
          },
        },
      });
      baseline = baselineResult.snapshot;

      const result = write(context, baseline, subgraphQuery, {
        foo: {
          id: 1,
          name: 'Foo',
          two: null,
        },
        bar: null,
      });
      snapshot = result.snapshot;
      editedNodeIds = result.editedNodeIds;
    });

    it(`replaces the reference with null`, () => {
      jestExpect(snapshot.getNodeData(QueryRootId)).toEqual({
        foo: {
          id: 1,
          name: 'Foo',
          two: null,
        },
        bar: null,
      });
    });

    it(`preserves nodes that only lost some of their inbound references`, () => {
      jestExpect(snapshot.getNodeData('1')).toEqual({ id: 1, name: 'Foo', two: null });
    });

    it(`updates outbound references`, () => {
      const queryRoot = snapshot.getNodeSnapshot(QueryRootId)!;
      jestExpect(mapToEntries(queryRoot.outbound)).toEqual(jestExpect.arrayContaining([{ id: '1', path: ['foo'] }]));
    });

    it(`marks the container and all orphaned nodes as edited`, () => {
      jestExpect(Array.from(editedNodeIds)).toEqual(jestExpect.arrayContaining([QueryRootId, '1', '2', '111', '222', '333']));
    });

    it(`contains the correct nodes`, () => {
      jestExpect(snapshot.allNodeIds()).toEqual(jestExpect.arrayContaining([QueryRootId, '1']));
    });

  });
});
