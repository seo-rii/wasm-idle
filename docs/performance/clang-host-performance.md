# Clang host filesystem and translation-unit reuse

`path_filestat_get` reads overlay/native node metadata without constructing a file-content copy. File opens retain an owned read snapshot, so overwriting or deleting the path cannot mutate an already-open descriptor. Compiler writes use synthetic handles and JS overlays rather than adding unreclaimable native MemFS nodes for each temporary output. Rename moves an owned overlay without another content copy; unlink removes the name. Native backing files retain tombstones because the existing MemFS producer has no free primitive. Compiler-created temporary outputs are retired on success and failure.

The host's optional trace predicate is consulted before decoding memory or formatting messages. The public runtime forwards its current debug/log state into both MemFS and App, so a forwarding callback no longer defeats the disabled trace path.

The public artifact runtime composes the existing dependency-validated object cache for normal multi-translation-unit builds. The default `cacheTranslationUnits = 'auto'` caches eligible C++ units only; `true` also enables C explicitly. Single-file builds keep the original path, and trace/LLDB, PCH and unsupported compiler options bypass object reuse. `cacheTranslationUnits = false` is an instance escape hatch. Linked-artifact reuse remains the first shortcut when the whole workspace and build options are unchanged. The compiler module identity comes from the actual verified Module passed to the compiler, including application loaders with an external module cache.

Every build supplies a complete workspace snapshot. Files absent from the next snapshot are removed (or their pre-workspace bytes restored), ensuring header deletion and `__has_include` changes reach preprocessing. Failed rebuilds invalidate the published artifact. Neither compiler instances nor mutable guest state are reused.

Run the pinned Chromium comparison after `prepare:test-assets -- clang`:

```sh
node scripts/probe-clang-host-performance.mjs --baseline-ref <base-commit> --repeats 4 --json /tmp/clang-host-performance.json
```

The probe validates compressed and decoded asset receipts, uses the real verified streaming loader, compares baseline/candidate and object cache off/on/auto, and executes every emitted program with stdin/stdout checks. It records compile/link time, bytes read through MemFS, temporary-file counts and cache statistics. Candidate correctness checks cover optional-header addition/removal, compiler flags, failed rebuild/recovery and the LLDB byte-only cache bypass. One warmup is excluded from medians. Timing comparisons are local evidence, subject to host load and engine tiering; copy counts and correctness checks are deterministic mechanisms.

## Pinned Chromium evidence (2026-10-23)

[Raw samples and receipts](../../scripts/performance-results/clang-host-20261023.json) use Chromium 153.0.8010.12 and the application's pinned Clang/LLD assets, with one warmup and four measured edits per workload. The same runtime compiles and executes every sample with stdin `9` and an exact expected stdout check. Variants run sequentially on a shared host, so filesystem timing is not treated as an isolated speedup claim.

| Workload   | Baseline MemFS bytes read | New FS bytes read, cache off | New FS median ms, cache off | New FS median ms, cache on |
| ---------- | ------------------------: | ---------------------------: | --------------------------: | -------------------------: |
| C / 1 TU   |                 8,380,349 |                    3,945,403 |                       426.5 |                      459.9 |
| C / 2 TU   |                 8,381,870 |                    3,946,400 |                       477.4 |                      560.7 |
| CPP / 1 TU |                27,521,761 |                   13,565,077 |                       281.5 |                      461.1 |
| CPP / 2 TU |                33,849,478 |                   18,323,105 |                     8,209.4 |                    2,684.9 |

Metadata lookup and output handling reduce observed file-content reads by 45.9–52.9% on these fixtures. The baseline retains 30 compiler temporary files after 20 builds; both candidate modes retain zero. Read bytes count calls through `getFileContents`, not network transfers or total process allocations. Compiler/sysroot download sizes do not change in this PR.

For the fixture with an unchanged C++ helper using vector, algorithm and numeric headers, boolean cache-on reduces the median from 8,209 to 2,685 ms. The small C two-TU fixture instead rises from 477 to 561 ms. This measured preprocessing tradeoff is why auto enables only C++ multi-file reuse, with C available through explicit `true`. Cache-on increases dependency/preprocessed byte reads; it saves frontend work rather than eliminating all I/O. Optional headers appearing/disappearing, compiler flags, a failed rebuild followed by recovery, and the LLDB cache bypass all passed with the real pinned compiler.

The [final auto-policy run](../../scripts/performance-results/clang-host-auto-20261023.json) also passed every emitted program and correctness check. It recorded exactly ten preprocessor invocations, four object hits and six misses: only the five C++ two-TU builds used the cache. C reads stayed byte-for-byte identical with cache off and auto. Its C++ two-TU medians were 5,309.7 / 999.9 ms, but the unchanged single-C++ path also shifted from 459.2 to 225.1 ms. This exposes substantial host/engine ordering effects; these timing ratios must not be presented as controlled or general speedups. The policy, reuse counts, read-byte reduction and zero retained temporary files are directly verified.
