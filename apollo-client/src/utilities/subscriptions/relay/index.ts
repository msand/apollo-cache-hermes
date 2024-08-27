import { Observable } from "relay-runtime";
import type { RequestParameters, GraphQLResponse } from "relay-runtime";

import {
  handleError,
  readMultipartBody,
} from "../../../link/http/parseAndCheckHttpResponse";
import { maybe } from "../../index";
import { serializeFetchParameter } from "../../../core/index";
import type { OperationVariables } from "../../../core/index";
import type { Body } from "../../../link/http/selectHttpOptionsAndBody";
import { generateOptionsForMultipartSubscription } from "../shared";
import type { CreateMultipartSubscriptionOptions } from "../shared";

const backupFetch = maybe(() => fetch);

export function createFetchMultipartSubscription(
  uri: string,
  { fetch: preferredFetch, headers }: CreateMultipartSubscriptionOptions = {}
) {
  return function fetchMultipartSubscription(
    operation: RequestParameters,
    variables: OperationVariables
  ): Observable<GraphQLResponse> {
    const body: Body = {
      operationName: operation.name,
      variables,
      query: operation.text || "",
    };
    const options = generateOptionsForMultipartSubscription(headers || {});

    return Observable.create((sink) => {
      try {
        options.body = serializeFetchParameter(body, "Payload");
      } catch (parseError) {
        sink.error(parseError as Error);
      }

      const currentFetch = preferredFetch || maybe(() => fetch) || backupFetch;
      const observerNext = sink.next.bind(sink);

      currentFetch!(uri, options)
        .then((response) => {
          const ctype = response.headers?.get("content-type");

          if (ctype !== null && /^multipart\/mixed/i.test(ctype)) {
            return readMultipartBody(response, observerNext);
          }

          sink.error(new Error("Expected multipart response"));
        })
        .then(() => {
          sink.complete();
        })
        .catch((err: any) => {
          handleError(err, sink);
        });
    });
  };
}
