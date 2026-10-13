import { NormalizedCacheObject, StoreObject } from '@apollo/client/cache/inmemory/types';
import { EntityStore } from '@apollo/client/cache/inmemory/entityStore';
import { Policies } from '@apollo/client/cache/inmemory/policies';
import type { InMemoryCache } from '@apollo/client/cache/inmemory/inMemoryCache';

import { Hermes } from '../../../../../src';

// Hermes: these tests exercise InMemoryCache's internal EntityStore layers. Their
// Policies only hold on to the cache, which these tests never use, so a Hermes
// cache stands in for the InMemoryCache.
describe('Optimistic EntityStore layering', () => {
  function makeLayer(root: EntityStore) {
    return root.addLayer('whatever', () => {});
  }

  function lookup(store: EntityStore, dataId: string) {
    return (store as any).lookup(dataId) as StoreObject;
  }

  describe('returns correct values during recording', () => {
    const data = {
      Human: { __typename: 'Human', name: 'Mark' },
      Animal: { __typename: 'Mouse', name: '🐭' },
    };

    const dataToRecord = {
      Human: { __typename: 'Human', name: 'John' },
    };

    const underlyingStore = new EntityStore.Root({
      seed: data,
      policies: new Policies({
        cache: new Hermes() as unknown as InMemoryCache,
      }),
    });

    let store = makeLayer(underlyingStore);
    beforeEach(() => {
      store = makeLayer(underlyingStore);
    });

    it('should passthrough values if not defined in recording', () => {
      expect(lookup(store, 'Human')).toBe(data.Human);
      expect(lookup(store, 'Animal')).toBe(data.Animal);
    });

    it('should return values defined during recording', () => {
      store.merge('Human', dataToRecord.Human);
      expect(lookup(store, 'Human')).toEqual(dataToRecord.Human);
      expect(lookup(underlyingStore, 'Human')).toBe(data.Human);
    });

    it('should return undefined for values deleted during recording', () => {
      expect(lookup(store, 'Animal')).toBe(data.Animal);
      // delete should be registered in the recording:
      store.delete('Animal');
      expect(lookup(store, 'Animal')).toBeUndefined();
      expect(store.toObject()).toHaveProperty('Animal');
      expect(lookup(underlyingStore, 'Animal')).toBe(data.Animal);
    });
  });

  describe('returns correct result of a recorded transaction', () => {
    const data = {
      Human: { __typename: 'Human', name: 'Mark' },
      Animal: { __typename: 'Mouse', name: '🐭' },
    };

    const dataToRecord = {
      Human: { __typename: 'Human', name: 'John' },
    };

    const underlyingStore = new EntityStore.Root({
      seed: data,
      policies: new Policies({
        cache: new Hermes() as unknown as InMemoryCache,
      }),
    });
    let store = makeLayer(underlyingStore);
    let recording: NormalizedCacheObject;

    beforeEach(() => {
      store = makeLayer(underlyingStore);
      store.merge('Human', dataToRecord.Human);
      store.delete('Animal');
      recording = store.toObject();
    });

    it('should contain the property indicating deletion', () => {
      expect(recording).toHaveProperty('Animal');
    });

    it('should have recorded the changes made during recording', () => {
      expect(recording).toEqual({
        Human: dataToRecord.Human,
        Animal: undefined,
      });
    });

    it('should keep the original data unaffected', () => {
      expect(underlyingStore.toObject()).toEqual(data);
    });
  });
});
