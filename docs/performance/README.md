# Browser performance series: design and acceptance map

This series separates host/runtime optimizations from compiler-producer experiments. Nine PRs exist, but a PR is not evidence that every planned optimization is implemented or faster. Draft status remains appropriate until its accepted scope, real-browser correctness and measured tradeoffs are reviewed. No merge or production rollout is implied by this document.

## 1. Define what is slow

A cold compiler interaction can include asset discovery, download, integrity checks, decompression, engine compilation, runtime initialization, source compilation, linking, engine compilation of the user artifact, instantiation and execution. Some steps overlap, so adding every stage duration does not equal wall time. First visible output is also different from total completion time: interactive input intentionally leaves execution open.

Python can incur runtime startup, package discovery/loading, repeated helper parsing, code compilation, execution and high-frequency output transport. LSP has a separate user-facing path: server startup, document synchronization, analysis, completion-list delivery and selected-item documentation. Debugging adds trace overhead while running and inspection overhead while paused. Optimizing one path must not be reported as improvement to all of them.

Use four explicit workload classes: empty-cache startup, persistent reload, same-session warm work, and unchanged-source/input-only reruns. Add source edits, dependency edits, multiple translation units, interactive input and cancellation as separate cases. Warm input-only success is not cold-start evidence.

## 2. Implementation map

| Plan | PR | Mechanism | Important boundary |
| --- | --- | --- | --- |
| 1 | #68 | MemFS input cursor and lazy trace construction | No compiler binary or WASI layout change |
| 2 | #70 | Native Python streams with bounded output batching | Explicit flush/input/pause ordering must remain correct |
| 3 | #72 | Fixed Python helper, code objects and per-file import discovery | Reuse immutable work, not user globals or mutable filesystem state |
| 4 | #69 | Lazy completion documentation and bounded Jedi analysis | Global workspace epoch invalidates imported-file dependencies |
| 5 | #73 | Fixed Java InputStream with runtime blocks | Same artifact, fresh input; actual pinned TeaVM must compile the helper |
| 6 | #75 | Linked bytes separate from browser Modules; normal export reduction | LLDB/WAMR and host ABI have distinct requirements |
| 7 | #76 | Opt-in per-translation-unit object reuse | Every eligible hit still preprocesses; general preamble not implemented |
| 8 | #71 | Cheaper continue events and bounded variable previews | Live breakpoints/stepping remain real; custom preview policy is explicit |
| 9 | #74 | Artifact inventory, comparison and original-report adapter | Tooling is not a combined/PGO/Python producer build |

Each implementation PR adds a dedicated design document under docs/performance: memfs-input-design.md, python-stdio-design.md, python-execution-design.md, python-lsp-design.md, java-runtime-stdin-design.md, clang-artifact-design.md, clang-object-cache-design.md and python-debug-design.md. They describe actual interfaces, ownership, invalidation, failure behavior, evidence layers and remaining scope. They reside on their respective PR branches until integration; this overview is not a claim that those branches are already merged.

## 3. Distinguish cache layers

An asset cache retains verified delivered bytes. An engine Module cache retains browser-compiled Wasm. A PCH retains compiler-parsed header state. A translation-unit cache retains a relocatable object. A whole-artifact cache retains linked program bytes and possibly a Module. A Python code cache retains compiled code objects. A language-server cache retains analysis and completion references. These caches have different keys, memory costs and invalidation events.

Correctness requires identifying every input that can change the result: compiler/asset identity, flags, source filename, source/header contents and search results, workspace epoch and relevant runtime policy. A positive cache-hit count is not sufficient. The object cache invokes the real preprocessor because a manually maintained include list misses negative dependencies such as a newly available __has_include header. The Python import cache retains analysis only; package availability is still checked. A filesystem write cannot be skipped merely because the editor text is unchanged when user code can modify that file.

Caches must specify ownership. Defensive byte copies prevent consumers corrupting retained artifacts; temporary PyProxy dictionaries and callbacks must be destroyed; eviction and explicit clear release references. A failed rebuild must not make an old successful program look like the new result. Clear during an asynchronous operation must prevent late insertion. Entry-count and accounted-byte limits are retention/admission policies, not complete process or Wasm heap limits.

## 4. Laziness, batching and semantic compatibility

Lazy work postpones a cost until it is needed. Python LSP returns candidate names before calculating documentation; it does not replace Jedi. Debug previews inspect a prefix instead of sorting or representing an entire container; custom objects deliberately receive a bounded placeholder unless explicitly inspected. Disabled logging must avoid constructing expensive arguments, not merely call a no-op callback.

Batching amortizes transport overhead but can hurt latency. A pending prompt must be flushed before waiting for input, and explicit flush followed by a CPU loop must still become visible. Timers alone cannot flush while synchronous Wasm occupies the worker. Bound message size as well as accumulation time, preserve independent UTF-8 decoder state and drain on failure. Fewer messages are not a success when total wall time worsens.

Java stdin is data, not source. The fixed helper makes input-only changes reusable without embedding a potentially large byte array in generated Java. The real pinned compiler rejected the first JSBody design; the revised helper uses supported classlib JSO overlays. Block acquisition reduces per-byte input protocol work, but copying a typed array into a Java array still has per-byte overlay access. This is not zero-copy or an assertion that every boundary crossing disappeared.

## 5. Size metrics must identify the artifact

Toolchain raw Wasm bytes, compressed delivery bytes, total runtime asset closure, generated user-program bytes and installed SDK package bytes are different quantities. A source-level host optimization may improve execution while adding JavaScript bytes. An object cache usually changes retained memory rather than emitted program size. Export reduction can shrink a user's linked executable without shrinking Clang itself.

A combined Clang/LLD producer could share linked implementation, but may increase first-use footprint for users needing only one tool. PGO must train on representative workloads separate from evaluation and preserve semantics. A console-first Python profile must define which modules/features are omitted and how optional packages remain compatible. These are experiments still requiring actual producer patches/builds, receipts, correctness suites and measured browser comparisons. This series has not supplied those alternative binaries.

## 6. Evidence hierarchy and CI interpretation

Static type/source tests verify contracts but do not execute a compiler. Explicit mocks verify orchestration but cannot demonstrate TeaVM/Pyodide/browser compatibility. Native Clang/Python tests exercise real semantics outside the shipped browser environment. Real bundled Wasm execution in Node is stronger integration evidence, but still does not prove Monaco, Worker, CSP, terminal or browser memory behavior. Actual Chromium product CI validates only the selected cases and paths; a disabled experiment is not validated just because default-path CI is green.

The follow-up uses a read-only CI dependency snapshot to run Node 24.21.0, TypeScript 6.0.3, Vitest 5.0.3 and the genuine bundled runtimes locally. It adds actual Pyodide execution/stdio/Jedi transport tests and actual TeaVM same-artifact input tests, while collecting the formerly manual regression scripts in normal CI. Local container navigation restrictions still prevent claiming a complete local playground browser run. Remote run IDs and exact commits are recorded separately in PR descriptions.

Keep failed and missing samples. Compare identical browser/device/workload/network/cache/repeat identities and exact output. Use medians and nearest-rank p95 only with the recorded sample count; tiny samples are not stable tail estimates. Never turn missing metrics into zero, discard failed runs before computing a speedup, or promote based on synthetic fixture timings. The Clang report adapter preserves suite-level transfer scope and labels operator-supplied provenance explicitly.

## 7. Integration and promotion

The Python stdio/helper/debugger branches share python.ts. Reconcile them into one lifecycle: fixed helpers, native streams, before-input/before-pause flushing, fresh user state, correct debug/Hy/image paths and one cleanup owner. Then test the combined branch; passing independent PRs does not prove their composition.

The Clang artifact and object-cache classes independently extend the legacy runtime. Choose one orchestration and compose object reuse beneath it; importing both classes does not activate both. Keep trace/LLDB/PCH fallback policy explicit and validate host-facing exports before changing defaults. The object-cache class is currently opt-in, with no worker activation and no general editable preamble.

Promotion requires a green exact-head correctness suite, reviewed public/ABI behavior, honest accepted scope, output-equivalent browser measurements, memory/lifecycle checks and a rollback path. Retain immutable compiler/input identities. Do not compensate for a failing memory test by raising its budget; calibrate the measurement and investigate retained allocations. No quantitative browser speedup or aggregate binary reduction is claimed by the new regression or adapter tests.
