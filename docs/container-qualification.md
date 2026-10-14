# Container qualification evidence

Recorded 2026-10-14. This is a component evidence ledger, not a released command alpha, shell
MVP or persistent beta. Work that can proceed independently of the blocked shell bridge has
been implemented; unpassed promotion gates remain explicit.

## Review order

| Work                                           | PR                                                                               | Base / dependency                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope and boundaries                           | [C-01 #128](https://github.com/seo-rii/wasm-idle/pull/128)                       | main at implementation start                                                                                                                            |
| Real Bash probe and backend decision           | [C-02 #133](https://github.com/seo-rii/wasm-idle/pull/133)                       | C-01, independent experiment                                                                                                                            |
| Pinned SDK bridge source experiment            | [C-02 follow-up #149](https://github.com/seo-rii/wasm-idle/pull/149) (draft)     | C-02; source/protocol checks and #189 SDK typechecking pass; modified SDK execution pending                                                             |
| Owned prepared-child command metadata          | [C-02 snapshot #189](https://github.com/seo-rii/wasm-idle/pull/189) (draft)      | #149; five source patch checks and genuine pinned SDK lib/external-example typechecking pass; linked SDK/glue, JS dispatch and fd/FS bridge pending     |
| Pinned SDK Wasm/web-glue build gate            | [C-02 SDK build #191](https://github.com/seo-rii/wasm-idle/pull/191) (draft)     | #189; real SDK/bindgen/static inspection passes on a warm target; original timeout preserved; guest qualification pending |
| Opt-in real Bash exec-shim producer            | [C-02 Bash producer #192](https://github.com/seo-rii/wasm-idle/pull/192) (draft) | #189; real source-pinned Bash build/import receipt passes; actual SDK/Bash execution pending |
| Local SDK module/Worker packaging              | [C-02 SDK package #193](https://github.com/seo-rii/wasm-idle/pull/193) (draft)   | #191; actual pinned-esbuild local package and original receipts pass; browser guest acceptance pending |
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

## Blocked or incomplete gates

| Gate                  | Observed boundary                                                                                                                                                                                                                                 | Next experiment / owner                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G0-SHELL/FS/FD/CANCEL | Real pinned WASIX SDK 0.10.0 Bash can execute selected external Wasm, but loses empty arguments, has inconsistent exit propagation and incomplete host filesystem visibility; nested Worker ownership needs explicit cleanup                      | C-02 backend investigation; #189 prepared-child metadata passes genuine SDK/example typechecking; linked SDK/glue, JS dispatch and common fd/FS routing still need actual guest acceptance before C-15 |
| G0-CLANG / CLI-01–03  | Modified raw links, eight actual Node WASI CLI commands, common VFS Node Worker acceptance, Chromium batch C/C++ compile/link/artifacts and the 14-case selected-target header corpus pass; reload reuses the verified full-sysroot asset closure | #159 retains a snapshot-only, explicit exception-free C++ profile; #188 closes the concrete selected corpus gate, while exhaustive combinations, live binding and release promotion remain separate    |
| B1 / P3               | Selected producer, 128 batch Node/256 Chromium invocations, and 17 live checks per backend pass                                                                                                                                                   | Keep support limited to the recorded applets/options; real shell acceptance is still separate                                                                                                          |
| P4 / shell MVP        | C-14 supplies live WASI VFS/SAB I/O and pipeline admission; actual shell dispatch/common WASIX fd ownership and full acceptance remain absent                                                                                                     | C-15 after backend and real compiler gates; snapshot Clang cannot overlap live users                                                                                                                   |
| P5 / product beta     | Persistence, editor/watch, terminal, backup/restore and save SDK bindings have component evidence; rendered integration and orphan GC remain separate                                                                                             | Product failure UI/lifecycle and full shell-based reload matrix                                                                                                                                        |
| C-19/20               | Local Chromium component evidence, including the selected header corpus; no production release or performance baseline                                                                                                                            | Real immutable hosting/receipt/license closure and clean-origin acceptance, then measured optimizations                                                                                                |

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

The selected-target full sysroot remains intact: 35,328,000 logical bytes, 2,168 files plus
117 directories, SHA-256 `91899da37610664152a2a1cbae3632f35ff8803e32f006225c1c4fb50f341402`.
It comes from the existing producer revision `25ef7345eba86fce0352e7eb0a881e23ed0e684f`;
no headers were pruned to make a minimal example pass.
