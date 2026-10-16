# Container compatibility ledger

This ledger distinguishes tested components and selected integration profiles from release
qualification. The SDK remains experimental; release promotion requires the outstanding
gates in the qualification ledger. Existing playground support is not evidence of container
CLI support.

| Capability | Implemented and tested | Remaining boundary |
| --- | --- | --- |
| Direct command API | `spawn/run`, argv/env snapshots, byte stdout/stderr, normal/nonzero exit, timeout/termination/disposal, CPU-loop restart; optional live WASI and explicit `spawnPipeline` | Batch execution starts after EOF; live mode requires isolation and has an explicit blocked-I/O deadline |
| WASI commands | Bounded core wasm32 Preview 1 modules in a dedicated Worker; explicit syscall/import allowlist and pointer validation | No components, shared/imported/unbounded memory, start section, sockets or arbitrary imports |
| Working directory | Real cwd capability plus producer `wasm_idle_process_v1.initial_cwd`; libc producers call actual `chdir` | Legacy Preview 1 modules must use explicit `cwd: '/'`; PWD alone is insufficient |
| Memory workspace | Inodes, descriptors, symlinks, relative paths, mount capabilities, readonly packages, atomic snapshot commit and writer lease; live guests share completed VFS operations. Builtin `/dev/null` returns EOF/discards writes, and reserved inode 0 preserves stored user IDs | Snapshot writer leases reject conflicting namespace changes; redirected file descriptors preserve inode/offset and nonzero writes at commit. No hardlinks, arbitrary device creation or general chmod |
| Workspace/editor binding | Bounded generation/rescan events, staged byte buffers, inode/content conflict checks and snapshot writer leases; rendered file tree/editor with publish, reload and buffer export | Unpublished buffers require explicit export; no historical revision store or automatic buffer persistence |
| Byte pipes | Bounded endpoint queues, partial/zero I/O, EOF, EPIPE, fd reference ownership; live SAB bridge and all-consumer pipeline reservation tested with real Wasm and BusyBox; live `spawn` accepts caller-owned stdio endpoints used directly by the guest | Shell descriptors beyond 0–2 are not delegated; no PTY or POSIX signal mapping |
| Command packages | Pinned manifest, graph/adapter allowlist, command-lazy verified assets, atomic readonly mounts; shared virtual executable command nodes for stat/access/PATH | Command nodes are typed capabilities with no readable fake executable body; general script/shebang dispatch remains unsupported |
| Asset cache | Core CacheStorage/IndexedDB verification, independent cancellation, quota fallback; actual reload uses one body request with HTTP cache disabled | Browser eviction remains possible; no complete offline application bootstrap |
| Workspace artifact | Explicit `wasm-run`; selected shell route additionally checks executable metadata, Wasm magic/import/memory profile. Successful changed Clang outputs can opt into the validated Preview 1 process profile | No filename-based execution permission, ELF/PE/components or automatic chmod of failed/unchanged outputs; actual public-session gate is recorded separately |
| LLVM tool host | Pinned modified Clang/LLD, original argv/env/cwd, checked cc1/linker dispatch and separate byte fd binding; actual Node/Chromium snapshot C/C++ and full selected-sysroot checks, plus 14 live checks per backend for compile/link/run, stdin, concurrent header visibility, cancellation and closed-stdin repair; exact inode revisions guard executable output metadata | C++ requires explicit `-fno-exceptions`; the 14-case header corpus is compile-only and live C++ is unqualified. Repairing several simultaneously closed standard descriptors, exhaustive header combinations and clean-build/release gates remain outside the selected profile |
| BusyBox | Separate producer/batch/live stacks: selected B0/B1 native, Node and Chromium differential/byte/file mutation checks; actual live cat/grep pipes and concurrent cp/file visibility | Selected applets/options only; grep `-a`/`-I` and encountered NUL bytes are rejected, while NUL-free non-UTF8 input is tested; no shell semantics implied |
| Real Bash | Optional `adapters/wasix` binds actual pinned GNU Bash to the common VFS and Supervisor. The default snapshot profile passes 83/83 public-session checks; explicit live Clang passes 50/50, including streamed compiler stdin and concurrent header/utility visibility. Actual UI gates cover blocked-child interrupt and surviving-shell input | Snapshot remains the default with an exclusive writer lease. Live compilation observes completed concurrent edits and preserves completed writes on cancellation. Routed interrupt is host cancellation; no arbitrary POSIX signals, PTY or job control |
| Bash lifecycle | Public session owns registered command handlers, filesystem handles and a bounded SDK Worker group. Owner disposal retires its realm; late startup is cleaned up. Owner transport reports lost cleanup confirmation explicitly | One SDK owner realm per shell session; builtin CPU loops require whole-session termination. A new session needs a fresh owner; no full fork/PTY semantics |
| Persistent workspace | OPFS blobs/IndexedDB roots, explicit flush, last-good recovery, Web Locks single writer, portable backup/atomic restore, owner-controlled orphan GC; 21 real browser persistence checks pass | Browser quota/eviction remain possible; GC preserves roots needed for recovery. No permanent storage promise or concurrent-tab writers |
| Save-state binding | Manual save, opt-in autosave, visible failure/retry, backup/confirmed restore and separate asset-cache deletion in the workbench; 16 actual Chromium UI fixture checks and six actual Bash/Clang checks per selected snapshot/live profile pass | Browser suspension delays timers; disposal does not imply flush. Restore freezes the editor transaction; pending input cannot erase newly typed bytes |
| Deployment | Immutable index/asset/source/notice/host-graph preparation and independent lock verification; local Chromium smoke under restrictive CSP/isolation | Production CDN responses, fixed OS image, source/notice applicability and release promotion remain independent gates; no upload or release is performed |
| Terminal UI binding | Optional byte-stream rendering/input binding; per-channel UTF-8, bounded admission and cancellation/failure cleanup tested with actual guests and host fault injection | No PTY, ANSI interpretation, termios, resize or job control |
| Preview, Node/Linux | No container implementation | Unsupported |

The review stack is rooted at [C-01 #128](https://github.com/seo-rii/wasm-idle/pull/128).
See [qualification evidence and next gates](./container-qualification.md),
[deployment requirements](./container-deployment.md), and the detailed
[package contract](../packages/container/README.md). The Bash investigation is a separate
[C-02 PR #133](https://github.com/seo-rii/wasm-idle/pull/133); the compiler producer change is
[wasm-llvm #32](https://github.com/seo-rii/wasm-llvm/pull/32).

Paths are UTF-8 POSIX paths: NUL is rejected, backslash is a literal character, and symlink
resolution rechecks mount capabilities. Unsupported operations fail explicitly. The default
workspace is 64 MiB/16,384 inodes; input, total guest output and `run` capture are each bounded
at 8 MiB. A memory maximum is enforced per admitted Wasm instance, not as an aggregate browser
RSS limit. Source, stdin, environment and file bodies are not telemetry.

The recorded browser is Chromium 153.0.8010.12 on Linux x64. Firefox, WebKit, mobile browsers,
PTY/termios and unlisted shell features are not implied by these results. A skipped, pending or
expected-failing fixture is never counted as a pass.
