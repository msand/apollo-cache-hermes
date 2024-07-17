
/*
 * Ugly workaround until https://github.com/jestjs/jest/issues/14874 is fixed
 */

const disposeSymbol: unique symbol = Symbol('Symbol.dispose');
const asyncDisposeSymbol: unique symbol = Symbol('Symbol.asyncDispose');
type Writable<T> = {
  -readonly [TKey in keyof T]: T[TKey];
};
(Symbol as Writable<SymbolConstructor>).asyncDispose
    ??= asyncDisposeSymbol as unknown as SymbolConstructor['asyncDispose'];
(Symbol as Writable<SymbolConstructor>).dispose
    ??= disposeSymbol as unknown as SymbolConstructor['dispose'];

/** @internal */
export function withCleanup<T extends object>(
  item: T,
  cleanup: (item: T) => void
): T & Disposable {
  return {
    ...item,
    [Symbol.dispose]() {
      cleanup(item);
      // if `item` already has a cleanup function, we also need to call the original cleanup function
      // (e.g. if something is wrapped in `withCleanup` twice)
      if (Symbol.dispose in item) {
        (item as Disposable)[Symbol.dispose]();
      }
    },
  };
}
