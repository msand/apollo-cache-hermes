#!/usr/bin/env bash
set -e

source ./scripts/include/node.sh

# Compile with TypeScript 7 (the native compiler, installed as typescript-7).
# The `typescript` package stays on 6.x for typescript-eslint, which does not
# support TypeScript 7 yet (it needs a TypeScript API that 7.0 doesn't have).
TSC=./node_modules/typescript-7/bin/tsc

run clean
"${TSC}" "${@}"
# The vendored Apollo Client tests; see tsconfig.vendored.json.
"${TSC}" -p tsconfig.vendored.json "${@}"
