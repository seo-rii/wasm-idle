# BusyBox batch container qualification

This contract consumes a successful C12 producer directory. It runs the exact
recorded BusyBox bytes through the actual container WASI Worker in Node and
Chromium, using a pinned distribution index and the existing verified asset
loader. It does not intercept commands or substitute JavaScript applets.

```sh
node runtimes/wasm-busybox/scripts/test-container.mjs \
  --producer-work /path/to/verified/busybox-producer-output \
  --producer-revision <full-C12-producer-commit> \
  --container-dist /path/to/packages/container/dist \
  --core-dist /path/to/packages/core/dist \
  --output /path/to/busybox-container-evidence.json
```

The source worktrees and builds must remain unchanged during the fixture. The
receipt records the producer commit, artifact and producer-receipt hashes,
container application commit, actual container/core module hashes, fixture hash,
Chromium/Node/OS versions, isolation state, byte digests, exit results, remaining
process/Worker counts and asset body request counts. `CHROMIUM_PATH` can select a
locally pinned Chromium executable; Chrome is not used.

`cat`, `echo`, `false`, `printf`, `pwd`, and `true` each use both real multicall
and argv0 alias dispatch. Tests cover NUL/non-UTF-8 bytes, 8193-byte stdin/files,
empty and Korean arguments, actual cwd `/workspace/a b`, relative and absolute
paths with spaces, missing-file stderr, nonzero exit, readonly package files,
and host edits visible to the next command. All commands use the container
workspace and its snapshot lease/commit rules.

Metadata lookup must issue zero body requests. One body fetch must serve all
aliases and subsequent commands. The Chromium run repeats after page reload,
with `Cache-Control: no-store` on the asset response, to distinguish application
cache reuse from HTTP caching. The persistent namespace is confined to this
fresh local test origin. This runner never clears a user's workspace or cache.

The qualified profile is **batch commands with a snapshot filesystem**. B0
evidence alone does not establish BusyBox B1 utilities. Live file sharing,
pipes, interactive stdin, shells and job control remain independent gates. The Node
worker shim only adapts message transport; actual imports, memory validation,
filesystem operations and execution use the package's WASI Worker.

When the external producer receipt contains a passed B1 subset gate, this runner
also verifies its `b1-smoke.json` and hash-pinned `b1-smoke/b1-cases.json`. It loads
plain fixture data and the fixed local helper, never producer-selected JavaScript.
The original B0 receipt remains a supported input and keeps its 20-case matrix.

The B1 profile adds real `grep`, `mkdir`, `cp`, `mv`, and `rm` commands and aliases.
Each matrix entry starts from the recorded file/directory/symlink tree and checks
the resulting bytes, tree and exit against the producer's native reference.
Intentional WASI profile rejections compare against their explicit expected
failure. The receipt records the native upstream behavior separately for the
grep NUL and ignored `-a`/`-I` options. These cases do not claim native equality.
The complete matrix includes nonzero exits after partial changes, readonly
package protection, cross-mount copy and a cross-mount move failure that retains
both source and existing destination. A 200-entry recursive removal exercises
directory iteration while entries disappear.

The selected grep profile is text-only: NUL and `-a`/`-I` fail explicitly.
Binary bytes remain qualified through `cat` and `cp`. `mkdir -m`, preserving or
recursive copy modes and link-copy modes fail before destination changes;
cross-mount `mv` does not copy/unlink. Ownership, permissions and timestamps
are outside the qualified tree schema. Unlisted BusyBox applets/modes, live
filesystem visibility, pipelines, interactive input and actual shells still
require their own gates.

Use `--node-only` for the initial Node probe before allocating Chromium. Its
output is marked `node-complete-browser-pending`, so it cannot be mistaken for
the complete browser qualification receipt. Failed Node/browser results are
saved before assertions for diagnosing host incompatibilities.

The recorded B1 Node candidate in `evidence/container-b1-node.json` passes all
20 B0 and 108 B1 cases, plus mount protection and cleanup checks, using artifact
`547827daf25957a4e2f77ba9ba76b4734f363f867a8a5cb39302dce1b1c36ade`.
Its source identity was recorded after the unchanged Node run. It explicitly
remains browser-pending: Chromium qualification has not run while the shared
host is below the 2 GiB available-memory admission threshold. This record must
not be used to promote the B1 browser support grade.
