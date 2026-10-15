# B0 container qualification

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
applets do not establish live file sharing, pipes, interactive stdin, BusyBox B1
utilities, a shell, or job control. Those remain independent gates. The Node
worker shim only adapts message transport; actual imports, memory validation,
filesystem operations and execution use the package's WASI Worker.
