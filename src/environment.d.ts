/**
 * Hermes relies on some ES6 functionality: iterators (via Symbol.iterator),
 * Sets, and Maps.
 *
 * Unfortunately, it can be tricky to polyfill correctly (and some environments
 * don't do it properly. Looking at you react-native on android). So, let's make
 * sure that everything is in a happy state, and complain otherwise.
 */
export declare function assertValidEnvironment(): void;
//# sourceMappingURL=environment.d.ts.map