# Container qualification evidence

Updated 2026-10-16. This ledger retains both successful evidence and earlier failed
experiments. Component and local integration results do not constitute a published release.

## Current integration

The final main integration was requalified at
`b3305cccd734eb80bce31e9f66ae93066c88bb83`, including main baseline
`af68215f26ffc72594bdee3e4481e8db0aecd010` and all 64 predecessor PR merge commits.
It retains the current Core changes and the lifecycle, filesystem and I/O guards from
the earlier side branches. These results have their own
[raw receipts, cleanup records and source pins](../packages/container/test/shell-acceptance/evidence/stack-main-20261016/README.md).
Core, LLVM host and container JavaScript/types were freshly compiled from that frozen
source before execution; the existing pinned runtime binaries and complete sysroot were reused.

| Final integrated-source gate | Result |
| --- | --- |
| Container unit/contracts | 246/246 |
| Distribution, hosting and shell judges | 44/44 |
| Existing Clang regressions | 220/220 |
| Package verification | 35/35 |
| Complete root script suite | 237 passed; one existing optional SDK-source check skipped |
| Actual snapshot Bash, eight scenarios | 83/83 |
| Actual live Bash, three scenarios | 50/50 |
| Rendered live workbench, three runs | 6/6 |

The fresh host-only npm package passes its 108-file boundary and zero-fetch root import.
Every browser guard exits 0 and reaps all owned OS descendants without forced signals.
Shell Workers retire before context closure; the rendered workbench retires its owner
after explicit close. The initial live attempt stopped at disk admission before browser
execution; its failure remains separate from the successful retry. The workspace CI job
now builds its LLVM/container prerequisites and supplies the locked installed esbuild
path to the unchanged root script tests. Source/license correspondence, clean producer
rebuild provenance and production deployment remain separate release gates.

The product stack combines the common resource contracts, verified package loading,
real Bash adapter, actual Clang/BusyBox commands, persistent workspace and rendered
workbench. Earlier statements that the shell bridge or UI was absent describe the
revision recorded in those sections. Current capabilities are tracked in the
[compatibility ledger](./container-compatibility.md).

The follow-up stack is #223 (bounded SDK streams and startup errors), #224 (pipeline
fixtures), #225 (combined base), #226 (resource contracts), #227 (immutable distribution
and archive validation), #228 (workbench and owned sessions), #229 (source materials and
canonical LLVM multicall execution), #230 (shared real Bash profile), and #231
(immutable workbench hosting), #232 (rebuilt SDK and actual workbench qualification),
#233 (view transaction fixes), #234 (recorded performance baseline), #235 (product
integration), #236 (optional live LLVM commands), and #237 (actual live Bash integration).
The product integration preserves the exact 20 SDK patches and ten compiled Rust source
files reviewed in #223, together with the historical receipts and their original identities.

The pre-integration library gates recorded 235 container unit/contract tests, 44 distribution,
hosting and shell-judge tests, 207 existing Clang tests, 18 source-material tests, and
the host-only npm package boundary (108 files; zero root-import fetches). Real Chromium
regressions also pass 34 live-I/O, 21 persistence and 14 workspace checks; all owned
Workers and OS descendants are reclaimed. A real Wasm fixture covers all eight initial
stdio masks; closed descriptors remain distinct from EOF. A builtin null character
device and lowest-free guest descriptor allocation let real LLVM reopen closed stdin.
Reserved inode 0 preserves existing positive workspace inode identities across reloads.
The real compiler self-path fixture records compile/link exit 0, generated command
exit 0 with `hello\n`, executable output metadata and zero remaining Workers:
[runner and evidence](../packages/container/test/fixtures/clang-self-path/).
The workbench regression has 16 actual Chromium checks, including input and restore
transactions that preserve pending view buffers; the persistence owner has
21 actual browser checks including recovery-preserving orphan collection.

The final SDK with patches 0001–0020 passes 83/83 checks across all eight actual Chromium
snapshot scenarios at `a8ff08b7` through the public Bash session. The unchanged acceptance script compiles,
runs and pipes its output into the same workspace; a fresh warm owner reuses every
asset body. Foreground interruption, package/compiler errors, pipeline redirection and
startup failure each reclaim all owned Workers. The fixture owner closes after completed
cleanup and acknowledgment; parent termination and the zero-CDP-target assertion remain
in place. Every scenario retires its Workers before the next scenario starts. See the
[eight-scenario receipt](../packages/container/test/shell-acceptance/evidence/public-session-0020-full8.json)
and [metadata/earlier failure](../packages/container/test/shell-acceptance/evidence/public-session-0020-full8-metadata.json).
The earlier [72-check receipt](../packages/container/test/shell-acceptance/evidence/public-session-0020.json)
retains its original seven-scenario scope.

The actual Bash workbench additionally passes 6/6 checks across three runs: cold
compile/pipe, persistent reload of source/result/executable metadata and direct execution,
warm compile without another asset body, and interrupting a blocked real `cat` followed
by another command in the surviving Bash. Its awaited owner-state polling observes the
running child before interrupting it and Bash's resumed prompt before sending new input.
These results qualify the snapshot compiler profile. Its
[browser receipt](../packages/container/test/fixtures/product-shell-browser-evidence.json)
and [process record](../packages/container/test/fixtures/product-shell-browser-process-evidence.json)
retain the exact tested sources. Later view changes, the optional live compiler and
immutable hosting each retain their own evidence. The three-sample
[snapshot baseline](./container-benchmarks.md) additionally passes all 216 acceptance
checks with zero warm asset body downloads; timings are observations on a shared host.

The independent syntax-only gate passes 12/12 actual Bash/BusyBox checks for quoting,
empty/Korean arguments, exported fixture environment values, cwd, conditional commands,
command substitution and redirection ordering. It never downloads Clang, LLD or the
sysroot. Its [receipt](../packages/container/test/shell-acceptance/evidence/syntax-0020.json)
retains its independent scope; the later complete eight-scenario gate is recorded above.

The immutable local release separately passes all six actual workbench checks across
three runs under the restrictive CSP and isolation headers. Its independent lock is
`e7392ffb2ec6af345f848ae675d2eecf890e2536cffa9cf9ce051d40801c201b`;
33 verified files occupy 596,775,617 bytes, including host modules, runtime assets and
source/notice materials. All six asset bodies are served once across the reloads and
all Workers/OS descendants are reclaimed. See the
[immutable hosting evidence](../examples/container/IMMUTABLE.md). This is local
qualification; `deployed: false` and `sourceClosureReviewed: false` remain explicit.

The optional `llvm-clang-tool-host-live-v1` adapter separately passes 14 actual Node
checks and 14 isolated Chromium checks. Real Clang/LLD compile, link and execute the
result; a compiler blocked on stdin observes a changed header, and cancellation preserves
already visible partial output. Exact inode revisions prevent unrelated or concurrently
changed files from acquiring executable metadata. All nine Workers per backend retire.
The [closed-input compiler receipts](../packages/container/test/fixtures/clang-live/null-device/README.md)
retain their tested source hashes, baseline failure and cleanup records. Repairing several
simultaneously closed standard descriptors remains an upstream producer limitation.

Actual Bash using the live compiler passes 50/50 checks across three scenarios at the
same application commit. The unchanged script passes cold and warm. A real Bash
producer feeds Clang stdin through a pipe while the owner edits an included header and
a concurrent BusyBox command reads that change. Clang observes the new header, writes
through the real pipeline, and repairs initially closed stdin through `/dev/null`.
Diagnostics are checked as exact bytes for each compiler phase; original argv and
stderr are preserved. See the [live session receipt](../packages/container/test/shell-acceptance/evidence/live-session-0020.json)
and [metadata/earlier failure](../packages/container/test/shell-acceptance/evidence/live-session-0020-metadata.json).

The rendered live workbench separately passes 6/6 checks across three runs: source exists
before Clang is downloaded; the same script compiles, executes and pipes; saved source,
result and executable metadata survive reload; warm compilation adds no asset body;
and interrupting a blocked real `cat` leaves Bash available for another command.
The [live UI receipt](../packages/container/test/fixtures/product-live-shell-0020.json)
records the selected live adapter. Its owner remains alive for editing and retires after
explicit close. All three final guards exit 0 and reap every OS descendant without
forced signals. These local live results do not change the earlier immutable snapshot lock.
Those historical browser runs used `a8ff08b7`; their evidence-only follow-ups add receipts,
documentation and a test that verifies archived identities and reapplies the shell judges.
The final main integration is independently requalified above. Original executed source
identities remain unchanged in every historical receipt.

Source packs preserve exact material identities while explicitly
recording incomplete runtime source/notice correspondence. Production responses,
clean compiler rebuild provenance, fixed OS image and source applicability remain
release qualification requirements; none is inferred from a local byte hash.

## Earlier stack and experiment history

| Work                                           | PR                                                                               | Base / dependency                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope and boundaries                           | [C-01 #128](https://github.com/seo-rii/wasm-idle/pull/128)                       | main at implementation start                                                                                                                            |
| Real Bash probe and backend decision           | [C-02 #133](https://github.com/seo-rii/wasm-idle/pull/133)                       | C-01, independent experiment                                                                                                                            |
| Pinned SDK bridge source experiment            | [C-02 follow-up #149](https://github.com/seo-rii/wasm-idle/pull/149) (draft)     | C-02; source/protocol checks and #189 SDK typechecking pass; selected native WASIX execution passes on #199; JavaScript/common Container bridge remains pending |
| Owned prepared-child command metadata          | [C-02 snapshot #189](https://github.com/seo-rii/wasm-idle/pull/189) (draft)      | #149; five source patch checks and genuine pinned SDK lib/external-example typechecking pass; binary/glue and selected native guest follow-ups below; JS dispatch and common fd/FS remain pending |
| Pinned SDK Wasm/web-glue build gate            | [C-02 SDK build #191](https://github.com/seo-rii/wasm-idle/pull/191) (draft)     | #189; real SDK/bindgen/static inspection passes on a warm target; original timeout preserved; guest qualification pending |
| Opt-in real Bash exec-shim producer            | [C-02 Bash producer #192](https://github.com/seo-rii/wasm-idle/pull/192) (draft) | #189; real source-pinned Bash build/import receipt passes; native SDK/Bash execution and startup cwd follow-ups on #197–199 |
| Local SDK module/Worker packaging              | [C-02 SDK package #193](https://github.com/seo-rii/wasm-idle/pull/193) (draft)   | #191; actual pinned-esbuild package passes; first actual guest acceptance fails on #195 |
| Rebuilt SDK/Bash Chromium probe                | [C-02 browser #195](https://github.com/seo-rii/wasm-idle/pull/195) (draft)      | #193 plus #192; ten SDK initializers return but guest instantiation fails with Noexec(45); raw failures preserved |
| Actual SDK Worker import resolver              | [C-02 resolver #196](https://github.com/seo-rii/wasm-idle/pull/196) (draft)     | #189; actual fresh-source SDK check/release/bindgen passes; original receipts and complete pin rechecks archived |
| Fixed SDK actual Bash execution                | [C-02 execution #197](https://github.com/seo-rii/wasm-idle/pull/197) (draft)    | #195 plus rebuilt #196 assets; historical 17/18 result and startup cwd/redirect failure preserved; unchanged contract passes on #199 |
| Selected Bash libc startup cwd                 | [C-02 startup #198](https://github.com/seo-rii/wasm-idle/pull/198) (draft)      | #192; separately pinned constructor/second object, native guards and actual producer build/import verification pass; selected runtime evidence on #199 |
| Startup cwd actual Bash execution              | [C-02 startup execution #199](https://github.com/seo-rii/wasm-idle/pull/199) (draft) | #197 plus #198 Bash bytes; unchanged ten real commands and 18/18 native WASIX checks pass, including relative redirect visibility; common Container bridge remains unqualified |
| Forced Bash backend owner cleanup              | [C-02 owner cancellation #200](https://github.com/seo-rii/wasm-idle/pull/200) (draft) | #199; 19/19 actual Chromium checks across CPU loop, blocked stdin and pending Bash download pass with fresh-backend recovery; public Container cancellation and surviving-shell interrupts remain unqualified |
| Trusted host-command registry and dispatch     | [C-02 dispatch #205](https://github.com/seo-rii/wasm-idle/pull/205) (draft)     | #196; patches 0007/0008, real eight-patch SDK typecheck/release/bindgen/package pass; actual Bash dispatch runs on #209 |
| WASIX proc_join exit statuses                  | [C-02 join #208](https://github.com/seo-rii/wasm-idle/pull/208) (draft)         | #205; patches 0009 (statuses >= 79), 0010 (WNOHANG) and host-command status-before-signal; all gates pass; first-command loss fixed |
| Shell and live I/O stack integration           | [C-15 merge #203](https://github.com/seo-rii/wasm-idle/pull/203) (draft)        | Merge of #200 into #171 only; 104 container and 14 shell evaluator tests pass on the merge |
| Real Bash host commands into the Supervisor    | [C-15 dispatch #209](https://github.com/seo-rii/wasm-idle/pull/209) (draft)     | #203 plus #205/#208 SDK packages; delegated live stdio and handler; with the status-order SDK all statuses hold in 5 runs, 3 pass 45/45, 2 miss only Worker retirement timing |
| Trusted host filesystem mounts                 | [C-02 host filesystem #212](https://github.com/seo-rii/wasm-idle/pull/212) (draft) | #208; patches 0011/0012 (`Directory.fromHostFileSystem`, live-mount revalidation); gate and package pass |
| Actual Bash on the common container VFS        | [C-15 filesystem #213](https://github.com/seo-rii/wasm-idle/pull/213) (draft)   | #209 plus #212 package; `createShellFilesystem`; 2 of 3 final Chromium runs pass 27/27, one hang before dispatch with the owner unresponsive |
| Workspace Wasm module routing                  | [C-02 module routing #214](https://github.com/seo-rii/wasm-idle/pull/214) (draft) | #212; `registerHostCommandDirectory` with a Wasm magic check; gate and package pass |
| Clang browser stack in the shell line          | [C-15 merge #215](https://github.com/seo-rii/wasm-idle/pull/215) (draft)        | Merge of #188 into #213 only |
| Forwarded and module-directory routes          | [C-15 routes #216](https://github.com/seo-rii/wasm-idle/pull/216) (draft)       | #215; snapshot tools on container streams, workspace modules through `wasm-run` |
| Host-command work off the scheduler thread     | [C-02 service #220](https://github.com/seo-rii/wasm-idle/pull/220) (draft)      | #214; patch 0013; fixes the owner deadlock behind the shell hangs; gate and package pass |
| Shell acceptance script                        | [C-15 acceptance #217](https://github.com/seo-rii/wasm-idle/pull/217) (draft)   | #216 plus #220 package and wasm-llvm#34 sysroot; the plan script passes 30/30 cold and warm in 5 of 5 consecutive runs (8-11 s each) |
| Owner interrupt of host commands               | [C-15 interrupt #219](https://github.com/seo-rii/wasm-idle/pull/219) (draft)    | #217; `interrupt()` gives 130 and Bash continues; 3 of 3 consecutive runs pass 38/38 |
| Shell failure fixtures                         | [C-15 failures #221](https://github.com/seo-rii/wasm-idle/pull/221) (draft)     | #219; corrupt BusyBox body (126, INTEGRITY, never cached), compile error (1, no artifact), missing command (127); 2 of 3 runs pass 47/47, 1 misses only Worker retirement timing |
| Package/API                                    | [C-03 #135](https://github.com/seo-rii/wasm-idle/pull/135)                       | C-01                                                                                                                                                    |
| VFS and writer leases                          | [C-04 #136](https://github.com/seo-rii/wasm-idle/pull/136)                       | C-03                                                                                                                                                    |
| Byte pipes/fds                                 | [C-05 #137](https://github.com/seo-rii/wasm-idle/pull/137)                       | C-04                                                                                                                                                    |
| WASI Worker Supervisor                         | [C-06 #138](https://github.com/seo-rii/wasm-idle/pull/138)                       | C-05                                                                                                                                                    |
| Pinned distribution index                      | [C-07 #139](https://github.com/seo-rii/wasm-idle/pull/139)                       | C-06                                                                                                                                                    |
| Verified asset loader                          | [C-08 #141](https://github.com/seo-rii/wasm-idle/pull/141)                       | C-07                                                                                                                                                    |
| Atomic lazy package mounts                     | [C-09 #142](https://github.com/seo-rii/wasm-idle/pull/142)                       | C-08                                                                                                                                                    |
| LLVM tool-host and snapshot adapter            | [C-10 #144](https://github.com/seo-rii/wasm-idle/pull/144) (draft)               | C-09; actual Chromium batch C/C++ and the concrete selected-target header corpus pass on C-11 follow-ups; experimental profile and release gates remain |
| Opt-in LLVM driver/cwd producer ABI            | [wasm-llvm C-11 #32](https://github.com/seo-rii/wasm-llvm/pull/32) (draft)       | wasm-llvm main; real raw links, producer CLI, Chromium consumer and selected header corpus pass; clean build and release gates remain                   |
| Receipt-gated actual Clang browser fixture     | [C-11 consumer #159](https://github.com/seo-rii/wasm-idle/pull/159) (draft)      | C-10 plus completed producer/CLI receipts; Chromium batch C/C++/artifact/cache and selected header checks pass; experimental snapshot profile remains   |
| Selected-target header compile corpus          | [C-11 headers #188](https://github.com/seo-rii/wasm-idle/pull/188)               | #159; 13 established producer cases plus one resource fixture pass in actual Node/Chromium, with original receipts archived; compile-only scope         |
| Real BusyBox B0 producer                       | [C-12 #143](https://github.com/seo-rii/wasm-idle/pull/143)                       | C-01, separate producer branch                                                                                                                          |
| Minimal BusyBox B1 producer                    | [C-12 follow-up #156](https://github.com/seo-rii/wasm-idle/pull/156)             | C-12; selected profiles and native/WASI differential evidence                                                                                           |
| BusyBox container qualification                | [C-13 #146](https://github.com/seo-rii/wasm-idle/pull/146)                       | C-10 plus external C-12 verified artifact                                                                                                               |
| BusyBox B1 container qualification             | [C-13 follow-up #163](https://github.com/seo-rii/wasm-idle/pull/163)             | C-13 plus C-12 B1 artifact and portable fd/directory fixes                                                                                              |
| Explicit workspace persistence                 | [C-17 #145](https://github.com/seo-rii/wasm-idle/pull/145)                       | C-10; independent of live shell                                                                                                                         |
| Host CI and qualification ledger               | [C-19 groundwork #147](https://github.com/seo-rii/wasm-idle/pull/147)            | C-17; production release still gated                                                                                                                    |
| Live VFS ownership and additive mounts         | [C-14a #148](https://github.com/seo-rii/wasm-idle/pull/148)                      | C-19 groundwork                                                                                                                                         |
| Isolated live WASI and explicit byte pipelines | [C-14b #150](https://github.com/seo-rii/wasm-idle/pull/150)                      | C-14a; actual shell backend remains separate                                                                                                            |
| Workspace events and staged editor buffers     | [C-16a #155](https://github.com/seo-rii/wasm-idle/pull/155)                      | C-14b; SDK binding independent of shell/UI renderer                                                                                                     |
| Terminal byte-stream UI binding                | [C-16b #170](https://github.com/seo-rii/wasm-idle/pull/170)                      | C-16a; real guest and host failure/cancellation fixtures                                                                                                |
| Actual BusyBox live VFS and pipes              | [C-14 follow-up #171](https://github.com/seo-rii/wasm-idle/pull/171)             | C-14b plus the external pinned B1 artifact; no shell interpreter                                                                                        |
| Portable workspace backup and atomic restore   | [C-18a #157](https://github.com/seo-rii/wasm-idle/pull/157)                      | C-16a                                                                                                                                                   |
| Save state and optional autosave               | [C-18b #164](https://github.com/seo-rii/wasm-idle/pull/164)                      | C-18a; explicit persistence owner remains separate                                                                                                      |

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
- C-11 now executes the actual modified Clang and LLD in Chromium 153.0.8010.12 at
  `fe5e3a85277e2dec02347d9d5362e5656ed3e5b7`. Nine cold compiler commands and three resulting
  Wasm programs pass, including multi-object linking, C stdio with binary stdin/stdout/stderr,
  and a C++20 vector/map/string template fixture with explicit `-fno-exceptions`. The complete
  pinned sysroot is mounted unchanged (2,285 entries, 2,168 files). Command metadata requests
  no compiler bodies; cold execution requests each Clang/LLD/sysroot body once, and a
  page-reloaded `--version` command requests no additional bodies with HTTP cache disabled.
  That reload does not repeat the full compilation suite. All 13 guest Workers across both
  pages are reclaimed, process lists are empty and restrictive CSP records no faults. This
  qualifies the recorded batch snapshot profile. The 14-case selected-target header corpus
  also passes in Node and Chromium on #188, with object/dependency checks and 1,050 header-byte
  identities verified per backend. Exhaustive header combinations, actual shell/live compiler
  integration, clean producer build and release/performance gates remain separate.
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

## Current qualification boundaries

| Gate                  | Observed boundary                                                                                                                                                                                                                                 | Next experiment / owner                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0-SHELL/FS/FD | The public pinned SDK/Bash session passes 83/83 checks across all eight snapshot scenarios, including syntax; the selected live compiler profile passes 50/50 across three scenarios. All observed Workers retire before context closure | Descriptors beyond inherited stdio, unlisted shell features, PTY/termios and job control remain unsupported |
| G0-CANCEL | Forced backend CPU-loop, blocked-input and pending-download cleanup is recorded separately. Public session gates and the rendered workbench verify foreground interruption, surviving Bash input, startup failure and complete cleanup | Host cancellation is not POSIX signal delivery. Builtin loops require a fresh owner; lost owner transport reports unconfirmed cleanup |
| G0-CLANG / CLI-01–03 | Real C/C++ snapshot CLI and the selected 14-case header corpus pass. Optional live LLVM has 14 Node and 14 Chromium checks, including concurrent header visibility, partial-output cancellation and closed-stdin repair | The selected C++ profile requires `-fno-exceptions`; live C++ coverage, several simultaneously closed standard descriptors, exhaustive header combinations, clean producer rebuild and source-to-binary release correspondence remain separate |
| B1 / P3 | Selected producer, 128 batch Node/256 Chromium invocations, 17 live checks per backend and actual Bash/BusyBox pipelines pass | Support remains limited to recorded applets/options; no full BusyBox or GNU utility compatibility claim |
| P4 / shell MVP | Actual Bash, BusyBox, workspace artifacts and both selected Clang profiles pass the original acceptance script. The live profile additionally shares compiler stdin and completed header edits with concurrent utilities | Snapshot remains the default and holds an exclusive writer lease. Live compilation can observe concurrent edits and retains completed writes after cancellation; no broad POSIX/PTY claim |
| P5 / product beta | Rendered editor/terminal/save/backup/restore integration, actual shell reload and recovery-preserving orphan GC are implemented. Real browser evidence covers 21 persistence, 16 view and six actual workbench checks per selected compiler profile | Browser eviction, fixed release environments and wider browser qualification remain separate; no simultaneous workspace writers or implicit save-on-dispose |
| C-19 / deployment | A separately locked 33-file local distribution passes all six actual workbench checks under restrictive CSP/isolation | Production responses, exact source/notice applicability and clean-build provenance remain open; no deployment or release promotion |
| C-20 / measurement | Three recorded snapshot suites pass 216 checks with zero warm asset body downloads and separate cold/warm timing observations | No L1/L2 optimization or performance promise; the measurements are from a shared host |

The opt-in producer's small real LLVM Support ABI fixture passed five dispatch cases, and a
real wasi-libc constructor fixture confirmed `getcwd`, relative reads, bad-cwd rejection and
restart. Neither proves the full compiler. An initial exec-only private relink exceeded its
2,700-second wall deadline. The exec+cwd successor exhausted its 10 GiB address-space cap under
full LTO. The O1/CGO1 candidate with one linker thread and a 16 GiB address-space bound then
hit its 7,200-second wall deadline without producing Clang or LLD. Killing the driver and
linker together left only driver usage in `wait4`; that receipt does not measure the linker's
final CPU time or peak RSS. A separate observation before exit recorded 756.2 linker CPU
seconds after 7,080.9 elapsed seconds, which documents contention without proving completion.

A distinct retry was prepared with the same compiler inputs and optimization settings, a
14,400-second deadline per child, and inherited per-process CPU limits of 1,200 seconds soft
and 1,260 hard. The producer's default deadline remains 2,700 seconds; its CLI now validates
explicit extensions through 14,400. The external runner requires at least 8 GiB available
memory and 4 GiB free disk before starting the producer and again before the CLI gate,
and fails immediately if admission fails.
CPU and address-space limits apply per process, not to aggregate process-tree resources.
Clang/LLD links and the receipt-gated actual CLI checks run sequentially; failed preparation
or build does not trigger an automatic retry. The actual CLI, browser and concrete selected
header corpus now have completed receipts. Compiler PRs remain draft while the experimental
profile and separate clean-build/release promotion gates are unresolved.

The requested guarded retry subsequently completed both raw links: Clang in 578.152 seconds
and LLD in 285.064 seconds. Its last verifier failed because it incorrectly required LLD
to have no `exec_v1` import, despite the pinned LLD error-handler calling `ExecuteAndWait`.
The failed receipt and source pack remain intact. The corrected verifier and a documented
requalification helper checked the same independently pinned bytes and every original input
without relinking, then published a separate complete producer receipt
`6e610fe9bb6a12c794dd3b0e5110b25c76cd31eed11d9546224d9e3e7478df14`.

The producer's actual Node WASI CLI receipt
`99bef206dba7f50dd07f6e7885b0e8570b11aae381360148a98a8d2f4678d2f3` passes seven
commands, response files, non-root Korean/spaced cwd, `-c/-E/-S`, diagnostics and a real
two-object driver-to-LLD link. The produced freestanding Wasm export returns 42. The pinned
WebAssembly driver selects an absolute linker with `-fuse-ld`; the fixture no longer assumes
`--ld-path` controls that target. Both tools import the exact ABI, but only top-level Clang
may dispatch the pinned linker; all LLD child requests are rejected.

An initial isolated Chromium run passed compilation, preprocessing, assembly, response-file
and diagnostic cases before rejecting inherited environment slices whose unused pointer was
nonzero. The producer's empty SmallVector has inline storage, so the host now checks the
zero count without reading that pointer. Ten focused LLVM host tests and an actual common-VFS
driver/link/export probe pass after the correction. The next Chromium attempt used
the same compiler, linker and full sysroot; its original receipt remains a failed attempt,
before the compiler-child dispatch correction. The immutable executable SHA-256 values are
`e0b548b70e13ad9620c1f47a1ef3f552b74cea586866ef1d8dcc0558c87f50e3` (Clang) and
`3da2fc3d37702d3d56bce834672912334e36d245efaf97fbdda7e4b5e810134a` (LLD).

The subsequent same-byte producer requalification receipt
`7db6ac0eff2256c79e0a5435908810d15daa18d2220c57ab64fea2116b7ba9fd` records the explicit
compiler-child opt-in policy. Its actual Node WASI CLI receipt
`f7895ec00fd05cb224b42e085873beb75fd5899cf238acf8f3833aeb2f9bded5` passes eight
commands, two cc1 and two linker executions, and artifact export 42. The driver disables
in-process cc1 when multiple jobs exist; the host executes only its exact multicall request
`program: ''`, argv prefix `['', 'clang', '-cc1' | '-cc1as', ...]` with the same pinned
compiler bytes. The original array is preserved. Only the root driver can dispatch;
generic recursion, arbitrary compiler self paths and child response-file-only packets fail.
Twelve focused host cases cover these boundaries and 63 container unit cases pass.

The actual common VFS C stdio workflow compiles, links and runs with stdout `hello`.
C++ version discovery initially failed because libc opendir requests NONBLOCK; the
batch host now admits that flag on directories and regular files while preserving rights
and rejecting unsupported flags. Four focused WASI fd tests pass. The unchanged complete
sysroot then compiles, links and runs the C++20 vector/map/string template fixture with
explicit `-fno-exceptions`, yielding `sum=6`. Exception-enabled input retains its real
missing exception-runtime linker diagnostics and remains outside this qualified profile.
The adapter does not insert flags or prune headers. The later successful Chromium receipt
below verifies the same full closure, byte streams and actual command artifacts; its reloaded
page verifies cache reuse with `--version`.

The Node Worker snapshot acceptance also passes the actual C stdio and exception-free
C++20 compile/link/run workflows, with `hello` and `sum=6` outputs. Its original receipt
and executed JavaScript host hashes are committed on #159. The npm dry-run packages
contain 53 Container host/type/document files (183,211 unpacked bytes) and 126 LLVM Core
files (896,259 bytes), with no executable assets; the root import performs zero fetches.
These Node snapshots remain separate from the actual Chromium receipt below.

The actual Chromium batch snapshot receipt has SHA-256
`b04774f0181150e46a4121dccbcf14ecb584bcf968133af585cbcae7e256fb9a` and is archived
unchanged as `packages/container/test/fixtures/clang-browser-evidence.json` on #159. It
records application commit `fe5e3a85277e2dec02347d9d5362e5656ed3e5b7`, Chromium
153.0.8010.12, Linux x64, cross-origin isolation and restrictive CSP with no faults. It pins
the producer requalification and eight-command CLI receipts above, the original executable
and sysroot hashes, and the exact application source and generated Worker bundles.
The browser process exits 0 and its external supervisor records all descendant processes
reaped. Earlier failed browser receipts retain their original identities and results.

The cold page passes nine compiler commands: version, relative `-c`, `-E`, `-S`, response-file
compilation, a real diagnostic exit 1, multi-object linking, C stdio linking and explicit
exception-free C++20 template linking. All three generated Wasm artifacts execute. C stdio
preserves `[0, 255, 195, 169]` on stdin and on each separate output channel, with the expected
`hello\n` prefix on stdout; the C++ artifact prints `sum=6\n`. The warm page remounts the
verified full sysroot and runs only `--version`, so the receipt proves body-cache reuse,
not a warm full C/C++ compile. Both pages finish with empty process lists and zero live
guest Workers (12 started cold, one on reload).

Before the cold command, all three asset request counts are zero. The cold page then requests
Clang gzip (16,270,174 bytes), LLD gzip (8,178,107 bytes) and the complete sysroot tar
(35,328,000 bytes) once each: 59,776,281 delivered body bytes total. The page reload adds no
asset body requests, with `Cache-Control: no-store` and no retained in-memory asset entries.
This is local batch-profile evidence, not a clean producer rebuild, full header-combination
corpus, exception-enabled C++ qualification, live compiler binding, shell MVP, production
release or performance benchmark. Compiler PRs remain draft pending the full promotion gates.

The pinned WASIX SDK experiment preserves the original shell failure traces. Its source-only
dispatch framing and Rust/C protocol checks pass, but no newly built SDK has passed Bash
argv/environment/fd/filesystem/cancel acceptance. That source patch is not a production shell
backend. Harness preparation and the existing playground's successful Clang regression remain
distinct from C-11's separately recorded execution of the modified compiler.

The source-only #189 follow-up adds an immutable owned snapshot of the prepared child's
argv, raw environment bytes and actual WASIX cwd. It exposes no mutable state or fd/FS
capability; the external SDK compile probe returns an explicit unsupported error if invoked.
Five patch dry-runs and preparation guards pass. The exact nightly-2025-07-05, rust-src and
wasm32 target are now installed in a private toolchain home, with exit 0 and complete process
cleanup. Genuine patched SDK/lib and external-example typechecking subsequently passed using
fresh physical sources and unique Cargo target/intermediate directories, as recorded below.
The example is a compile probe, not an executed guest or linked browser SDK.

The first #188 actual Node attempt passed C compilation, then exposed fixture include
flags that searched C headers before libc++ wrappers. Removing those overrides preserves
the real driver's ordering. The next attempt compiled C and GNU C++98/03/11 successfully,
then failed an expected-path assertion: the original producer's GNU aggregate headers
are `include/bits/stdc++.h` and `include/bits/extc++.h`. The corrected metadata matches
their original bytes, preserves all 14 source cases and the full sysroot, and preflights
required paths before compiler execution. Both failed receipts remain unchanged; they
do not qualify the complete corpus or Chromium header profile.

The completed #188 Node and Chromium runs now pass all 14 compile-only cases: the 13 existing
producer cases and one additional Clang resource-header fixture. Each run verifies generated
object bytes, dependency output and 1,050 distinct header-byte identities against the unchanged
selected sysroot. C++ arguments explicitly include `-fno-exceptions`; the adapter inserts no
flags. This closes the concrete selected corpus gate, without claiming exhaustive header
combinations, every header family's linked runtime support or language conformance. The
separate #159 receipt above records actual C/C++ linking and artifact execution.

Both header receipts record application commit `b8edc146c4ba26905c9a0639726f24407825b3a3`
and corpus SHA-256 `f8c5a9360642a7fd676ba10edbc8ac5a07fea9c4f9d75698b6aad32d7769bee2`.
The original Node receipt has SHA-256
`c69fa7bc702ba653e98e9919307de54cbbf120817181799cf7241d19f4a1329e`; the Chromium receipt
has SHA-256 `c2c5de32cc85f53eb5dc051f599714e178ca8f0111593a0ae4083a159e3c4d6f`.
They are archived unchanged on #188 under `packages/container/test/fixtures/clang-headers/`
as `node-evidence.json` and `chromium-evidence.json`, alongside the separate process-supervisor
receipts. Node 24.21.0 reclaims all 14 guest Workers. Chromium 153.0.8010.12 on Linux x64
reclaims all 16 guest Workers: one version command plus 14 cold compile cases and one reloaded
version command. Both pages end with empty process lists, zero live Workers and no CSP faults.
There are no asset body requests at boot; cold execution requests Clang, LLD and the complete
sysroot once each; the page reload adds zero requests with HTTP cache disabled. The reload
does not recompile the corpus. Both external supervised processes exit 0 with every owned
descendant reaped. The earlier failed Node receipts retain their original results and source
identities.

The first #189 offline SDK check exited 101 before Rust typing because a locked host
dependency was missing after wasm-target-filtered fetch. Unfiltered locked fetch and
fully offline fetch validation now pass for both SDK and pinned standard-library graphs,
with both lockfile hashes unchanged. The separate preparation receipt records the original
failure and full cleanup. The subsequent genuine SDK typecheck exited 101 after 342.205
seconds, exposing an unqualified `Function` and two unsupported `WasmSliceAccess.to_vec`
calls in the prototype. Source commit `de98d061435a308e8bbcd2ca195d29ac07401774` qualifies
`wasmer::Function` and uses fallible, bounded `read_to_vec` ownership without changing the
framed ABI, decoder or prepared-child snapshot contract. Five patch dry-runs and five C/Rust
protocol cases pass after the correction. The corrected genuine SDK/lib and external-example
typecheck now exits 0 in 412.428 seconds. It uses the pinned nightly-2025-07-05 and
`cargo check --locked --offline --target wasm32-unknown-unknown --lib --example
container_command_snapshot_compile -j1` against a fresh physical source copy, with unique
Cargo target and intermediate directories. Its external supervisor records all owned
processes reaped, with no remaining processes or cleanup errors.

The original process receipt has SHA-256
`a906d32e8b063520dd7aba2b002b84ddc067a52482434ec78ebeb7ded4e0d6b8`; the completed log
has SHA-256 `4419e76d277d33fe319931468bb911e44b210f6e6c6ad2490ae5ca3180d7ab84`.
The #189 archive records source commit `de98d061435a308e8bbcd2ca195d29ac07401774` in
`runtimes/wasm-bash/bridge/evidence.sdk-typecheck.json`, and preserves the original process
receipt as `evidence.sdk-typecheck-process.json`. Previous failed typing, dependency and
source-only receipts keep their original identities. This pass qualifies Rust typing,
privacy and the exact pinned SDK API used by the external snapshot example. Actual Wasm SDK
linking and generated JavaScript glue, JS registry dispatch, modified Bash execution,
common fd/filesystem ownership and shell MVP acceptance remain separate gates.

The #191 follow-up prepares a sealed offline release build and matching
`wasm-bindgen 0.2.101` web glue, retaining raw and transformed Wasm identities.
The exact CLI was built separately with its shipped lock, exit 0 and complete
owned-process cleanup; this qualifies only the native build tool. Its executable
SHA-256 is `f78ceef06ed9356f42408f2b32d2f621dfa6fd09f192a41320355abf7f9562cc`.
That tool receipt is a local operator record and is not yet archived on #191.
The eight helper tests include a real small shared-memory Wasm static inspection
under the proposed 12 GiB process address-space cap; they do not build the SDK.

The parallel #192 producer preserves the original Bash, WASIX sysroot, WASI SDK
and Binaryen pins, linking the actual C exec shim through the upstream build.
The real producer now exits 0 in 587.243 seconds at source `74abe392`, producing
1,811,021 Wasm bytes with SHA-256
`96866a2ea6b4cc19949346822348ca8caba80052dd227e07a3e644329c7ba02d`.
The original import allowlist plus the seven-i32 `exec_v1` import, shared bounded
memory and Asyncify exports are verified; the WEBc and source-material pack also
have recorded hashes. This is a producer/import gate, not actual Bash execution.

The first #191 SDK attempt stops at its 3,600-second outer build deadline before
producing runnable SDK Wasm or web glue. Its process receipt records Cargo exit
-9, a subsequently reaped rustc exit 0 and no remaining processes or cleanup
errors. The completed log ends during dependency compilation without a recorded
Rust compilation error. Historical main-thread-only process/RSS observations
remain incomplete; the failure is preserved, not counted as a successful build.
A distinct manual follow-up reuses only the same physical source copy's checked
target, with unchanged source/locks/release profile and a corrected process
owner. It does not automatically retry or replace prior files. Local module/Worker
packaging and real shared fd/VFS/foreground cancellation remain required.

The manual follow-up now passes: actual SDK release build 100.969 seconds,
matching bindgen 1.761 seconds and static inspection 0.255 seconds, with each
stage exiting 0 and recording complete cleanup. The immutable original receipt
on #191 has SHA-256 `a8ca2caa7f1e511a6bdb66ea6fc18ccd34911d78113da8a7cd73c521b2ba511a`.
Raw Wasm is 10,091,403 bytes; bound Wasm is 9,044,795 bytes with SHA-256
`01dae00296dd2257f1cd7ede3e4d1e42837d0c4432ce1f70b539c62a9b63b561`.
The shared memory profiles are respectively 33/16,384 and 34/16,384 initial/maximum
pages. This is warm target reuse for the same physical source, not clean-build
timing or actual guest acceptance; the earlier timeout remains a separate failure.

The [#193 layer](https://github.com/seo-rii/wasm-idle/pull/193), stacked on #191,
prepares local module/Worker packaging from an independently pinned successful
binary receipt. Seven tests with actual local esbuild cover graph closure,
deterministic output and Module/Memory/URL argument policy; the small JS glue is
a protocol fixture only. The real binary prerequisite now passes, and actual
local packaging at helper `495b06c5` exits 0 in 1.257 seconds. Its original
receipt on #193 has SHA-256 `86b7993253952a735f0260edb693f217c26bd4e409cfd181c90b23ecfca50b34`;
all five published entries match their recorded byte/hash identities. The
original worker's dynamic SDK import remains a trusted immutable host module
graph; actual nested Worker ownership and the original unbounded pre-init
queue remain unresolved, alongside command registry/fd/VFS.

The first [#195 browser layer](https://github.com/seo-rii/wasm-idle/pull/195) runs the actual
rebuilt SDK/Bash package together. Chromium 153.0.8010.12/Linux completes all ten observations
in 10.183 seconds: the supplied-Module/shared-Memory SDK initializers return, but all ten
SDK waits return WASIX Noexec (45), empty stdout/stderr and the console error
`Unable to initialize the context and store`. No Bash guest entry or argv/fd/filesystem
behavior is qualified by this run. The private `exec_v1` import was added to only one
resolver; the actual Worker calls the separate `import_object_for_all_wasi_versions`,
which omits `wasm_idle_shell_v1`. The [#196 resolver fix](https://github.com/seo-rii/wasm-idle/pull/196)
passes six-patch/source guards; completed SDK and native guest follow-ups are recorded below.
Original browser and process receipts are preserved unchanged;
their SHA-256 values are respectively
`db4ee40be5021dfe47301931fc28aae14e529b833cbdf29096832584292a7ff1` and
`3297aaf1d24d96ed22822f8c2916e537808b68411332c1f388f2488de57e9276`.
Forty dedicated Worker targets retire to zero before and after host context close, and all
owned OS processes are reaped without forced signals. That cleanup result does not qualify
guest execution, foreground cancellation or common Container fd/VFS ownership. Metadata
corrects the initial URL-based nested count using recorded parent edges (30 of 40 targets);
the raw receipt retains its original diagnostic fields.

The actual resolver fix on #196 now passes fresh-source SDK/example typechecking in
373.991 seconds, release generation in 586.098 seconds, matching bindgen in 1.762 seconds
and static inspection in 0.255 seconds. All stages exit 0 with complete cleanup. Original
receipts recheck all 581 source/tool pins, complete SDK/WASIX inventories and six outputs.
The bound Wasm is 9,071,791 bytes, SHA-256
`326b58090df4dbe3f0f3e4105b56b9cdbd0ebf40a5cecd437f503dac19ac7551`.
Local packaging of those bytes also passes and retains the original host/Worker semantics.

The historical [#197 actual execution](https://github.com/seo-rii/wasm-idle/pull/197) completes all
ten real Bash commands with code 0 on Chromium 153.0.8010.12/Linux. Seventeen of 18 selected
checks pass: empty/LF/CR/UTF-8 argv, replaced and explicitly empty environment, actual cwd,
raw stderr, status 23, tail exec, binary pipes and separate parent/guest/host file sharing.
The remaining `redirect-mount` check fails because the pipeline's relative output file is
absent from the host workspace even though stdout bytes are correct. Overall acceptance
remains false (outer process exit 1). All 60 observed Workers and owned OS processes retire.
Original browser receipt SHA-256:
`25f8bb75efda9ce61128809fb922a5e31f539f22c2a86e931dad3671905f7bbd`.

Four separate actual cwd comparisons complete collection in 7.133 seconds. Both an absolute
`/workspace` redirect and an explicit initial `cd /workspace` publish the exact binary file;
unchanged relative redirection and a parent builtin's relative write do not. The actual cwd
guest still reports `/workspace`. This matches the pinned libc's separate legacy cwd used
by relative `open`, which `getcwd` does not update and `chdir` synchronizes. Diagnostics
retain false guest/shell qualification; they do not change or replace the original failing
contract.

The [#198 startup synchronization](https://github.com/seo-rii/wasm-idle/pull/198) producer
build at source `7d15375967ed557e724488e82bab75cb5c4b41cb` exits 0 in 129.466 seconds.
The separately pinned constructor and second object are linked into real Bash, and import
verification passes. All owned processes are reaped without cleanup errors or forced signals.
This local observation does not establish cold/clean build performance; the producer receipt
remains `built-imports-verified-not-runtime-qualified`.

The stacked [#199 actual browser run](https://github.com/seo-rii/wasm-idle/pull/199), based on
#197, uses application source `7c7c32c3dc3c8f6842dd59bd677457e5e9613032` and the new Bash
bytes with the same SDK package receipt
`9d3a6094f057d52d7221c676965a03a366de6a0d709ffeaf11147193c0273525`. The original ten
scripts and three real ABI fixture sources are unchanged. Chromium 153.0.8010.12/Linux
completes all ten real commands with code 0 and passes all 18 selected checks in 15.812
seconds. Relative redirection now publishes the host Directory's `/binary` with exactly
`[0, 255, 226, 130, 172, 10, 13, 97, 98]`. All 60 dedicated Workers, including 50 nested
Workers, retire to zero before host context close and remain absent afterward; all owned OS
processes are reaped without errors or forced signals.

The unchanged original browser receipt is 254,412 bytes, SHA-256
`0e0afaea1bb34193260ce7fab29205a8f2e810be32a29491864a4cad6614f5b6`; the process receipt
is 1,059 bytes, SHA-256
`59b61cbc217d26eb3f8b3bfcd9c652d668105cd5f9cdfe90da1553438a094e24`. A prior local
attempt stopped at memory admission before launching Chromium because available headroom
was below 8 GiB. The successful fresh attempt met the unchanged policy after headroom
recovered; it does not replace or relabel that admission failure.

These results qualify only the selected native WASIX `Directory` observations.
`commonContainerFdVfsQualified` and `shellBackendReady` remain false. Common Container live
fd/VFS, JavaScript command registry, public foreground cancellation and actual Clang/BusyBox
shell acceptance remain open; the original #195 Noexec and #197 17/18 failures remain
archived separately.

The stacked [#200 forced owner cleanup](https://github.com/seo-rii/wasm-idle/pull/200), based
on #199, reuses the same pinned SDK/Bash bytes at application source
`266469ff21821f8e347fcc967bc32d3da8fb8437`. Chromium 153.0.8010.12/Linux passes all 19
selected checks across three actual cases: a CPU loop, blocked stdin and a pending Bash
asset response. The browser stage exits 0 in 19.216 seconds, and the supervisor also exits
0; 14 focused unit/archive guards pass.

The CPU/input guests publish actual `ready\n` bytes and their SDK waits remain pending for
150 ms before cleanup. The blocked-input case holds its stdin writer locked and open.
The trusted host owner explicitly calls `Worker.terminate()` on three SDK children in each
of these cases, then the page terminates that owner. The three cases observe 21 Workers,
including 15 nested Workers. Each case has zero remaining Workers before recovery and again
before context close. Every OS descendant is reaped without cleanup errors or forced OS
signals; this does not mean no JavaScript Worker was forcibly terminated.

Each case recovers in the same page with a fresh owner and fresh SDK shared memory, runs
real Bash `printf recovered`, and returns code 0. The download case aborts after receiving
16,384 of the pinned 1,812,678 Bash WEBc bytes; the server records zero active responses,
one aborted response and zero completed responses. Partial bytes are never executed.

The original browser receipt is 36,426 bytes, SHA-256
`d5fdbace414dc5fbca66cc748781c89c1c2495dad6e48bc7120fb36d04664036`; the original process
receipt is 1,056 bytes, SHA-256
`ec7502bd18708492db0ed5002b483e2549e158f993f4a8efa4b93e29730ecb58`. The unchanged
18-check normal-execution evidence remains separate.

This qualifies forced trusted host Worker-group cleanup and fresh-backend recovery only.
It does not qualify public Container cancellation, POSIX signals, a surviving shell, PTY
semantics or the Container asset service's cancellation contract. Common live fd/VFS,
JavaScript command registry and actual Clang/BusyBox shell acceptance remain open;
`guestSignalQualified`, `survivingShellQualified`, `commonContainerFdVfsQualified` and
`shellBackendReady` remain false.

The selected-target full sysroot remains intact: 35,328,000 logical bytes, 2,168 files plus
117 directories, SHA-256 `91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402`.
It comes from the existing producer revision `25ef7345eba86fce0352e7eb0a881e23ed0e684f`;
no headers were pruned to make a minimal example pass.

The trusted host-command layer has its own evidence. [#205](https://github.com/seo-rii/wasm-idle/pull/205)
adds bridge patches 0007/0008. A registered exact path takes the prepared child from the
WASIX builder; the SDK moves it to its scheduler thread, where the JavaScript handler
registered on that thread receives the owned snapshot and descriptors 0–2. No JavaScript
value crosses threads. The eight-patch SDK passes the real gate from fresh source with all
583 pins: typecheck 845.135 s, release 889.651 s, bindgen 2.013 s and inspection 0.255 s.
Its binary receipt is `1e85d0d18925ab2817cb2acfa77f394ecbb2be3fa78d84f1d576ea2ca45696ac`.

On [#209](https://github.com/seo-rii/wasm-idle/pull/209), on top of the merge-only
[#203](https://github.com/seo-rii/wasm-idle/pull/203), live `spawn` accepts caller-owned
stdio endpoints. The guest's own descriptor calls reach Bash's child descriptors through
the Supervisor RPC, without a relay buffer. Actual Chromium runs then exposed two WASIX
`proc_join` defects, fixed in [#208](https://github.com/seo-rii/wasm-idle/pull/208):
statuses of 79 and above were reported as 79, and a nonblocking specific-pid join reported a
running child as exited 0. The 0010 commit attributed the observed loss to Bash; the pinned
Bash uses `nojobs.c` and `waitpid(-1)`, and the #208 README corrects that claim.

The ten-patch SDK passes the same gate (binary receipt
`2b4d95ca3294dd059548b3c351adbe09444d79eada3125505f7981ada828d8c3`, package
`4b4de3258029c40f7c6db2feb1e342009ce647d683f4ecff87daf509d3b094bb`). Seven actual runs follow:
- **Four runs pass all 45 checks.**
- In every run, twenty consecutive statuses and statuses 126/134 are correct.
- Three runs report one shell's first command as 0 while the Supervisor record holds 23.
- Two of those runs also hang once before any dispatch.
- One run has a Worker outlive the five-second retirement window.

A diagnostic build traced the first-command 0 to the bridge's own completion path. Bash
runs external commands with a full fork, and `HostCommandProcess::finish` signalled SIGQUIT
to the forked process before publishing the status; the waiting thread's default SIGQUIT
published 0 first. #208 now publishes the status before signalling. That build passes the
same gate (binary receipt `ec389294c97172bb6457f0044bd781eab8e78fc9ca77998c79a994a54724ecc6`,
package `1826ec2bcb5abf51dee6a740d96fb02b644de38d0e0f64b21626051f45be039a`). In five actual
runs every status arrived intact, including the first command's, and no case hung before
dispatch. Three runs pass all 45 checks; two fail only because the probe's owner Worker
target disappeared 5.03–5.13 s after cleanup, just past the five-second window.

#212 and #213 replace the shell's private WASIX `Directory` with the container VFS:
`Directory.fromHostFileSystem(createShellFilesystem(container.fs))` posts every guest
filesystem call to the SDK scheduler thread that owns the delegate, and WASIX revalidates
inodes cached below the live mount. Bash then sees external unlink/rename/replacement and
appends after other writers. #214 routes Bash's exec of a workspace Wasm module to the
container (`wasm-run` on the live artifact adapter) instead of executing it natively.
#215/#216 bring Clang into the shell line on its snapshot adapter with forwarded output,
and wasm-llvm#34 derives a process-profile sysroot so the artifact runs in the shell's cwd.

On #217 the development plan's acceptance script ran in actual Bash with actual BusyBox,
actual Clang and the built artifact. One run passed all 30 checks, cold and warm:
- stdout `hello`, with only the pinned Clang triple warning on stderr;
- `main.c` and `result.txt` in the container VFS;
- five Supervisor processes exiting 0, including `/workspace/demo/hello.wasm`;
- each package fetched only after its first command;
- no body request in the warm run.

The run also exposed two VFS errno defects, fixed there. With the #214 SDK it was not
reliable: in five of eleven runs that reached the end of Clang, the owner thread stopped
right after the Clang host command completed. A diagnostic SDK that logs on every thread
showed a deadlock between a Bash child holding a WASIX directory inode lock while waiting
for the owner to serve a live-mount `stat`, and the owner preparing the next host command,
which needed that lock. #220 keeps all host-command WASIX work off the owner (the snapshot
on the guest thread, descriptor I/O and completion on a dedicated service thread). With
it, five consecutive acceptance runs pass all 30 checks in 8–11 seconds instead of 39–61,
and the shared-filesystem and dispatch probes, re-run with only their pin changed, keep
every status and pass 5 of 5 and 4 of 5 (one Worker retirement miss). #219's interrupt
run stops a running artifact and a running compile with status 130 while Bash continues;
three consecutive runs pass all 38 checks. #221 adds the failure fixtures: an integrity
failure of a whole package, a compile error and a missing command each fail alone while
Bash and the other package keep working; two of three runs pass all 47 checks and the
third misses only the five-second Worker retirement window.

In that earlier dispatch experiment, redirections inside forked Bash pipeline subshells failed with `Invalid
argument`, and `PIPESTATUS` stays empty even for builtins. Every attempt's original
receipts are archived on #209. Its readiness flags remain false in those preserved
receipts. Later common-VFS and pipe work is assessed independently; this historical
failure is not the status of every subsequent integration.
