import { ApolloLink } from "../core/index";
import type { HttpOptions } from "./selectHttpOptionsAndBody";
import { createHttpLink } from "./createHttpLink";

export class HttpLink extends ApolloLink {
  constructor(public options: HttpOptions = {}) {
    super(createHttpLink(options).request);
  }
}
