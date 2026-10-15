# Memory filesystem contract

`MemoryFileSystem` is a synchronous, in-memory POSIX-shaped namespace. It does not
read the host filesystem or persist user data. `/workspace`, `/tmp`, and
`/home/user` are separate writable mounts; the root and package trees are readonly.
The defaults bound the entire namespace, including readonly bytes and retained
unlinked files, to 64 MiB and 16,384 inodes. Hosts can set `maxBytes` and `maxInodes`.

Paths are well-formed UTF-8 strings with `/` separators. A backslash is an ordinary
filename character. NUL, empty paths, paths over 4096 UTF-8 bytes, and paths over
128 components fail with `EINVAL`. Relative host paths default to `/workspace`.
`{cwd, root}` selects a real working directory and directory capability. Absolute
paths must name that capability's canonical subtree. Traversal applies `..` after
symlinks, rejects capability escape with `EACCES`, and follows at most 40 links.
`lstat`, `readlink`, rename and unlink do not follow the final symlink.

Directory entries reference inodes. Rename in a mount preserves the inode;
cross-mount rename returns `EXDEV`. Unlink removes a name while existing file
descriptors continue to reference the data. Those retained bytes and inodes still
count against quota. Directory descriptors can report their current path after
rename; an unlinked directory cannot resolve new paths. Mount roots cannot move.

`open` returns an integer descriptor starting at 3. Options select read/write,
create/exclusive, truncate, append or directory access. `dup` shares the open
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
checks, devices, sockets and arbitrary byte-string paths are unsupported. Execute
mode metadata alone does not dispatch a command or implement shell access checks.
Timestamps reflect in-memory modifications and are not persisted timestamps.
Filesystem string errors are translated separately by each guest ABI adapter.

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
the host generation once. Snapshots carry unique positive safe-integer inode IDs
and a monotonic `nextInode` allocation mark. Restore preserves them, and commit
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
