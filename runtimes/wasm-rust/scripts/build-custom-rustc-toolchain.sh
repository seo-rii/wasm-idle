#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="${WASM_RUST_BUILD_SCRIPT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
SELF_PATH="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
ROOT="${WASM_RUST_CUSTOM_TOOLCHAIN_ROOT:-${WASM_RUST_REAL_RUSTC_ROOT:-$HOME/.cache/wasm-rust-custom-toolchain}}"
RUST_ROOT="${WASM_RUST_RUST_SOURCE_ROOT:-$ROOT/rust}"
CONFIG_PATH="${WASM_RUST_RUST_CONFIG:-$RUST_ROOT/config.wasm-rust-browser.toml}"
EFFECTIVE_CONFIG_PATH="${WASM_RUST_EFFECTIVE_RUST_CONFIG:-$ROOT/config.wasm-rust-browser.effective.toml}"
COMPILER_HOST_TARGET="${WASM_RUST_COMPILER_HOST_TARGET:-wasm32-wasip1-threads}"
INSTALL_TARGETS="${WASM_RUST_INSTALL_TARGETS:-x86_64-unknown-linux-gnu,wasm32-wasip1,wasm32-wasip2}"
LLVM_BUILD="${WASM_RUST_LLVM_BUILD_DIR:-$RUST_ROOT/build/$COMPILER_HOST_TARGET/llvm/build}"
BUILD_HOST_TARGET="${WASM_RUST_BUILD_HOST_TARGET:-}"
BUILD_JOBS="${WASM_RUST_BUILD_JOBS:-8}"
DISABLE_INCREMENTAL="${WASM_RUST_DISABLE_INCREMENTAL:-1}"
PRUNE_INCREMENTAL="${WASM_RUST_PRUNE_INCREMENTAL:-1}"
LOG="${WASM_RUST_BUILD_LOG:-$ROOT/wasm-rust-custom-toolchain.log}"
PID="${WASM_RUST_BUILD_PID_FILE:-$ROOT/wasm-rust-custom-toolchain.pid}"
EXIT="${WASM_RUST_BUILD_EXIT_FILE:-$ROOT/wasm-rust-custom-toolchain.exit.txt}"
LOCK="${WASM_RUST_BUILD_LOCK_FILE:-$ROOT/wasm-rust-custom-toolchain.lock}"

is_pid_alive() {
  local pid="$1"
  local stat=''
  if [[ -z "$pid" || ! "$pid" =~ ^[0-9]+$ || "$pid" -le 0 ]]; then
    return 1
  fi
  if ! kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
  if stat="$(ps -p "$pid" -o stat= 2>/dev/null)"; then
    stat="$(printf '%s' "$stat" | tr -d '[:space:]')"
    if [[ "$stat" == Z* ]]; then
      return 1
    fi
  fi
  return 0
}

read_pid_file() {
  local pid_contents=''
  if [[ ! -f "$PID" ]]; then
    return 1
  fi
  pid_contents="$(tr -d '[:space:]' < "$PID" 2>/dev/null || true)"
  if [[ -z "$pid_contents" || ! "$pid_contents" =~ ^[0-9]+$ || "$pid_contents" -le 0 ]]; then
    return 1
  fi
  printf '%s\n' "$pid_contents"
}

is_active_build_process() {
  local pid="$1"
  local cmdline=''
  if ! is_pid_alive "$pid"; then
    return 1
  fi
  if ! cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"; then
    return 1
  fi
  [[ "$cmdline" == *"build-custom-rustc-toolchain"* && "$cmdline" == *"--foreground"* ]]
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

if [[ "${1:-}" != "--foreground" ]]; then
  mkdir -p "$ROOT"
  touch "$LOG"
  exec 9>"$LOCK"
  if ! flock -n 9; then
    existing_pid="$(read_pid_file || true)"
    if [[ -n "$existing_pid" ]] && is_active_build_process "$existing_pid"; then
      printf '[%s] build-custom-rustc-toolchain: detected active build process pid=%s while waiting on %s; reusing existing detached build instead of spawning a duplicate\n' \
        "$(date -Is)" "$existing_pid" "$LOCK" >> "$LOG"
      printf '%s\n' "$existing_pid"
      exit 0
    fi
    flock 9
  fi
  existing_pid="$(read_pid_file || true)"
  if [[ -n "$existing_pid" ]] && is_active_build_process "$existing_pid"; then
    printf '[%s] build-custom-rustc-toolchain: detected active build process pid=%s; reusing existing detached build instead of spawning a duplicate\n' \
      "$(date -Is)" "$existing_pid" >> "$LOG"
    printf '%s\n' "$existing_pid"
    exit 0
  fi
  printf '%s\n' "NO_EXIT_STATUS_YET" > "$EXIT"
  snapshot_path="$ROOT/build-custom-rustc-toolchain.snapshot.sh"
  cp "$SELF_PATH" "$snapshot_path"
  chmod +x "$snapshot_path"
  printf '[%s] build-custom-rustc-toolchain: wrote detached build snapshot %s from %s\n' \
    "$(date -Is)" "$snapshot_path" "$SELF_PATH" >> "$LOG"
  if command -v setsid >/dev/null 2>&1; then
    WASM_RUST_BUILD_SCRIPT_DIR="$SCRIPT_DIR" setsid /bin/bash "$snapshot_path" --foreground >>"$LOG" 2>&1 < /dev/null &
  else
    WASM_RUST_BUILD_SCRIPT_DIR="$SCRIPT_DIR" nohup /bin/bash "$snapshot_path" --foreground >>"$LOG" 2>&1 < /dev/null &
  fi
  child_pid=$!
  printf '%s\n' "$child_pid" > "$PID"
  printf '%s\n' "$child_pid"
  exit 0
fi

mkdir -p "$ROOT"
touch "$LOG"
active_child_pid=""
exec 9>"$LOCK"
if ! flock -n 9; then
  existing_pid="$(read_pid_file || true)"
  if [[ -n "$existing_pid" ]] && is_active_build_process "$existing_pid"; then
    printf '[%s] build-custom-rustc-toolchain: refusing to start a duplicate foreground build because pid=%s is already active\n' \
      "$(date -Is)" "$existing_pid" >> "$LOG"
    printf '%s\n' "$existing_pid" > "$PID"
    exit 3
  fi
  printf '[%s] build-custom-rustc-toolchain: could not acquire build lock %s\n' "$(date -Is)" "$LOCK" >> "$LOG"
  exit 3
fi
trap 'status=$?; if [[ -n "$active_child_pid" ]] && kill -0 "$active_child_pid" 2>/dev/null; then kill "$active_child_pid" 2>/dev/null || true; wait "$active_child_pid" 2>/dev/null || true; fi; printf "%s\n" "$status" > "$EXIT"' EXIT
trap 'if [[ -n "$active_child_pid" ]] && kill -0 "$active_child_pid" 2>/dev/null; then kill "$active_child_pid" 2>/dev/null || true; wait "$active_child_pid" 2>/dev/null || true; fi; exit 130' INT
trap 'if [[ -n "$active_child_pid" ]] && kill -0 "$active_child_pid" 2>/dev/null; then kill "$active_child_pid" 2>/dev/null || true; wait "$active_child_pid" 2>/dev/null || true; fi; exit 143' TERM
printf '%s\n' "$$" > "$PID"

printf '[%s] build-custom-rustc-toolchain: foreground entry root=%s rust_root=%s config=%s\n' \
  "$(date -Is)" "$ROOT" "$RUST_ROOT" "$CONFIG_PATH" >> "$LOG"

if [[ ! -d "$RUST_ROOT" ]]; then
  printf '[%s] missing rust source root: %s\n' "$(date -Is)" "$RUST_ROOT" >> "$LOG"
  exit 2
fi

status=0
effective_config_path="$CONFIG_PATH"
force_stage1_cleanup=0
force_stage2_cleanup=0
use_threaded_host_env_flags=1

wasi_sdk_root="${WASM_RUST_WASI_SDK_ROOT:-${WASI_SDK_PATH:-}}"
if [[ -n "$wasi_sdk_root" && -d "$wasi_sdk_root/bin" ]]; then
  PATH="$wasi_sdk_root/bin:$PATH"
  export PATH
  printf '[%s] build-custom-rustc-toolchain: prepended wasi-sdk bin directory to PATH: %s\n' "$(date -Is)" "$wasi_sdk_root/bin" >> "$LOG"
fi

if [[ "$COMPILER_HOST_TARGET" == "wasm32-wasip1-threads" ]]; then
  if [[ -f "$RUST_ROOT/src/bootstrap/src/core/build_steps/llvm.rs" ]] && \
    grep -Fq 'if target.contains("wasip1-threads") {' "$RUST_ROOT/src/bootstrap/src/core/build_steps/llvm.rs" && \
    grep -Fq 'cflags.push(" -matomics -mbulk-memory");' "$RUST_ROOT/src/bootstrap/src/core/build_steps/llvm.rs"
  then
    use_threaded_host_env_flags=0
    printf '[%s] build-custom-rustc-toolchain: detected browser-patched bootstrap LLVM config; skipping external CFLAGS_wasm32_wasip1_threads/CXXFLAGS_wasm32_wasip1_threads injection for %s\n' \
      "$(date -Is)" "$COMPILER_HOST_TARGET" >> "$LOG"
  fi

  threaded_target_flag="--target=wasm32-wasip1-threads"
  threaded_endian_defines="-DBYTE_ORDER=__BYTE_ORDER__ -DBIG_ENDIAN=__ORDER_BIG_ENDIAN__ -DLITTLE_ENDIAN=__ORDER_LITTLE_ENDIAN__"
  if [[ "$use_threaded_host_env_flags" -eq 1 ]]; then
    threaded_cflags="${CFLAGS_wasm32_wasip1_threads:-}"
    if [[ "$threaded_cflags" != *"$threaded_target_flag"* ]]; then
      threaded_cflags="${threaded_cflags:+$threaded_cflags }$threaded_target_flag"
    fi
    if [[ "$threaded_cflags" != *"-DBYTE_ORDER=__BYTE_ORDER__"* ]]; then
      threaded_cflags="${threaded_cflags:+$threaded_cflags }$threaded_endian_defines"
    fi
    CFLAGS_wasm32_wasip1_threads="$threaded_cflags"
    export CFLAGS_wasm32_wasip1_threads

    threaded_cxxflags="${CXXFLAGS_wasm32_wasip1_threads:-}"
    if [[ "$threaded_cxxflags" != *"$threaded_target_flag"* ]]; then
      threaded_cxxflags="${threaded_cxxflags:+$threaded_cxxflags }$threaded_target_flag"
    fi
    if [[ "$threaded_cxxflags" != *"-DBYTE_ORDER=__BYTE_ORDER__"* ]]; then
      threaded_cxxflags="${threaded_cxxflags:+$threaded_cxxflags }$threaded_endian_defines"
    fi
    CXXFLAGS_wasm32_wasip1_threads="$threaded_cxxflags"
    export CXXFLAGS_wasm32_wasip1_threads

    printf '[%s] build-custom-rustc-toolchain: forcing thread-aware C/C++ flags for %s via CFLAGS_wasm32_wasip1_threads/CXXFLAGS_wasm32_wasip1_threads\n' \
      "$(date -Is)" "$COMPILER_HOST_TARGET" >> "$LOG"
  fi
fi

stale_bootstrap_pid_pattern="${RUST_ROOT}/build/bootstrap/debug/bootstrap|${RUST_ROOT}/build/bootstrap/debug/rustc|${RUST_ROOT}/build/.*/stage1-rustc"
stale_bootstrap_pids=()
while true; do
  stale_bootstrap_found=0
  while IFS= read -r stale_bootstrap_pid; do
    if [[ -z "$stale_bootstrap_pid" || "$stale_bootstrap_pid" == "$$" ]]; then
      continue
    fi
    stale_bootstrap_found=1
    stale_bootstrap_pids+=("$stale_bootstrap_pid")
    kill "$stale_bootstrap_pid" 2>/dev/null || true
  done < <(pgrep -f "$stale_bootstrap_pid_pattern" || true)
  if [[ "$stale_bootstrap_found" -eq 0 ]]; then
    break
  fi
  sleep 1
done

if [[ "${#stale_bootstrap_pids[@]}" -gt 0 ]]; then
  force_stage1_cleanup=1
  lingering_bootstrap_pids=()
  while IFS= read -r stale_bootstrap_pid; do
    if [[ -n "$stale_bootstrap_pid" && "$stale_bootstrap_pid" != "$$" ]]; then
      lingering_bootstrap_pids+=("$stale_bootstrap_pid")
    fi
  done < <(pgrep -f "$stale_bootstrap_pid_pattern" || true)
  if [[ "${#lingering_bootstrap_pids[@]}" -gt 0 ]]; then
    kill -9 "${lingering_bootstrap_pids[@]}" 2>/dev/null || true
  fi
  printf '[%s] build-custom-rustc-toolchain: terminated %s stale bootstrap helper process%s under %s before cleanup\n' \
    "$(date -Is)" "${#stale_bootstrap_pids[@]}" \
    "$([[ "${#stale_bootstrap_pids[@]}" -eq 1 ]] && printf '' || printf 'es')" \
    "$RUST_ROOT" >> "$LOG"
fi

if [[ "$DISABLE_INCREMENTAL" != "0" && "$DISABLE_INCREMENTAL" != "false" ]]; then
  CARGO_INCREMENTAL=0
  CARGO_PROFILE_RELEASE_INCREMENTAL=false
  CARGO_PROFILE_DEV_INCREMENTAL=false
  export CARGO_INCREMENTAL
  export CARGO_PROFILE_RELEASE_INCREMENTAL
  export CARGO_PROFILE_DEV_INCREMENTAL
  printf '[%s] build-custom-rustc-toolchain: disabled cargo incremental state for bootstrap and compiler builds\n' \
    "$(date -Is)" >> "$LOG"
fi

if [[ "$PRUNE_INCREMENTAL" != "0" && "$PRUNE_INCREMENTAL" != "false" && -d "$RUST_ROOT/build" ]]; then
  pruned_incremental_dirs=0
  while IFS= read -r incremental_dir; do
    rm -rf "$incremental_dir"
    pruned_incremental_dirs=$((pruned_incremental_dirs + 1))
  done < <(find "$RUST_ROOT/build" -type d -name incremental -prune)
  printf '[%s] build-custom-rustc-toolchain: pruned %s stale cargo incremental director%s under %s\n' \
    "$(date -Is)" "$pruned_incremental_dirs" \
    "$([[ "$pruned_incremental_dirs" -eq 1 ]] && printf 'y' || printf 'ies')" \
    "$RUST_ROOT/build" >> "$LOG"
fi

if [[ -z "$BUILD_HOST_TARGET" ]]; then
  if command -v rustc >/dev/null 2>&1; then
    detected_build_host_target="$(rustc -vV 2>/dev/null | sed -n 's/^host: //p' || true)"
    if [[ -n "$detected_build_host_target" ]]; then
      BUILD_HOST_TARGET="$detected_build_host_target"
    fi
  fi
  if [[ -z "$BUILD_HOST_TARGET" ]]; then
    detected_build_arch="$(uname -m 2>/dev/null || true)"
    detected_build_os="$(uname -s 2>/dev/null || true)"
    if [[ "$detected_build_arch" == "x86_64" && "$detected_build_os" == "Linux" ]]; then
      BUILD_HOST_TARGET="x86_64-unknown-linux-gnu"
    elif [[ "$detected_build_arch" == "aarch64" && "$detected_build_os" == "Linux" ]]; then
      BUILD_HOST_TARGET="aarch64-unknown-linux-gnu"
    elif [[ "$detected_build_arch" == "arm64" && "$detected_build_os" == "Darwin" ]]; then
      BUILD_HOST_TARGET="aarch64-apple-darwin"
    elif [[ "$detected_build_arch" == "x86_64" && "$detected_build_os" == "Darwin" ]]; then
      BUILD_HOST_TARGET="x86_64-apple-darwin"
    fi
  fi
fi

if [[ -n "$BUILD_HOST_TARGET" ]]; then
  build_host_stage_root="$RUST_ROOT/build/$BUILD_HOST_TARGET"
  build_host_llvm_root="$build_host_stage_root/llvm/build"
  stage1_rustc_path="$build_host_stage_root/stage1/bin/rustc"
  if [[ -d "$build_host_stage_root" && ( "$force_stage1_cleanup" -eq 1 || ! -x "$stage1_rustc_path" ) ]]; then
    stale_stage1_paths=()
    for stale_stage1_dir in stage1 stage1-rustc stage1-std stage1-tools-bin; do
      if [[ -e "$build_host_stage_root/$stale_stage1_dir" ]]; then
        stale_stage1_paths+=("$build_host_stage_root/$stale_stage1_dir")
      fi
    done
    if [[ "${#stale_stage1_paths[@]}" -gt 0 ]]; then
      rm -rf "${stale_stage1_paths[@]}"
      if [[ "$force_stage1_cleanup" -eq 1 ]]; then
        stale_stage1_reason='stale bootstrap helper processes were terminated'
      else
        stale_stage1_reason="$stage1_rustc_path is missing"
      fi
      printf '[%s] build-custom-rustc-toolchain: removed %s stale stage1 path%s under %s because %s\n' \
        "$(date -Is)" "${#stale_stage1_paths[@]}" \
        "$([[ "${#stale_stage1_paths[@]}" -eq 1 ]] && printf '' || printf 's')" \
        "$build_host_stage_root" "$stale_stage1_reason" >> "$LOG"
    fi
  fi
  if [[ -f "$build_host_llvm_root/CMakeCache.txt" ]] && grep -Fq -- '--target=wasm32-wasip1-threads' "$build_host_llvm_root/CMakeCache.txt"; then
    rm -rf "$build_host_llvm_root"
    printf '[%s] build-custom-rustc-toolchain: removed stale native LLVM build dir %s because its CMake cache captured browser-host thread flags\n' \
      "$(date -Is)" "$build_host_llvm_root" >> "$LOG"
  fi
else
  printf '[%s] build-custom-rustc-toolchain: could not determine the native build host target; skipping stale stage1 cleanup\n' \
    "$(date -Is)" >> "$LOG"
fi

if [[ -f "$CONFIG_PATH" ]]; then
  printf '[%s] build-custom-rustc-toolchain: using existing x.py config %s\n' "$(date -Is)" "$CONFIG_PATH" >> "$LOG"
  cp "$CONFIG_PATH" "$EFFECTIVE_CONFIG_PATH"
else
  printf '[%s] build-custom-rustc-toolchain: generating x.py config because %s is missing\n' "$(date -Is)" "$CONFIG_PATH" >> "$LOG"
  if [[ -z "$wasi_sdk_root" ]]; then
    printf '[%s] build-custom-rustc-toolchain: missing x.py config %s and no WASM_RUST_WASI_SDK_ROOT/WASI_SDK_PATH was provided to generate one\n' "$(date -Is)" "$CONFIG_PATH" >> "$LOG"
    exit 2
  fi
  for required_path in \
    "$wasi_sdk_root/share/wasi-sysroot" \
    "$wasi_sdk_root/bin/clang" \
    "$wasi_sdk_root/bin/clang++" \
    "$wasi_sdk_root/bin/llvm-ar" \
    "$wasi_sdk_root/bin/llvm-ranlib" \
    "$wasi_sdk_root/bin/wasm-component-ld"
  do
    if [[ ! -e "$required_path" ]]; then
      printf '[%s] build-custom-rustc-toolchain: missing required wasi-sdk path %s for generated config\n' "$(date -Is)" "$required_path" >> "$LOG"
      exit 2
    fi
  done
  cat > "$EFFECTIVE_CONFIG_PATH" <<EOF
profile = "compiler"
change-id = 9999999

[llvm]
download-ci-llvm = false
ninja = false

[rust]
codegen-backends = ["llvm"]
deny-warnings = false
llvm-bitcode-linker = false

[build]
docs = false
extended = false
tools = []
host = ["$COMPILER_HOST_TARGET"]

[install]
prefix = "dist-emit-ir"
sysconfdir = "etc"

[target.'wasm32-wasip1']
wasi-root = "$wasi_sdk_root/share/wasi-sysroot"
linker = "$wasi_sdk_root/bin/clang"
cc = "$wasi_sdk_root/bin/clang"
cxx = "$wasi_sdk_root/bin/clang++"
ar = "$wasi_sdk_root/bin/llvm-ar"
ranlib = "$wasi_sdk_root/bin/llvm-ranlib"

[target.'wasm32-wasip1-threads']
wasi-root = "$wasi_sdk_root/share/wasi-sysroot"
linker = "$wasi_sdk_root/bin/clang"
cc = "$wasi_sdk_root/bin/clang"
cxx = "$wasi_sdk_root/bin/clang++"
ar = "$wasi_sdk_root/bin/llvm-ar"
ranlib = "$wasi_sdk_root/bin/llvm-ranlib"
codegen-backends = ["llvm"]

[target.'wasm32-wasip2']
wasi-root = "$wasi_sdk_root/share/wasi-sysroot"
linker = "$wasi_sdk_root/bin/wasm-component-ld"
cc = "$wasi_sdk_root/bin/clang"
cxx = "$wasi_sdk_root/bin/clang++"
ar = "$wasi_sdk_root/bin/llvm-ar"
ranlib = "$wasi_sdk_root/bin/llvm-ranlib"

[target.'x86_64-unknown-linux-gnu']
cc = "${CC:-/usr/bin/gcc}"
EOF
fi

if [[ -f "$EFFECTIVE_CONFIG_PATH" && "$COMPILER_HOST_TARGET" == "wasm32-wasip1-threads" ]]; then
  original_effective_config="$(cat "$EFFECTIVE_CONFIG_PATH")"
  normalized_effective_config="$(
    COMPILER_HOST_TARGET="$COMPILER_HOST_TARGET" awk '
      BEGIN {
        in_host_target = 0
      }
      $0 == "[target.\047" ENVIRON["COMPILER_HOST_TARGET"] "\047]" {
        in_host_target = 1
        print
        next
      }
      in_host_target && /^\[target\./ {
        in_host_target = 0
      }
      in_host_target && /^[[:space:]]*codegen-backends[[:space:]]*=/ {
        print "codegen-backends = [\"llvm\"]"
        next
      }
      {
        print
      }
    ' "$EFFECTIVE_CONFIG_PATH"
  )"
  if [[ "$normalized_effective_config" != "$original_effective_config" ]]; then
    printf '%s' "$normalized_effective_config" > "$EFFECTIVE_CONFIG_PATH"
    force_stage2_cleanup=1
    printf '[%s] build-custom-rustc-toolchain: normalized %s host target codegen-backends to ["llvm"] in %s so browser rustc keeps wasm32-wasip2/wasm32-wasip3 on the LLVM backend\n' \
      "$(date -Is)" "$COMPILER_HOST_TARGET" "$EFFECTIVE_CONFIG_PATH" >> "$LOG"
  fi
fi

install_targets_toml=""
IFS=',' read -r -a install_target_array <<< "$INSTALL_TARGETS"
for install_target in "${install_target_array[@]}"; do
  install_target="$(printf '%s' "$install_target" | xargs)"
  if [[ -z "$install_target" ]]; then
    continue
  fi
  if [[ -n "$install_targets_toml" ]]; then
    install_targets_toml+=", "
  fi
  install_targets_toml+="\"$install_target\""
done
if grep -qE '^[[:space:]]*target[[:space:]]*=' "$EFFECTIVE_CONFIG_PATH"; then
  perl -0pi -e 's/^[ \t]*target[ \t]*=.*$/target = ['"$install_targets_toml"']/m' "$EFFECTIVE_CONFIG_PATH"
elif grep -qE '^\[build\]$' "$EFFECTIVE_CONFIG_PATH"; then
  perl -0pi -e 's/^\[build\]\n/[build]\ntarget = ['"$install_targets_toml"']\n/m' "$EFFECTIVE_CONFIG_PATH"
else
  printf '\n[build]\ntarget = [%s]\n' "$install_targets_toml" >> "$EFFECTIVE_CONFIG_PATH"
fi
effective_config_path="$EFFECTIVE_CONFIG_PATH"
install_prefix_path=""
if [[ -f "$effective_config_path" ]]; then
  install_prefix_value="$(
    awk '
      BEGIN { in_install = 0 }
      /^\[install\]$/ { in_install = 1; next }
      /^\[/ { in_install = 0 }
      in_install && /^[[:space:]]*prefix[[:space:]]*=/ {
        line = $0
        sub(/^[[:space:]]*prefix[[:space:]]*=[[:space:]]*"/, "", line)
        sub(/".*$/, "", line)
        print line
        exit
      }
    ' "$effective_config_path"
  )"
  if [[ -n "$install_prefix_value" ]]; then
    if [[ "$install_prefix_value" = /* ]]; then
      install_prefix_path="$install_prefix_value"
    else
      install_prefix_path="$RUST_ROOT/$install_prefix_value"
    fi
  fi
fi

if [[ "$force_stage2_cleanup" -eq 1 ]]; then
  compiler_host_stage_root="$RUST_ROOT/build/$COMPILER_HOST_TARGET"
  stale_stage2_paths=()
  for stale_stage2_dir in stage2 stage2-rustc stage2-std stage2-tools-bin; do
    if [[ -e "$compiler_host_stage_root/$stale_stage2_dir" ]]; then
      stale_stage2_paths+=("$compiler_host_stage_root/$stale_stage2_dir")
    fi
  done
  if [[ "${#stale_stage2_paths[@]}" -gt 0 ]]; then
    rm -rf "${stale_stage2_paths[@]}"
    printf '[%s] build-custom-rustc-toolchain: removed %s stale stage2 path%s under %s because the browser host target backend config changed\n' \
      "$(date -Is)" "${#stale_stage2_paths[@]}" \
      "$([[ "${#stale_stage2_paths[@]}" -eq 1 ]] && printf '' || printf 's')" \
      "$compiler_host_stage_root" >> "$LOG"
  fi
  if [[ -n "$install_prefix_path" && -f "$install_prefix_path/bin/rustc.wasm" ]]; then
    rm -f "$install_prefix_path/bin/rustc.wasm"
    printf '[%s] build-custom-rustc-toolchain: removed stale installed rustc.wasm at %s because the browser host target backend config changed\n' \
      "$(date -Is)" "$install_prefix_path/bin/rustc.wasm" >> "$LOG"
  fi
fi

if [[ "$INSTALL_TARGETS" == *"wasm32-wasip3"* ]]; then
  if [[ ! -f "$RUST_ROOT/compiler/rustc_target/src/spec/targets/wasm32_wasip3.rs" ]]; then
    printf '[%s] build-custom-rustc-toolchain: missing wasm32-wasip3 target support in rust source root %s\n' "$(date -Is)" "$RUST_ROOT" >> "$LOG"
    printf '[%s] build-custom-rustc-toolchain: update the Rust checkout to one that already contains wasm32-wasip3 target support before applying the libc patch overlay\n' "$(date -Is)" >> "$LOG"
    exit 2
  fi
  if ! grep -q "\\[target.'wasm32-wasip3'\\]" "$EFFECTIVE_CONFIG_PATH"; then
    printf '[%s] build-custom-rustc-toolchain: appending wasm32-wasip3 target config to %s\n' "$(date -Is)" "$EFFECTIVE_CONFIG_PATH" >> "$LOG"
    if [[ -z "$wasi_sdk_root" ]]; then
      printf '[%s] build-custom-rustc-toolchain: WASM_RUST_WASI_SDK_ROOT or WASI_SDK_PATH is required to generate the wasm32-wasip3 target config\n' "$(date -Is)" >> "$LOG"
      exit 2
    fi
    for required_path in \
      "$wasi_sdk_root/share/wasi-sysroot" \
      "$wasi_sdk_root/bin/clang" \
      "$wasi_sdk_root/bin/clang++" \
      "$wasi_sdk_root/bin/llvm-ar" \
      "$wasi_sdk_root/bin/llvm-ranlib" \
      "$wasi_sdk_root/bin/wasm-component-ld"
    do
      if [[ ! -e "$required_path" ]]; then
        printf '[%s] build-custom-rustc-toolchain: missing required wasi-sdk path %s for wasm32-wasip3 config generation\n' "$(date -Is)" "$required_path" >> "$LOG"
        exit 2
      fi
    done
    cat >> "$EFFECTIVE_CONFIG_PATH" <<EOF

[target.'wasm32-wasip3']
wasi-root = "$wasi_sdk_root/share/wasi-sysroot"
linker = "$wasi_sdk_root/bin/wasm-component-ld"
cc = "$wasi_sdk_root/bin/clang"
cxx = "$wasi_sdk_root/bin/clang++"
ar = "$wasi_sdk_root/bin/llvm-ar"
ranlib = "$wasi_sdk_root/bin/llvm-ranlib"
EOF
  fi
  printf '[%s] build-custom-rustc-toolchain: preparing wasm32-wasip3 libc overlay\n' "$(date -Is)" >> "$LOG"
  overlay_output="$(bash "$SCRIPT_DIR/prepare-wasip3-libc-overlay.sh" 2>>"$LOG")" || {
    printf '[%s] build-custom-rustc-toolchain: wasm32-wasip3 libc overlay preparation failed\n' "$(date -Is)" >> "$LOG"
    exit 2
  }
  while IFS='=' read -r key value; do
    case "$key" in
      WASM_RUST_WASIP3_LIBC_PATCH_SOURCE)
        WASM_RUST_WASIP3_LIBC_PATCH_SOURCE="$value"
        export WASM_RUST_WASIP3_LIBC_PATCH_SOURCE
        ;;
      WASM_RUST_WASIP3_CARGO_HOME)
        CARGO_HOME="$value"
        export CARGO_HOME
        ;;
    esac
  done <<< "$overlay_output"
  printf '[%s] build-custom-rustc-toolchain: wasm32-wasip3 libc overlay is ready\n' "$(date -Is)" >> "$LOG"
  {
    printf '[%s] build-custom-rustc-toolchain: wasm32-wasip3 requested\n' "$(date -Is)"
    printf '[%s] build-custom-rustc-toolchain: effective config path %s\n' "$(date -Is)" "$effective_config_path"
    printf '[%s] build-custom-rustc-toolchain: using patched libc source %s\n' "$(date -Is)" "$WASM_RUST_WASIP3_LIBC_PATCH_SOURCE"
    printf '[%s] build-custom-rustc-toolchain: using cargo home overlay %s\n' "$(date -Is)" "$CARGO_HOME"
  } >> "$LOG"
fi

llvm_build_reconfigure_reason=""
if [[ -f "$LLVM_BUILD/CMakeCache.txt" && "$COMPILER_HOST_TARGET" == "wasm32-wasip1-threads" && "$use_threaded_host_env_flags" -eq 1 ]]; then
  if ! grep -Fq -- "-DBYTE_ORDER=__BYTE_ORDER__" "$LLVM_BUILD/CMakeCache.txt"; then
    rm -rf "$LLVM_BUILD"
    llvm_build_reconfigure_reason='was removed because CMakeCache.txt lacks thread-aware endian defines'
  fi
fi
if [[ -f "$LLVM_BUILD/CMakeCache.txt" ]]; then
  llvm_cache_home_dir="$(sed -n 's/^CMAKE_HOME_DIRECTORY:INTERNAL=//p' "$LLVM_BUILD/CMakeCache.txt" | head -n 1)"
  llvm_cache_build_dir="$(sed -n 's/^CMAKE_CACHEFILE_DIR:INTERNAL=//p' "$LLVM_BUILD/CMakeCache.txt" | head -n 1)"
  if [[ -n "$llvm_cache_home_dir" && "$llvm_cache_home_dir" != "$RUST_ROOT/src/llvm-project/llvm" ]]; then
    rm -rf "$LLVM_BUILD"
    llvm_build_reconfigure_reason="was removed because CMakeCache.txt points at stale llvm source dir $llvm_cache_home_dir"
  elif [[ -n "$llvm_cache_build_dir" && "$llvm_cache_build_dir" != "$LLVM_BUILD" ]]; then
    rm -rf "$LLVM_BUILD"
    llvm_build_reconfigure_reason="was removed because CMakeCache.txt was created for different build dir $llvm_cache_build_dir"
  fi
fi

if [[ -d "$LLVM_BUILD" && ( -f "$LLVM_BUILD/Makefile" || -f "$LLVM_BUILD/build.ninja" ) ]]; then
  llvm_install_attempt=1
  while [[ "$llvm_install_attempt" -le 2 ]]; do
    llvm_log_start_line="$(wc -l < "$LOG")"
    {
      cmake_resume_status=0
      printf '[%s] build-custom-rustc-toolchain: root=%s config=%s host=%s targets=%s\n' \
        "$(date -Is)" "$ROOT" "$effective_config_path" "$COMPILER_HOST_TARGET" "$INSTALL_TARGETS"
      cd "$LLVM_BUILD"
      if [[ -f "tools/llvm-cxxfilt/CMakeFiles/llvm-cxxfilt.dir/link.txt" && ! -f "bin/llvm-cxxfilt" ]]; then
        printf '[%s] build-custom-rustc-toolchain: prebuilding llvm-cxxfilt serially because %s/bin/llvm-cxxfilt is missing before LLVM install\n' \
          "$(date -Is)" "$LLVM_BUILD"
        DESTDIR="${WASM_RUST_INSTALL_DESTDIR:-}" cmake --build . --target llvm-cxxfilt --config Release -- -j 1 &
        active_child_pid=$!
        wait "$active_child_pid" || cmake_resume_status=$?
        active_child_pid=""
      fi
      if [[ "$cmake_resume_status" -eq 0 ]]; then
        printf '[%s] build-custom-rustc-toolchain: resume target LLVM install attempt=%s/2\n' "$(date -Is)" "$llvm_install_attempt"
        DESTDIR="${WASM_RUST_INSTALL_DESTDIR:-}" cmake --build . --target install --config Release -- -j "$BUILD_JOBS" &
        active_child_pid=$!
        wait "$active_child_pid" || cmake_resume_status=$?
        active_child_pid=""
      fi
      [[ "$cmake_resume_status" -eq 0 ]]
    } >> "$LOG" 2>&1 || status=$?
    if [[ "$status" -eq 0 ]]; then
      break
    fi
    if [[ "$llvm_install_attempt" -eq 1 ]] && \
      [[ -f "$LLVM_BUILD/tools/llvm-cxxfilt/CMakeFiles/llvm-cxxfilt.dir/link.txt" ]] && \
      sed -n "$((llvm_log_start_line + 1)),\$p" "$LOG" | grep -Fq 'file INSTALL cannot find' && \
      sed -n "$((llvm_log_start_line + 1)),\$p" "$LOG" | grep -Fq 'llvm-cxxfilt'
    then
      {
        llvm_repair_status=0
        printf '[%s] build-custom-rustc-toolchain: retrying LLVM install after repairing missing llvm-cxxfilt in %s\n' \
          "$(date -Is)" "$LLVM_BUILD"
        cd "$LLVM_BUILD"
        DESTDIR="${WASM_RUST_INSTALL_DESTDIR:-}" cmake --build . --target llvm-cxxfilt --config Release -- -j 1 &
        active_child_pid=$!
        wait "$active_child_pid" || llvm_repair_status=$?
        active_child_pid=""
        [[ "$llvm_repair_status" -eq 0 ]]
      } >> "$LOG" 2>&1 || status=$?
      if [[ "$status" -ne 0 ]]; then
        break
      fi
      status=0
      llvm_install_attempt=$((llvm_install_attempt + 1))
      continue
    fi
    break
  done
else
  if [[ -d "$LLVM_BUILD" ]]; then
    rm -rf "$LLVM_BUILD"
    stale_llvm_build_log='was removed because it lacks a generated build script'
  elif [[ -n "$llvm_build_reconfigure_reason" ]]; then
    stale_llvm_build_log="$llvm_build_reconfigure_reason"
  else
    stale_llvm_build_log='is missing or lacks a generated build script'
  fi
  {
    printf '[%s] build-custom-rustc-toolchain: root=%s config=%s host=%s targets=%s\n' \
      "$(date -Is)" "$ROOT" "$effective_config_path" "$COMPILER_HOST_TARGET" "$INSTALL_TARGETS"
    printf '[%s] build-custom-rustc-toolchain: LLVM build dir %s %s; skipping resume step and starting from x.py install\n' \
      "$(date -Is)" "$LLVM_BUILD" "$stale_llvm_build_log"
  } >> "$LOG" 2>&1
fi

if [[ "$status" -eq 0 ]]; then
  if [[ -n "$install_prefix_path" ]]; then
    cleaned_install_targets=()
    for cleanup_target in "${install_target_array[@]}" "$BUILD_HOST_TARGET" "$COMPILER_HOST_TARGET"; do
      cleanup_target="$(printf '%s' "$cleanup_target" | xargs)"
      if [[ -z "$cleanup_target" ]]; then
        continue
      fi
      if [[ " ${cleaned_install_targets[*]} " == *" $cleanup_target "* ]]; then
        continue
      fi
      cleaned_install_targets+=("$cleanup_target")
      cleanup_target_lib_dir="$install_prefix_path/lib/rustlib/$cleanup_target/lib"
      if [[ ! -d "$cleanup_target_lib_dir" ]]; then
        continue
      fi
      declare -A latest_install_lib_by_key=()
      declare -A latest_install_lib_mtime=()
      cleaned_duplicate_count=0
      while IFS= read -r cleanup_target_file; do
        cleanup_target_basename="$(basename "$cleanup_target_file")"
        if [[ ! "$cleanup_target_basename" =~ ^(lib.+)-([0-9a-f]{16})\.(rlib|rmeta)$ ]]; then
          continue
        fi
        cleanup_target_key="${BASH_REMATCH[1]}.${BASH_REMATCH[3]}"
        cleanup_target_mtime="$(stat -c '%Y' "$cleanup_target_file")"
        cleanup_existing_file="${latest_install_lib_by_key[$cleanup_target_key]-}"
        if [[ -z "$cleanup_existing_file" || "$cleanup_target_mtime" -gt "${latest_install_lib_mtime[$cleanup_target_key]}" ]]; then
          if [[ -n "$cleanup_existing_file" ]]; then
            rm -f "$cleanup_existing_file"
            cleaned_duplicate_count=$((cleaned_duplicate_count + 1))
            printf '[%s] build-custom-rustc-toolchain: removed stale installed rustlib %s in favor of newer %s\n' \
              "$(date -Is)" "$cleanup_existing_file" "$cleanup_target_file" >> "$LOG"
          fi
          latest_install_lib_by_key[$cleanup_target_key]="$cleanup_target_file"
          latest_install_lib_mtime[$cleanup_target_key]="$cleanup_target_mtime"
        else
          rm -f "$cleanup_target_file"
          cleaned_duplicate_count=$((cleaned_duplicate_count + 1))
          printf '[%s] build-custom-rustc-toolchain: removed stale installed rustlib %s in favor of newer %s\n' \
            "$(date -Is)" "$cleanup_target_file" "$cleanup_existing_file" >> "$LOG"
        fi
      done < <(find "$cleanup_target_lib_dir" -maxdepth 1 -type f \( -name '*.rlib' -o -name '*.rmeta' \) | sort)
      if [[ "$cleaned_duplicate_count" -gt 0 ]]; then
        printf '[%s] build-custom-rustc-toolchain: removed %s duplicate installed rustlib artifact%s under %s\n' \
          "$(date -Is)" "$cleaned_duplicate_count" \
          "$([[ "$cleaned_duplicate_count" -eq 1 ]] && printf '' || printf 's')" \
          "$cleanup_target_lib_dir" >> "$LOG"
      fi
      unset latest_install_lib_by_key
      unset latest_install_lib_mtime
    done
  fi
  xpy_install_attempt=1
  while [[ "$xpy_install_attempt" -le 2 ]]; do
    xpy_log_start_line="$(wc -l < "$LOG")"
    {
      xpy_install_status=0
      printf '[%s] build-custom-rustc-toolchain: resume rust install attempt=%s/2\n' "$(date -Is)" "$xpy_install_attempt"
      cd "$RUST_ROOT"
      ./x.py install --config "$effective_config_path" &
      active_child_pid=$!
      wait "$active_child_pid" || xpy_install_status=$?
      active_child_pid=""
      [[ "$xpy_install_status" -eq 0 ]]
    } >> "$LOG" 2>&1 || status=$?
    if [[ "$status" -eq 0 ]]; then
      break
    fi
    if [[ "$xpy_install_attempt" -eq 1 && -n "${build_host_stage_root:-}" ]]; then
      if [[ -d "$build_host_stage_root/llvm" ]] && \
        [[ -f "$build_host_stage_root/llvm/build/tools/llvm-cxxfilt/cmake_install.cmake" ]] && \
        [[ -f "$build_host_stage_root/llvm/build/tools/llvm-cxxfilt/CMakeFiles/llvm-cxxfilt.dir/link.txt" ]] && \
        [[ ! -f "$build_host_stage_root/llvm/build/bin/llvm-cxxfilt" ]]
      then
        rm -rf "$build_host_stage_root/llvm"
        printf '[%s] build-custom-rustc-toolchain: removed stale native LLVM tree %s after install failed because llvm-cxxfilt was missing; retrying x.py install from a clean native LLVM build\n' \
          "$(date -Is)" "$build_host_stage_root/llvm" >> "$LOG"
        status=0
        xpy_install_attempt=$((xpy_install_attempt + 1))
        continue
      fi
    fi
    break
  done
fi
exit "$status"
