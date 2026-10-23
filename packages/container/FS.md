# Memory filesystem contract

`MemoryFileSystem` is a synchronous, in-memory POSIX-shaped namespace. It does not
read the host filesystem or persist user data. `/workspace`, `/tmp`, and
`/home/user` are separate writable mounts; the root and package trees are readonly.
The defaults bound the entire namespace, including readonly bytes and retained
unlinked files, to 64 MiB and 16,384 inodes. Hosts can set `maxBytes` and `maxInodes`.

Paths are well-formed UTF-8 strings with `/` separators. A backslash is an ordinary
filename character. NUL, empty paths, paths over 4096 UTF-8 bytes, and paths over
128 components fail with `EINVAL`. The same limits apply to the resulting canonical path
of every created or renamed entry, including the deepest descendant of a moved directory,
so each entry stays addressable and snapshot-representable. Relative host paths default to
`/workspace`.
`{cwd, root}` selects a real working directory and directory capability. Absolute
paths must name that capability's canonical subtree. Traversal applies `..` after
symlinks, rejects capability escape with `EACCES`, and follows at most 40 links.
A trailing slash in a path or followed symlink target requires a directory, including
through chained targets; a dangling directory-required target cannot create a regular
file. `lstat` and `readlink` do not follow an unadorned final symlink. A final slash
requires that link to resolve to a directory. Rename and unlink do not follow the
final symlink.

Directory entries reference inodes. Rename in a mount preserves the inode;
cross-mount rename returns `EXDEV`. Unlink removes a name while existing file
descriptors continue to reference the data. Those retained bytes and inodes still
count against quota. Directory descriptors can report their current path after
rename; an unlinked directory cannot resolve new paths. Mount roots cannot move.
Current-name lookup follows inode parent links in time proportional to path depth,
without enumerating unrelated directory entries. Rename updates those links;
snapshot restoration and readonly publication rebuild them without changing the
snapshot format. Descriptors still reject paths moved outside their original
directory capability, and recreating an unlinked name does not revive its old handle.

`open` returns an integer descriptor starting at 3. Options select read/write,
create/exclusive, truncate, append or directory access. `resize: true` separately
permits `ftruncate` on regular files without granting byte reads or writes. Read
access defaults to true only when neither write nor resize access was requested.
Resize access checks the regular file's readonly mount at open time; including
it in a directory open does not request byte-write access to that directory.
The `truncate` and `append` open options still require write access. `dup` shares the open
description and its offset. `pread` and `pwrite` use an explicit offset and never
change it; `pwrite` ignores append mode. `write` in append mode chooses EOF for
each nonempty write. Reads can be short and return empty bytes at EOF. Empty reads
and writes do not advance offsets. Writes are complete or fail before changing
file contents; there is no claim of regular-file partial writes. Seeking past EOF
does not allocate until a nonempty write. Truncate and file replacement check quota
before changing the original data. Each returned/read/accepted byte buffer is
copied so callers cannot mutate filesystem data behind its generation counter.

Mode bits are stored as metadata and default to 0644 for files and 0755 for
directories. Mount readonly policy, open access and directory capabilities are
enforced. Unix user/group ownership, chmod, hardlinks, permission-based access
checks, arbitrary devices, sockets and arbitrary byte-string paths are unsupported. Execute
mode metadata alone does not dispatch a command or implement shell access checks.
Timestamps are nonnegative integer milliseconds. `atimeMs`, `mtimeMs` and `ctimeMs`
survive snapshots and workspace persistence. Backups restore entry timestamps
while retaining the target `/workspace` mount root's metadata, as described in
[WORKSPACE.md](WORKSPACE.md). Older saved records without `atimeMs` initialize it
from `mtimeMs`. Reads use a noatime policy: they do not dirty the workspace or
change timestamps. Explicit `setTimes`/`fsetTimes` updates
atime and/or mtime without changing contents, inode identities, descriptor offsets
or byte/inode quota usage. An omitted field stays unchanged; `now` samples one
owner clock value for both fields. Any requested update sets ctime to that value,
advances the filesystem generation and invalidates file-version tokens, including
when the requested timestamp already equals its stored value. An all-omitted
update validates the target but changes no metadata. Writable mount policy and
snapshot writer leases apply to timestamp mutations, including directory/symlink
metadata; path updates follow the final symlink unless explicitly disabled.
Filesystem string errors are translated separately by each guest ABI adapter.

The built-in `/dev/null` is a character device with mode 0666 and reserved inode 0.
Its name remains in the readonly root namespace: it cannot be removed, renamed,
replaced or supplied by a package. Opening it still follows the caller's path
capability. Reads return EOF, writes discard their bytes, and seek/tell return zero.
These operations consume no workspace bytes and do not change file generations.
Open access flags and duplicate/closed descriptor lifetimes remain enforced.
`open` with truncate is accepted without changing the device; an explicit
`truncate`/`ftruncate` returns `EINVAL`. Other devices are not implemented by this VFS.

Snapshots preserve the device's type and identity and validate that inode 0 occurs
only at `/dev/null`. A guest snapshot cannot modify or remove the readonly device.
Historical full snapshots without it retain their historical namespace; persistent
workspaces instead rebuild the current readonly base and save only `/workspace`.
Reserving zero keeps all existing positive user inode identities unchanged on reload.
Workspace backups exclude `/dev` and never import device nodes. WASI reports the
character-device type; the optional WASIX SDK retains its own `/dev` implementation
unless the host explicitly mounts a supported common device filesystem there.

`applyFileChanges({ remove, write }, { cwd, root, createRoot })` publishes an editor batch
atomically. `write` entries contain `{ path, bytes }`; missing parent directories are
created, missing removals are ignored, and identical file contents are left alone.
Removals precede writes. Any path, mount, byte or inode quota error preserves the
original namespace, contents, metadata, version tokens and generation. Quotas include
open unlinked files. A successful changed batch emits one rescan and advances one
generation; an unchanged batch emits nothing. Snapshot writer leases still apply.
Staging copies inode/directory metadata, shares untouched file bodies, and copies
replacement bytes only. Optional `createRoot: true` creates the explicitly supplied
absolute capability root and its parents within the same transaction, including for
an empty project. Validation or write failures leave no newly created root behind.
Publication retains live descriptors and shared offsets; open files removed by the
batch remain available until their final descriptor closes.

`mountReadonly(path, entries)` accepts an explicit directory/file/symlink tree with
relative canonical entry paths. Directories must be present. It rejects duplicate
paths, file/directory conflicts, quota overflow, symlink loops and capability
escape, and publishes the entire tree only after validation. Existing mounts cannot
overlap. Mount publication rejects an active snapshot lease. Live descriptors may
remain open: additive publication preserves inode objects, shared offsets, and
retained unlinked data. Quotas include those unlinked bytes and nodes. Publication
is synchronous, so no guest sees a partially added dependency closure.
It validates the tree shape, not asset hashes; the package loader must verify bytes
before calling it.

`mountReadonlyPackages([{ path, entries }, ...])` stages a complete package
dependency closure and publishes all mounts in one filesystem generation. Quotas,
overlap, namespace shape and symlink boundaries apply to the whole staged tree.
If any package fails, no mount, parent directory, inode allocation or generation
change is published. An empty list is a no-op. `mountReadonly()` delegates to this
operation with one package. Identity-based repeated-mount policy belongs to the
supervisor; an already mounted path is still rejected by the filesystem API.

`mountCommands(path, names)` publishes explicit readonly virtual executable entries
for a trusted backend registry. `stat`/`readdir` expose regular-file metadata with mode
0555 and `command: true`; `open`/`readFile` reject `ENOTSUP` because no executable file
body exists. The registered backend owns actual dispatch. These entries are shared by
the shell and utility VFS, survive snapshots, and cannot be introduced on a writable
mount or changed by a guest snapshot. They are not placeholder Wasm or script files.

`acquireSnapshot()` obtains a global writer lease and returns a structured-clone
snapshot plus `commit(result)` and `discard()`. Acquire rejects live users and ordinary
open host descriptors; new descriptors and all mutations fail with `EBUSY` during the lease.
Read-only path queries remain available. A Worker can restore a private filesystem
with `MemoryFileSystem.fromSnapshot(snapshot)`, run a guest, then call
`exportSnapshot()` for its result. Regular guest exit, including nonzero exit, may
commit; runtime crash, cancellation and timeout must discard. The adapter makes
that exit-policy decision. This is snapshot visibility, not live filesystem access.

Hosts may explicitly open a description with `{ snapshot: 'preserve' }`, as the shell
filesystem does for redirection. Such handles do not block snapshot admission. Commit
rebinds them by inode identity, preserving access/append flags and shared `dup()` offsets;
reads see the previous revision until commit. Writes through those handles still fail
with `EBUSY` during the lease. The snapshot guest's captured output is published only
after commit or discard, so forwarding can write through the retained shell handles.

A commit that removes a still-open linked inode fails with `ECONFLICT` and leaves the
whole workspace and descriptions unchanged. Private snapshots do not carry the final
contents of unlinked inodes, so accepting that change could silently lose data. Closing
the last host handle before commit permits removal. Files already unlinked before the
lease remain readable through their preserved handles and count against byte/inode
quota; the snapshot cannot resurrect their identities. Crash/cancel discards private
changes and leaves the retained handles usable.

`acquireLive()` registers a live filesystem user and returns an idempotent
`release()`. Multiple live users and editor operations share completed VFS
operations immediately. An active snapshot rejects live acquisition with `EBUSY`.
A live user excludes snapshots even after closing all its current descriptors;
it may open more before exiting. The Supervisor releases this ownership only
after runtime cleanup. Already published live writes remain after crash or cancel.

Commit validates the entire candidate, verifies the generation and mount table,
and rejects changes to readonly entries or mount-root metadata before publishing.
On rejection the original namespace is intact and the lease remains held until
discard or a valid commit. Discard is idempotent. Successful publication increments
the host generation once. Snapshots carry unique positive safe-integer inode IDs,
plus reserved inode 0 for `/dev/null`, and a monotonic `nextInode` allocation mark.
Restore preserves them, and commit
matches identities rather than paths: renamed files/directories retain IDs, while
replacement paths receive new IDs. Deleted identities are never recycled, even
after a restore. Missing/duplicate IDs, a rewound allocation mark, reuse of retired
IDs and changes to an existing inode's type or mount fail validation. Readonly
mount input has no inode IDs; publication allocates those locally. Host handles stay
with the Supervisor; snapshots serialize the linked namespace only. Timestamps and generation
are memory observations, and neither export nor commit is a durable flush.

The `fs.test.mjs` suite covers FS-01 through FS-06 and the regular-file portions of
FD-01/02. It is deterministic VFS evidence; it does not qualify a real compiler,
WASI guest, BusyBox or shell adapter.

Trusted owner adapters can capture an opaque `FileVersion` with
`captureFileVersion(pathOrFd)`. It identifies one linked regular inode revision,
including same-byte writes, unlink and rename. Renaming an ancestor directory
invalidates descendant tokens even if the directory later moves back. Unrelated
file edits and additive readonly mounts preserve a token. Snapshot publication
invalidates prior tokens; revisions and tokens are not serialized or persisted.

`readFileVersion(token)` returns a private copy only while that precise revision
remains current. After validating that content, `grantExecutable(token)` atomically
checks it again and derives execute bits from the existing read bits on a writable
mount. Fabricated tokens and tokens from another filesystem fail. No guest syscall
or RPC exposes these owner operations; they do not add guest chmod support.
