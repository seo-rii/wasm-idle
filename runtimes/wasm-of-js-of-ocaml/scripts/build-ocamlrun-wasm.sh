#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/build-ocamlrun-wasm.sh

Prepare an ocamlrun.wasm build plan for the browser toolchain substrate.

Environment:
  WASM_OF_JS_OF_OCAML_OCAML_SOURCE_ROOT  Required OCaml source tree
  WASM_OF_JS_OF_OCAML_BUILD_DIR          Output build directory
EOF
  exit 0
fi

OCAML_SOURCE_ROOT="${WASM_OF_JS_OF_OCAML_OCAML_SOURCE_ROOT:-}"
BUILD_DIR="${WASM_OF_JS_OF_OCAML_BUILD_DIR:-$PWD/.cache/ocamlrun-wasm}"

if [[ -z "$OCAML_SOURCE_ROOT" ]]; then
  echo "error: set WASM_OF_JS_OF_OCAML_OCAML_SOURCE_ROOT to an OCaml source checkout" >&2
  exit 1
fi

if [[ ! -d "$OCAML_SOURCE_ROOT" ]]; then
  echo "error: OCaml source root does not exist: $OCAML_SOURCE_ROOT" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"

if command -v emcc >/dev/null 2>&1; then
  TOOLCHAIN="emscripten"
elif command -v clang >/dev/null 2>&1; then
  TOOLCHAIN="wasi-clang"
else
  echo "error: neither emcc nor clang is available; cannot prepare an ocamlrun.wasm build plan" >&2
  exit 1
fi

cat > "$BUILD_DIR/ocamlrun-wasm.plan.txt" <<EOF
toolchain=$TOOLCHAIN
ocaml-source-root=$OCAML_SOURCE_ROOT
build-dir=$BUILD_DIR

Next steps:
1. Freeze the OCaml runtime ABI and select the browser substrate (WASI vs custom host bridge).
2. Add configure/make invocations for ocamlrun once the substrate choice is finalized.
3. Emit ocamlrun.wasm and a manifest consumable by scripts/prepare-runtime.mjs.
EOF

echo "$BUILD_DIR/ocamlrun-wasm.plan.txt"

