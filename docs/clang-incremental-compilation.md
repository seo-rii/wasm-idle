# Experimental session-local Clang object reuse (proposal 7)

## Status and scope

This is a **partial, explicit opt-in experiment**, not a default playground speedup.
`ExperimentalIncrementalClangRuntime` subclasses the existing runtime; the default
`BrowserClangRuntime`, compiler factory and worker selection are unchanged. The real
Clang/LLD, verified assets, language semantics, existing bits PCH and debug paths remain
in place. No replacement parser, compiler subset or synthetic browser result is used.

The implemented portion is per-translation-unit object reuse. General editable
preamble generation, automatic worker activation, persistent object storage and
parallel compilation are **not implemented**. A cache hit still runs real Clang
preprocessing; whether this saves wall-clock time requires the pinned browser build.

## Opt-in API

Import `ExperimentalIncrementalClangRuntime` from the same Clang runtime entry point
that exports `BrowserClangRuntime`. Construct it with the existing runtime options,
optionally adding `objectCache` limits, then call the inherited `compileLink` or
`compileArtifact` methods. This example describes the API, not an executed browser test:

```ts
const runtime = new ExperimentalIncrementalClangRuntime({
  ...existingRuntimeOptions,
  objectCache: { maxEntries: 16, maxBytes: 32 * 1024 * 1024 }
});
await runtime.compileLink(source, runOptions);
console.log(runtime.incrementalCompilationStats);
runtime.clearIncrementalCompilationCache();
```

Do not run simultaneous compilations on one instance or mutate its MemFS while a
compilation is in progress. Other independent runtime instances have independent
caches. A future integration with proposal 6 must compose the bytes-only artifact
runtime deliberately; independently subclassing the old runtime does not combine
both optimizations automatically.

## Correctness and invalidation

Only ordinary C/C++ object invocations with an inspected set of caller flags are
eligible. Debug/trace, source transformation, existing PCH consumption, Objective-C,
modules, unknown flags and reserved scratch-path collisions use the original path.

For each eligible invocation:

1. Run the actual compiler with `-E -C`, full system-header dependencies and
   `-Werror=date-time`. Capture probe diagnostics without emitting duplicates.
2. Hash the preprocessed bytes, normalized compile arguments, compiler Module
   identity, probe diagnostics, and **raw contents and paths of every reported
   dependency plus the main source**. The output object's filename alone is omitted
   from the key. Real preprocessing detects newly available `__has_include` headers;
   a handwritten include scanner is not trusted for missing-header dependencies.
3. On a hit, install a defensive copy of the Wasm object and replay original compile
   diagnostics. On a miss, run the original compiler and retain only a complete,
   successful Wasm object and complete diagnostics.

Malformed/oversized dependencies, unavailable SHA-256, incomplete diagnostics,
unsupported preprocessing and volatile time macros fail closed to ordinary
compilation. Raw time-macro/diagnostic-override checks also guard source pragmas that
suppress `-Wdate-time`. Failed compilation is never cached. Explicit clear invalidates
in-flight insertions; failed rebuilds also invalidate inherited whole-build reuse.

The Make dependency parser supports escaped spaces, tabs, `#`, colon, backslash,
`$$` and LF/CRLF continuations, rejecting ambiguous syntax. Compiler arguments,
headers, include search results and compiler-module changes are not assumed stable.

The LRU defaults are 16 entries / 32 MiB accounted object+diagnostic+key storage.
Preprocessed input is capped at 16 MiB, dependency contents at 64 MiB and the depfile
at 1 MiB. Scratch contents are cleared after an invocation. These are cache admission
limits, **not hard caps on Clang, MemFS capacity or total browser memory**. Objects
are session-local; user source and artifacts are not added to persistent storage.

## Why general preamble reuse remains disabled

An ordinary `-emit-pch` of a source prefix is not a substitute for Clang's validated
main-file preamble generation/remapping contract. In a native Clang 17 experiment,
creating a PCH from a prefix and appending a function before consuming it with
`-include-pch -preamble-bytes=...` failed because the source size had changed. The
regression test records that failure; it does not disable validation to make it pass.

A real implementation must use the producer's preamble generation/remapping support
and preserve main-file identity, macro state, include level, conditional state,
locations, user-header invalidation and semantic diagnostics. Do not add
`-fno-validate-pch` or force-inject unrelated headers. The existing bits PCH continues
unchanged.

Primary implementation references:
- https://clang.llvm.org/docs/PCHInternals.html
- https://clang.llvm.org/doxygen/PreprocessorOptions_8h_source.html

## Validation performed and not performed

Run from the repository root:

```sh
node --test scripts/test-clang-incremental.mjs
```

The harness needs the project's TypeScript dependency. Native tests use `CLANG` and
`WASM_LD` overrides (or `clang` and `wasm-ld` on PATH); tests report skips when those
tools are absent. It transpiles the actual cache/adapter, uses explicit adapter mocks,
and separately compiles and executes genuine small Wasm programs with native tools.

Observed locally on 2026-10-10: **17 tests passed, 0 skipped**, Node 22.16.0,
TypeScript provided through local `NODE_PATH`, native Clang/wasm-ld 17. Real linked
Wasm returned 42 -> 43 -> 53 for TU/header changes, and 1 -> 9 -> 1 when an optional
header appeared/disappeared. Tests also cover flags/compiler changes, warning replay,
Unicode/space paths, failure recovery, volatile macros, eviction, cancellation,
clear-during-compile and the unsafe ordinary-PCH case. The standalone cache module
passes strict TypeScript checking.

**Not executed locally:** repository-pinned Node 24.15.0/pnpm dependency installation,
full repository/package typecheck and suite, pinned browser Clang/LLD assets, Playwright
browser integration, actual preamble speedup, memory profiling or browser benchmarks.
The container cannot directly reach GitHub/package endpoints; source was read through
the connected GitHub API and a read-only source evidence artifact. Native Clang and
Node Wasm execution are not browser-toolchain or end-to-end playground validation.

Before enabling by default, wire the explicit class into the real worker behind an
experiment flag, check pinned `-cc1` flag support, validate PCH/debug interactions,
run full package/browser tests, and measure cold/warm/multi-TU edits and memory against
the unmodified runtime. A preprocessing pass on every hit and an extra pass on every
miss can outweigh saved frontend/codegen work. No speedup percentage is claimed.
