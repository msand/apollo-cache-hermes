import { CacheContext } from '../../../../../src/context';
import { GraphSnapshot } from '../../../../../src/GraphSnapshot';
import { extract } from '../../../../../src/operations';
import { createGraphSnapshot, createStrictCacheContext } from '../../../../helpers';

describe(`operations.extract`, () => {
  describe(`invalid values`, () => {

    let snapshot: GraphSnapshot, cacheContext: CacheContext;
    beforeAll(() => {
      cacheContext = createStrictCacheContext();
      snapshot = createGraphSnapshot(
        { nan: NaN, func: (() => {}) as any },
        `{
          nan
          func
        }`,
        cacheContext
      );
    });

    it(`throws error when extracting invalid values`, () => {
      jestExpect(() => {
        extract(snapshot, cacheContext);
      }).toThrow(/unserializable/i);
    });

  });
});
