import { expect } from 'chai';
import { gql, InMemoryCache } from '@apollo/client';

import { Hermes } from '../../../src';
import { Policies } from '../../../src/context/policies';
import { ScalarConfig } from '../../../src/context/scalars';

// Custom scalar coercion, like InMemoryCache's EntityStore#coerceValue.
describe(`context.ScalarConfig`, () => {
  const DateScalar = {
    coerceToParsed: (value: unknown) => (typeof value === 'string' ? new Date(value) : value),
    coerceToSerialized: (value: unknown) => (value instanceof Date ? value.toISOString() : value),
  };
  const Same = { coerceToParsed: (value: unknown) => value, coerceToSerialized: (value: unknown) => value };

  for (const [name, Cache] of Object.entries({ Hermes, InMemoryCache })) {
    it(`coerces the fields of typed objects in values of unregistered scalar types (${name})`, () => {
      const cache = new (Cache as typeof Hermes)({
        scalars: { Date: DateScalar as any },
        typePolicies: {
          Query: { fields: { meta: { scalar: 'Unregistered' } } },
          Meta: { fields: { at: { scalar: 'Date' } } },
        },
      });
      const query = gql`
        {
          meta
        }
      `;
      cache.writeQuery({ query, data: { meta: { __typename: 'Meta', at: '1970-01-01T00:00:00.000Z' } } });
      const meta = cache.readQuery<any>({ query })?.meta;
      expect(meta.at).to.be.instanceOf(Date);
      expect(meta.at.getTime()).to.eq(0);
    });
  }

  function scalarConfig(scalarType: string) {
    const policies = new Policies({ typePolicies: { T: { fields: { list: { scalar: scalarType } } } }, scalars: true });
    return new ScalarConfig({ Same } as any, undefined, policies);
  }

  it(`keeps lists whose items are unchanged`, () => {
    const list = [1, 2, 3];
    expect(scalarConfig('[Same]').parseStoreValue('T', 'list', list)).to.eq(list);
    expect(scalarConfig('[Unregistered]').parseStoreValue('T', 'list', list)).to.eq(list);
  });

  describe(`warnings about values of list types that are not lists`, () => {
    let dev: boolean | undefined;
    let warn: jest.SpyInstance;
    beforeEach(() => {
      dev = (globalThis as any).__DEV__;
      warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      (globalThis as any).__DEV__ = dev;
      warn.mockRestore();
    });

    it(`are made in development`, () => {
      (globalThis as any).__DEV__ = true;
      scalarConfig('[Same]').parseStoreValue('T', 'list', 1);
      expect(warn.mock.calls.length).to.eq(1);
    });

    it(`are not made in production`, () => {
      (globalThis as any).__DEV__ = false;
      scalarConfig('[Same]').parseStoreValue('T', 'list', 1);
      expect(warn.mock.calls.length).to.eq(0);
    });
  });
});
