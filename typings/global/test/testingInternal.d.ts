// Apollo Client 4.3.3's src/testing/internal/declarations.d.ts: the type overrides its test suite
// (vendored in test/src) is written against. They enable GraphQL Codegen data masking types, the
// Defer20220824 incremental types and a distinguishable `Streaming<TData>`.
import type { Defer20220824Handler } from '@apollo/client/incremental';
import type { GraphQLCodegenDataMasking } from '@apollo/client/masking';
import type { HKT } from '@apollo/client/utilities';

type StreamingOverride<TData> = TData & { __streaming?: true };
interface StreamingOverrideHKT extends HKT {
  return: StreamingOverride<this['arg1']>;
}

declare module '@apollo/client' {
  export interface TypeOverrides extends GraphQLCodegenDataMasking.TypeOverrides, Defer20220824Handler.TypeOverrides {
    Streaming: StreamingOverrideHKT;
  }
}
