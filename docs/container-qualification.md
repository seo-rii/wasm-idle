# Container qualification evidence

Recorded 2026-10-14. This is a component evidence ledger, not a released command alpha, shell
MVP or persistent beta. Work that can proceed independently of the blocked shell bridge has
been implemented; unpassed promotion gates remain explicit.

## Review order

| Work | PR | Base / dependency |
| --- | --- | --- |
| Scope and boundaries | [C-01 #128](https://github.com/seo-rii/wasm-idle/pull/128) | main at implementation start |
| Real Bash probe and backend decision | [C-02 #133](https://github.com/seo-rii/wasm-idle/pull/133) | C-01, independent experiment |
| Pinned SDK bridge source experiment | [C-02 follow-up #149](https://github.com/seo-rii/wasm-idle/pull/149) (draft) | C-02; source/protocol checks only, modified SDK execution pending |
| Package/API | [C-03 #135](https://github.com/seo-rii/wasm-idle/pull/135) | C-01 |
| VFS and writer leases | [C-04 #136](https://github.com/seo-rii/wasm-idle/pull/136) | C-03 |
| Byte pipes/fds | [C-05 #137](https://github.com/seo-rii/wasm-idle/pull/137) | C-04 |
| WASI Worker Supervisor | [C-06 #138](https://github.com/seo-rii/wasm-idle/pull/138) | C-05 |
| Pinned distribution index | [C-07 #139](https://github.com/seo-rii/wasm-idle/pull/139) | C-06 |
| Verified asset loader | [C-08 #141](https://github.com/seo-rii/wasm-idle/pull/141) | C-07 |
| Atomic lazy package mounts | [C-09 #142](https://github.com/seo-rii/wasm-idle/pull/142) | C-08 |
| LLVM tool-host and snapshot adapter | [C-10 #144](https://github.com/seo-rii/wasm-idle/pull/144) (draft) | C-09; actual producer qualification pending |
| Opt-in LLVM driver/cwd producer ABI | [wasm-llvm C-11 #32](https://github.com/seo-rii/wasm-llvm/pull/32) (draft) | wasm-llvm main; full relink/CLI gate pending |
| Receipt-gated actual Clang browser fixture | [C-11 consumer #159](https://github.com/seo-rii/wasm-idle/pull/159) (draft) | C-10 plus completed producer/CLI receipts; new compiler execution pending |
| Real BusyBox B0 producer | [C-12 #143](https://github.com/seo-rii/wasm-idle/pull/143) | C-01, separate producer branch |
| Minimal BusyBox B1 producer | [C-12 follow-up #156](https://github.com/seo-rii/wasm-idle/pull/156) | C-12; selected profiles and native/WASI differential evidence |
| BusyBox container qualification | [C-13 #146](https://github.com/seo-rii/wasm-idle/pull/146) | C-10 plus external C-12 verified artifact |
| BusyBox B1 container qualification | [C-13 follow-up #163](https://github.com/seo-rii/wasm-idle/pull/163) | C-13 plus C-12 B1 artifact and portable fd/directory fixes |
| Explicit workspace persistence | [C-17 #145](https://github.com/seo-rii/wasm-idle/pull/145) | C-10; independent of live shell |
| Host CI and qualification ledger | [C-19 groundwork #147](https://github.com/seo-rii/wasm-idle/pull/147) | C-17; production release still gated |
| Live VFS ownership and additive mounts | [C-14a #148](https://github.com/seo-rii/wasm-idle/pull/148) | C-19 groundwork |
| Isolated live WASI and explicit byte pipelines | [C-14b #150](https://github.com/seo-rii/wasm-idle/pull/150) | C-14a; actual shell backend remains separate |
| Workspace events and staged editor buffers | [C-16a #155](https://github.com/seo-rii/wasm-idle/pull/155) | C-14b; SDK binding independent of shell/UI renderer |
| Terminal byte-stream UI binding | [C-16b #170](https://github.com/seo-rii/wasm-idle/pull/170) | C-16a; real guest and host failure/cancellation fixtures |
| Actual BusyBox live VFS and pipes | [C-14 follow-up #171](https://github.com/seo-rii/wasm-idle/pull/171) | C-14b plus the external pinned B1 artifact; no shell interpreter |
| Portable workspace backup and atomic restore | [C-18a #157](https://github.com/seo-rii/wasm-idle/pull/157) | C-16a |
| Save state and optional autosave | [C-18b #164](https://github.com/seo-rii/wasm-idle/pull/164) | C-18a; explicit persistence owner remains separate |

The initial CI/documentation PR is based on C-17; its [follow-up #167](https://github.com/seo-rii/wasm-idle/pull/167)
is based on C-18b. They implement only the independently testable
portion of C-19, without claiming production qualification. The subsequent C-14 stack adds
live VFS ownership and an isolated WASI adapter; it does not supply the pending actual shell
backend. This ledger covers independent branches; a single PR does not include every listed
component. Merge in dependency order and retarget/rebase the remaining stack
as needed; no PR is automatically merged.

## Verified components

- The C-14 source snapshot passed 103 container Node unit/contract cases and 34 real
  isolated Chromium checks, including two guest file sharing, partial binary I/O,
  byte pipelines, early reader exit, crash visibility, blocked-I/O/CPU cancellation and
  atomic dirfd operations during namespace replacement, paged directory deletion, and
  29 owned Workers reclaimed to zero. A final stdin byte-ownership regression and 15 focused
  checks passed before repeating all 34 browser checks. Nonisolated startup rejects before
  allocating a Worker. GitHub CI at `cdbba220` also passed the container and existing runtime
  regression jobs.
  The committed `packages/container/test/fixtures/live-browser-evidence.json` records the
  baseline commit plus exact source hashes, environment and checks. This does not qualify
  actual Bash or BusyBox pipelines. The live guest SHA-256 is
  `f27e623971cec039be49e18209fa19822d9b8acb1e6d0a33ca65e02cd765efaf`.
  C-14 npm dry-run pack contains 65 host/type/document files;
  binaries and test receipts are excluded and root import still performs zero fetches.
  Existing Chromium batch/cache and all 10 persistence regressions also passed after
  the live changes; cache reuse and explicit committed-root recovery remain intact.
- C-16 uses bounded generation/rescan events and inode/content conflict checks for staged
  editor buffers. Fourteen actual live/snapshot guest checks passed in Chromium with three
  Workers reclaimed to zero. File writes, readonly/snapshot admission and editor buffers copy
  Buffer inputs into owned bytes; 34 focused filesystem/editor tests cover that boundary.
  The restacked `fdf56255` container CI passed these browser fixtures again.
- C-18 backup validates bounded metadata, paths, body ranges and SHA-256 before one leased
  workspace replacement. Seven focused tests cover hostile checksum-valid archives, quotas,
  busy resources and caller Buffer mutation while verification awaits. The initial 12 real
  Chromium persistence checks were extended to 14 with manual/default saving, opt-in autosave,
  visible storage failures, explicit retry and retained unsaved data. Nine save-controller
  scheduling/cleanup tests cover saved-state reentry and disposal races. The fifteenth browser
  case exercises reentry against real OPFS/IndexedDB; the full contract job at `217c6a6b`
  [passed in CI](https://github.com/seo-rii/wasm-idle/actions/runs/38492801909), independently
  of the earlier 14-case local receipt.
- C-16b adds an optional terminal rendering/input binding with per-channel streaming UTF-8,
  bounded render/input admission and cooperative cancellation. Nineteen Node cases and nine
  real-guest Chromium cases passed at the final source snapshot, including host fault injection
  for failed termination and pending input. Nineteen Workers were reclaimed to zero; restrictive
  CSP had no faults. An independent review and its original failure probes also passed after
  fixes. The binding does not interpret shell syntax or supply ANSI handling, PTY, resize,
  termios or job control. Its 73-file host-only package check passed without executable assets.
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
- The selected BusyBox B1 profile is 447,557 bytes, SHA-256
  `547827daf25957a4e2f77ba9ba76b4734f363f867a8a5cb39302dce1b1c36ade`;
  its source pack SHA-256 is
  `ca68639e0a6a159e55000594011e6b60f4850248e8edd5918d10b225e0afe818`.
  Producer qualification executes 54 scenarios in both argv0 and multicall forms (108 WASI
  checks: 88 native differential and 20 explicit profile rejections). The container Node
  matrix passed 20 B0 and 108 B1 invocations, plus separate mount-edge checks,
  including recursive removal of 200 entries, binary copies, readonly/cross-mount rejection,
  one asset body request and zero retained Workers/processes. These are Node and producer
  results. Its separate Chromium qualification passed 256 cold/reload matrix invocations plus
  mount-edge checks with one
  asset body request and zero retained Workers/processes. The live follow-up passed 17 Node
  and 17 Chromium checks: `cat | grep`, early-reader broken pipe, 262,147 binary input bytes,
  concurrent `cp` to a waiting `cat`, file/directory changes, blocked-read termination/restart
  and complete cleanup. Each backend used one verified body request. These are explicit host
  pipelines; the actual Bash interpreter, shell redirection and PTY are not involved.
  The selected port rejects
  grep `-a`/`-I` and encountered NUL bytes instead of truncating them; NUL-free non-UTF8 input
  remains tested. This does not claim full GNU/POSIX utility semantics.

Each PR retains its fixture commands, source/artifact hashes and recorded receipt. A receipt
describes its exact source snapshot, not every descendant commit. CI emits fresh browser JSON
with the tested commit and environment. Earlier runs retained those JSONs in job logs but did
not upload artifacts: `upload-artifact@v4` excludes hidden directories by default. The current
workflow explicitly includes only `.codex/container-*.json` and rejects missing receipts;
[the action's hidden-file contract](https://github.com/actions/upload-artifact/blob/v4/README.md#uploading-hidden-files)
explains that setting. Verify the downloadable artifact as well as the workflow status. Local successes do
not imply the GitHub workflow has already completed, or that another browser/version passed.

The fix was verified by downloading all five JSON receipts from
[run 38493461673](https://github.com/seo-rii/wasm-idle/actions/runs/38493461673): batch,
isolated headers, live, persistence and workspace. The PR head is `795a6d12`; the tested
application commit is its CI merge ref `292c217ac1974b22b379772d4bdc27e4d64e3836`.
All 33 recorded TypeScript source hashes match the reviewed stack, as do the four compiled
filesystem/persistence/backup/save implementation hashes. The receipts contain 34 live,
15 persistence and 14 workspace checks, zero retained guest Workers, and the actual browser
profile. Later documentation changes do not relabel these receipts as a different execution.

## Blocked or incomplete gates

| Gate | Observed boundary | Next experiment / owner |
| --- | --- | --- |
| G0-SHELL/FS/FD/CANCEL | Real pinned WASIX SDK 0.10.0 Bash can execute selected external Wasm, but loses empty arguments, has inconsistent exit propagation and incomplete host filesystem visibility; nested Worker ownership needs explicit cleanup | C-02 backend investigation; choose and qualify a maintained native/bridge path before C-14/15 |
| G0-CLANG / CLI-01–03 | Existing raw Clang reports that WASI cannot spawn subprocesses. Preopens/PWD do not set wasi-libc's cwd. Full modified compiler qualification is pending | wasm-llvm #32 opt-in LLVM `ExecuteAndWait` bridge and real `chdir` startup; complete Clang/LLD relink and actual C/C++ CLI gate, then browser |
| B1 / P3 | Selected producer, 128 batch Node/256 Chromium invocations, and 17 live checks per backend pass | Keep support limited to the recorded applets/options; real shell acceptance is still separate |
| P4 / shell MVP | C-14 supplies live WASI VFS/SAB I/O and pipeline admission; actual shell dispatch/common WASIX fd ownership and full acceptance remain absent | C-15 after backend and real compiler gates; snapshot Clang cannot overlap live users |
| P5 / product beta | Persistence, editor/watch, terminal, backup/restore and save SDK bindings have component evidence; rendered integration and orphan GC remain separate | Product failure UI/lifecycle and full shell-based reload matrix |
| C-19/20 | Local header smoke only; no production release or performance baseline | Real immutable hosting/receipt/license closure and clean-origin acceptance, then measured optimizations |

The opt-in producer's small real LLVM Support ABI fixture passed five dispatch cases, and a
real wasi-libc constructor fixture confirmed `getcwd`, relative reads, bad-cwd rejection and
restart. Neither proves the full compiler. An initial exec-only private relink exceeded its
2,700-second wall deadline. The exec+cwd successor exhausted its 10 GiB address-space cap under
full LTO. A correctness-only retry uses O1/CGO1, one linker thread and a 16 GiB address-space
bound, with sequential Clang/LLD links and a separately recorded consumer gate. Keep compiler PRs draft
until that gate and required browser/header coverage have actual receipts.

The pinned WASIX SDK experiment preserves the original shell failure traces. Its source-only
dispatch framing and Rust/C protocol checks pass, but no newly built SDK has passed Bash
argv/environment/fd/filesystem/cancel acceptance. That source patch is not a production shell
backend. Likewise, C-11 browser harness preparation and the existing playground's successful
Clang regression do not count as execution of the modified compiler.

The selected-target full sysroot remains intact: 35,328,000 logical bytes, 2,168 files plus
117 directories, SHA-256 `91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402`.
It comes from the existing producer revision `25ef7345eba86fce0352e7eb0a881e23ed0e684f`;
no headers were pruned to make a minimal example pass.
