# Clang artifacts are not always executable browser Modules

## Consumer-oriented preparation

Clang produces objects and LLD produces linked Wasm bytes. The browser engine may then compile those bytes into a WebAssembly.Module and instantiate it. LLDB/WAMR consumes the bytes and DWARF description through a different execution backend. Compiling an extra browser Module before handing the same bytes to that backend is redundant preparation, not an essential compiler step.

The artifact runtime separates immutable linked bytes from optional executable Modules. Normal and trace execution can reuse both. LLDB compileArtifact returns defensive bytes and the deterministic DWARF descriptor without calling WebAssembly.compile. File/workspace/options/debug-mode changes invalidate the build; direct compile/link operations and failed rebuilds also invalidate reusable state. A failure cannot expose a prior successful executable as the new result.

## Export reduction is an ABI decision

Normal links omit --export-dynamic, allowing unnecessary externally visible symbols to disappear. Trace and LLDB links preserve their previous export behavior. The instance-level exportDynamic compatibility escape hatch invalidates the cache key. Filtering applies only inside the inherited linker invocation; a user's program argument named --export-dynamic and a compiler flag are not modified. The invocation scope is restored even after an error.

Removing exports can break consumers that depend on externally visible functions, runtime registration or host callbacks. A smaller output is insufficient proof. C/C++, Objective-C-derived paths, exceptions, long double, library-host ABI and debugger behavior require separate execution coverage. No Clang/LLD compiler binary is rebuilt or shrunk by this consumer-side change.

## Public versus legacy boundary

The public entrypoint and compiler factory select artifact-runtime.ts. Legacy runtime.ts remains available to existing deep imports and supplies low-level compiler, MemFS, PCH and verified-asset operations. This duplication is temporary compatibility scaffolding; it does not optimize every private deep-import path. The incremental object-cache subclass in the separate PR must be composed deliberately rather than assuming two independently inherited classes combine automatically.

The old public API test replaced only legacy runtime.ts with a compileLink-only mock. The new real subclass consequently reached a mock lacking beginTrace, producing the four CI failures. The repaired test mocks the actual public artifact boundary and preserves forwarding, diagnostic and real DWARF descriptor assertions. A separate collected harness exercises the actual artifact runtime over explicitly mocked low-level services, including zero Module compilation for LLDB, defensive byte copies, Module reuse, export scoping and failure invalidation. Thus fixing the public mock does not remove coverage of the new orchestration.

## Validation and remaining measurements

The CI dependency snapshot uses Node 24.21.0, TypeScript 6.0.3 and Vitest 5.0.3. All ten focused public API tests passed. The nine actual-runtime/native-tool tests also passed after marking the synthetic runtime import as an ES module; this matches TypeScript 6's interop behavior without disabling diagnostics. Those regressions now run in normal root CI.

The native Clang/wasm-ld 17 fixture returns 42 in both cases; dynamic exports produce 374 bytes and minimal exports 343 bytes. This deliberately tiny fixture proves the mechanism, not a general reduction percentage. Before this repair, remote CI already passed the real required Clang browser job and LLDB browser workflow for the feature head, while the package mock test failed. Fresh CI must still validate the updated head independently.

Record bytes before/after link policy, cold/warm compile-to-ready, LLDB first-stop latency, browser Module compilation count and retained immutable-byte memory. Avoid summing speedups from overlapping stages. Keep source/compiler identity, diagnostic output, debug semantics and host ABI identical across measured comparisons. General relocation compression and LLDB request caching remain outside this implementation.
