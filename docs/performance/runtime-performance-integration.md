# Combined runtime performance validation

This report records the integration of the runtime performance changes with main
`f5c45469df0fdef98e86a94ecc848ae66703a19f`, including the newer debugger state and
container and PostgreSQL LSP changes. The final measured source graph is
`e4b570571a4db0f6f6d17c36db1f6b774836435c`.

| Change                                                                              | Reviewed feature head                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------ |
| Brotli q5 comparison [#270](https://github.com/seo-rii/wasm-idle/pull/270)          | `807fc4c99d2dfce717c893e22ee6ce14106aec0d` |
| Rust diagnostics/execution [#271](https://github.com/seo-rii/wasm-idle/pull/271)    | `49285269280ab334fadab79e652702128b20b8f7` |
| Java output/module reuse [#272](https://github.com/seo-rii/wasm-idle/pull/272)      | `5659330055d39d91a16e4e2cb0db3b15b009afaf` |
| Python execution/debug/LSP [#273](https://github.com/seo-rii/wasm-idle/pull/273)    | `5f538f50a9341ed382fdc4d1638d5bca00dc3244` |
| Clang incremental work [#274](https://github.com/seo-rii/wasm-idle/pull/274)        | `44b5d0eb18c495a3d660ae2178f93134de237901` |
| LLDB module reuse/first pause [#275](https://github.com/seo-rii/wasm-idle/pull/275) | `e4b570571a4db0f6f6d17c36db1f6b774836435c` |

The earlier temporary integration base is superseded by these reviewed feature
commits. Installation allowances now live in the feature PRs that introduce the
files and bytes; this follow-up documents their combined validation.

## Installation measurements

Each checkout builds its own core, LLVM and container prerequisites, then runs
the standard `pnpm run verify:package`. That command rebuilds and packs the public
packages and performs five real npm installations, dependency exclusion checks,
budget checks and import smoke tests. Workspace package links resolve to the
checkout's own outputs. External dependencies may be shared; another checkout's
compiled workspace packages are not used.

Measurements use Node 22.23.3 and pnpm 12.9.1 on October 23, 2026. The final
combined installation results are:

| Installation                 |      Bytes | Files | Packages |
| ---------------------------- | ---------: | ----: | -------: |
| Root                         |  6,389,794 |   710 |        5 |
| Terminal                     | 16,802,907 | 1,305 |       28 |
| Debug                        |  7,294,907 | 1,144 |       21 |
| LSP                          |  4,527,126 |   651 |        6 |
| All public packages/adapters | 39,990,857 | 2,993 |       61 |

The root's 710 installed files comprise 438 root-package files, 271 dependency
files and npm's metadata file. Relative to the pre-Java/Python/LLDB baseline of 704 files,
Java, Python and LLDB each add one JavaScript/declaration pair. The package count
limit stays six. The final root byte allowance is 6,397,952 bytes (6 MiB + 104 KiB) and the
aggregate byte allowance is 40,001,536 bytes (38 MiB + 152 KiB); their measured headroom is
8,158 and 10,679 bytes respectively. Other
installation limits are unchanged. The final aggregate measurement exceeded the
previous 38 MiB + 128 KiB allowance by 13,897 bytes; its allowance increased by
24 KiB after measuring the combined graph.

For comparison, the isolated Java integration installed 6,370,462 bytes across
706 root files. Adding Python produced 6,378,105 bytes across 708 root files,
which exceeded the former 6,373,376-byte limit by 4,729 bytes. Its measured
allowance increased by 8 KiB. These are npm installation sizes, not browser
transfer measurements or a claim of reduced total package bytes.

## Integration fixes and validation

The integration baseline already has the richer debugger variable tree and stable
session/stop identities. The integration preserves those APIs while correcting
four interactions with progressive LLDB stack loading:

- The initial pause and deferred scope/stack events share the same captured
  session and stop IDs. Stale details from another stop or session are ignored.
- Variable comparison and expansion paths are registered when caller identities
  become complete, without replacing the previous stop's baseline. Partial
  caller suffixes cannot become comparison baselines.
- Explicit expand/collapse choices made while pages arrive remain attached to
  the same stop and frame. Once callers are complete, only those live choices
  move to the stable path; an explicit collapse overrides an older saved expansion.
- The 100-frame retention limit does not certify that a deeper or unknown stack
  is complete. Completion follows the adapter's actual total or a valid end of
  an unknown-length stack.

The Python browser scope fixture now renders the current page's `debugNodeRows`
snippet and node structure. The page's newer scope behavior remains intact.

Java passed 73 focused unit tests and its actual TeaVM Chromium fixture. Python
passed 84 execution/module/LSP unit tests, 28 host tests and eight actual
Chromium tests covering live breakpoints, stepping, scope pagination,
cancellation, Pyodide module reuse and the Jedi bridge. No tests in those
selections were skipped. The final LLDB integration passed 217 debugger-controller tests, 134 sandbox
session tests and 36 package-budget tests. The LLVM debugger suite separately
passed 241 tests during integration. New regressions failed before the fixes
and passed afterward, including deferred callers, stale stop identities,
truncated stacks and manual expand/collapse during stack loading.

The package measurements and focused tests describe the recorded source
commits. Their exact PR-head CI additionally checks the repository and selected
browser runtime families before merge. No new end-to-end wall-clock speedup is
claimed by this integration report; the individual performance reports retain
their measurements and limitations.

## Separate source-build experiments

The LLDB compiled-module cache remains opt-in and requires runtime capability
support. Existing published runtime pins and defaults are unchanged. The Rust
ELF-removal experiment in wasm-llvm [#51](https://github.com/seo-rii/wasm-llvm/pull/51)
and LLDB source-build qualification in
[#52](https://github.com/seo-rii/wasm-llvm/pull/52) have separate build and browser
evidence gates; merging these consumer changes does not qualify those producer
experiments. The Brotli q5 PR records the compression/transfer comparison and
does not change a production compression default.
