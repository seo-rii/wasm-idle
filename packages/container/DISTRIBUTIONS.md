# Pinned container distributions

The package index is schema version 1. `validateDistribution()` requires the raw UTF-8 JSON
bytes and an expected SHA-256 supplied independently by the application. It verifies that
digest before parsing or accepting command metadata. A digest written inside the manifest
does not authenticate it. The caller also supplies an explicit adapter ID allowlist and an
exact asset URL allowlist. Neither validation nor command lookup downloads a tool body.

```ts
const distribution = await validateDistribution({
  bytes: applicationPinnedIndexBytes,
  expectedSha256: applicationLock.distributionSha256,
  adapterIds: ['wasi-preview1'],
  allowedAssetURLs: applicationLock.assetURLs
});
```

The JSON structure is:

```json
{
  "schemaVersion": 1,
  "distributionId": "example-release-1",
  "packages": [{
    "id": "example-tools",
    "identity": "sha256:<64 lowercase hex characters>",
    "producer": {
      "repository": "https://github.com/example/producer",
      "revision": "<exact 40 or 64 lowercase hex source revision>",
      "receiptSha256": "<64 lowercase hex characters>"
    },
    "dependencies": [],
    "mount": "/opt/toolchains/example-tools",
    "capabilities": ["wasi-preview1"],
    "assets": [{
      "id": "tool",
      "url": "https://assets.example/tool-<digest>.wasm",
      "encoding": "identity",
      "delivery": { "sha256": "<digest>", "bytes": 8, "mediaType": "application/wasm" },
      "logical": { "sha256": "<same digest>", "bytes": 8, "mediaType": "application/wasm" }
    }],
    "files": [{ "path": "bin/tool", "asset": "tool", "executable": true }]
  }],
  "commands": [{
    "name": "tool", "package": "example-tools", "adapter": "wasi-preview1",
    "path": "bin/tool", "argv0": "tool", "prefixArgs": []
  }]
}
```

Placeholders above must be replaced with actual producer identities. The index wraps existing
producer receipts; it does not replace their producer-specific validation. `identity` and
`receiptSha256` are provenance authenticated by the host-pinned index, not a claim that a
separate receipt body was downloaded or checked. The distribution preparer must verify that
receipt and populate actual values before creating the application lock.

Dependencies are fixed package IDs in this index. Unknown packages, cycles, duplicate command
names, unregistered adapters, and executable references to non-executable files fail before
downloads. Adapter IDs cannot import remote JavaScript. `argv0` and `prefixArgs` represent
explicit multicall aliases; they are not shell strings.

Files use canonical UTF-8 relative POSIX paths, without NUL or path traversal. Backslash is
an ordinary filename character. Mounts are readonly descendants of `/opt/toolchains` or
`/usr/share`, and cannot overlap. There are no archive or symlink entries in this initial
format. Unsupported encodings and unknown fields are rejected. Per-file, total-file,
asset-byte, index-count, path-depth and dependency-depth bounds are checked before fetch.
`maxTotalAssetBytes` counts both delivery and logical sizes conservatively; file sizes also
count each file index entry, including aliases that use the same asset.

Direct file assets support `identity` and file-level `gzip`. Delivery identities describe
the body bytes returned by fetch after any HTTP content decoding. Logical identities describe
the resulting file. Gzip delivered transparently by HTTP must therefore use `identity` when
fetch returns the uncompressed file; a `.gz` suffix alone never selects decompression. A gzip
file's delivery MIME is checked against its HTTP response, while its logical MIME is pinned
metadata and its logical bytes must match their separate digest and size.

`createVerifiedAssetLoader({ distribution, persistentCache })` loads only an asset selected
with `load(packageId, assetId, { signal })`. It delegates delivery fetch/cache reads to Core's
`fetchPinnedRuntimeAsset`, retaining exact response-URL, complete-response, no-redirect,
omitted-credentials, MIME, SHA-256 and size checks. Browser storage failure permits verified
nonpersistent execution. Offline misses report the missing asset identity without version
fallback. CacheStorage and IndexedDB remain subject to origin quota and eviction.

Concurrent consumers of the same receipt and fixed loader policy share one request. Aborting
one consumer leaves others running; the final cancellation aborts network/decompression and
removes the old request generation. Failed work is retryable. Each result is an owned byte
copy. A separate bounded LRU retains verified logical bytes (64 MiB by default); zero disables
that memory cache. Pending asset requests and consumer counts are bounded as well.
`dispose()` is idempotent and aborts outstanding work. `clearMemoryCache()` touches only this
loader's re-downloadable bytes, never workspace files or the shared persistent asset cache.

`createContainerPackageManager({ distribution, capabilities, persistentCache })` supplies
metadata-only `resolveCommand(name)` and `listCommands()`. The resolver accepts the exact bare
name or `/usr/bin/<name>`; it does not parse shell strings or claim to implement a shell's PATH
rules. The supervisor must expose command entries through a real executable-node/dispatch
contract before advertising shell `stat/access/exec` support; the manager does not create
empty executable placeholder files.

`prepare(packageId, { signal })` returns a complete dependency-first `PreparedPackages`:
`{ distributionId, distributionSha256, packages }`. Each package contains
`{ id, identity, mount, files }`; a file contains its relative `path`, owned `bytes`,
`executable` flag, `sha256` and `mediaType`. `prepareCommand()` additionally returns the
frozen `command` metadata, an independently owned `executable` byte array and its absolute
`executablePath`. Only the receiving adapter may instantiate those bytes; it must validate
the actual Wasm/import/memory profile and must not re-fetch an executable by URL.

The manager checks host capability IDs and reserves preparation count/file-byte budgets
before downloading. Byte accounting covers prepared file copies and a command executable
copy. This is an admission budget, not a browser JS heap/RSS hard limit; delivery buffers,
decoding, the asset cache and engine memory have separate bounds. No partial package closure
is returned on failure or cancellation. The caller must atomically mount the completed
closure readonly, snapshot the incoming bytes, and make repeated mounting of the same
`distributionSha256`/package identity/mount idempotent. A filesystem writer lease belongs
after preparation, so downloads do not hold a workspace lock. The manager never reads,
modifies, persists or deletes the user's workspace.

Unit tests here cover index validation, pinned loader protocol failures, cancellation and
staged results with byte fixtures. They do not qualify a Clang CLI, BusyBox, a shell, browser
persistent-cache recovery, or atomic mounting in a specific filesystem; those require the
corresponding adapter/browser integration fixtures.
