#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/bootstrap-wasip3-toolchain.sh [--foreground]

Prepare a Rust source checkout that contains wasm32-wasip3 support, then build the custom
browser toolchain with the wasm32-wasip3 libc patch overlay enabled.

This script forwards all arguments to scripts/build-custom-rustc-toolchain.sh after updating the
Rust source checkout.
EOF
  exit 0
fi

bash "$SCRIPT_DIR/prepare-wasip3-rust-source.sh"
exec /bin/bash "$SCRIPT_DIR/build-custom-rustc-toolchain.sh" "$@"
