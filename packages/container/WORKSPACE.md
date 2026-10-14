# Workspace and editor bindings

The container VFS is the published source of truth. An editor may stage separate
unsaved bytes, but publishing them is explicit and independent from durable saving.
The optional workspace entrypoint supplies that staging contract without owning a
renderer, language runtime, terminal, package resolver, or storage lock.

```ts
import { openWorkspaceEditor } from '@wasm-idle/container/workspace';

const editor = openWorkspaceEditor(container.fs, '/workspace/main.c');
editor.edit(new TextEncoder().encode('int main(void) { return 0; }'));
const revision = editor.publish(); // { generation, inode }; memory publication only
// A compile UI can display revision.generation beside the build result.
await container.flush(); // only with an explicitly opened persistent owner
```

`openWorkspaceEditor` opens an existing regular file through the `/workspace`
capability. Create new files explicitly with the VFS. The editor resolves its path
once, keeps the inode/content and global generation from that read, and owns copies
of staged bytes. Its default file/buffer bound is 8 MiB. `read()` returns a copy.
`inspect()` distinguishes clean, modified, conflict and disposed state and reports
both the base and current workspace generation.

`publish()` synchronously compares the current file's inode and bytes with the
editor base before writing. Unrelated file changes do not cause false conflicts.
Deleted, replaced or modified source files reject with `ECONFLICT`, preserving the
unsaved buffer. A snapshot writer lease rejects with `EBUSY`; the editor must retry
or resolve an ensuing conflict after the compiler completes. There is no force-save
overload. `reload({ discardChanges: true })` is the explicit way to discard local
changes after presenting them to the user. `dispose()` discards only this buffer;
it neither saves nor deletes a workspace file.

This comparison protects publication, not a whole build. A live process or editor
can change other input files during compilation. Reproducible builds must select
an explicit input snapshot and record its generation; a recorded revision is not
a promise that later VFS reads still return historical bytes.

`container.fs.watch({ path: '/workspace', maxQueuedEvents: 32, signal })` returns a
ReadableStream of immutable change hints with generation, kind, canonical path,
and available inode/previous-path information. Create, modify, remove and rename
events describe completed synchronous mutations. Snapshot commits and package
publication emit a rescan hint. Scope is resolved once at subscription; moving an
ancestor invalidates the view rather than silently following a different tree.

Queues contain at most the configured 1..256 hints. Overflow becomes one rescan
hint with the newest generation until consumed. A consumer must re-query the VFS
on rescan; events are not a complete audit trail or historical file snapshot.
At most 64 watchers can be registered per filesystem. An AbortSignal or reader
cancel releases the subscription and wakes a pending read. The host owns this
lifetime: container disposal preserves its VFS and does not dispose editor/watch
objects still held by the application. Neither file bodies nor environment data
are included in event notifications.

## Explicit backup and replacement

`createWorkspaceBackup(container.fs)` copies one published memory revision into a
portable `Uint8Array`, including unsaved `/workspace` file bytes, directory/file
metadata and literal symlink targets. It excludes `/tmp`, package mounts and runtime
asset caches. It also works on the retained VFS after owner/container disposal or a
failed durable save. The host chooses when to present a file download; no network
upload or browser download is triggered by the SDK.

`restoreWorkspaceBackup(container.fs, bytes, { replace: true })` explicitly replaces
the whole published workspace. It checks the complete archive before taking an
exclusive writer lease and atomically publishing the replacement. A running live
process, snapshot writer or open host descriptor returns `EBUSY`. Existing editor
buffers retain their unsaved content and detect the replacement on publication.
Restoration allocates new inode identities and retains the target workspace mount
root's identity/metadata; file and nested directory timestamps/modes are restored.
The result reports the source and new generation. It does **not** call `flush()`;
the host must show this replacement as unsaved until explicit durable publication.

The version-1 format is eight magic bytes (`WIDLEWS1`), a little-endian uint32 UTF-8
manifest length, JSON metadata, contiguous file bodies, and a 32-byte SHA-256 checksum
of all preceding bytes. The checksum detects corruption; it does not authenticate
the sender or make user programs trustworthy. The default limits are 96 MiB for the
whole archive and 8 MiB for metadata. Filesystem byte, inode, path and depth quotas
also apply before publication. Duplicate paths, escaping write paths, overlapping
bodies, dangling body bytes and invalid UTF-8/metadata fail without partial changes.
Imported symlinks are inert records: restoration never writes through them. Later
access still obeys the requesting VFS capability, including symlinks outside it.
No archive JavaScript, shell script or program is executed during restore.

## Save-state binding and optional autosave

`createWorkspaceSaveController(persistentOwner)` exposes `inspect()` and a bounded
latest-state `updates` stream for saved/saving/dirty/recovered/error UI. The nested
`workspace` inspection reports both published and committed generations. Consuming
updates never marks data saved. Only one save controller may own an owner at a time;
all UI save requests should use its `save()` method so their status is observable.

Manual saving is the default. A host may explicitly opt in using `{ autosave: true,
delayMs: 1000, maxWaitMs: 5000 }` or `setAutosave(true)`. Changes are debounced with a
maximum scheduling wait; browser suspension can delay timers, so neither value is
a durability deadline. A save takes the current published revision, serializes
requests and, if a newer manual request arrived while storage was pending, commits
that requested revision before resolving. Edits after the final snapshot remain
dirty. Status notifications contain at most one queued inspection and may coalesce
intermediate transitions.

A save error remains visible and pauses automatic retries. No workspace data is
deleted. The host should offer retry (`save()` or explicit `setAutosave(true)`),
backup download, and a visible unsaved/error state. New edits alone do not trigger
an endless failing write loop. Unpublished editor buffers must be published or
exported separately; autosave only sees the VFS. A conservative VFS-wide generation
can schedule another save for temporary/package changes even though their bytes
are not persisted.

`dispose()` cancels timers/subscriptions and waits for storage already in progress.
It starts no final save, deletes no files and does not release the separately owned
persistence lock. A newer queued revision that cannot finish before disposal
rejects rather than reporting the earlier root as fully saved. The host must stop
its container processes, explicitly save/export as chosen by the user, dispose the
binding, and finally dispose the persistence owner. Page teardown is not a reliable
place to await these operations. Cancelling only the status reader does not turn
off autosave; dispose the controller when removing the owning UI.

## Qualification

`node packages/container/scripts/test-workspace-browser.mjs` runs the shared
Node/Chromium contract with actual live and snapshot Wasm guests. Fourteen checks
cover staged conflicts, bounded guest notifications, revision publication, both
live guests seeing an editor write, snapshot writer leases and committed changes,
and complete process/watcher cleanup. Chromium 153/Linux passes under restrictive
CSP with cross-origin isolation; the source hashes and exact guest identity are in
`test/fixtures/workspace-browser-evidence.json`. This qualifies the SDK binding,
not a full editor application or actual shell integration.

The persistence Chromium suite also covers exporting all unsaved files after a
failed save, restoring into a separate owner without touching runtime caches/tmp,
rejecting a corrupt replacement, and explicitly flushing/reopening the restored
workspace. Its 12-case receipt is in
`test/fixtures/workspace-backup-browser-evidence.json`; six focused backup unit
cases exercise checksum-valid hostile manifests, atomicity, quotas and byte ownership.
