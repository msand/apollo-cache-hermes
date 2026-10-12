function wrap(key?: 'only' | 'skip' | 'todo') {
  return (
    message: string,
    callback: (resolve: (result?: any) => void, reject: (reason?: any) => void) => any,
    timeout?: number,
  ) =>
    (key ? it[key] : it)(
      message,
      function (this: unknown) {
        return new Promise((resolve, reject) => {
          const result = callback.call(this, resolve, reject);
          // Fail fast when an async callback throws, instead of waiting for the test timeout.
          if (result && typeof result.then === 'function') {
            result.then(undefined, reject);
          }
        });
      },
      timeout,
    );
}

const wrappedIt = wrap();

export const itAsync = Object.assign(
  function (this: unknown, ...args: Parameters<typeof wrappedIt>) {
    return wrappedIt.apply(this, args);
  },
  {
    only: wrap('only'),
    skip: wrap('skip'),
    todo: wrap('todo'),
  },
);
