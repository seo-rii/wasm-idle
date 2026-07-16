#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/bootstrap-switch.sh

Create a host-side frozen OCaml switch that can later be collected into a browser bundle.

Environment:
  WASM_OF_JS_OF_OCAML_OPAM_BIN         Custom opam executable. Default: opam
  WASM_OF_JS_OF_OCAML_OPAM_ROOT        Custom opam root. Default: ~/.cache/wasm-of-js-of-ocaml/opam
  WASM_OF_JS_OF_OCAML_SWITCH_NAME      Switch name. Default: wasm-of-js-of-ocaml-5.4.1
  WASM_OF_JS_OF_OCAML_COMPILER_PACKAGE Compiler package. Default: ocaml-base-compiler.5.4.1.
  WASM_OF_JS_OF_OCAML_BASE_PACKAGES    Space-separated package list.
  WASM_OF_JS_OF_OCAML_INSTALL_WASM_COMPILER
                                       Install wasm_of_ocaml-compiler when non-empty.
  WASM_OF_JS_OF_OCAML_JSOO_SOURCE_DIR  Optional local js_of_ocaml checkout to pin.
EOF
  exit 0
fi

DEFAULT_LOCAL_OPAM_BIN="$PWD/.cache/opam-2.2.1"
OPAM_BIN="${WASM_OF_JS_OF_OCAML_OPAM_BIN:-}"
if [[ -z "$OPAM_BIN" && -x "$DEFAULT_LOCAL_OPAM_BIN" ]]; then
  OPAM_BIN="$DEFAULT_LOCAL_OPAM_BIN"
fi
if [[ -z "$OPAM_BIN" ]]; then
  OPAM_BIN="opam"
fi

if ! command -v "$OPAM_BIN" >/dev/null 2>&1; then
  echo "error: opam is required to bootstrap the frozen switch (looked for $OPAM_BIN)" >&2
  exit 1
fi

OPAM_ROOT="${WASM_OF_JS_OF_OCAML_OPAM_ROOT:-$HOME/.cache/wasm-of-js-of-ocaml/opam}"
PINNED_OCAML_VERSION="5.4.1"
PINNED_JS_OF_OCAML_VERSION="6.3.2"
SWITCH_NAME="${WASM_OF_JS_OF_OCAML_SWITCH_NAME:-wasm-of-js-of-ocaml-$PINNED_OCAML_VERSION}"
BASE_PACKAGES="${WASM_OF_JS_OF_OCAML_BASE_PACKAGES:-ocamlfind dune js_of_ocaml.$PINNED_JS_OF_OCAML_VERSION js_of_ocaml-compiler.$PINNED_JS_OF_OCAML_VERSION}"
INSTALL_WASM_COMPILER="${WASM_OF_JS_OF_OCAML_INSTALL_WASM_COMPILER:-}"
JSOO_SOURCE_DIR="${WASM_OF_JS_OF_OCAML_JSOO_SOURCE_DIR:-}"

mkdir -p "$OPAM_ROOT"
if [[ ! -d "$OPAM_ROOT/default" && ! -f "$OPAM_ROOT/config" ]]; then
  OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" init --bare --disable-sandboxing -y >/dev/null
fi

COMPILER_PACKAGE="${WASM_OF_JS_OF_OCAML_COMPILER_PACKAGE:-ocaml-base-compiler.$PINNED_OCAML_VERSION}"

if ! OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" switch list --short 2>/dev/null | grep -Fxq "$SWITCH_NAME"; then
  OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" switch create "$SWITCH_NAME" "$COMPILER_PACKAGE" -y
fi

eval "$(OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" env --root="$OPAM_ROOT" --switch="$SWITCH_NAME" --set-switch)"

if [[ -n "$JSOO_SOURCE_DIR" ]]; then
  if [[ ! -d "$JSOO_SOURCE_DIR" ]]; then
    echo "error: WASM_OF_JS_OF_OCAML_JSOO_SOURCE_DIR does not exist: $JSOO_SOURCE_DIR" >&2
    exit 1
  fi
  OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" pin add -y js_of_ocaml "$JSOO_SOURCE_DIR"
fi

OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" install -y $BASE_PACKAGES

if [[ -n "$INSTALL_WASM_COMPILER" ]]; then
  OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" install -y wasm_of_ocaml-compiler
fi

PREFIX="$(OPAMROOT="$OPAM_ROOT" "$OPAM_BIN" var --root "$OPAM_ROOT" --switch "$SWITCH_NAME" prefix)"
echo "bootstrap complete"
echo "opam-root=$OPAM_ROOT"
echo "switch-name=$SWITCH_NAME"
echo "switch-prefix=$PREFIX"
echo "next: node ./scripts/collect-toolchain.mjs --switch-prefix \"$PREFIX\""
if [[ -z "$INSTALL_WASM_COMPILER" ]]; then
  echo "optional: set WASM_OF_JS_OF_OCAML_INSTALL_WASM_COMPILER=1 when binaryen is already on PATH"
fi
