# Debugger responsiveness benchmark

Run the actual Clang/LLDB/WAMR and javac/TeaVM implementations in Chromium:

```sh
node scripts/benchmark-debug-responsiveness.mjs --assets /path/to/static --samples 10 --json /tmp/debug-responsiveness.json
```

The default asset directory is `static`. Assets must match this checkout's pinned receipts;
the harness also accepts gzip-compressed asset storage. `--languages lldb` or
`--languages java` runs only one backend. `--samples` accepts 2–100 sessions per backend,
including the first session. Set `WASM_IDLE_CHROMIUM_EXECUTABLE` to select Chromium.
The normal browser-test cookie helper is used when configured.

This is an opt-in local benchmark, not a timing gate in CI. Each language has a fresh
browser context, and sessions run sequentially. The output preserves raw samples,
nearest-rank p50/p95, Chromium/Node versions, source fingerprints, and asset hashes.
Use the same machine, browser, assets, sample count, and workload when comparing
revisions. Alternate baseline/candidate order and repeat runs before claiming an
improvement. Ten samples are exploratory; small changes need more repetitions.

## What the timings include

| Metric                  | Start → end                                                                       |
| ----------------------- | --------------------------------------------------------------------------------- |
| Preparation             | LLDB: compile the C fixture once; Java: load the Java compiler/runtime            |
| First session           | Start the first debug run → first source pause event                              |
| Restart                 | Start another run in the same context → first source pause event                  |
| Step                    | Send `nextLine` → next source pause event                                         |
| First Watch per session | Evaluate `number + 5` → result; the first Java session includes evaluator startup |
| Repeated Watch          | Repeat that expression twice while paused → each result                           |
| Continue                | Send `continue` → execution completion                                            |

These measure the sandbox API boundary, not button-click-to-DOM-paint latency. C is
compiled once outside LLDB launch measurements. Java compilation is part of its
launch path. Therefore backend startup numbers are not directly comparable.
“First session” does not mean a fully cold OS or browser engine: disk and engine
caches are not cleared. Persistent asset storage is disabled; existing in-memory
compiler/module/evaluator caches retain their production behavior. The optional
LLDB module cache remains at its production default (disabled).

Every sample asserts the original source and line, initialized local value, three
correct Watch results when supported, the next source line and changed local value after Step,
and final program output. The retained Java runtime can reuse immutable compiled
code, but the fixture must still start with `number = 68` on every restart.

The currently pinned LLDB manifest disables `evaluateExpressions`. Its Watch
metrics are therefore `null`, with `watchSupported: false`; the benchmark does not
enable an unqualified capability. Java Watch uses the real snapshot evaluator.

## Memory interpretation

Chromium runs with `--enable-precise-memory-info`. Before each backend, a retained
96 MiB `ArrayBuffer` must increase reported memory by at least 64 MiB and release
back to within 16 MiB of baseline after garbage collection. A failed calibration
fails the benchmark.

The report records page `performance.memory.usedJSHeapSize` after each run and
after disposal, with an explicit garbage collection before each sample. This
includes the measured page's V8 backing allocations; it is **not total debugger
memory, worker heap size, browser RSS, or an operating-system release guarantee**.
Worker counts are recorded separately, and disposal must leave zero live workers.
Comparing post-disposal page memory against the imported-module baseline can
highlight retained page state, but investigating worker or process memory requires
the measurements described in [LLDB memory measurement](lldb-memory-measurement.md).

The harness serves its own bundles and runtime bytes from an ephemeral loopback
server. It does not build the application, modify runtime glue, install extensions,
or change production debugger settings.

## Example capture

[The recorded capture](debugger-responsiveness-sample.json) used Chromium
156.0.8078.4 on Linux x64, ten sessions per backend, and product source
`27b4be22fbc7e9a543eadd0b3267b40cecabbd61`. The report contains the exact benchmark
source hashes and pinned asset hashes. These are one-machine exploratory results,
not a baseline/candidate speedup claim. Values below are milliseconds.

| Metric                                         |          LLDB |          Java |
| ---------------------------------------------- | ------------: | ------------: |
| Preparation                                    |         1,463 |           437 |
| First session                                  |         2,968 |         3,078 |
| Restart p50 / p95 (9 samples)                  | 1,119 / 2,036 |     7.0 / 9.3 |
| Step p50 / p95 (10 samples)                    |  12.7 / 569.7 |     1.3 / 1.6 |
| First Watch per session p50 / p95 (10 samples) |   Unsupported | 1,981 / 2,464 |
| Repeated Watch p50 / p95 (20 samples)          |   Unsupported |     5.0 / 7.0 |

The Java result identifies evaluator startup on a new debug run as a useful
future investigation: repeated evaluation at the same stop already benefits
from its compiled-artifact cache. The LLDB Step tail also warrants repeated,
isolated measurements before choosing an optimization.

All sessions passed their correctness assertions. LLDB had zero observed workers
after each disconnect and collection; Java retained one runtime worker between
runs. Both backends had zero workers after final disposal. Post-disposal page
heap was about 4.7 MiB for LLDB and 12.2 MiB for Java, subject to the page-only
measurement limits above.
