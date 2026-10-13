#!/usr/bin/env bash
set -e

source ./scripts/include/node.sh

run clean
tsc "${@}"
# The vendored Apollo Client tests; see tsconfig.vendored.json.
tsc -p tsconfig.vendored.json "${@}"
