# V browser integration

V runs the real V 0.5.2 compiler in the browser. The compiler is the upstream
[`vlang/vc`](https://github.com/vlang/vc/tree/7eb8c54a3843e5107d5af06d7a8c3e928f322475) bootstrap
translation of [V 0.5.2](https://github.com/vlang/v/tree/7647ce1c6fad63b5578bc07883139906de74b2f8)
(`v.c`), built for WASI Preview 1 by the `wasm-llvm/producer/v-browser` producer with WASI SDK 33.
There is no source translation or V subset in wasm-idle: every `.v` source is handled by the V
compiler itself.

## Pipeline

Each run uses one Worker (`src/lib/playground/worker/v.ts`) and `@wasm-idle/llvm-core/v`:

1. The V compiler Wasm runs under the `@bjorn3/browser_wasi_shim` WASI host with the packaged V root
   (`/v/vlib`, `/v/thirdparty/stdatomic`) and the workspace under `/work`. It is invoked as
   `v -os wasm32_wasi -gc none -no-parallel -o /work/__wasm_v_main.c /work/main.v`. Parser and
   checker errors are V's own diagnostics (`main.v:3:1: error: ...`).
2. The generated C is compiled by the shared llvm-core Clang host. Only its sysroot is replaced
   by the producer's complete wasi-libc C sysroot, which also carries V's WASI compatibility
   headers (`include/v-wasi`) and archive (`libvwasi.a`). V's usual `-fwrapv` and relaxed aliasing
   flags are applied.
3. LLD links the object with `--no-stack-first --global-base=65536`. V's builtin memory helpers
   treat addresses at or below `0xFFFF` as invalid, so no data or stack may live in the first
   64 KiB of linear memory.
4. The resulting WASI module runs with terminal stdin (`os.get_line()`, `os.input()`), stdout,
   stderr and program arguments.

The packaged vlib covers `arrays`, `bitfield`, `builtin`, `context`, `crypto`, `datatypes`,
`encoding`, `hash`, `io`, `maps`, `math`, `os`, `rand`, `regex`, `runtime`, `semver`, `strconv`,
`strings`, `sync`, `term`, `time` and `x.json2`. Subprocesses, threads, networking, graphics and
C libraries beyond wasi-libc are unavailable: process and descriptor-duplication calls fail with
`ENOSYS`, and garbage collection is disabled (`-gc none`).

## Assets

`static/wasm-v` holds the native gzip delivery assets (`v.wasm.gz`, `vroot.tar.gz`,
`c-sysroot.tar.gz`) plus `runtime-manifest.v1.json` and `runtime-build.json` receipts. Refresh them
from a verified producer release directory:

```sh
# in wasm-llvm
WASI_SDK_PATH=/opt/wasi-sdk-33.0-x86_64-linux pnpm build:v
pnpm verify:v-artifacts
pnpm prepare:v-release
# in wasm-idle
pnpm sync:wasm-v /absolute/path/to/wasm-llvm/out/v-browser
```

The sync step accepts only the reviewed V 0.5.2 profile, checks every archive against the producer
receipt and its passing compile/run acceptance, and installs the bundle atomically. Set
`runtimeAssets.v.baseUrl` (or `PUBLIC_WASM_V_BASE_URL`) to host the same files elsewhere;
`runtimeAssets.clang` still selects the Clang/LLD host.

## Tests

```sh
pnpm exec vitest run packages/llvm-core/runtime/v src/lib/playground/worker/v.test.ts \
  src/lib/sync-wasm-v.test.ts src/lib/playground/v-runtime-bundle.test.ts
pnpm run prepare:test-assets -- clang
pnpm test:browser:v
```

The Chromium suite selects V in the playground, runs a program that reads stdin through
`os.get_line()`, runs the default editor sample with terminal input, and checks that a syntax
error is reported by the V compiler with its source position.
