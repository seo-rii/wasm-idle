#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-dool-ocaml-judge-path-test}"

if [ ! -f "$ROOT_DIR/build/languages/ocaml.js" ]; then
    echo "build artifact missing: $ROOT_DIR/build/languages/ocaml.js" >&2
    echo "run 'pnpm --dir $ROOT_DIR build:ts' first" >&2
    exit 1
fi

docker build \
    --progress=plain \
    --platform linux/amd64 \
    -f "$ROOT_DIR/Dockerfile/base.Dockerfile" \
    -t "$IMAGE_TAG" \
    "$ROOT_DIR"

docker run --rm \
    --cpus=1 \
    --memory=2g \
    -v "$ROOT_DIR:/src:ro" \
    -w /src \
    --entrypoint node \
    "$IMAGE_TAG" \
    test/ocaml/verify-judge-path.js
