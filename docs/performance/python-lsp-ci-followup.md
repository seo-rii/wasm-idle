# Python LSP CI follow-up: independent debugger measurement

The real pinned-Pyodide/Jedi integration passed locally. Its first remote type-check exposed the undeclared FS.mkdirTree helper; fixture directory creation now uses actual Python os.makedirs, with strict TypeScript and the real matrix rerun successfully.

On 39947f4988ebc4289aa7bae55ac49e5ebfd29afe, LLDB run 38020887261 completed stepping, crash recovery, transport stress and debug-worker termination assertions, then failed the unchanged post-stop renderer heap guard: 132037668 bytes versus 67108864. This matches the measurement failure independently investigated in PR #75; it is not evidence that Python LSP caused that allocation.

This branch reuses the exact four CI instrumentation blobs from #75: a Chromium launcher with --enable-precise-memory-info, a retained/released allocation calibration, the launcher/unchanged-guard regression tests, and the LLDB workflow wiring. The product debug.playwright.test.ts, 64 MiB threshold, relaunch counts, strict CSP and runtime assets are unchanged. No artifact-runtime production changes are copied from #75.

The calibration requires a deliberately retained 96 MiB buffer to exceed the existing 64 MiB guard, then verifies that released memory is visible after GC. The real product test still runs separately and may fail. This prevents stale low measurements from producing a false pass. The same instrumentation already passed #75's actual LLDB run 38020694849; this branch requires its own fresh CI result.

Detailed mechanism, primary Chromium sources and local calibration evidence are recorded in PR #75's docs/performance/lldb-memory-measurement.md at commit 6291d08da1ee3f2bf36f490a299e84d79efbcdc9. Chromium caches performance.memory without the precision flag; the investigation distinguishes that behavior from proving an absence of retained product allocations. Do not infer a runtime memory reduction from this test-only change. Preserve earlier failing runs as evidence and reconcile the identical shared CI files once when merging the independent branches.
