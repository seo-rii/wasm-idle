# Python worker startup, editing and debugger inspection

The execution host and the default Python LSP host share immutable compiled
Pyodide engine code. The cache computes SHA-256 from a snapshot of the actual
bytes and uses a fixed default-compilation ABI key. It retains at most two modules
and 32 MiB of source bytes; that is an accounting bound, not an estimate of the
engine's internal memory. A failed compilation is removed. Each worker still
creates its own instance, memory, filesystem and Python interpreter.

LSP startup fetches and verifies the pinned runtime on the host, then structured
clones the module to the worker. Pyodide keeps its own import/sentinel setup; only
the exact bootstrap Wasm response is substituted during initialization. Explicit
custom Python base URLs keep the original loader contract. Aborting one startup
aborts its fetch and prevents replies to its retired worker, without cancelling
another consumer's immutable module. This cache does not change persistent-cache
preferences or eliminate runtime byte validation.

The LSP worker yields between synchronous Jedi calls. Adjacent full document
snapshots coalesce, newer same-kind requests supersede queued requests, and any
document/dependency change retires queued semantic work. Incremental changes and
open/save/close barriers retain their ordering. Already running Jedi work cannot
be preempted. Obsolete requests settle with empty results, matching the native
Monaco provider's cancellation behavior. Syntax diagnostics wait 120 ms for edit
bursts and include the document version; a delayed task checks that version again
before parsing. Existing Jedi parsing and dependency invalidation remain in use.

Debugger tracing still checks the shared atomic breakpoint version on every line.
A JavaScript property getter performs `Atomics.load`; the Python-to-JavaScript
snapshot function and JSON conversion run only when that version changes. This
preserves breakpoint edits while user code runs. It reduces the bridge cost but
does not eliminate the Python/JavaScript boundary or `sys.settrace` overhead.

Each pause previews at most 50 locals. Further pages are requested while paused,
without sorting or previewing the entire scope. Names and displayed previews are
bounded to 256 and 200 code points; explicit watch evaluation keeps its existing
preview rules. Pages follow Python's locals iteration order. Seeking a later page
still scans earlier keys, and obtaining `f_locals` has interpreter-specific cost.
The shared watch/page mailbox serializes requests and cancels polling on resume,
termination or a new pause, including when a recreated worker reuses a reference.
The variables panel displays the latest loaded page collection.

Focused tests cover burst coalescing, cancellation, dependency invalidation,
module identity/eviction/failure retry, isolated startup aborts, bounded previews
and mailbox cancellation. The Chromium fixtures use pinned Pyodide 314.0.7/Jedi
and verify execution stdin/Unicode stdout, execution-to-LSP module reuse, two fresh
LSP workers, rapid edits, live breakpoint updates, stepping, watch inspection,
scope pagination and cancellation. `scripts/test-python-debug-performance.py`
also checks the embedded tracer with native CPython; it is not browser evidence.
The Python PR browser family and the scheduled specialized shard include both
fixtures. After the normal package/asset preparation, focused coverage runs with:

```sh
WASM_IDLE_RUN_REAL_BROWSER_PYTHON=1 WASM_IDLE_RUN_REAL_BROWSER_PYTHON_DEBUG=1 \
  pnpm exec vitest run src/lib/playground/python-performance.playwright.test.ts \
  src/lib/playground/python-debug.playwright.test.ts --maxWorkers=1
```

`scripts/probe-python-breakpoint-polling.mjs` compares the two bridge checks in the
actual pinned Pyodide runtime. A local Node 22 probe used seven alternating rounds
of 100,000 unchanged checks: median callback time was 191.49 ms and property time
159.17 ms. Other workspace tasks were active. These are narrow bridge measurements,
not a browser or end-to-end debug speedup claim. Fixed trace-helper compilation
and `sys.monitoring` remain separate future experiments.
