#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE_TAG="${IMAGE_TAG:-dool-haskell-judge-path-test}"

if [ ! -f "$ROOT_DIR/build/languages/haskell.js" ]; then
    echo "build artifact missing: $ROOT_DIR/build/languages/haskell.js" >&2
    echo "run 'npm run build:ts' first" >&2
    exit 1
fi

docker build \
    -t "$IMAGE_TAG" \
    --platform linux/amd64 \
    -f "$ROOT_DIR/Dockerfile/base.Dockerfile" \
    "$ROOT_DIR"

docker run \
    --rm \
    --platform linux/amd64 \
    -v "$ROOT_DIR:/workspace" \
    -w /workspace \
    "$IMAGE_TAG" \
    node \
    test/haskell/verify-judge-path.js
