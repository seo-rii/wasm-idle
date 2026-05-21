#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: scripts/prepare-wasip3-rust-source.sh

Prepare a Rust source checkout for wasm32-wasip3 browser-toolchain builds.

Preferred behavior is to copy an existing browser-patched Rust checkout and backport the minimal
wasm32-wasip3 support needed by this repo. If no such checkout is available, the script falls back
to fetching an upstream Rust checkout that already contains wasm32-wasip3 target support.

Environment:
  WASM_RUST_CUSTOM_TOOLCHAIN_ROOT        Root used for the default checkout path
  WASM_RUST_REAL_RUSTC_ROOT              Fallback root when CUSTOM_TOOLCHAIN_ROOT is unset
  WASM_RUST_RUST_SOURCE_ROOT             Explicit Rust source checkout path
  WASM_RUST_BROWSER_PATCHED_SOURCE_ROOT  Existing browser-patched Rust checkout to copy first
  WASM_RUST_SKIP_BROWSER_PATCHED_SOURCE  Skip browser-patched source auto-detection when set to 1
  WASM_RUST_RUST_SOURCE_REMOTE           Git remote to fetch (default: https://github.com/rust-lang/rust.git)
  WASM_RUST_RUST_SOURCE_REF              Git ref to fetch (default: main)
  WASM_RUST_RUST_SOURCE_DEPTH            Shallow fetch depth (default: 1, set 0 for full history)
  WASM_RUST_RUST_SOURCE_FILTER           Git partial-clone filter (default: blob:none)
  WASM_RUST_RUST_SOURCE_REMOTE_NAME      Remote name to use (default: origin)

The script prints KEY=VALUE lines for:
  WASM_RUST_RUST_SOURCE_ROOT
  WASM_RUST_RUST_SOURCE_REV
EOF
  exit 0
fi

if [[ $# -gt 0 ]]; then
  printf 'unsupported argument: %s\n' "${1:-}" >&2
  exit 2
fi

root="${WASM_RUST_CUSTOM_TOOLCHAIN_ROOT:-${WASM_RUST_REAL_RUSTC_ROOT:-$HOME/.cache/wasm-rust-custom-toolchain}}"
rust_root="${WASM_RUST_RUST_SOURCE_ROOT:-$root/rust}"
browser_patched_root="${WASM_RUST_BROWSER_PATCHED_SOURCE_ROOT:-}"
remote_url="${WASM_RUST_RUST_SOURCE_REMOTE:-https://github.com/rust-lang/rust.git}"
remote_ref="${WASM_RUST_RUST_SOURCE_REF:-main}"
fetch_depth="${WASM_RUST_RUST_SOURCE_DEPTH:-1}"
fetch_filter="${WASM_RUST_RUST_SOURCE_FILTER:-blob:none}"
remote_name="${WASM_RUST_RUST_SOURCE_REMOTE_NAME:-origin}"
target_file="compiler/rustc_target/src/spec/targets/wasm32_wasip3.rs"
target_registry="compiler/rustc_target/src/spec/mod.rs"
bootstrap_compile="src/bootstrap/src/core/build_steps/compile.rs"
std_pal="library/std/src/sys/pal/mod.rs"
std_os="library/std/src/os/mod.rs"
browser_patched_target_file="compiler/rustc_target/src/spec/targets/wasm32_wasip2.rs"
browser_patched_config="config.wasm-rust-browser.toml"

if [[ "${WASM_RUST_SKIP_BROWSER_PATCHED_SOURCE:-0}" != "1" && -z "$browser_patched_root" ]]; then
  for candidate in \
    "${WASM_RUST_REAL_RUSTC_ROOT:-}/rust" \
    "$HOME/.cache/wasm-rust-real-rustc-20260317/rust"
  do
    if [[ -n "$candidate" && -f "$candidate/$browser_patched_target_file" && -f "$candidate/$browser_patched_config" ]]; then
      browser_patched_root="$candidate"
      break
    fi
  done
fi

mkdir -p "$(dirname "$rust_root")"

if [[ -n "$browser_patched_root" ]]; then
  if [[ ! -d "$browser_patched_root" ]]; then
    printf 'browser-patched rust source root does not exist: %s\n' "$browser_patched_root" >&2
    exit 1
  fi
  if [[ ! -f "$browser_patched_root/$browser_patched_target_file" || ! -f "$browser_patched_root/$browser_patched_config" ]]; then
    printf 'browser-patched rust source root is missing required browser host files: %s\n' "$browser_patched_root" >&2
    exit 1
  fi
  if [[ "$rust_root" != "$browser_patched_root" ]]; then
    rm -rf "$rust_root"
    mkdir -p "$rust_root"
    (
      cd "$browser_patched_root"
      tar --exclude='./build' --exclude='./dist-emit-ir' --exclude='./.git/index.lock' -cf - .
    ) | (
      cd "$rust_root"
      tar -xf -
    )
  fi
else
  if [[ -e "$rust_root" && ! -d "$rust_root/.git" ]]; then
    printf 'existing rust source root is not a git checkout: %s\n' "$rust_root" >&2
    exit 1
  fi

  if [[ -d "$rust_root/.git" ]]; then
    if [[ -n "$(git -C "$rust_root" status --porcelain)" ]]; then
      printf 'existing rust source checkout has local changes: %s\n' "$rust_root" >&2
      exit 1
    fi
    if git -C "$rust_root" remote get-url "$remote_name" >/dev/null 2>&1; then
      git -C "$rust_root" remote set-url "$remote_name" "$remote_url"
    else
      git -C "$rust_root" remote add "$remote_name" "$remote_url"
    fi
  else
    git init "$rust_root" >/dev/null 2>&1
    git -C "$rust_root" remote add "$remote_name" "$remote_url"
  fi

  fetch_args=(fetch --prune --tags "--filter=$fetch_filter" "$remote_name" "$remote_ref")
  if [[ "$fetch_depth" != "0" ]]; then
    fetch_args=(fetch --prune --tags "--filter=$fetch_filter" --depth "$fetch_depth" "$remote_name" "$remote_ref")
  fi
  git -C "$rust_root" "${fetch_args[@]}" >/dev/null 2>&1
  git -C "$rust_root" checkout --detach --force FETCH_HEAD >/dev/null 2>&1
fi

if [[ ! -f "$rust_root/$target_file" ]]; then
  cat > "$rust_root/$target_file" <<'EOF'
//! The `wasm32-wasip3` target is the next in the chain of `wasm32-wasip1`, then
//! `wasm32-wasip2`, then WASIp3. Today this target is intentionally a thin
//! wrapper around `wasm32-wasip2` while libc and the rest of the WASI stack
//! catch up.

use crate::spec::Target;

pub fn target() -> Target {
    let mut target = super::wasm32_wasip2::target();
    target.llvm_target = "wasm32-wasip3".into();
    target.options.env = "p3".into();
    target
}
EOF
fi

if ! grep -Fq '("wasm32-wasip3", wasm32_wasip3),' "$rust_root/$target_registry"; then
  perl -0pi -e 's/\("wasm32-wasip2", wasm32_wasip2\),\n/\("wasm32-wasip2", wasm32_wasip2\),\n    \("wasm32-wasip3", wasm32_wasip3\),\n/' \
    "$rust_root/$target_registry"
fi

perl -0pi -e 's/\.join\(if target == "wasm32-wasip3" \{ "wasm32-wasip2"\.to_string\(\) \} else \{ if target == "wasm32-wasip3" \{ "wasm32-wasip2"\.to_string\(\) \} else \{ target\.to_string\(\)\.replace\("-preview1", ""\) \}\.replace\("p2", ""\)\.replace\("p1", ""\) \}\)/.join(if target == "wasm32-wasip3" { "wasm32-wasip2".to_string() } else { target.to_string().replace("-preview1", "").replace("p2", "").replace("p1", "") })/' \
  "$rust_root/$bootstrap_compile"
perl -0pi -e 's/\.join\(target\.to_string\(\)\.replace\("-preview1", ""\)\.replace\("p2", ""\)\.replace\("p1", ""\)\)/.join(if target == "wasm32-wasip3" { "wasm32-wasip2".to_string() } else { target.to_string().replace("-preview1", "").replace("p2", "").replace("p1", "") })/' \
  "$rust_root/$bootstrap_compile"
perl -0pi -e 's/("native=\{\}\/lib\/\{\}",\n\s+p\.to_str\(\)\.unwrap\(\),\n\s+)target\.to_string\(\)\.replace\("-preview1", ""\)/$1if target == "wasm32-wasip3" { "wasm32-wasip2".to_string() } else { target.to_string().replace("-preview1", "") }/' \
  "$rust_root/$bootstrap_compile"

if ! grep -q 'target_env = "p3"' "$rust_root/$std_pal"; then
  perl -0pi -e 's/all\(target_os = "wasi", target_env = "p2"\)/all(target_os = "wasi", any(target_env = "p2", target_env = "p3"))/' \
    "$rust_root/$std_pal"
fi

if ! grep -q 'target_env = "p3"' "$rust_root/$std_os"; then
  perl -0pi -e 's/all\(target_os = "wasi", target_env = "p2"\)/all(target_os = "wasi", any(target_env = "p2", target_env = "p3"))/' \
    "$rust_root/$std_os"
fi

if [[ ! -f "$rust_root/$target_file" ]]; then
  printf 'prepared Rust source root %s but %s is still missing\n' "$rust_root" "$target_file" >&2
  exit 1
fi

printf 'WASM_RUST_RUST_SOURCE_ROOT=%s\n' "$rust_root"
if [[ -d "$rust_root/.git" ]]; then
  printf 'WASM_RUST_RUST_SOURCE_REV=%s\n' "$(git -C "$rust_root" rev-parse HEAD)"
else
  printf 'WASM_RUST_RUST_SOURCE_REV=worktree\n'
fi
