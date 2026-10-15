# Container compatibility ledger

This ledger distinguishes tested components from release qualification. The new SDK remains
experimental; P2 command alpha and P4 shell MVP have **not** passed their complete gates.
Existing playground support is not evidence of container CLI support.

| Capability | Implemented and tested | Remaining boundary |
| --- | --- | --- |
| Direct command API | `spawn/run`, argv/env snapshots, byte stdout/stderr, normal/nonzero exit, timeout/termination/disposal, CPU-loop restart; optional live WASI and explicit `spawnPipeline` | Batch execution starts after EOF; live mode requires isolation and has an explicit blocked-I/O deadline |
| WASI commands | Bounded core wasm32 Preview 1 modules in a dedicated Worker; explicit syscall/import allowlist and pointer validation | No components, shared/imported/unbounded memory, start section, sockets or arbitrary imports |
| Working directory | Real cwd capability plus producer `wasm_idle_process_v1.initial_cwd`; libc producers call actual `chdir` | Legacy Preview 1 modules must use explicit `cwd: '/'`; PWD alone is insufficient |
| Memory workspace | Inodes, descriptors, symlinks, relative paths, mount capabilities, readonly packages, atomic snapshot commit and writer lease; live guests share completed VFS operations | Snapshot and live executions cannot overlap; no hardlinks or permissions mutation |
| Workspace/editor binding | Bounded generation/rescan events, staged owned byte buffers, inode/content conflict checks, snapshot busy protection; actual live/snapshot guests see published edits | No rendered editor application, historical revision store or automatic unpublished-buffer persistence |
| Byte pipes | Bounded endpoint queues, partial/zero I/O, EOF, EPIPE, fd reference ownership; live SAB bridge and all-consumer pipeline reservation tested with real Wasm and BusyBox | No WASIX shell fd inheritance, PTY or POSIX signal mapping |
| Command packages | Pinned manifest digest, validated graph/adapter allowlist, command-lazy verified assets, atomic readonly mount | Command index is host metadata; no fake PATH executable nodes, shell exec or shebang support |
| Asset cache | Core CacheStorage/IndexedDB verification, independent cancellation, quota fallback; actual reload uses one body request with HTTP cache disabled | Browser eviction remains possible; no complete offline application bootstrap |
| Workspace artifact | Explicit `wasm-run <path>` with import/memory validation | Direct `./file.wasm` and executable mode dispatch are not implemented |
| LLVM tool host | Pinned modified Clang/LLD, original argv/env/cwd, checked cc1/linker dispatch and separate byte fd binding; actual Node Worker and Chromium batch snapshot C/C++ compile/link/artifact checks with the unchanged full sysroot; the concrete 14-case selected header corpus verifies objects/dependencies and 1,050 header-byte identities per backend; reload reuses asset bodies | C++ profile requires explicit `-fno-exceptions`; reload runs only `--version`, not a warm full compile. Header checks are compile-only; exhaustive combinations and all header families' linked runtime support remain unqualified. Live compiler/shell integration and clean-build/release/performance gates remain; C-10 and producer/consumer C-11 stay draft |
| BusyBox | Separate producer/batch/live stacks: selected B0/B1 native, Node and Chromium differential/byte/file mutation checks; actual live cat/grep pipes and concurrent cp/file visibility | Selected applets/options only; grep `-a`/`-I` and encountered NUL bytes are rejected, while NUL-free non-UTF8 input is tested; no shell semantics implied |
| Real Bash | Fixed SDK/Bash builds and local packaging pass; all ten real Chromium commands complete and 17/18 selected checks pass, including empty/LF/CR/UTF-8 argv, environment replacement, actual cwd, nonzero guest status, binary pipes and separate file sharing | Relative redirect file visibility fails: pinned libc startup cwd differs from actual host cwd; absolute-path/explicit-chdir diagnostics isolate the boundary. Startup fix, JavaScript registry, common live fd/VFS, cancellation and actual Clang/BusyBox shell acceptance remain open; original Noexec failure is preserved separately |
| Persistent workspace | Optional OPFS blobs/IndexedDB roots, explicit flush, last-good recovery, Web Locks single writer, separate cache namespace; portable checksum-validated backup/atomic restore | No rendered save/export UI, orphan GC, permanent storage guarantee or complete P5 beta qualification |
| Save-state binding | Optional bounded status stream, manual save by default, opt-in autosave, explicit error retry and revision-aware completion | Browser suspension delays timers; controller disposal does not save or release the separately owned persistence owner |
| Deployment | Local Chromium/Linux batch and live smoke under restrictive CSP; nonisolated live startup rejects before Worker allocation | Production CDN, full release inventory and clean-origin shell acceptance remain unqualified |
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
PTY/termios and live shell support are not implied by these results. A skipped, pending or
expected-failing fixture is never counted as a pass.
