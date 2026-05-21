#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$RUNTIME_DIR"

mix deps.get
mix popcorn.cook --target wasm --out-dir dist/wasm
