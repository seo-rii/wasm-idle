#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CACHE_DIR="$PROJECT_ROOT/.cache"
OPAM_BIN_PATH="${WASM_OF_JS_OF_OCAML_BOOTSTRAP_OPAM_PATH:-$CACHE_DIR/opam-2.2.1}"
BINARYEN_DIR="${WASM_OF_JS_OF_OCAML_BOOTSTRAP_BINARYEN_DIR:-$CACHE_DIR/binaryen-version_129}"

mkdir -p "$CACHE_DIR"

if [[ ! -x "$OPAM_BIN_PATH" ]]; then
  curl -L https://github.com/ocaml/opam/releases/download/2.2.1/opam-2.2.1-x86_64-linux -o "$OPAM_BIN_PATH"
  chmod +x "$OPAM_BIN_PATH"
fi

if [[ ! -x "$BINARYEN_DIR/bin/wasm-merge" ]]; then
  ARCHIVE_PATH="$CACHE_DIR/binaryen-version_129.tar.gz"
  curl -L https://github.com/WebAssembly/binaryen/releases/download/version_129/binaryen-version_129-x86_64-linux.tar.gz -o "$ARCHIVE_PATH"
  tar -xzf "$ARCHIVE_PATH" -C "$CACHE_DIR"
fi

echo "opam-bin=$OPAM_BIN_PATH"
echo "binaryen-bin=$BINARYEN_DIR/bin"
