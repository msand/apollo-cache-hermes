import type * as jest from 'jest';

declare global {
  const expect: typeof jest.expect;
  const jestExpect: typeof jest.expect;
  interface Window {
    __DEV__?: boolean;
  }

  namespace NodeJS {
    export interface Global {
      expect: typeof jest.expect;
      jestExpect: typeof global.expect;
      __DEV__: boolean;
    }
  }
}
