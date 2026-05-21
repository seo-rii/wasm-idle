# Real `rustc.wasm` history

This file is a history and residual-risk document.

`wasm-rust` no longer uses the old handwritten subset compiler. The checked-in product uses a real
browser-hosted `rustc.wasm` frontend plus a packaged `llvm-wasm` `llc`/`lld` backend, and it can
compile and run the minimal regression target in Chromium.

Historical probe detail now lives mostly in:

- `browser-compiler.md`
- `reproduction.md`
- `../PROGRESS.md`

## Current state

What is now true:

- `wasm-rust` uses real `rustc.wasm` in `src/`
- the standalone Chromium harness succeeds end to end
- the shipped module returns runnable WASI `wasm`
- `wasm-idle` can consume that module through the browser compiler contract

Latest repo-owned validation command:

```bash
cd /path/to/wasm-rust
pnpm run validate:standalone-browser
```

That validation covers:

1. build
2. unit/integration tests
3. Playwright Chromium harness probe
4. real-browser Vitest harness
5. direct Playwright integration test

## Remaining real blocker

The original bootstrap blockers are no longer the active issue. The remaining limitation is runtime
stability inside the browser-hosted LLVM path.

Current blocker category:

- `browser platform limitation`

Concrete symptom:

- browser-hosted `rustc.wasm` worker threads can still fail intermittently during LLVM work with
  errors like:
  - `memory access out of bounds`
  - `operation does not support unaligned accesses`

Current product behavior:

- transient browser-rustc failures are retried up to `5` attempts
- mirrored `.no-opt.bc` recovery plus `llvm-wasm` linking is what makes the standalone browser path
  reliable enough today

What is not blocked anymore:

- compiler bootstrap
- sysroot identity mismatch for the shipped path
- final backend availability
- final linker availability
- wasm artifact shape for consumers

So the remaining issue is no longer "can we make real rustc work at all?" It is "can we reduce the
remaining intermittent browser-rustc LLVM worker failure rate enough to remove or relax retries?"

## Resolved blocker chain

These were the major blockers uncovered during the work and how they resolved.

### 1. Stock nightly target std did not match `wasm-rustc`

Early real-rustc probes failed with:

```text
error[E0514]: found crate 'std' compiled by an incompatible version of rustc
```

Meaning:

- upstream `wasm-rustc` shipped a browser-host compiler identity that did not match the stock
  nightly `wasm32-wasip1` std metadata

Resolution:

- this path was abandoned for the shipped product
- the final product uses a packaged runtime/toolchain path that is internally consistent

Blocker type at the time:

- `sysroot availability`

### 2. Cranelift-only browser-host rustc could not target wasm output

After building a branch-matched target std, the rebuilt compiler still reported:

```text
error: can't compile for wasm32-wasi: Support for this target has not been implemented yet
```

Meaning:

- the wasm-host compiler still defaulted to builtin Cranelift for the browser host
- that backend configuration did not implement the desired wasm output target in this setup

Resolution:

- rebuilds moved to an LLVM-enabled wasm-host compiler path

Blocker type at the time:

- `codegen backend / target support`

### 3. Source-building the wasm-host compiler hit a long WASI-host LLVM portability wall

The branch did not build cleanly for a WASI-hosted LLVM toolchain. Repeated blockers included:

- missing or unsupported Unix APIs on WASI:
  - `getsid`
  - `pipe`
  - `fork`
  - `execv`
  - `munmap`
  - `getpid`
  - `strsignal`
  - `realpath`
  - `fchown`
  - `netdb.h`
  - signal support
- shared-library/link-model assumptions incompatible with wasm:
  - `--version-script`
  - `-z defs`
  - Unix rpath logic

Resolution:

- the wasm-host build path was patched repeatedly until a usable LLVM-enabled browser compiler
  could be produced

Blocker type at the time:

- `compiler bootstrap`

### 4. `wasm-idle`'s legacy browser clang backend was too old for modern Rust IR

The old browser clang/lld assets could not consume Rust 1.79 outputs.

Observed failures included:

```text
error: Invalid value (Producer: 'LLVM18.1.3-rust-1.79.0-nightly' Reader: 'LLVM 8.0.1')
```

and textual LLVM IR parse failures caused by opaque-pointer-era IR.

Meaning:

- LLVM 8-era browser clang in `wasm-idle` could not serve as a second-stage backend for modern
  Rust LLVM IR

Resolution:

- the shipped product uses `llvm-wasm` `llc` + `lld`, not the legacy clang 8 browser stack

Blocker type at the time:

- `artifact format mismatch`

### 5. Real browser-hosted rustc worked, but final reliability required split recovery

Once the browser-hosted `rustc.wasm` frontend was running, it could reach real source compilation,
but direct end-to-end codegen was not stable enough on its own.

Important positive finding:

- rustc often still emitted and mirrored `.no-opt.bc` before the worker failure became terminal

Resolution:

- preserve the mirrored bitcode
- lower and link it with packaged `llvm-wasm`
- retry transient browser-rustc failures up to `5` attempts

This is the architecture that shipped.

## Why the split backend exists

The final product architecture is:

1. real `rustc.wasm` frontend
2. shared mirrored `.no-opt.bc`
3. browser `llvm-wasm` `llc`
4. browser `llvm-wasm` `lld`
5. final WASI `wasm`

This is not an accidental fallback. It is the concrete outcome of the blocker chain above.

## Current acceptable tradeoff

Accepted current state:

- standalone Chromium compile+run succeeds
- the module fulfills the browser compiler contract expected by consumers
- success currently relies on retrying around intermittent browser-rustc LLVM worker faults

If that retry-based behavior becomes unacceptable later, the next work item is not bootstrap or
sysroot recovery anymore. It is reducing the browser-host LLVM worker failure rate enough to stop
depending on retries.
