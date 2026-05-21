#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_RUST_CACHE_ROOT="${HOME}/.cache/wasm-rust-real-rustc-20260317/rust"

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/prepare-wasip3-runtime.sh [--probe]

Build a wasm-rust runtime bundle with wasm32-wasip3 enabled.

Optional environment:
  WASM_RUST_WASI_SDK_ROOT                Path to wasi-sdk >= 22 with bin/wasm-component-ld
  WASM_RUST_RUSTC_ROOT                   Custom Rust install root containing rustc.wasm and wasm32-wasip3 sysroot
  WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT Matching stage2 toolchain used to probe native link args
  WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT Native sysroot root used with the matching rustc (defaults to WASM_RUST_RUSTC_ROOT)
  WASM_RUST_RUNTIME_TARGET_TRIPLES       Defaults to wasm32-wasip1,wasm32-wasip2,wasm32-wasip3
  WASM_RUST_DEFAULT_TARGET_TRIPLE        Defaults to wasm32-wasip1

Important:
  As documented by rustc for 2025-10-01, wasm32-wasip3 still needs a libc [patch].
  This script assumes your custom Rust install root and matching native sysroot were already built with that patch.

The script fails fast when wasm32-wasip3 prerequisites are missing instead of silently skipping it.
Pass --probe to run the native wasm32-wasip3 link probe after the runtime build.
EOF
  exit 0
fi

run_probe=0
if [[ "${1:-}" == "--probe" ]]; then
  run_probe=1
elif [[ $# -gt 0 ]]; then
  printf 'unsupported argument: %s\n' "$1" >&2
  exit 2
fi

rustc_root="${WASM_RUST_RUSTC_ROOT:-${DEFAULT_RUST_CACHE_ROOT}/dist-emit-ir}"
matching_native_toolchain_root="${WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT:-${DEFAULT_RUST_CACHE_ROOT}/build/x86_64-unknown-linux-gnu/stage2}"
matching_native_sysroot_root="${WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT:-$rustc_root}"
wasi_sdk_root="${WASM_RUST_WASI_SDK_ROOT:-${WASI_SDK_PATH:-}}"
runtime_target_triples="${WASM_RUST_RUNTIME_TARGET_TRIPLES:-wasm32-wasip1,wasm32-wasip2,wasm32-wasip3}"
default_target_triple="${WASM_RUST_DEFAULT_TARGET_TRIPLE:-wasm32-wasip1}"

if [[ -z "$wasi_sdk_root" ]]; then
  mapfile -t wasi_sdk_candidates < <(
    find \
      "$(dirname "$(dirname "$rustc_root")")" \
      "$HOME/.cache" \
      -maxdepth 3 \
      -type d \
      -name 'wasi-sdk-*' \
      2>/dev/null \
      | sort -Vr
  )
  for candidate in "${wasi_sdk_candidates[@]}"; do
    if [[ -x "$candidate/bin/wasm-component-ld" ]]; then
      wasi_sdk_root="$candidate"
      printf '[wasm-rust] auto-detected wasi-sdk root: %s\n' "$wasi_sdk_root"
      break
    fi
  done
fi

if [[ -z "$wasi_sdk_root" ]]; then
  printf 'WASM_RUST_WASI_SDK_ROOT is required to package wasm32-wasip3, or a cached wasi-sdk >= 22 must exist under the rustc cache / $HOME/.cache\n' >&2
  exit 1
fi

if [[ ! -f "$rustc_root/bin/rustc.wasm" ]]; then
  printf 'missing rustc.wasm at %s\n' "$rustc_root/bin/rustc.wasm" >&2
  exit 1
fi

if [[ ! -d "$rustc_root/lib/rustlib/wasm32-wasip3/lib" ]]; then
  printf 'missing wasm32-wasip3 sysroot at %s\n' "$rustc_root/lib/rustlib/wasm32-wasip3/lib" >&2
  printf 'build/install a custom toolchain with wasm32-wasip3 first (for example: pnpm run toolchain:build:custom:wasip3), and ensure the documented libc [patch] was applied before rerunning this script\n' >&2
  exit 1
fi

if [[ ! -x "$matching_native_toolchain_root/bin/rustc" ]]; then
  printf 'missing matching stage2 rustc at %s\n' "$matching_native_toolchain_root/bin/rustc" >&2
  exit 1
fi

if [[ ! -d "$matching_native_sysroot_root/lib/rustlib/wasm32-wasip3/lib" ]]; then
  printf 'missing matching native wasm32-wasip3 sysroot at %s\n' "$matching_native_sysroot_root/lib/rustlib/wasm32-wasip3/lib" >&2
  printf 'the matching native sysroot must also be built with the documented libc [patch]\n' >&2
  exit 1
fi

if [[ ! -x "$wasi_sdk_root/bin/wasm-component-ld" ]]; then
  printf 'missing wasm-component-ld at %s\n' "$wasi_sdk_root/bin/wasm-component-ld" >&2
  exit 1
fi

wasi_sdk_version=""
for candidate in \
  "$wasi_sdk_root" \
  "$wasi_sdk_root/VERSION" \
  "$wasi_sdk_root/share/wasi-sdk/VERSION" \
  "$wasi_sdk_root/share/wasi-sdk/version.txt"
do
  if [[ -d "$candidate" ]]; then
    value="$(basename "$candidate")"
  elif [[ -f "$candidate" ]]; then
    value="$(<"$candidate")"
  else
    continue
  fi
  if [[ "$value" =~ wasi-sdk[^0-9]*([0-9]+)(\.([0-9]+))? ]]; then
    wasi_sdk_version="${BASH_REMATCH[1]}.${BASH_REMATCH[3]:-0}"
    break
  fi
  if [[ "$value" =~ (^|[^0-9])([0-9]+)\.([0-9]+)([^0-9]|$) ]]; then
    wasi_sdk_version="${BASH_REMATCH[2]}.${BASH_REMATCH[3]}"
    break
  fi
done
if [[ -n "$wasi_sdk_version" ]]; then
  if [[ "$wasi_sdk_version" =~ ^([0-9]+)\.([0-9]+)$ ]] && (( BASH_REMATCH[1] < 22 )); then
    printf 'wasi-sdk >= 22 is required for wasm32-wasip3, found: %s\n' "$wasi_sdk_version" >&2
    exit 1
  fi
else
  printf 'warning: unable to determine wasi-sdk version under %s; assuming it satisfies wasm32-wasip3 requirements\n' "$wasi_sdk_root" >&2
fi

printf '[wasm-rust] preparing runtime with wasm32-wasip3 enabled\n'
printf '[wasm-rust] rustc root: %s\n' "$rustc_root"
printf '[wasm-rust] matching native toolchain: %s\n' "$matching_native_toolchain_root"
printf '[wasm-rust] matching native sysroot: %s\n' "$matching_native_sysroot_root"
printf '[wasm-rust] wasi-sdk root: %s\n' "$wasi_sdk_root"
printf '[wasm-rust] note: wasm32-wasip3 currently requires the documented libc [patch] upstream\n'

(
  cd "$PROJECT_ROOT"
  WASM_RUST_RUSTC_ROOT="$rustc_root" \
  WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT="$matching_native_toolchain_root" \
  WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT="$matching_native_sysroot_root" \
  WASM_RUST_WASI_SDK_ROOT="$wasi_sdk_root" \
  WASM_RUST_RUNTIME_TARGET_TRIPLES="$runtime_target_triples" \
  WASM_RUST_DEFAULT_TARGET_TRIPLE="$default_target_triple" \
  WASM_RUST_ALLOW_MISSING_TARGETS=0 \
  pnpm run build
)

if [[ $run_probe -eq 1 ]]; then
  (
    cd "$PROJECT_ROOT"
    WASM_RUST_MATCHING_NATIVE_TOOLCHAIN_ROOT="$matching_native_toolchain_root" \
    WASM_RUST_MATCHING_NATIVE_SYSROOT_ROOT="$matching_native_sysroot_root" \
    pnpm run probe:native-link:wasip3
  )
fi

printf '[wasm-rust] wasm32-wasip3 runtime bundle is ready\n'
printf '[wasm-rust] check dist/runtime/runtime-manifest.v3.json for targets["wasm32-wasip3"]\n'
