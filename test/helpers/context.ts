import * as util from 'util';
import { KeyFieldsContext } from '@apollo/client/cache/inmemory/policies';

import { CacheContext } from '../../src/context';
import { StoreObject } from '../../apollo-client';

export const strictConfig: CacheContext.Configuration = {
  freeze: true,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn(message: string, ...args: any[]) {
      throw new Error(util.format(`warn:`, message, ...args));
    },
    group: jest.fn(),
    groupEnd: jest.fn(),
  },
  entityIdForNode: (
    object: Readonly<StoreObject>,
    context: KeyFieldsContext) => {
    const id = object?.id;
    return typeof id === 'string' || typeof id === 'number' ? id : undefined;
  },
  addTypename: false,
};

export const silentConfig: CacheContext.Configuration = {
  freeze: true,
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    group: jest.fn(),
    groupEnd: jest.fn(),
  },
  entityIdForNode: (
    object: Readonly<StoreObject>,
    context: KeyFieldsContext) => {
    const id = object?.id;
    return typeof id === 'string' || typeof id === 'number' ? id : undefined;
  },
  addTypename: false,
};

/** Cache context created using strictConfig */
export function createStrictCacheContext() {
  return new CacheContext(strictConfig);
}
