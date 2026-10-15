# Explicit workspace persistence

`openPersistentWorkspace()` is an optional persistence owner around `MemoryFileSystem`.
It is implemented in `src/fs/persistence/index.ts` and is independent of `Container`:
opening a container does not enable persistence, autosave, or background deletion.
The owner requires a secure context, OPFS, IndexedDB, Web Locks and Web Crypto.
If any capability is unavailable, opening fails with `UNSUPPORTED`; a second writer
for the same workspace ID fails with `BUSY`.

```ts
const workspace = await openPersistentWorkspace({
  id: 'project-one',
  maxBytes: 64 * 1024 * 1024,
  maxInodes: 16_384,
});
workspace.fs.writeFile('/workspace/main.c', new TextEncoder().encode(source));
await workspace.flush();
const status = workspace.inspect();
await workspace.dispose();
```

The caller supplies `openPersistentWorkspace` from the optional persistence
entrypoint; this module has no dependency on the runtime asset cache or compiler
adapters. Only `/workspace` is saved. Temporary files, home configuration and
readonly toolchains are excluded. Paths, file bytes, directory entries, symlinks,
permission bits, inode identities and the inode allocation high-water mark are
preserved, including the recorded modification/change timestamps.

## Commit and recovery

`flush()` takes an owned memory snapshot before starting asynchronous storage work:

1. Write content-addressed file blobs into OPFS, close the writers, then verify
   each stored blob's exact size and SHA-256 digest.
2. Validate the bounded JSON root manifest and compute its SHA-256 digest.
3. Publish the root record in one IndexedDB transaction with strict durability
   requested, retaining the previous verified root in the same transaction.

OPFS and IndexedDB do not share a transaction. A page interruption before step 3
leaves the previous committed root intact and may leave unreferenced blobs. A
successful flush means that the browser completed the root transaction after the
blob writes and verification; it does not guarantee persistence against storage
eviction, browser bugs or device failure. This API does not request persistent
storage permission or claim indefinite retention.

On reopen, root digests, structure, inode identities, namespace limits and every
referenced blob are validated. An invalid latest root can fall back to the
previous verified root, with `recovered: true`. If neither retained root validates,
opening fails with `CORRUPT` and leaves the stored data untouched. It never replaces
a corrupt workspace with an empty one. Lowering memory or metadata limits can
make a previously valid workspace unrecoverable under the new limits.

There are at most two committed root records after publication. Orphan and retired
blobs are currently retained: garbage collection and a user-facing deletion API
are follow-up work. Repeated edits can therefore exhaust origin storage. Such a
write failure rejects `flush()` without deleting committed roots or the current
in-memory files. The default metadata limit is 16 MiB and is configurable up to
64 MiB. Memory byte and inode budgets also apply during recovery.

## Ownership and save status

An exclusive Web Lock is held from open until `dispose()` or page teardown. Lock
acquisition uses `ifAvailable`, so it never silently waits behind another editor.
Lockless editing of persistent storage and multiple writers are unsupported.
OPFS handles are owned by this persistence module; synchronous guest syscalls
continue to access the in-memory filesystem.

`inspect()` includes the current memory generation, the committed generation and
journal sequence, `dirty`, `recovered`, save state, and the last typed error code.
Mutations while a flush is pending are permitted. That flush publishes its initial
snapshot and leaves the newer memory generation dirty. Concurrent `flush()` calls
reject with `BUSY`. The generation is a VFS-wide revision, so changes to temporary
or package mounts may conservatively mark the owner dirty even though those
mounts are excluded from the saved root.

`dispose()` is idempotent. It waits for a flush already in progress and releases
ownership; it does not initiate a flush or delete files. Do not rely on asynchronous
dispose or flush completing during page teardown. The retained memory filesystem
and `exportSnapshot()` remain readable after disposal, while new flush calls fail
with `DISPOSED`.

`exportSnapshot()` returns an owned snapshot of current `/workspace` content,
including unsaved data and inode identities, with empty default mounts. A host can
use it for user-initiated export and recovery UI. It contains `Uint8Array` file
data. The optional workspace entrypoint provides a bounded downloadable binary
backup and atomic explicit restore; see [workspace bindings](./WORKSPACE.md).
This module does not automatically upload telemetry, source files, or diagnostic
bundles. Runtime cache clear/prune never calls this module; its OPFS directory,
IndexedDB database and lock names use the `wasm-idle-workspaces-v1` namespace.

## Validation and current qualification

After building the container, run:

```sh
node packages/container/scripts/test-persistence-browser.mjs
```

The script uses an unprotected loopback origin and a fresh Playwright Chromium
context. `CHROMIUM_PATH` optionally selects a local Chromium executable.
`CONTAINER_PERSISTENCE_EVIDENCE` optionally writes a JSON result containing browser
version, platform, module hash and fixture outcomes. No compiler assets are used.

The suite covers binary/symlink/inode restoration after reload, exclusive ownership
from a second tab, cache deletion, unsaved export and disposal, a real page reload
after a blob has closed but before root publication, last-good recovery after blob
corruption, post-publication failure status, edits during flush, metadata budget
failure and unrecoverable
storage. Fault hooks receive only named commit boundaries, never file contents.
Throwing after root publication can reject a flush whose data has already committed;
inspection reports that committed generation rather than claiming rollback.

An explicitly opened owner can be injected as `createContainer({ workspace: owner,
adapters, packages })`. The container uses that same filesystem and its byte/inode
quotas. `container.flush()` publishes its visible workspace revision; a running
snapshot command's private changes are not visible until normal completion. Inspect
reports the owner's saved/dirty/error state. Container disposal stops its commands;
the injecting host must then call `owner.dispose()` to release the writer lock. This
allows export and an explicit final flush without deleting data or implicitly saving.
Passing conflicting container/owner quotas or a disposed owner fails explicitly.

This is a persistence primitive with Chromium/Linux coverage, not qualification of
the complete persistent container beta. Editor integration, autosave UI,
export UI, orphan collection, broader browser coverage and process-crash
testing during an active IndexedDB transaction remain separate work.
