import { expect } from 'chai';
import { Cache as CacheInterface } from '@apollo/client';

import { query, silentConfig, strictConfig } from '../../helpers';
import { Cache } from '../../../src';
import { CacheContext } from '../../../src/context';
import { CacheTransaction } from '../../../src/CacheTransaction';
import { GraphSnapshot } from '../../../src/GraphSnapshot';
import { SnapshotEditor } from '../../../src/operations/SnapshotEditor';

describe(`Cache#batchEvict`, () => {

  const graph = query(`{
    things { __typename id name shared { __typename id name } }
    holder { __typename id items { __typename id name } }
  }`);

  const baseState = {
    things: [1, 2, 3, 4, 5].map(i => ({
      __typename: 'Thing', id: `${i}`, name: `Thing ${i}`, shared: { __typename: 'Shared', id: 's', name: 'Shared' },
    })),
    holder: {
      __typename: 'Holder',
      id: 'h',
      items: [1, 2, 3].map(i => ({ __typename: 'Item', id: `i${i}`, name: `Item ${i}` })),
    },
  };

  function createCache(config: CacheContext.Configuration = strictConfig) {
    const cache = new Cache(config);
    cache.write(graph, baseState);
    return cache;
  }

  function evictSeparately(cache: Cache, ids: string[]) {
    ids.forEach(id => cache.evict({ id }));
  }

  let commit: jest.SpyInstance;
  beforeEach(() => {
    commit = jest.spyOn(SnapshotEditor.prototype, 'commit');
  });

  afterEach(() => {
    commit.mockRestore();
  });

  it(`commits several evicts once, leaving the same cache as separate evicts`, () => {
    const ids = ['1', '3', '5'];
    const expected = createCache();
    evictSeparately(expected, ids);
    const cache = createCache();

    commit.mockClear();
    expect(cache.batchEvict(ids)).to.eq(true);

    expect(commit.mock.calls.length).to.eq(1);
    expect(cache.extract(false)).to.deep.eq(expected.extract(false));
  });

  // The evicted ids reference each other, so the second delete in the shared
  // editor meets reference edits against the node deleted first.
  for (const ids of [['h', 'i1'], ['i1', 'h']]) {
    it(`evicts an entity together with an entity it references (${ids.join(', ')})`, () => {
      const expected = createCache();
      evictSeparately(expected, ids);
      const cache = createCache();

      expect(cache.batchEvict(ids)).to.eq(true);

      expect(cache.extract(false)).to.deep.eq(expected.extract(false));
      expect(cache.getEntity('h')).to.eq(undefined);
      expect(cache.getEntity('i1')).to.eq(undefined);
      expect(cache.getSnapshot().baseline.getNodeSnapshot('i2')!.inbound).to.eq(undefined);
    });
  }

  it(`skips ids that are not in the cache, as evict does`, () => {
    const evictOnChange = jest.fn();
    const viaEvict = createCache({ ...strictConfig, onChange: evictOnChange });
    const onChange = jest.fn();
    const cache = createCache({ ...strictConfig, onChange });
    const before = cache.getSnapshot();
    evictOnChange.mockClear();
    onChange.mockClear();
    commit.mockClear();

    expect(viaEvict.evict({ id: 'missing' })).to.eq(false);
    expect(cache.batchEvict(['missing'])).to.eq(false);

    expect(cache.getSnapshot().baseline).to.eq(before.baseline);
    expect(commit.mock.calls.length).to.eq(0);
    expect(onChange.mock.calls.map(([, edited]) => edited.size))
      .to.deep.eq(evictOnChange.mock.calls.map(([, edited]) => edited.size));

    const expected = createCache();
    expected.evict({ id: '2' });
    expect(cache.batchEvict(['missing', '2'])).to.eq(true);
    expect(cache.extract(false)).to.deep.eq(expected.extract(false));
  });

  it(`removes an entity whole, including a null field with a parameterized variant`, () => {
    const cache = createCache();
    cache.write(query(`{ foo { id bar } }`), { foo: { id: 'f', bar: null } });
    cache.write(query(`{ foo { id bar(x: 1) { id } } }`), { foo: { id: 'f', bar: { id: 'b' } } });

    expect(cache.batchEvict(['f'])).to.eq(true);

    expect(cache.getEntity('f')).to.eq(undefined);
  });

  it(`runs entity updaters as evict does, once per batch for a shared referrer`, () => {
    function recordingCache(calls: string[]) {
      const record = (typeName: string) => (_dataProxy: unknown, node: any, previous: any) => {
        calls.push(`${typeName} ${previous?.id ?? 'root'} -> ${node ? 'present' : 'removed'}`);
      };
      return createCache({
        ...strictConfig,
        entityUpdaters: { Thing: record('Thing'), Query: record('Query') },
      });
    }
    const separateCalls: string[] = [];
    const separate = recordingCache(separateCalls);
    const batchCalls: string[] = [];
    const batch = recordingCache(batchCalls);
    separateCalls.length = 0;
    batchCalls.length = 0;

    evictSeparately(separate, ['1', '3']);
    batch.batchEvict(['1', '3']);

    expect(separateCalls).to.have.members([
      'Thing 1 -> removed', 'Query root -> present', 'Thing 3 -> removed', 'Query root -> present',
    ]);
    expect(batchCalls).to.have.members(['Thing 1 -> removed', 'Thing 3 -> removed', 'Query root -> present']);
    expect(batchCalls.length).to.eq(3);
  });

  it(`notifies a watcher once, with the data separate evicts lead to`, () => {
    const ids = ['1', '3', '5'];
    const expected = createCache();
    evictSeparately(expected, ids);
    const cache = createCache();
    const updates: CacheInterface.DiffResult<any>[] = [];
    cache.watch(graph, newResult => updates.push(newResult));
    updates.length = 0; // The immediate initial callback.

    cache.batchEvict(ids);

    expect(updates.length).to.eq(1);
    expect(updates[0].result).to.deep.eq(expected.read(graph).result);
    expect(updates[0].complete).to.eq(expected.read(graph).complete);
  });

  it(`fails like evict when committing throws, leaving the cache unchanged`, () => {
    function failingCache() {
      const warn = jest.fn();
      let armed = false;
      const cache = createCache({
        ...silentConfig,
        logger: { ...silentConfig.logger!, warn },
        entityTransformer: () => {
          if (armed) throw new Error(`transformer failure`);
        },
      });
      armed = true;
      return { cache, warn };
    }
    const viaEvict = failingCache();
    const viaBatch = failingCache();
    const before = viaBatch.cache.extract(false);

    expect(viaEvict.cache.evict({ id: '1' })).to.eq(false);
    expect(viaBatch.cache.batchEvict(['1', '3'])).to.eq(false);

    expect(viaBatch.cache.extract(false)).to.deep.eq(before);
    expect(viaBatch.cache.getEntity('1')).to.not.eq(undefined);
    expect(viaEvict.warn.mock.calls.length).to.eq(1);
    expect(viaBatch.warn.mock.calls.length).to.eq(1);
    expect(viaBatch.warn.mock.calls[0][0]).to.eq(viaEvict.warn.mock.calls[0][0]);
  });

});

describe(`Cache#gc`, () => {

  const graph = query(`{
    holder { id items { id name } }
    kept { id }
  }`);

  function createCache() {
    const cache = new Cache(strictConfig);
    cache.write(graph, {
      holder: { id: 'h', items: [1, 2, 3].map(i => ({ id: `i${i}`, name: `Item ${i}` })) },
      kept: { id: 'k' },
    });
    // Evicting leaves the items in the cache, but unreachable.
    cache.evict({ id: 'h' });
    return cache;
  }

  let commit: jest.SpyInstance;
  beforeEach(() => {
    commit = jest.spyOn(SnapshotEditor.prototype, 'commit');
  });

  afterEach(() => {
    commit.mockRestore();
  });

  it(`removes several unreachable nodes with one commit, leaving the same cache as evicting each`, () => {
    const cache = createCache();
    const orphans = ['i1', 'i2', 'i3'];
    const expected = createCache();
    orphans.forEach(id => expected.evict({ id }));

    commit.mockClear();
    const removed = cache.gc();

    expect(removed).to.have.members(orphans);
    expect(commit.mock.calls.length).to.eq(1);
    expect(cache.extract(false)).to.deep.eq(expected.extract(false));
  });

});

describe(`optimistic replay of deletes`, () => {

  const graph = query(`{ a { id ref { id } } b { id } c { id } }`);
  const aToC = query(`{ a { id ref { id } } }`);
  const cField = query(`{ c { id extra } }`);
  const other = query(`{ other }`);

  function deleteOptimistically(t: CacheTransaction<GraphSnapshot>, id: string) {
    return t.modify({ id, optimistic: true, fields: (_current, { DELETE }) => DELETE });
  }

  function inboundIdsOf(cache: Cache, id: string) {
    const inbound = cache.getSnapshot().optimistic.getNodeSnapshot(id)?.inbound;
    return Array.from(inbound?.values() ?? [], ref => ref.id);
  }

  // A reference rewritten by an earlier optimistic transaction must be cleaned
  // up by a later delete that is replayed on top of it, or the deleted entity
  // is resurrected by the next update to its stale target.
  it(`removes references changed by earlier optimistic transactions when replaying a delete`, () => {
    const cache = new Cache(strictConfig);
    cache.write(graph, {
      a: { id: 'A', ref: { id: 'B' } },
      b: { id: 'B' },
      c: { id: 'C' },
    });

    expect(cache.transaction(false, 'delete-b', t => deleteOptimistically(t, 'B'))).to.eq(true);
    expect(cache.transaction(false, 'a-to-c', (t) => {
      t.write(aToC, { a: { id: 'A', ref: { id: 'C' } } });
    })).to.eq(true);
    expect(cache.transaction(false, 'delete-a', t => deleteOptimistically(t, 'A'))).to.eq(true);

    // Replays the three optimistic transactions on the new baseline.
    expect(cache.transaction(false, (t) => {
      t.write(other, { other: 1 });
    })).to.eq(true);

    expect(inboundIdsOf(cache, 'C')).to.not.include('A');
    expect(cache.getEntity('A')).to.eq(undefined);

    const results: any[] = [];
    cache.watch(aToC, {
      query: aToC.document, optimistic: true, immediate: false, callback: r => results.push(r),
    });
    // Broadcast so the watcher is actually notified of the update.
    expect(cache.transaction(true, 'update-c', (t) => {
      t.write(cField, { c: { id: 'C', extra: 1 } });
    })).to.eq(true);

    expect(cache.getEntity('A')).to.eq(undefined);
    const resurrected = (data: any) => data?.a?.id === 'A';
    expect(resurrected(cache.read(aToC, true).result)).to.eq(false);
    expect(results.length).to.eq(1);
    expect(resurrected(results[0].result)).to.eq(false);
  });

});
