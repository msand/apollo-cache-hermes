#!/usr/bin/env bash
set -e

source ./scripts/include/shell.sh
source ./scripts/include/node.sh

FILES=("${OPTIONS_ARGS[@]}")
if [[ "${#FILES[@]}" = "0" ]]; then
  FILES+=($(
    find . \
      -not -path "./apollo-client/*" \
      -not -path "*/node_modules/*" \
      \( -name "*.ts" -not -name "*.d.ts" \) \
      -or -name "*.tsx" \
      -not -path "./apollo-client/*" \
      -not -path "*/node_modules/*"
  ))
fi

OPTIONS=(
  "${OPTIONS_FLAGS[@]}"
  --report-unused-disable-directives
)

eslint "${OPTIONS[@]}" "${FILES[@]}"
