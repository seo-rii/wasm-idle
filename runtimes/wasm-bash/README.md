# wasm-bash

This package builds real GNU Bash for WASIX and packages it as a local WEBc asset for the
wasm-idle browser playground. The browser never queries the Wasmer registry at runtime.

Run `pnpm --dir runtimes/wasm-bash build` to download the pinned inputs, compile Bash, and write
the verified bundle to `runtimes/wasm-bash/dist`. The root `sync:wasm-bash` task validates that
bundle before atomically copying it to `static/wasm-bash` and updating the asset fingerprint.
`pnpm --dir runtimes/wasm-bash check` verifies an existing dist without rebuilding it.

The build currently supports Linux x86-64 hosts. End users do not need the build toolchain because
the checked-in browser asset is self-contained.

## Provenance

- Source: `wasix-org/bash` commit `fc8096485478055f4fcf31402004fdd8ff6b72b7`
- Runtime package version: `wasmer/bash@1.0.25`
- WASIX sysroot: `v2024-07-08.1`
- Compiler: WASI SDK 20.0 / LLVM 16.0.0
- Optimizer: Binaryen 108 with upstream `--asyncify --fpcast-emu`, followed by `--strip-debug`
- WEBc builder: Wasmer CLI 7.2.0
- License: GNU GPL version 3 or later

Every archive URL and SHA-256, the final Wasm and WEBc hashes, and the allowed Wasm feature set are
recorded in `runtime-build.json`.

The bundle contains Bash builtins only. External utilities such as `cat`, `sed`, and `ls` are not
included because the separate coreutils package is not yet bundled.
