#!/usr/bin/env bash
# Regenerate pydantic models from the contracts package's emitted JSON Schemas.
# Generated models are the ONLY shapes the worker API speaks — never hand-edit.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMAS="$HERE/../../packages/contracts/jsonschema"
OUT="$HERE/app/contracts_gen"

mkdir -p "$OUT"
for schema in extraction-result extraction-job-submit extraction-status \
              extraction-webhook extraction-result-pointer; do
  module="${schema//-/_}"
  uv run datamodel-codegen \
    --input "$SCHEMAS/$schema.json" \
    --input-file-type jsonschema \
    --output "$OUT/$module.py" \
    --output-model-type pydantic_v2.BaseModel \
    --use-standard-collections --use-union-operator
  echo "✓ $OUT/$module.py"
done
touch "$OUT/__init__.py"
