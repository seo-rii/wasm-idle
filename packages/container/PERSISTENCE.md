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
permission bits, inode identities, modification/change timestamps and the inode
allocation high-water mark are preserved.

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
previous verified root, with `recovered: true`. Only evidence about the stored data
selects that fallback: a digest, size or structure mismatch, or a missing blob.
Because the next flush retires every root except the loaded one, a storage access
failure such as an unreadable blob instead fails opening with `STORAGE` and leaves both
roots untouched for a retry. If neither retained root validates,
opening fails with `CORRUPT` and leaves the stored data untouched. It never replaces
a corrupt workspace with an empty one. If the newest candidate exceeds the current
byte, inode or metadata budget, opening fails with `RESOURCE_LIMIT` and releases
the writer lock. It does not select an older root or modify either committed root
or its blobs. Retry with sufficient limits to reopen the latest save. Byte budgets
include both file content and symlink targets; inode budgets include the recreated
base namespace as well as the saved workspace entries.

There are at most two committed root records after publication. Orphan and retired
blobs remain until the host explicitly requests the bounded maintenance operation
below. A write failure rejects `flush()` without deleting committed roots or the
current in-memory files; collection is never an automatic response to quota errors.
The default metadata limit is 16 MiB and is configurable up to 64 MiB. Memory byte
and inode budgets also apply during recovery.

## Explicit orphan collection

```ts
const result = await workspace.collectGarbage({
  maxScannedEntries: 4096,
  maxDeletedBlobs: 128,
  maxDeletedBytes: 64 * 1024 * 1024,
  maxReferencedBytes: 128 * 1024 * 1024,
});
```

Collection holds the existing workspace owner lock and excludes concurrent flush
or collection (`BUSY`). It first validates **every** retained journal root, their
namespace/inode/metadata limits, and the size and digest of every uniquely
referenced blob. This includes the previous recovery root, even when the current
root is valid. An invalid root, missing/corrupt referenced blob, or change to the
owner's known current or previous journal records fails with `CORRUPT` before deletion.
Exceeding the referenced-byte validation budget fails with `RESOURCE_LIMIT`.
Collection cannot repair a corrupt journal or discard a recovery root.

Only regular files named by a lowercase SHA-256 digest directly inside this
workspace's private OPFS directory can be candidates. References from all retained
roots protect a blob. Unknown names and directories remain untouched; collection
never recurses, edits root records, touches another workspace or runtime cache,
modifies the in-memory VFS, or publishes dirty editor data.

The entire bounded directory scan must finish before deletion starts. If more
entries exist than `maxScannedEntries`, the result has `scanComplete: false` and
zero deletions; at most one extra iterator entry is observed to detect overflow.
The caller can explicitly retry with a larger scan budget. With a complete scan,
only the deletion count/byte budget is spent, preserving larger or remaining
candidates for another call. `maxDeletedBlobs: 0` is a validation-and-scan dry run.

The frozen result reports retained roots, unique referenced blobs, scanned and
skipped entries, candidates, deleted blobs/bytes, `scanComplete`, and `complete`.
`complete` is true only when enumeration finished and every candidate was removed.
Budgets allow 1–65,536 scanned entries, 0–4,096 deleted blobs, 0–1 GiB deleted bytes,
and 1 byte–1 GiB of unique referenced content validation. Storage errors reject;
earlier successful orphan deletions may remain, but committed data stays protected.
An explicit successful retry clears the previous maintenance error while leaving
an unrelated failed save visible.

## Ownership and save status

An exclusive Web Lock is held from open until `dispose()` or page teardown. Lock
acquisition uses `ifAvailable`, so it never silently waits behind another editor.
Lockless editing of persistent storage and multiple writers are unsupported.
OPFS handles are owned by this persistence module; synchronous guest syscalls
continue to access the in-memory filesystem.

`inspect()` includes the current memory generation, the committed generation and
journal sequence, `dirty`, `recovered`, save state, and the last typed error code.
Mutations while a flush is pending are permitted. That flush publishes its initial
snapshot and leaves the newer memory generation dirty. Concurrent storage operations
reject with `BUSY`; `inspect().maintenance` reports an active collection. The generation
is a VFS-wide revision, so changes to temporary
or package mounts may conservatively mark the owner dirty even though those
mounts are excluded from the saved root.

`dispose()` is idempotent. It waits for flush or maintenance already in progress and releases
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
corruption, lowered byte/inode/metadata admission budgets without fallback or journal
changes, post-publication failure status, edits during flush, metadata budget
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
export UI, broader browser coverage and process-crash
testing during an active IndexedDB transaction remain separate work.

The separate [maintenance receipt](test/fixtures/persistence-gc-browser-evidence.json)
records 21 passing Chromium 153/Linux scenarios: the existing 15 persistence/save
checks plus six explicit collection scenarios. They cover an actual interrupted
flush orphan, dry-run/scan/count/byte/validation budgets, both retained recovery
roots, invalid older metadata and referenced bytes, unknown files and directories,
other workspaces/caches, failed-removal retry, and flush/dispose/cross-tab ownership
collisions. The original [process record](test/fixtures/persistence-gc-browser-process-evidence.json)
reports exit 0 in 2.550 seconds with every owned descendant reaped and no cleanup
signals or errors. [Provenance](test/fixtures/persistence-gc-browser-metadata.json)
distinguishes the run's base commit from its independently hashed working-tree
source and preserves all input rechecks; earlier receipts remain unchanged.
