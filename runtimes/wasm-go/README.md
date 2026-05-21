# wasm-go

`wasm-go` is a browser-oriented Go compiler runtime prototype for upstream-style `cmd/compile` and
`cmd/link` execution in WebAssembly. The repository is currently `private: true`, and the checked-in
API should be treated as repo-scoped scaffolding rather than a published npm contract.

Current checked-in scope:

- runtime manifest and asset model for `wasip1/wasm` and `js/wasm`, plus preview1-compatible alias
  targets for `wasip2/wasm` and `wasip3/wasm` unless a custom toolchain exposes them directly
- browser/Node WASI execution path
- browser/Node `wasm_exec.js` execution path for `js/wasm`
- build planner that emits `compile`/`link` invocations plus `importcfg` and `embedcfg`
- reproducible runtime packaging from the official Go `1.26.1` toolchain
- runtime probe that compiles and runs `fmt.Println("probe-ok")`
- code-only compile requests that auto-populate the reachable stdlib `importcfg` closure from the
  bundled sysroot

## Reproducible Runtime Build

Build the TypeScript package:

```bash
cd /path/to/wasm-go
npm run build
```

Download the pinned official Go `1.26.1` host archive for one of the currently supported
`prepare:runtime` hosts (`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`), verify its
SHA-256, then generate runtime assets:

```bash
cd /path/to/wasm-go
npm run prepare:runtime
```

That writes:

- `dist/runtime/tools/compile.wasm.gz`
- `dist/runtime/tools/link.wasm.gz`
- `dist/runtime/sysroot/wasip1.pack.gz`
- `dist/runtime/sysroot/wasip1.index.json.gz`
- `dist/runtime/sysroot/wasip1.stdlib-index.json.gz`
- `dist/runtime/sysroot/js.pack.gz`
- `dist/runtime/sysroot/js.index.json.gz`
- `dist/runtime/sysroot/js.stdlib-index.json.gz`
- `dist/runtime/runtime/wasm_exec.js`
- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/runtime-build.json`

`runtime-build.json` records the exact upstream archive URL and checksum so the same runtime can be
rebuilt later, and records whether `wasip2/wasm` / `wasip3/wasm` were packaged as real targets or
as `wasip1/wasm` aliases.

## Validation

Run the end-to-end local probe:

```bash
cd /path/to/wasm-go
npm run validate:runtime
```

That sequence:

1. builds `dist/`
2. prepares the pinned `go1.26.1` runtime assets
3. calls `compileGo()` against the generated bundled runtime
4. links preview1-compatible `wasip1/wasm`, `wasip2/wasm`, `wasip3/wasm`, and `js/wasm` hello programs
5. executes each linked artifact and checks for `probe-ok\n`

## Target Support

| Target | Planner | In-process execution | Notes |
| --- | --- | --- | --- |
| `wasip1/wasm` | yes | yes | primary packaged/runtime target |
| `wasip2/wasm` | yes | yes | uses native `GOOS=wasip2` when the toolchain supports it, otherwise aliases to `wasip1` |
| `wasip3/wasm` | yes | yes | uses native `GOOS=wasip3` when the toolchain supports it, otherwise aliases to `wasip1` |
| `js/wasm` | yes | yes | packaged with `wasm_exec.js` and a dedicated `js` stdlib sysroot |

## Library Contract

The current scaffold supports the consumer-facing path that is closest to `wasm-rust`, without yet
wiring `wasm-idle` itself.

```ts
import createGoCompiler from './dist/index.js';

const compiler = await createGoCompiler();
const result = await compiler.compile({
  code: `package main

import "fmt"

func main() {
  fmt.Println("hello from wasm-go")
}
`,
  target: 'wasip1/wasm'
});
```

For simple single-file programs, the compiler now:

- defaults the source file to `main.go`
- defaults the package import path for planning/cache purposes
- auto-populates the reachable stdlib archive mappings from the bundled sysroot
- returns the linked executable under both `artifact.bytes` and `artifact.wasm`

If you pass a custom `manifest`, the bundled executor path now still works as long as the referenced
runtime assets are reachable under `runtimeBaseUrl` (or under paths relative to the default bundled
runtime root). Injecting `dependencies.runTool` is only necessary when you want to override the
default in-process executor.

## Current Limits

- the pinned official `go1.26.1` toolchain currently reports `wasip1/wasm` and `js/wasm` from
  `go tool dist list`; unless you provide a custom toolchain that adds `wasip2/wasm` or
  `wasip3/wasm`, those targets still package and execute through the `wasip1` alias path
- module resolution outside the bundled stdlib is still manual; third-party/user package archives
  still need to be supplied through `dependencies`
- `js/wasm` execution currently covers the bundled `wasm_exec.js` runtime path, argv/env, and
  stdout/stderr capture; it does not yet emulate a full Node-style filesystem for `os`/`syscall`
  heavy programs
