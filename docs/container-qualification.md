# Container qualification evidence

Recorded 2026-10-14. This is a component evidence ledger, not a released command alpha, shell
MVP or persistent beta. Work that can proceed independently of the blocked shell bridge has
been implemented; unpassed promotion gates remain explicit.

## Review order

| Work | PR | Base / dependency |
| --- | --- | --- |
| Scope and boundaries | [C-01 #128](https://github.com/seo-rii/wasm-idle/pull/128) | main at implementation start |
| Real Bash probe and backend decision | [C-02 #133](https://github.com/seo-rii/wasm-idle/pull/133) | C-01, independent experiment |
| Package/API | [C-03 #135](https://github.com/seo-rii/wasm-idle/pull/135) | C-01 |
| VFS and writer leases | [C-04 #136](https://github.com/seo-rii/wasm-idle/pull/136) | C-03 |
| Byte pipes/fds | [C-05 #137](https://github.com/seo-rii/wasm-idle/pull/137) | C-04 |
| WASI Worker Supervisor | [C-06 #138](https://github.com/seo-rii/wasm-idle/pull/138) | C-05 |
| Pinned distribution index | [C-07 #139](https://github.com/seo-rii/wasm-idle/pull/139) | C-06 |
| Verified asset loader | [C-08 #141](https://github.com/seo-rii/wasm-idle/pull/141) | C-07 |
| Atomic lazy package mounts | [C-09 #142](https://github.com/seo-rii/wasm-idle/pull/142) | C-08 |
| LLVM tool-host and snapshot adapter | [C-10 #144](https://github.com/seo-rii/wasm-idle/pull/144) (draft) | C-09; actual producer qualification pending |
| Opt-in LLVM driver/cwd producer ABI | [wasm-llvm C-11 #32](https://github.com/seo-rii/wasm-llvm/pull/32) (draft) | wasm-llvm main; full relink/CLI gate pending |
| Real BusyBox B0 producer | [C-12 #143](https://github.com/seo-rii/wasm-idle/pull/143) | C-01, separate producer branch |
| BusyBox container qualification | [C-13 #146](https://github.com/seo-rii/wasm-idle/pull/146) | C-10 plus external C-12 verified artifact |
| Explicit workspace persistence | [C-17 #145](https://github.com/seo-rii/wasm-idle/pull/145) | C-10; independent of live shell |
| Host CI and qualification ledger | [C-19 groundwork #147](https://github.com/seo-rii/wasm-idle/pull/147) | C-17; production release still gated |
| Live VFS ownership and additive mounts | [C-14a #148](https://github.com/seo-rii/wasm-idle/pull/148) | C-19 groundwork |
| Isolated live WASI and explicit byte pipelines | [C-14b branch](https://github.com/seo-rii/wasm-idle/tree/feat/container/c14-live-wasi) | C-14a; actual shell backend remains separate |

The CI/documentation PR is based on C-17. It implements only the independently testable
portion of C-19, without claiming production qualification. The subsequent C-14 stack adds
live VFS ownership and an isolated WASI adapter; it does not supply the pending actual shell
backend. Merge in dependency order and retarget/rebase the remaining stack
as needed; no PR is automatically merged.

## Verified components

- The C-14 worktree source snapshot passed 83 container Node unit/contract cases and real
  isolated Chromium live execution, including two guest file sharing, partial binary I/O,
  byte pipelines, early reader exit, crash visibility, blocked-I/O/CPU cancellation and
  zero owned Workers after cleanup. Nonisolated startup rejects before allocating a Worker.
  The committed `packages/container/test/fixtures/live-browser-evidence.json` records the
  baseline commit plus exact source hashes, environment and checks. This does not qualify
  actual Bash or BusyBox pipelines. The live guest SHA-256 is
  `d40963aaabe8c64b32ab77d30dd9b26dfc6bd6699c92c5a4c4e4e36750ebeae0`.
  C-14 npm dry-run pack contains 65 host/type/document files, 256,582 unpacked bytes;
  binaries and test receipts are excluded and root import still performs zero fetches.
  Existing Chromium batch/cache and all 10 persistence regressions also passed after
  the live changes; cache reuse and explicit committed-root recovery remain intact.
- The C-10 source snapshot passed 68 container Node unit/contract tests, 9 focused LLVM tool-host
  protocol tests, and real Chromium batch/cache tests. The existing LLVM Clang regression suite
  passed 202 tests across 20 files. Protocol fixtures do not replace real Clang evidence.
- C-17 added timestamp-preserving snapshots and explicit container/owner integration. Its
  focused filesystem/WASI suite passed 31 tests; 10 real Chromium persistence scenarios cover
  reload, bytes/inodes/timestamps/symlinks, a second-tab writer, cache deletion, interrupted blob
  publication, last-good recovery, metadata limits, unsaved export and disposal.
- Actual Chromium 153.0.8010.12 on Linux x64, kernel `6.1.0-53-cloud-amd64`, passed batch execution
  under restrictive CSP both without isolation and with COOP/COEP. The guest uses real Wasm,
  argv including empty/Korean values, separate byte output, relative cwd files, nonzero exit,
  CPU-loop cancellation/restart and crash discard; no owned Workers remain.
- Each cache case performs two executions separated by a page reload, with `Cache-Control:
  no-store` and zero in-memory asset cache entries. Exactly one asset body request occurs;
  command metadata lookup requests none. CacheStorage/IndexedDB retain the verified bytes.
- The real WASI fixture SHA-256 is
  `d0677464798321b70268b0db86df56fc8e6c4a52d5c57f2a0950c5eab0f25982`.
  Build it with `node packages/container/scripts/build-fixtures.mjs`; it is not a compiler mock.
- The npm dry-run pack contains 56 host/type/document files (206,905 unpacked bytes at this
  source snapshot), with no Wasm, WEBc, sysroot or archive. Package verification checks the
  actual npm file list and rejects executable assets; a root import performs zero fetches.
- The real BusyBox 1.37.0 B0 binary is 303,353 bytes, SHA-256
  `e4a21b3bb0cea1495a42b6dfba71a2e89b44b3d80a6d703e1542fd909781b133`.
  Its source pack SHA-256 is
  `ccb77c4afaddc1642651033cec10ea4848124a6f2030d27d346607054461327b`.
  Twenty native and 24 producer Node-WASI checks passed. C-13 runs the same verified artifact
  in 20 container Node cases and 40 Chromium cases (cold/reload), including aliases, cwd,
  binary `cat`, stderr/nonzero exits, host edits between commands and one-body cache reuse.

Each PR retains its fixture commands, source/artifact hashes and result receipt. CI uploads
fresh browser JSON receipts with the tested commit and actual environment. Local successes do
not imply the GitHub workflow has already completed, or that another browser/version passed.

## Blocked or incomplete gates

| Gate | Observed boundary | Next experiment / owner |
| --- | --- | --- |
| G0-SHELL/FS/FD/CANCEL | Real pinned WASIX SDK 0.10.0 Bash can execute selected external Wasm, but loses empty arguments, has inconsistent exit propagation and incomplete host filesystem visibility; nested Worker ownership needs explicit cleanup | C-02 backend investigation; choose and qualify a maintained native/bridge path before C-14/15 |
| G0-CLANG / CLI-01–03 | Existing raw Clang reports that WASI cannot spawn subprocesses. Preopens/PWD do not set wasi-libc's cwd. Full modified compiler qualification is pending | wasm-llvm #32 opt-in LLVM `ExecuteAndWait` bridge and real `chdir` startup; complete Clang/LLD relink and actual C/C++ CLI gate, then browser |
| B1 / P3 | Only six B0 applets have runtime evidence | Port and differentially test `grep`, `mkdir`, `cp/mv/rm` and required filesystem calls; do not infer support from multicall build success |
| P4 / shell MVP | C-14 supplies live WASI VFS/SAB I/O and pipeline admission; actual shell dispatch/common WASIX fd ownership and full acceptance remain absent | C-15 after backend and real compiler gates; snapshot Clang cannot overlap live users |
| P5 / product beta | Persistence storage primitive passes targeted Chromium cases; editor/terminal/save/export UI and orphan GC absent | C-16/18; failure UI, lifecycle and actual crash/reload matrix |
| C-19/20 | Local header smoke only; no production release or performance baseline | Real immutable hosting/receipt/license closure and clean-origin acceptance, then measured optimizations |

The opt-in producer's small real LLVM Support ABI fixture passed five dispatch cases, and a
real wasi-libc constructor fixture confirmed `getcwd`, relative reads, bad-cwd rejection and
restart. Neither proves the full compiler. An initial exec-only private relink exceeded its
2,700-second wall deadline. The exec+cwd successor exhausted its 10 GiB address-space cap under
full LTO. A correctness-only retry uses O1/CGO1, one linker thread and a 16 GiB address-space
bound, with sequential Clang/LLD links and a separately recorded consumer gate. Keep compiler PRs draft
until that gate and required browser/header coverage have actual receipts.

The selected-target full sysroot remains intact: 35,328,000 logical bytes, 2,168 files plus
117 directories, SHA-256 `91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402`.
It comes from the existing producer revision `25ef7345eba86fce0352e7eb0a881e23ed0e684f`;
no headers were pruned to make a minimal example pass.
