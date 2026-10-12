// Re-export @apollo/client's errors so the vendored sources, the tests and the
// ApolloClient under test share one ApolloError class and protocol-errors symbol.
export * from '@apollo/client/errors';
