import { expect } from 'chai';

import { Cache } from '../../../src';
import { query } from '../../helpers';

describe(`gc`, () => {

  let cache: Cache;
  beforeEach(() => {
    cache = new Cache({
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        group: jest.fn(),
        groupEnd: jest.fn(),
      },
      entityIdForNode: (obj) => {
        const id = obj?.id;
        return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
      },
      addTypename: false,
    });
  });

  // Cyclic refs survive write-time orphan removal, so gc() is needed to collect them
  const pairedQuery = query(`{
    items {
      id
      name
      friend {
        id
      }
    }
  }`);

  it(`collects orphaned entities with cyclic references`, () => {
    cache.write(pairedQuery, {
      items: [
        { id: 'a', name: 'Alice', friend: { id: 'b' } },
        { id: 'b', name: 'Bob', friend: { id: 'a' } },
      ],
    });

    expect(cache.getEntity('a')).to.deep.include({ id: 'a', name: 'Alice' });
    expect(cache.getEntity('b')).to.deep.include({ id: 'b', name: 'Bob' });

    // Orphan both by clearing items
    cache.write(pairedQuery, { items: [] });

    const removed = cache.gc();
    expect(removed).to.include.members(['a', 'b']);
    expect(cache.getEntity('a')).to.eq(undefined);
    expect(cache.getEntity('b')).to.eq(undefined);
  });

  it(`returns empty array when there are no orphans`, () => {
    cache.write(pairedQuery, {
      items: [{ id: 'a', name: 'Alice', friend: null }],
    });

    const removed = cache.gc();
    expect(removed).to.deep.eq([]);
    expect(cache.getEntity('a')).to.deep.include({ id: 'a', name: 'Alice' });
  });

  it(`collects multiple independent orphan clusters`, () => {
    // Two separate cycles: a↔b and c↔d
    cache.write(pairedQuery, {
      items: [
        { id: 'a', name: 'A', friend: { id: 'b' } },
        { id: 'b', name: 'B', friend: { id: 'a' } },
        { id: 'c', name: 'C', friend: { id: 'd' } },
        { id: 'd', name: 'D', friend: { id: 'c' } },
      ],
    });

    cache.write(pairedQuery, { items: [] });

    const removed = cache.gc();
    expect(removed).to.include.members(['a', 'b', 'c', 'd']);
    expect(cache.getEntity('a')).to.eq(undefined);
    expect(cache.getEntity('c')).to.eq(undefined);
  });

  it(`collects deep cyclic chains of orphans`, () => {
    const chainQuery = query(`{
      root {
        id
        child {
          id
          grandchild {
            id
            backref {
              id
            }
          }
        }
      }
    }`);

    // A→B→C→A cycle
    cache.write(chainQuery, {
      root: {
        id: 'a',
        child: {
          id: 'b',
          grandchild: {
            id: 'c',
            backref: { id: 'a' },
          },
        },
      },
    });

    cache.write(chainQuery, { root: null });

    const removed = cache.gc();
    expect(removed).to.include.members(['a', 'b', 'c']);
  });

  it(`does not collect entities still reachable via references`, () => {
    // r↔a are paired (mutual refs keep both alive through write-time GC)
    // orphan1↔orphan2 are paired but get removed from items
    cache.write(pairedQuery, {
      items: [
        { id: 'r', name: 'Reachable', friend: { id: 'a' } },
        { id: 'a', name: 'Alice', friend: { id: 'r' } },
        { id: 'orphan1', name: 'O1', friend: { id: 'orphan2' } },
        { id: 'orphan2', name: 'O2', friend: { id: 'orphan1' } },
      ],
    });

    // Keep r and a, drop orphan1 and orphan2
    cache.write(pairedQuery, {
      items: [
        { id: 'r', name: 'Reachable', friend: { id: 'a' } },
        { id: 'a', name: 'Alice', friend: { id: 'r' } },
      ],
    });

    const removed = cache.gc();
    expect(removed).to.include.members(['orphan1', 'orphan2']);
    expect(removed).to.not.include('r');
    expect(removed).to.not.include('a');
    expect(cache.getEntity('a')).to.deep.include({ id: 'a', name: 'Alice' });
  });

  it(`collects orphans that reference reachable nodes, keeping reachable intact`, () => {
    const refQuery = query(`{
      items {
        id
        name
        ref {
          id
          name
        }
        friend {
          id
        }
      }
    }`);

    // orphan1↔orphan2 form a cycle and orphan1 also references 'shared'
    // r also references 'shared' and is kept in items
    cache.write(refQuery, {
      items: [
        { id: 'orphan1', name: 'O1', ref: { id: 'shared', name: 'Shared' }, friend: { id: 'orphan2' } },
        { id: 'orphan2', name: 'O2', ref: null, friend: { id: 'orphan1' } },
        { id: 'r', name: 'Reachable', ref: { id: 'shared', name: 'Shared' }, friend: null },
      ],
    });

    // Drop orphan1 and orphan2
    cache.write(refQuery, {
      items: [
        { id: 'r', name: 'Reachable', ref: { id: 'shared', name: 'Shared' }, friend: null },
      ],
    });

    const removed = cache.gc();
    expect(removed).to.include.members(['orphan1', 'orphan2']);
    expect(removed).to.not.include('r');
    expect(removed).to.not.include('shared');
    expect(cache.getEntity('shared')).to.deep.include({ id: 'shared', name: 'Shared' });
  });

  it(`preserves optimistic updates after gc`, () => {
    const simpleQuery = query(`{
      items {
        id
        name
      }
    }`);

    cache.write(simpleQuery, {
      items: [{ id: 'a', name: 'Alice' }],
    });

    // Add optimistic update
    cache.transaction(true, '123', (t) => {
      t.write(simpleQuery, {
        items: [{ id: 'a', name: 'Alice-optimistic' }],
      });
    });

    const removed = cache.gc();
    expect(removed).to.deep.eq([]);

    // Optimistic read should still return the optimistic data
    const result = cache.read(simpleQuery, true);
    expect(result.result).to.deep.eq({
      items: [{ id: 'a', name: 'Alice-optimistic' }],
    });
  });

  // Skipped: wall-clock thresholds are machine-dependent and flaky in CI.
  // Useful for verifying gc() scales linearly with orphan count.
  it.skip(`completes gc of many orphans within time budget`, () => {
    const COUNT = 2000;

    const entityQuery = query(`{
      items {
        id
        value
        next {
          id
        }
      }
    }`);

    // Create entities in a ring: each references the next, last references first
    const items = Array.from({ length: COUNT }, (_, i) => ({
      id: `entity-${i}`,
      value: i,
      next: { id: `entity-${(i + 1) % COUNT}` },
    }));

    cache.write(entityQuery, { items });

    // Orphan all entities
    cache.write(entityQuery, { items: [] });

    const start = Date.now();
    const removed = cache.gc();
    const elapsed = Date.now() - start;

    expect(removed).to.have.length(COUNT);
    expect(elapsed).to.be.lessThan(50);
  });

});
