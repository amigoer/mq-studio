#!/bin/sh
set -eu
npm --prefix desktop run generate:api
if ! git diff --quiet -- desktop/src/generated/schema.ts; then
  echo "OpenAPI 生成类型已过期，请运行 npm run generate:api 并提交结果。" >&2
  git diff -- desktop/src/generated/schema.ts
  exit 1
fi
