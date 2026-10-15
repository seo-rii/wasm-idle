# Actual Bash on the common container filesystem

This opt-in Chromium probe mounts Bash's `/workspace` from the container VFS. The owner Worker
creates `Directory.fromHostFileSystem(createShellFilesystem(container.fs))` with SDK bridge
patches 0011/0012. Every shell lookup, redirection, `mkdir`, `cd` and read then reaches the
same `MemoryFileSystem` the Supervisor's live guests use. `mkdir` is not a Bash builtin and
BusyBox is not dispatched yet, so the scripts create directories with the editor below. Host commands are dispatched
exactly as in [the dispatch probe](../host-command-shell/README.md). Because the
filesystems are now one namespace, a guest's cwd is Bash's actual cwd, with no mirroring.

`/opt/host/bin/edit` is a trusted harness host command. It changes the container VFS
directly, the way an editor would: make a directory, unlink, rename, replace a file with a
directory, write, or print a file. This lets the probe check that Bash observes changes made outside its
process.

| Case | Required observation |
| --- | --- |
| FS-SHELL-TO-GUEST | After the editor creates `d/e`, Bash `cd`s there and writes `note`; a guest started in that cwd reads the bytes |
| FS-GUEST-TO-SHELL | A guest's `out.bin` and Bash's `> out` redirect land in the container VFS; Bash reads `out.bin` back |
| FS-EXTERNAL-ENTRIES | After external unlink, rename and file→directory replacement, Bash's `[ -e ]`/`[ -d ]` see the new state despite WASIX's cached inodes |
| FS-LIVE-APPEND | `>>` appends after bytes written by another process; a file created after a failed lookup is found and appended |
| FS-PIPELINE-RESULT | The acceptance-shaped pipeline (directory, `cd`, write source, two guests, redirect, read back) without a compiler |

Every case also requires:
- the expected container file bytes and an empty container process list;
- the SDK initialized with the public `fromHostFileSystem` API;
- no browser errors, and all Workers retired.

`commonContainerFdVfsQualified` and `shellBackendReady` stay false. Host-command
descriptors other than 0–2, symlinks and hard links in shell paths, cancellation,
BusyBox/Clang and command-lazy assets remain separate gates.

Use the same configuration shape and commands as the dispatch probe, with
`scripts/probe-container-shell-filesystem.mjs` and a package receipt pinned in
`scripts/probe-container-shell-filesystem-lib.mjs`.

## Results

- **Preliminary, mkdir** ([receipt](evidence/preliminary-mkdir.json), commit `1457a6c7`):
  18 of 27 checks. FS-GUEST-TO-SHELL, FS-EXTERNAL-ENTRIES and FS-LIVE-APPEND passed.
  FS-SHELL-TO-GUEST and FS-PIPELINE-RESULT failed only because their scripts called
  `mkdir`: `bash: line 1: mkdir: command not found`, exit 127.
- **Preliminary package** ([receipt](evidence/preliminary-package.json), commit `368dc3c0`): 27 of 27 with
  directories created by the editor. This package was built from patches 0001–0012 before
  the host-command status-order fix, so it is not the final pin.

The recorded commits `1457a6c7` and `368dc3c0` predate rebasing this branch onto #209's
status-order commits. The container sources, probe, worker and fixtures are byte-identical
in the rebased commits `fd8f317e` and `59fe968d`; only #209's own pins and evidence differ.
