import '../utilities/globals/index';

export type { ApolloContextValue } from './context/index';
export {
  ApolloProvider,
  ApolloConsumer,
  getApolloContext,
  resetApolloContext,
} from './context/index';

export * from './hooks/index';

export type { IDocumentDefinition } from './parser/index';
export { DocumentType, operationName, parser } from './parser/index';

export type {
  PreloadQueryOptions,
  PreloadQueryFetchPolicy,
  PreloadQueryFunction,
} from './query-preloader/createQueryPreloader';
export { createQueryPreloader } from './query-preloader/createQueryPreloader';

export * from './types/types';
