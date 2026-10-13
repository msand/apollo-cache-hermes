// eslint-disable-next-line import/no-extraneous-dependencies -- installed with jest
import { expect } from '@jest/globals';

import { arrayWithLength } from './arrayWithLength';
import { toBeDisposed } from './toBeDisposed';
import { toBeGarbageCollected } from './toBeGarbageCollected';
import { toBeOneOf } from './toBeOneOf';
import { toComplete } from './toComplete';
import { toEmitAnything } from './toEmitAnything';
import { toEmitError } from './toEmitError';
import { toEmitNext } from './toEmitNext';
import { toEmitTypedValue } from './toEmitTypedValue';
import { toHaveFragmentWatchesOn } from './toHaveFragmentWatchesOn';
import { toHaveNumWatches } from './toHaveNumWatches';
import { toHaveSuspenseCacheEntryUsing } from './toHaveSuspenseCacheEntryUsing';
import { toMatchDocument } from './toMatchDocument';
import { toEmitSimilarValue, toRerenderWithSimilarSnapshot } from './toRerenderWithSimilarSnapshot';
import { toStrictEqualTyped } from './toStrictEqualTyped';

expect.extend({
  arrayWithLength,
  toBeOneOf,
  toComplete,
  toEmitAnything,
  toEmitError,
  toEmitNext,
  toEmitTypedValue,
  toBeDisposed,
  toHaveFragmentWatchesOn,
  toHaveNumWatches,
  toHaveSuspenseCacheEntryUsing,
  toMatchDocument,
  toBeGarbageCollected,
  toStrictEqualTyped,
  toRerenderWithSimilarSnapshot,
  toEmitSimilarValue,
});
