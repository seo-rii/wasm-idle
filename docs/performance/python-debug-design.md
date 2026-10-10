# Python debugging: event cost and bounded automatic inspection

## The two different bottlenecks

Continuing a program generates many trace events but comparatively few pauses. A useful optimization removes work from events that do not stop; it does not weaken breakpoints or approximate source execution. Inspecting a paused program is a separate workload: a variable pane must not traverse a million-entry container merely to display six entries.

The trace callback still polls the shared breakpoint version so edits made while running take effect. The host compares the requested version before copying or JSON-encoding the payload. An unchanged version returns null. A changed version retains the existing filtering and bounds. This is not a new atomic-snapshot protocol and does not promise lock-free consistency beyond the existing writer contract.

The ordinary continue path avoids an f_back traversal. Next, step-out, resume-skip comparisons and actual pauses still obtain the depth they need. Removing those comparisons would make recursion and stepping incorrect; the native regression executes real sys.settrace events rather than only examining source strings.

## Preview policy is part of the user-visible contract

Strings and bytes are sliced before representation. Lists/tuples inspect at most eight entries; dictionaries/sets inspect at most six; recursion retains the depth bound. Huge integers use a bounded descriptive form instead of decimal conversion. Automatic previews do not invoke arbitrary user __repr__ implementations or custom-container methods. The cost is a deliberately less detailed display for custom objects, not a change to the running program. Explicit watch expressions remain the way to request a user-defined representation. Set previews are not globally sorted: that would traverse the entire set and defeat the bound.

These limits bound inspection work, not the program's allocation or total Pyodide heap. Each pause can still contain many variables; measuring pause latency and long-session retention remains necessary. sys.monitoring is not introduced here, and no LLDB/WAMR behavior is changed.

## CI repair and validation layers

The old source test expected the removed inline bytes formatter and full-set sorting. It now follows the imported PYTHON_DEBUG_PREVIEW and still verifies hidden-local filtering, watch dispatch, trace cleanup and separate execution/debug filenames. The executable native Python and actual-worker host regressions are also collected by the normal root Vitest suite, so the source check is not the only safety net.

Locally executed with the CI dependency snapshot: Node 24.21.0, TypeScript 6.0.3 and Vitest 5.0.3; two source tests plus two harness checks passed. The harness checks execute the two worker tests and ten native Python tracing/preview tests. This focused run uses a Node test configuration rather than the complete Svelte application configuration. Native tracing and a mocked Pyodide worker are not a real browser debugger benchmark.

The preceding CI had a separate J-runtime timeout and an LLDB post-stop JavaScript heap delta above its unchanged 64 MiB guard. Neither check is removed or relaxed by this repair. A fresh CI result must be reported separately; a successful Python unit run cannot resolve an LLDB memory failure.

## Acceptance measurements

Use the same program and breakpoint sequence before/after: continue through a large loop, update breakpoints during execution, next/into/out through recursion, inspect large strings/containers, evaluate explicit watches, cancel and rerun. Record continue wall time, trace-event/JSON/stack-walk counts, pause-to-variables latency and post-stop memory. Keep failures and cold/warm runs separate. No numerical speedup is claimed before those browser measurements.
