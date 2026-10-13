import { disableActEnvironment, renderHookToSnapshotStream } from '@testing-library/react-render-stream';
import React from 'react';
import { delay, of } from 'rxjs';
import { ApolloClient, ApolloLink, gql } from '@apollo/client';
import { ApolloProvider, useMutation } from '@apollo/client/react';

import { Hermes } from '../../../../../../src';

const echoContextLink = new ApolloLink(operation => {
  // filter out internal client set context values
  const { queryDeduplication, optimisticResponse, ...context } = operation.getContext();
  return of({
    data: { echo: { context } },
  }).pipe(delay(20));
});

it('context is provided from hook', async () => {
  const mutation = gql`
    mutation {
      echo {
        context
      }
    }
  `;

  const client = new ApolloClient({
    link: echoContextLink,
    cache: new Hermes(),
  });

  using _disabledAct = disableActEnvironment();
  const { takeSnapshot, getCurrentSnapshot } = await renderHookToSnapshotStream(
    () => useMutation(mutation, { context: { foo: true } }),
    {
      wrapper: ({ children }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
    },
  );

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: false,
      called: false,
    });
  }

  const [execute] = getCurrentSnapshot();

  await execute();

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: true,
      called: true,
    });
  }

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: { echo: { context: { foo: true } } },
      error: undefined,
      loading: false,
      called: true,
    });
  }

  await expect(takeSnapshot).not.toRerender();
});

it('context provided to execute function overrides hook context', async () => {
  const mutation = gql`
    mutation {
      echo {
        context
      }
    }
  `;

  const client = new ApolloClient({
    link: echoContextLink,
    cache: new Hermes(),
  });

  using _disabledAct = disableActEnvironment();
  const { takeSnapshot, getCurrentSnapshot } = await renderHookToSnapshotStream(
    () => useMutation(mutation, { context: { foo: true } }),
    {
      wrapper: ({ children }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
    },
  );

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: false,
      called: false,
    });
  }

  const [execute] = getCurrentSnapshot();

  await execute({ context: { bar: true } });

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: true,
      called: true,
    });
  }

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: { echo: { context: { bar: true } } },
      error: undefined,
      loading: false,
      called: true,
    });
  }

  await expect(takeSnapshot).not.toRerender();
});

it('allows context as callback called with context from hook', async () => {
  const mutation = gql`
    mutation {
      echo {
        context
      }
    }
  `;

  const client = new ApolloClient({
    link: echoContextLink,
    cache: new Hermes(),
  });

  using _disabledAct = disableActEnvironment();
  const { takeSnapshot, getCurrentSnapshot } = await renderHookToSnapshotStream(
    () => useMutation(mutation, { context: { foo: true } }),
    {
      wrapper: ({ children }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
    },
  );

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: false,
      called: false,
    });
  }

  const [execute] = getCurrentSnapshot();

  const contextFn = jest.fn(ctx => ({ ...ctx, bar: true }));
  await execute({ context: contextFn });

  expect(contextFn).toHaveBeenCalledTimes(1);
  expect(contextFn).toHaveBeenCalledWith({ foo: true });

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: true,
      called: true,
    });
  }

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: {
        echo: { context: { foo: true, bar: true } },
      },
      error: undefined,
      loading: false,
      called: true,
    });
  }

  await expect(takeSnapshot).not.toRerender();
});

it('provides undefined to context callback if context is not provided to hook', async () => {
  const mutation = gql`
    mutation {
      echo {
        context
      }
    }
  `;

  const client = new ApolloClient({
    link: echoContextLink,
    cache: new Hermes(),
  });

  using _disabledAct = disableActEnvironment();
  const { takeSnapshot, getCurrentSnapshot } = await renderHookToSnapshotStream(() => useMutation(mutation), {
    wrapper: ({ children }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
  });

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: false,
      called: false,
    });
  }

  const [execute] = getCurrentSnapshot();

  const contextFn = jest.fn(ctx => ({ ...ctx, bar: true }));
  await execute({ context: contextFn });

  expect(contextFn).toHaveBeenCalledTimes(1);
  expect(contextFn).toHaveBeenCalledWith(undefined);

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: true,
      called: true,
    });
  }

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: {
        echo: { context: { bar: true } },
      },
      error: undefined,
      loading: false,
      called: true,
    });
  }

  await expect(takeSnapshot).not.toRerender();
});

it('does not merge returned context from context callback with hook', async () => {
  const mutation = gql`
    mutation {
      echo {
        context
      }
    }
  `;

  const client = new ApolloClient({
    link: echoContextLink,
    cache: new Hermes(),
  });

  using _disabledAct = disableActEnvironment();
  const { takeSnapshot, getCurrentSnapshot } = await renderHookToSnapshotStream(
    () => useMutation(mutation, { context: { foo: true } }),
    {
      wrapper: ({ children }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
    },
  );

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: false,
      called: false,
    });
  }

  const [execute] = getCurrentSnapshot();

  const contextFn = jest.fn(() => ({ baz: true }));
  await execute({ context: contextFn });

  expect(contextFn).toHaveBeenCalledTimes(1);
  expect(contextFn).toHaveBeenCalledWith({ foo: true });

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: true,
      called: true,
    });
  }

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: {
        echo: { context: { baz: true } },
      },
      error: undefined,
      loading: false,
      called: true,
    });
  }

  await expect(takeSnapshot).not.toRerender();
});

it('provides full context returned from callback to update function', async () => {
  const mutation = gql`
    mutation {
      echo {
        context
      }
    }
  `;

  const client = new ApolloClient({
    link: echoContextLink,
    cache: new Hermes(),
  });

  using _disabledAct = disableActEnvironment();
  const update = jest.fn();
  const { takeSnapshot, getCurrentSnapshot } = await renderHookToSnapshotStream(
    () => useMutation(mutation, { context: { foo: true }, update }),
    {
      wrapper: ({ children }) => <ApolloProvider client={client}>{children}</ApolloProvider>,
    },
  );

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: false,
      called: false,
    });
  }

  const [execute] = getCurrentSnapshot();

  await execute({ context: ctx => ({ ...ctx, bar: true }) });

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: undefined,
      error: undefined,
      loading: true,
      called: true,
    });
  }

  {
    const [, result] = await takeSnapshot();

    expect(result).toStrictEqualTyped({
      data: {
        echo: { context: { foo: true, bar: true } },
      },
      error: undefined,
      loading: false,
      called: true,
    });
  }

  await expect(takeSnapshot).not.toRerender();

  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenCalledWith(
    client.cache,
    {
      data: {
        echo: { context: { foo: true, bar: true } },
      },
    },
    { context: { foo: true, bar: true }, variables: {} },
  );
});
