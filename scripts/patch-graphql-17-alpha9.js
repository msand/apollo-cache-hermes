#!/usr/bin/env node
// Applies Apollo Client's patch to graphql 17.0.0-alpha.9's type declarations
// (apollo-client/patches/graphql-17-alpha9+17.0.0-alpha.9.patch): alpha.9 sends
// `completed: [{ id, errors }]`, but its FormattedCompletedResult type still
// declares the older `{ path, label }` shape. Apollo Client's @defer/@stream tests
// (vendored in test/src) build such results.
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '../node_modules/graphql-17-alpha9/execution/types.d.ts');
if (!fs.existsSync(file)) process.exit(0);

const before = `export interface FormattedCompletedResult {
    path: ReadonlyArray<string | number>;
    label?: string;
    errors?: ReadonlyArray<GraphQLError>;
}`;
const after = `export interface FormattedCompletedResult {
    id: string;
    errors?: ReadonlyArray<GraphQLFormattedError>;
}`;

const source = fs.readFileSync(file, 'utf8');
if (source.includes(after)) process.exit(0);
if (!source.includes(before)) {
  console.error(`${file}: FormattedCompletedResult not found; update scripts/patch-graphql-17-alpha9.js`);
  process.exit(1);
}
fs.writeFileSync(file, source.replace(before, after));
