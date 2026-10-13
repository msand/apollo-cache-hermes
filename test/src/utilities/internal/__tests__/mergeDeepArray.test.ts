import { mergeDeepArray } from '@apollo/client/utilities/internal';

it('mergeDeepArray returns the supertype of its argument types', () => {
  class F {
    check() {
      return 'ok';
    }
  }
  const fs: F[] = [new F(), new F(), new F()];
  // Although mergeDeepArray doesn't have the same tuple type awareness as
  // mergeDeep, it does infer that F should be the return type here:
  expect(mergeDeepArray(fs).check()).toBe('ok');
});
