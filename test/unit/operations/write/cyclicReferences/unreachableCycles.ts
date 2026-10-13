import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { write } from '../../../../../src/operations/write';
import { NodeId, StaticNodeId } from '../../../../../src/schema';
import { createSnapshot, query, strictConfig, updateSnapshot } from '../../../../helpers';

const { QueryRoot: QueryRootId } = StaticNodeId;

describe(`operations.write`, () => {
  describe(`unreachable reference cycles`, () => {
    describe(`a self-reference`, () => {
      const selfQuery = `{
        foo {
          id
          self { id }
        }
      }`;
      let snapshot: GraphSnapshot, editedNodeIds: Set<NodeId>;
      beforeAll(() => {
        const baseline = createSnapshot({ foo: { id: 1, self: { id: 1 } } }, selfQuery).snapshot;
        jestExpect(baseline.allNodeIds().sort()).toEqual(['1', QueryRootId]);

        const result = updateSnapshot(baseline, { foo: null }, selfQuery);
        snapshot = result.snapshot;
        editedNodeIds = result.editedNodeIds;
      });

      it(`removes the entity`, () => {
        jestExpect(snapshot.allNodeIds()).toEqual([QueryRootId]);
      });

      it(`marks it as edited`, () => {
        jestExpect(Array.from(editedNodeIds).sort()).toEqual(['1', QueryRootId]);
      });
    });

    describe(`a cycle hanging off a reachable entity`, () => {
      const cycleQuery = `{
        foo {
          id
          bar {
            id
            baz {
              id
              bar { id }
            }
          }
        }
        other {
          id
          baz { id }
        }
      }`;
      let baseline: GraphSnapshot;
      beforeAll(() => {
        baseline = createSnapshot(
          {
            foo: { id: 1, bar: { id: 2, baz: { id: 3, bar: { id: 2 } } } },
            other: { id: 4, baz: { id: 3 } },
          },
          cycleQuery,
        ).snapshot;
        jestExpect(baseline.allNodeIds().sort()).toEqual(['1', '2', '3', '4', QueryRootId]);
      });

      it(`keeps the cycle while it is reachable`, () => {
        const { snapshot } = updateSnapshot(baseline, { foo: null }, `{ foo { id } }`);
        jestExpect(snapshot.allNodeIds().sort()).toEqual(['2', '3', '4', QueryRootId]);
        jestExpect((snapshot.getNodeData('4') as any).baz.bar.id).toBe(2);
      });

      it(`removes the cycle once it is unreachable`, () => {
        const { snapshot, editedNodeIds } = updateSnapshot(
          baseline,
          { foo: null, other: null },
          `{ foo { id } other { id } }`,
        );
        jestExpect(snapshot.allNodeIds()).toEqual([QueryRootId]);
        jestExpect(Array.from(editedNodeIds).sort()).toEqual(['1', '2', '3', '4', QueryRootId]);
      });

      it(`keeps a cycle that is still referenced by an entity outside it`, () => {
        // 1 → 2 ⇄ 3, and 4 → 3; dropping 1 leaves 2 and 3 reachable through 4.
        const { snapshot } = updateSnapshot(baseline, { foo: null }, `{ foo { id } }`);
        jestExpect(snapshot.getNodeSnapshot('3')!.inbound!.size).toBe(2);
      });
    });

    describe(`a cycle reachable only through a parameterized field`, () => {
      const paramQuery = `{
        foo(id: 1) {
          id
          bar {
            id
            foo { id }
          }
        }
        other { id }
      }`;
      const fooId = `${QueryRootId}❖["foo"]❖{"id":1}`;
      let baseline: GraphSnapshot, withoutOther: GraphSnapshot;
      beforeAll(() => {
        baseline = createSnapshot(
          { foo: { id: 1, bar: { id: 2, foo: { id: 1 } } }, other: { id: 2 } },
          paramQuery,
        ).snapshot;
        jestExpect(baseline.allNodeIds().sort()).toEqual(['1', '2', QueryRootId, fooId].sort());
        withoutOther = updateSnapshot(baseline, { other: null }, `{ other { id } }`).snapshot;
      });

      it(`keeps the cycle while the parameterized field references it`, () => {
        jestExpect(withoutOther.allNodeIds().sort()).toEqual(['1', '2', QueryRootId, fooId].sort());
      });

      it(`removes the cycle once the parameterized field no longer references it`, () => {
        const { snapshot, editedNodeIds } = updateSnapshot(withoutOther, { foo: null }, `{ foo(id: 1) { id } }`);
        jestExpect(snapshot.allNodeIds().sort()).toEqual([QueryRootId, fooId].sort());
        jestExpect(snapshot.getNodeData(fooId)).toBe(null);
        jestExpect(Array.from(editedNodeIds)).toEqual(jestExpect.arrayContaining(['1', '2', fooId]));
      });
    });

    describe(`a retained cycle`, () => {
      const cycleQuery = `{
        foo {
          id
          bar {
            id
            foo { id }
          }
        }
      }`;

      it(`is kept when one of its nodes is retained`, () => {
        const context = new CacheContext(strictConfig);
        const baseline = createSnapshot({ foo: { id: 1, bar: { id: 2, foo: { id: 1 } } } }, cycleQuery).snapshot;
        const raw = query(`{ foo { id } }`);
        const { snapshot } = write(
          context,
          baseline,
          { ...raw, document: context.transformDocument(raw.document) },
          { foo: null },
          false,
          id => id === '2',
        );
        jestExpect(snapshot.allNodeIds().sort()).toEqual(['1', '2', QueryRootId]);
      });
    });
  });
});
