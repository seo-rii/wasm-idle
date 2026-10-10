# Python execution helpers, code objects and import analysis

## Cache immutable work, not program state

A large generated Python wrapper duplicates fixed helper source around user code on every run. This implementation initializes fixed helpers once per Pyodide runtime, compiles user code separately, and retains bounded code objects. Executing a cached code object must still create fresh user globals. A program that increments globals().get('value', 0) must print 1 every execution, not 1/2/3. The filename remains part of the compile identity for tracebacks and diagnostics; top-level await and explicit future-flag behavior remain supported.

Code-object admission uses an eight-entry LRU and a four-MiB accounting budget for source and serialized code. It is not a hard cap on the Python interpreter, JavaScript heap or Wasm memory. The image hook is compiled once but its original guard still executes in the expected namespace. Expensive optional-feature splitting is not implemented by this extraction.

## Import discovery is not package availability

The official pyodide.code.find_imports analyzes each source file separately, with a 32-entry/two-MiB accounted cache. Concatenating files before parsing can change syntax and scope boundaries. A cached list of import names does not prove the package is still available, so package loading retains its existing per-unprepared-run availability checks. A successful prepare result is consumable only by the next matching execution; failures and load changes invalidate that handoff.

Workspace files are deliberately rewritten. User Python can mutate its filesystem; assuming a matching editor string means matching runtime file contents would create stale reads. Differential synchronization needs a separate mutation-aware contract and is not silently enabled here. Debug and Hy retain their original real execution paths.

## Proxy ownership and composition

The helper owns retained Python function references. Each invocation owns its temporary dictionary and JavaScript callback names; cleanup runs even when compile/eval/await fails. Partial helper acquisition is cleaned up, disposal is idempotent, and later use of disposed helpers is rejected. These lifecycle rules avoid accumulating run contexts merely because compilation was cached.

Normal worker execution passes only source, filename and the readiness callback to the cached helper. Native Python print/input and the per-run stdio observer retain input buffering, explicit flushes and output cleanup. Explicit helper callers can still supply bridges; absent bridges use Python's default None arguments rather than JavaScript null, which Pyodide exposes as a JsNull object. Debug and Hy retain their own execution paths with the same stdio lifecycle.

The first nonempty decoded output in each run reaches the host immediately. A warm cached program can print once and enter a synchronous CPU loop before the batch timer runs; holding that first output hides execution progress until the loop ends or is interrupted. Later output retains bounded batching, with explicit flush, input and completion boundaries unchanged.

## CI repair and genuine interpreter coverage

The worker dispatch fixture retains all 27 cases in python.runtime.cases.ts, including asset trust, startup ordering, diagnostics and prepare-to-run assertions. Its native byte writers and flush-hook boundary compose with the collected entrypoint's narrow execution-helper mock. Actual interpreter behavior remains covered separately from dispatch mocks.

The real-Pyodide integration separately executes the actual helper: cached runs with fresh globals, Korean filenames, top-level await, CRLF input, real import discovery, runtime/syntax failure, restoration of builtins, recovery returning 42, and idempotent disposal. A combined matrix verifies native stream identity, immediate explicit prompt flushes, Unicode input and repeated cached executions. Shared stdio tests cover unread-input isolation, closed-stream recovery and restoration of stream configuration; real Pyodide tracing also covers unchanged JavaScript-null breakpoint tokens. These are interpreter checks in Node, separate from browser UI and performance measurements. Native code-cache and actual-source worker regression scripts are additionally collected by normal root CI.

## Acceptance and limitations

Measure unchanged-source/input-only runs separately from source edits, first runtime initialization and package downloads. Record compile/cache hit counts, first output, total run latency and long-session memory with equal outputs and tracebacks. A cache hit does not remove user execution cost; a single first run can be slower due to helper initialization. No faster Python interpreter binary or browser speedup percentage is claimed. Full browser normal/debug/Hy switching, image output, interactive cancellation and combined stdio integration remain required before promotion.
