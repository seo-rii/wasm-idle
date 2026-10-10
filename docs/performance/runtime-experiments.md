# Runtime producer experiments: evidence before promotion

This is an **opt-in experiment/evidence foundation**, not a newly built compiler or Python runtime. No default artifact, optimization level, asset receipt or download URL changes. The real implementation and language semantics must remain intact.

## Separate experiments

| Candidate | Producer work required | Acceptance evidence |
| --- | --- | --- |
| Combined Clang/LLD | Add separate compile/link entrypoints to one real LLVM build; inspect link maps for actual duplication; preserve isolated invocation state. This producer patch is not implemented here. | Compressed total bytes, cold first output, link overlap tradeoff, memory, C/C++ and debugger correctness. |
| Profile-guided/selectively optimized Clang | Collect actual browser hot paths, then build a version-pinned producer variant. Do not reuse a native profile as browser evidence or repeat the rejected O3 experiment without new evidence. Producer instrumentation/build is not implemented here. | Compilation and user-program execution measured separately, generated artifact equality/correctness, size and tail latency. |
| Console-first Python | Build a compatible Pyodide/CPython profile with deferred optional assets; retain complete Python semantics and explicit package availability. No subset interpreter, unverified stdlib deletion or modified Pyodide binary is supplied here. | Native stream/import/traceback tests, package and image compatibility, cold/warm startup, pure-Python execution, LSP/debug memory. |

## Artifact inventory

Create a JSON array of `{ "name": "clang", "path": "path/to/clang.wasm.gz" }` entries for each actual candidate output, then run:

```sh
node scripts/performance/runtime-experiments.mjs inventory artifacts.json inventory.json
```

Paths are relative to the current working directory. The inventory records real on-disk compressed/decoded bytes and SHA-256 identities; gzip detection uses magic bytes. Decoding is bounded to 256 MiB by default. Missing files fail rather than creating zero-size measurements. This does **not** measure HTTP transfer bytes, compile a toolchain, validate the complete Wasm format, or prove the binary's language semantics. Record the producer repository/commit, build command, environment and license alongside the inventory.

## Browser comparison

Use the existing `scripts/benchmark-clang-browser.mjs` / `scripts/compiler-performance.worker.ts` for Clang/clangd, and the real language workers for Python/other languages. Add targeted runs for stdin, output, input-only reruns, LSP completion/resolve, debug continue/step and large variable previews. No fake runtime is a performance substitute.

The comparison tool consumes normalized browser evidence, not the raw existing benchmark report. An adapter from the existing report and a Python browser driver are **not implemented in this PR**. Each document requires:

- `measurementKind: "browser"`, exact `browser`, `device`, and 40-hex `revision`.
- Nonempty `samples`, each with `workload`, `profile`, `phase`, nonnegative integer `repeat`, and boolean `ok`.
- Successful samples require `outputSha256` from checked actual output (not a copy of the expected hash).
- Optional nonnegative finite `preparationMs`, `compileLinkMs`, `executeMs`, `firstOutputMs`, `totalMs`, `emittedBytes`, `transferredBytes`, `peakMemoryBytes`.

Phases are `empty-cache`, `persistent-reload`, `warm`, and `input-only`. Never merge them. For LSP/debug workloads, document precisely what first output/completion means; do not mix user program runtime and interpreter-debug runtime. Capture all failed runs with `ok: false` rather than filtering them out.

```sh
node scripts/performance/runtime-experiments.mjs compare baseline.json candidate.json comparison.json
```

The tool refuses native-only/mismatched browser/device inputs, retains failure counts, marks unmatched repeats/output differences, and reports missing metrics as null. Median and nearest-rank p95 are descriptive only; small sample counts do not establish significance. Warm up the toolchain separately where appropriate, but never silently execute arbitrary user programs twice. Use randomized/interleaved candidate ordering, sufficient repeats and a separate profiling run. Negative percentage change means a lower duration/byte count, not automatic promotion. No statistic alone checks semantic coverage or CPU/memory tradeoffs.

## CI scope and promotion gate

The audit workflow runs dependency-free evidence-tool tests and archives the exact relevant source snapshot for reproducibility. Its success is **not** browser or producer-build success. It does not auto-merge, write back to branches, download new untrusted artifacts, change receipts, or access secrets.

Before a candidate is ready: build the genuine producer; regenerate/verify receipts through existing tooling; run pinned repository checks and real-browser correctness suites; measure cold/reload/warm scenarios across representative desktop/mobile hardware; inspect memory and p95; document any regression and compatibility limitations. Keep experiment PRs draft until those steps actually run. Expected performance benefits are hypotheses (예상 결과), not measured results.
