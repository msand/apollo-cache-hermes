import { Observable, maybe } from '../../index';
import {
  handleError,
  readMultipartBody,
} from '../../../link/http/parseAndCheckHttpResponse';
import { serializeFetchParameter } from '../../../core/index';
import type { Body } from '../../../link/http/selectHttpOptionsAndBody';
import { generateOptionsForMultipartSubscription } from '../shared';
import type { CreateMultipartSubscriptionOptions } from '../shared';

const backupFetch = maybe(() => fetch);

export function createFetchMultipartSubscription(
  uri: string,
  { fetch: preferredFetch, headers }: CreateMultipartSubscriptionOptions = {}
) {
  return function multipartSubscriptionForwarder({
    query,
    variables,
  }: {
    query?: string,
    variables: undefined | Record<string, any>,
  }) {
    const body: Body = { variables, query };
    const options = generateOptionsForMultipartSubscription(headers || {});

    return new Observable((observer) => {
      try {
        options.body = serializeFetchParameter(body, 'Payload');
      } catch (parseError) {
        observer.error(parseError);
      }

      const currentFetch = preferredFetch || maybe(() => fetch) || backupFetch;
      const observerNext = observer.next.bind(observer);

      currentFetch!(uri, options)
        .then((response) => {
          const ctype = response.headers?.get('content-type');

          if (ctype !== null && /^multipart\/mixed/i.test(ctype)) {
            return readMultipartBody(response, observerNext);
          }

          observer.error(new Error('Expected multipart response'));
        })
        .then(() => {
          observer.complete();
        })
        .catch((err: any) => {
          handleError(err, observer);
        });
    });
  };
}
