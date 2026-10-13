// What Apollo Client's own test utilities get when they import its cache module
// (see test/env/resolver.ts): the real module, except that `InMemoryCache` is
// Hermes. So `MockedProvider`, `createMockClient`, `renderWithMocks` and other
// helpers that default to an `InMemoryCache` test Hermes instead.
export * from '@apollo/client/cache';
export { Hermes as InMemoryCache } from '../../src';
