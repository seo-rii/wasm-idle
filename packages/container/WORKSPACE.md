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

## Qualification

`node packages/container/scripts/test-workspace-browser.mjs` runs the shared
Node/Chromium contract with actual live and snapshot Wasm guests. Fourteen checks
cover staged conflicts, bounded guest notifications, revision publication, both
live guests seeing an editor write, snapshot writer leases and committed changes,
and complete process/watcher cleanup. Chromium 153/Linux passes under restrictive
CSP with cross-origin isolation; the source hashes and exact guest identity are in
`test/fixtures/workspace-browser-evidence.json`. This qualifies the SDK binding,
not a full editor application or actual shell integration.
