# Python debugging: event cost and bounded automatic inspection

## The two different bottlenecks

Continuing a program generates many trace events but comparatively few pauses. A useful optimization removes work from events that do not stop; it does not weaken breakpoints or approximate source execution. Inspecting a paused program is a separate workload: a variable pane must not traverse a million-entry container merely to display six entries.

The trace callback still polls the shared breakpoint version so edits made while running take effect. The host compares the requested version before copying or JSON-encoding the payload. An unchanged version returns null. A changed version retains the existing filtering and bounds. This is not a new atomic-snapshot protocol and does not promise lock-free consistency beyond the existing writer contract.

The ordinary continue path avoids an f_back traversal. Next, step-out and actual pauses still obtain the depth they need. Removing those comparisons would make recursion and stepping incorrect; the native regression executes real sys.settrace events rather than only examining source strings.

## Preview policy is part of the user-visible contract

Strings and bytes are sliced before representation. Lists/tuples inspect at most eight entries; dictionaries/sets inspect at most six; recursion retains the depth bound. Huge integers use a bounded descriptive form instead of decimal conversion. Automatic previews do not invoke arbitrary user `__repr__` implementations or custom-container methods. The cost is a deliberately less detailed display for custom objects, not a change to the running program. Explicit watch expressions remain the way to request a user-defined representation. Set previews are not globally sorted: that would traverse the entire set and defeat the bound.

These limits bound inspection work, not the program's allocation or total Pyodide heap. Each pause initially previews at most 50 visible locals; additional pages remain explicit. Measuring pause latency and long-session retention remains necessary. sys.monitoring is not introduced here, and no LLDB/WAMR behavior is changed.

## CI repair and validation layers

The old source test expected the removed inline bytes formatter and full-set sorting. It now follows the imported PYTHON_DEBUG_PREVIEW and still verifies hidden-local filtering, watch dispatch, trace cleanup and separate execution/debug filenames. The executable native Python and actual-worker host regressions are also collected by the normal root Vitest suite, so the source check is not the only safety net.

Locally executed with the CI dependency snapshot: Node 24.21.0, TypeScript 6.0.3 and Vitest 5.0.3; two source tests plus two harness checks passed. The harness checks execute the two worker tests and ten native Python tracing/preview tests. This focused run uses a Node test configuration rather than the complete Svelte application configuration. Native tracing and a mocked Pyodide worker are not a real browser debugger benchmark.

The preceding CI had a separate J-runtime timeout and an LLDB post-stop JavaScript heap delta above its unchanged 64 MiB guard. Neither check is removed or relaxed by this repair. A fresh CI result must be reported separately; a successful Python unit run cannot resolve an LLDB memory failure.

## Acceptance measurements

Use the same program and breakpoint sequence before/after: continue through a large loop, update breakpoints during execution, next/into/out through recursion, inspect large strings/containers, evaluate explicit watches, cancel and rerun. Record continue wall time, trace-event/JSON/stack-walk counts, pause-to-variables latency and post-stop memory. Keep failures and cold/warm runs separate. No numerical speedup is claimed before those browser measurements.

## Reusing fixed debug setup

Debug runs now compile the fixed trace/preview source and image hook once per Python worker. Each run executes that code into a new private dictionary containing its own source filenames, initial breakpoints, version, pause state and bridge. Only code objects are shared. Source programs still compile with their actual execution filename, execute in a fresh `__main__`, and retain top-level await, input/output and workspace-import behavior.

The image hook executes its existing installation guard in the same Pyodide globals as ordinary runs. The worker removes each run's imported trace and destroys its JavaScript proxy in the cleanup path, including syntax errors, user exceptions and cancellation. It does not cache a frame, user globals or a previous run's stepping state. The atomic breakpoint-version check remains on every user line. Its unchanged-version branch now returns directly to the trace logic without calling the Python snapshot helper; that helper is entered when the version changes. The real `sys.settrace` event stream and bounded locals paging remain in place.

The opt-in probe runs the actual pinned Pyodide on Node:

```sh
node scripts/probe-python-debug-trace.mjs --baseline-ref=27b4be22fbc7e9a543eadd0b3267b40cecabbd61
```

It records the Node/Pyodide/Python versions and source hashes, separates the first run, then records seven alternating-order samples after one warmup. The continue workload executes the same 50,000-iteration loop with no trace, a minimal trace, the baseline helper and the current helper. Setup timing separately compares compilation/execution of the baseline fixed helpers with creation of a fresh run from cached helper code. It excludes runtime loading, user-source compilation, pauses, DOM rendering and network delivery; it is not an end-to-end browser speedup claim. Timing is reported rather than used as a flaky CI threshold.

### Pinned-runtime measurements (2026-10-28)

One Node 24.22.1 process with Pyodide 314.0.7 / CPython 3.14.2 produced these median times using the probe above. Comparisons use the same process and alternating samples; absolute times vary with host load.

| Workload                                   |  Baseline |   Current |
| ------------------------------------------ | --------: | --------: |
| Continue through the 50,000-iteration loop | 182.40 ms | 166.51 ms |
| Fixed trace/image setup per debug run      |  5.634 ms |  0.047 ms |

The loop reduction is 8.7% in this workload. The same loop took 9.39 ms without tracing and 20.27 ms with a minimal no-op `sys.settrace` callback: most remaining debugger cost is in its Python/JavaScript line handling, not helper compilation. Both debugger variants checked the shared version on every user line; only changed versions requested JSON snapshots. The setup comparison has 20 repetitions per sample and excludes the one-time factory compilation. These are separate costs, not additive estimates of a full debug launch.

## Why sys.monitoring remains an experiment

The pinned Pyodide 314.0.7 runs CPython 3.14.2 and exposes `sys.monitoring`. Availability is insufficient for replacing the debugger. The probe's single-line `while` program produces `sys.settrace` lines `[1, 2, 2, 2, 2, 3]`, while a monitoring `LINE` callback sees `[1, 2, 3]`. This follows the [Python monitoring event contract](https://docs.python.org/3.14/library/sys.monitoring.html#monitoring-events): `LINE` concerns changes in source line, while jumps and function lifecycles have separate events. A LINE-only replacement would lose repeated-line breakpoints and stepping.

Disabling events at non-breakpoint locations would also remove the current opportunity to poll a running program's shared breakpoint version. A future backend needs a qualified event/rearming design, frame lookup, recursion/generator handling and cancellation behavior. No alternate monitoring backend is enabled. A separate initial experiment that split global frame dispatch from the local line callback was slower on the pinned interpreter and was discarded.

The regression layers now check helper code identity with fresh state, changed filenames, error/cancellation recovery and the image guard in actual Pyodide; native tracing additionally covers recursive step-out. The real Chromium worker cases retain live edits, watches, imported source paths and locals paging, and add repeated-line stepping, recursive stepping and interactive input on the reused worker. Native CPython event counts can differ from the pinned browser interpreter, so the browser test explicitly covers CPython 3.14's final false `while` condition.
