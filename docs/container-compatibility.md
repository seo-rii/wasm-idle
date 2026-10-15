# Container compatibility ledger

This ledger distinguishes tested components from release qualification. The new SDK remains
experimental; P2 command alpha and P4 shell MVP have **not** passed their complete gates.
Existing playground support is not evidence of container CLI support.

| Capability | Implemented and tested | Remaining boundary |
| --- | --- | --- |
| Direct command API | `spawn/run`, argv/env snapshots, byte stdout/stderr, normal/nonzero exit, timeout/termination/disposal, CPU-loop restart | Batch execution begins after stdin EOF; no interactive guest I/O |
| WASI commands | Bounded core wasm32 Preview 1 modules in a dedicated Worker; explicit syscall/import allowlist and pointer validation | No components, shared/imported/unbounded memory, start section, sockets or arbitrary imports |
| Working directory | Real cwd capability plus producer `wasm_idle_process_v1.initial_cwd`; libc producers call actual `chdir` | Legacy Preview 1 modules must use explicit `cwd: '/'`; PWD alone is insufficient |
| Memory workspace | Inodes, descriptors, symlinks, relative paths, mount capabilities, readonly packages, atomic snapshot commit and writer lease | Snapshot visibility at command completion; one writer; no hardlinks, permissions mutation or live multiprocess sharing |
| Byte pipes | Bounded endpoint queues, partial/zero I/O, EOF, EPIPE, fd reference ownership | Primitive tests only; no guest pipeline scheduler or live SAB bridge |
| Command packages | Pinned manifest digest, validated graph/adapter allowlist, command-lazy verified assets, atomic readonly mount | Command index is host metadata; no fake PATH executable nodes, shell exec or shebang support |
| Asset cache | Core CacheStorage/IndexedDB verification, independent cancellation, quota fallback; actual reload uses one body request with HTTP cache disabled | Browser eviction remains possible; no complete offline application bootstrap |
| Workspace artifact | Explicit `wasm-run <path>` with import/memory validation | Direct `./file.wasm` and executable mode dispatch are not implemented |
| LLVM tool host | Pinned bytes, original argv/env/cwd, separate byte fd binding, snapshot resources, checked driver/linker dispatch ABI | Full modified Clang/LLD artifact and C/C++ CLI/browser gates pending; C-10 and producer C-11 stay draft |
| BusyBox B0 | Separate C-12/C-13 stack: actual 1.37.0 `printf`, `echo`, `cat`, `pwd`, `true`, `false`; native/Node/Chromium alias and byte fixtures | B1 including `grep`, file mutation commands and live pipes are not qualified |
| Real Bash | C-02 probe executes actual WASIX Bash external Wasm with selected args/env/fd cases | Empty argv loss, inconsistent exit propagation and filesystem visibility block promotion; no selected production bridge |
| Persistent workspace | Optional OPFS blobs/IndexedDB roots, explicit flush, last-good recovery, Web Locks single writer, separate cache namespace | No autosave/editor/save UI, orphan GC, permanent storage guarantee or complete P5 beta qualification |
| Deployment | Local Chromium/Linux batch smoke under restrictive CSP, with and without COOP/COEP | Isolated headers do not implement live I/O; production CDN, full release inventory and clean-origin shell acceptance remain unqualified |
| Terminal, PTY, preview, job control, Node/Linux | No container implementation | Unsupported |

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
