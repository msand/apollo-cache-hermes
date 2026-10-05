import { expect } from 'chai';

import { query, strictConfig } from '../../helpers';
import { Cache } from '../../../src';
import { CacheContext } from '../../../src/context';

describe(`evicting an entity`, () => {

  const thingsQuery = query(`{
    things {
      id
      shared { id name }
    }
    loner { id solo { id } }
  }`);

  const sharedQuery = query(`{
    shared { id name }
  }`);

  let cache: Cache, editedNodeIds: Parameters<CacheContext.OnChangeCallback>[1][];
  beforeEach(() => {
    editedNodeIds = [];
    cache = new Cache({
      ...strictConfig,
      onChange: (_snapshot, edited) => {
        editedNodeIds.push(edited);
      },
    });
    cache.write(thingsQuery, {
      things: [
        { id: '1', shared: { id: 's', name: 'Shared' } },
        { id: '2', shared: { id: 's', name: 'Shared' } },
        { id: '3', shared: { id: 's', name: 'Shared' } },
      ],
      loner: { id: 'l', solo: { id: 'o' } },
    });
    editedNodeIds = [];
  });

  it(`keeps the identity of other entities referencing the same entity`, () => {
    const two = cache.getEntity('2');
    const three = cache.getEntity('3');

    cache.evict({ id: '1' });

    expect(cache.getEntity('1')).to.eq(undefined);
    expect(cache.getEntity('2')).to.eq(two);
    expect(cache.getEntity('3')).to.eq(three);
    expect(editedNodeIds[0].has('s')).to.eq(false);
  });

  it(`removes the evicted entity from the inbound references of its targets`, () => {
    cache.evict({ id: '1' });

    const inbound = Array.from(cache.getSnapshot().baseline.getNodeSnapshot('s')!.inbound!.values()).map(({ id }) => id);
    expect(inbound).to.have.members(['2', '3']);
  });

  it(`propagates later writes of the shared entity to the remaining referrers`, () => {
    cache.evict({ id: '1' });
    cache.write(sharedQuery, { shared: { id: 's', name: 'Renamed' } });

    expect(cache.getEntity('2')).to.deep.eq({ id: '2', shared: { id: 's', name: 'Renamed' } });
    expect(cache.getEntity('3')).to.deep.eq({ id: '3', shared: { id: 's', name: 'Renamed' } });
  });

  it(`still reports a target that is left without referrers as edited`, () => {
    cache.evict({ id: 'l' });

    expect(editedNodeIds[0].has('o')).to.eq(true);
    expect(cache.getSnapshot().baseline.getNodeSnapshot('o')!.inbound).to.eq(undefined);
  });

});
