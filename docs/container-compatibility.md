# Container compatibility ledger

This ledger distinguishes the existing playground, implementation experiments and qualified SDK
capabilities. The existing playground's support is not evidence of container support.

| Capability | Baseline evidence | Container status at C-01 |
| --- | --- | --- |
| Bash builtins | Real GNU Bash WASIX WEBc run by `@wasmer/sdk` 0.10.0 | G0 external exec pending |
| Bash external adapter | No public JavaScript command callback established | G0-SHELL/FD/FS/CANCEL pending |
| C/C++ compilation | Existing LLVM high-level API; complete selected-target headers | Generic CLI/tool-host pending |
| User WASI artifact | Existing browser WASI host | Common VFS/byte fd Worker profile pending |
| Memory filesystem | Clang private MemFS | Common inode/path/mount implementation pending |
| Verified persistent asset cache | Existing core CacheStorage/IndexedDB helper | Distribution resolution pending |
| BusyBox | No producer in baseline | Source/config/build/browser gates pending |
| Shell live pipes/workspace | No common backend | Unsupported until P4 |
| Persistent workspace | Asset cache is not user storage | Unsupported until P5 |
| PTY/job control/Node/Linux | No implementation | Unsupported |

Tests may qualify individual rows without qualifying an entire release stage. A blocked or
unrun fixture is never a pass. Browser/OS version, source hashes and commands belong in the
associated evidence receipt. This project starts with UTF-8 paths and WASI Preview 1 core Wasm;
components, sockets, fork, hardlinks and arbitrary signals require explicit future profiles.
