# Python execution helpers, code objects and import analysis

## Cache immutable work, not program state

A large generated Python wrapper duplicates fixed helper source around user code on every run. This implementation initializes fixed helpers once per Pyodide runtime, compiles user code separately, and retains bounded code objects. Executing a cached code object must still create fresh user globals. A program that increments globals().get('value', 0) must print 1 every execution, not 1/2/3. The filename remains part of the compile identity for tracebacks and diagnostics; top-level await and explicit future-flag behavior remain supported.

Code-object admission uses an eight-entry LRU and a four-MiB accounting budget for source and serialized code. It is not a hard cap on the Python interpreter, JavaScript heap or Wasm memory. The image hook is compiled once but its original guard still executes in the expected namespace. Expensive optional-feature splitting is not implemented by this extraction.

## Import discovery is not package availability

The official pyodide.code.find_imports analyzes each source file separately, with a 32-entry/two-MiB accounted cache. Concatenating files before parsing can change syntax and scope boundaries. A cached list of import names does not prove the package is still available, so package loading retains its existing per-unprepared-run availability checks. A successful prepare result is consumable only by the next matching execution; failures and load changes invalidate that handoff.

Workspace files are deliberately rewritten. User Python can mutate its filesystem; assuming a matching editor string means matching runtime file contents would create stale reads. Differential synchronization needs a separate mutation-aware contract and is not silently enabled here. Debug and Hy retain their original real execution paths.

## Proxy ownership and composition

The helper owns retained Python function references. Each invocation owns its temporary dictionary and JavaScript callback names; cleanup runs even when compile/eval/await fails. Partial helper acquisition is cleaned up, disposal is idempotent, and later use of disposed helpers is rejected. These lifecycle rules avoid accumulating run contexts merely because compilation was cached.

This branch still uses the existing print/input bridge. The separate native-stdio PR changes that boundary. Combining the branches must retain helper reuse while replacing callbacks and preserving debug/Hy/image behavior; two independent green PRs are not integration proof.

## CI repair and genuine interpreter coverage

The old worker dispatch fixture assumed every Python call was runPythonAsync and did not implement extracted helper creation. Its complete original 27 test cases are retained byte-for-byte in python.runtime.cases.ts. The collected entrypoint supplies a narrow helper-boundary mock before importing those cases. This preserves asset trust, startup ordering, diagnostics and prepare-to-run assertions rather than replacing them with fewer tests.

The real-Pyodide integration separately executes the actual helper: three cached runs with fresh globals, Korean filenames, top-level await, CRLF input, real import discovery, runtime/syntax failure, restoration of builtins, recovery returning 42, and idempotent disposal. The focused local run using CI's Node 24.21.0 / TypeScript 6.0.3 / Vitest 5.0.3 passed all 28 checks (27 routing cases plus one real interpreter matrix). This is genuine Pyodide/Wasm in Node, not a browser UI or performance measurement. The native code-cache and actual-source worker regression scripts are additionally collected by normal root CI.

## Acceptance and limitations

Measure unchanged-source/input-only runs separately from source edits, first runtime initialization and package downloads. Record compile/cache hit counts, first output, total run latency and long-session memory with equal outputs and tracebacks. A cache hit does not remove user execution cost; a single first run can be slower due to helper initialization. No faster Python interpreter binary or browser speedup percentage is claimed. Full browser normal/debug/Hy switching, image output, interactive cancellation and combined stdio integration remain required before promotion.
