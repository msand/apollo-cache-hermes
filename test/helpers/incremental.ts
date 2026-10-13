import { ReadableStream as NodeReadableStream, TextEncoderStream, TransformStream } from 'node:stream/web';
import { HttpLink } from '@apollo/client';

const hasNextSymbol = Symbol('hasNext');

/**
 * Apollo Client 3.14.1's `mockIncrementalStream` (from
 * `@apollo/client/testing/internal`), with one fix: whether the opening
 * boundary was sent is tracked per response stream. The original resets a
 * shared flag in `close()`, which runs synchronously when the last chunk is
 * enqueued, while the stream transforms chunks asynchronously on current Node
 * versions. The last chunk then gets a second opening boundary, and HttpLink
 * fails to parse the empty part in between ("Unexpected end of JSON input").
 */
export function mockIncrementalStream<Chunks extends object>({ responseHeaders }: { responseHeaders: Headers }) {
  type Payload = Chunks & { [hasNextSymbol]: boolean };
  const CLOSE = Symbol('close');
  let streamController: ReadableStreamDefaultController<Payload> | null = null;

  const queue: (Payload | typeof CLOSE)[] = [];

  function processQueue() {
    if (!streamController) {
      throw new Error('Cannot process queue without stream controller');
    }

    let chunk;
    while ((chunk = queue.shift())) {
      if (chunk === CLOSE) {
        streamController.close();
      } else {
        streamController.enqueue(chunk);
      }
    }
  }

  function createStream() {
    let sentInitialChunk = false;
    return new NodeReadableStream<Payload>({
      start(c) {
        streamController = c;
        processQueue();
      },
    })
      .pipeThrough(
        new TransformStream<Payload, string>({
          transform: (chunk, controller) => {
            controller.enqueue(
              `${
                !sentInitialChunk ? '\r\n---\r\n' : ''
              }content-type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(
                chunk,
              )}${chunk[hasNextSymbol] ? '\r\n---\r\n' : '\r\n-----\r\n'}`,
            );
            sentInitialChunk = true;
          },
        }),
      )
      .pipeThrough(new TextEncoderStream());
  }

  const httpLink = new HttpLink({
    fetch() {
      return Promise.resolve(
        new Response(createStream() as unknown as ReadableStream<Uint8Array>, {
          status: 200,
          headers: responseHeaders,
        }),
      );
    },
  });

  function queueNext(event: Payload | typeof CLOSE) {
    queue.push(event);

    if (streamController) {
      processQueue();
    }
  }

  function close() {
    queueNext(CLOSE);

    streamController = null;
  }

  function enqueue(chunk: Chunks, hasNext: boolean) {
    queueNext({ ...chunk, [hasNextSymbol]: hasNext });

    if (!hasNext) {
      close();
    }
  }

  return {
    httpLink,
    enqueue,
    close,
  };
}

/** Apollo Client 3.14.1's `mockDeferStream`, built on the fixed `mockIncrementalStream`. */
export function mockDeferStream<TData = Record<string, unknown>>() {
  type Chunk = { data?: TData; incremental?: unknown[]; errors?: unknown[]; hasNext: boolean; [key: string]: unknown };
  const { httpLink, enqueue } = mockIncrementalStream<Chunk>({
    responseHeaders: new Headers({
      'Content-Type': 'multipart/mixed; boundary="-"; deferSpec=20220824',
    }),
  });
  return {
    httpLink,
    enqueueInitialChunk(chunk: Chunk) {
      enqueue(chunk, chunk.hasNext);
    },
    enqueueSubsequentChunk(chunk: Chunk) {
      enqueue(chunk, chunk.hasNext);
    },
    enqueueErrorChunk(errors: unknown[]) {
      enqueue({ hasNext: true, incremental: [{ errors }] }, true);
    },
  };
}

/** Apollo Client 3.14.1's `mockMultipartSubscriptionStream`, built on the fixed `mockIncrementalStream`. */
export function mockMultipartSubscriptionStream<TData = Record<string, unknown>>() {
  type Chunk = { payload?: { data?: TData; errors?: unknown[]; [key: string]: unknown } | null; errors?: unknown[] };
  const { httpLink, enqueue } = mockIncrementalStream<Chunk>({
    responseHeaders: new Headers({
      'Content-Type': 'multipart/mixed',
    }),
  });

  enqueueHeartbeat();

  function enqueueHeartbeat() {
    enqueue({}, true);
  }

  return {
    httpLink,
    enqueueHeartbeat,
    enqueuePayloadResult(payload: NonNullable<Chunk['payload']>, hasNext = true) {
      enqueue({ payload }, hasNext);
    },
    enqueueProtocolErrors(errors: unknown[]) {
      enqueue({ payload: null, errors }, false);
    },
  };
}
