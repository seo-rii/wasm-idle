# Container commands

The container runs the selected upstream BusyBox applets as a real WASI binary.
[`commands.mjs`](../runtimes/wasm-busybox/commands.mjs) is the shared inventory for
the producer applet-list check, distribution commands and Bash external routes.
`busybox --list` lists the compiled applets; `busybox <applet> ...` invokes one
directly. The distribution also exposes each applet to `container.run()`.

Bash handles `echo`, `printf`, `pwd`, `true` and `false` through its builtins.
The remaining applets and the `busybox` multicall entry are external commands
under `/usr/local/bin`, backed by the common container filesystem and stdio.

## Stage 1: navigation and byte streams

| Commands | Purpose and supported starting point |
| --- | --- |
| `ls`, `rmdir` | List directory entries, including `ls -1 -a -A -d`, and remove empty directories |
| `head`, `tail`, `wc`, `tee` | Select initial/final lines or bytes, count input, and copy a stream to files and stdout |
| `sort`, `uniq`, `cut`, `tr` | Sort, remove adjacent duplicate lines, select fields/bytes, and translate/delete bytes |
| `basename`, `dirname` | Manipulate path strings |
| `readlink`, `realpath` | Inspect symbolic links and resolve paths inside the container filesystem |
| `cat`, `cp`, `grep`, `mkdir`, `mv`, `rm` | Existing file output, file copy, search, directory creation, rename and removal |
| `echo`, `printf`, `pwd`, `true`, `false` | Existing BusyBox applets; also available as Bash builtins |

These commands operate on raw byte streams. `tail -f` is outside the profile:
file watching requires a separate live-wait contract. Stage 1 rejects long
directory metadata, timestamp changes and recursive copy; later stages enable
the supported forms below. Ownership, host identity and Unix permission
mutation are not modeled by these commands.

For example, these commands can inspect a workspace and process a text stream:

```sh
ls -a /workspace
printf 'beta\nalpha\nalpha\n' | sort | uniq | tee /workspace/names.txt
head -n 1 /workspace/names.txt
wc -l /workspace/names.txt
```

## Staged additions

The registry and binary expand cumulatively with each stage. All four stages
below are implemented in the current 40-applet profile.

| Stage | Commands and changes |
| --- | --- |
| 2: text, search and file tools | `sed`, `find`, `diff`, `cmp`, recursive `cp -r/-R`, symbolic-link creation with `ln -s`, `sha256sum`, `base64`, `od`, `hexdump` |
| 3: filesystem metadata | `touch`, `stat`, `ls -l`, backed by explicit timestamp and metadata support |
| 4: archives | `tar`, `gzip`, `gunzip`, `unzip` |

Subprocess launch (`find -exec`, `xargs`, `env COMMAND`), PTY/full-screen tools,
hard links, ownership/permission changes and networking remain separate work.
Each stage must update the real producer configuration and binary, validate its
behavior, then regenerate the pinned distribution; adding a route alone does not
provide an applet.

## Stage 1 qualification

The exact 486,866-byte upstream BusyBox Wasm (SHA-256 `939faca10df3f30f96092eb0539c804702112aaa43e6dd0ca3b9ef958d23842d`) passes 106 new native/WASI invocation checks plus the retained B0/B1 gates. All 424 real container invocations pass across Node and Chromium, batch and live, with 22 additional readonly, quota, lifecycle and pipeline checks. Chromium was 153.0.8010.12. Full producer, verification and container receipts are in `runtimes/wasm-busybox/evidence/commands-stage1-*.json`.

## Stage 2 development tools

Adds `sed`, query-only `find`, `diff`, `cmp`, `ln -s`, `sha256sum`, `base64`, `od` and `hexdump`, plus content-tree `cp -r/-R`. Existing B1 recursive-copy rejection cases are replaced by positive recursive-copy tests. `sed -i`, hardlinks, find process/deletion actions and copy metadata preservation remain explicit errors. Base64 retains upstream garbage-skipping semantics and rejects truncated quartets. Binary dumps and stdin comparisons use real file streams rather than POSIX descriptor replacement or temporary-file emulation.

Stage 2 qualification: the 551,862-byte Wasm SHA-256 is `45e067aa95cb76b1c8dba19dcde9eb85736ba45486f19fe77c38030eaf1bccb8`. Native/WASI executes all 166 cumulative command cases successfully; Node/Chromium batch/live executes 664 cumulative command cases successfully. The original B0 and the updated 104-invocation B1 gates also pass. Complete receipts are retained under `runtimes/wasm-busybox/evidence/commands-stage2-*.json`.

## Stage 3 filesystem metadata

`touch`, `stat` and `ls -l/-n` use the virtual filesystem's stored mode, size,
type and independent access/modification timestamps. Touch supports creation,
`-c`, `-a`, `-m`, explicit dates and reference files through real WASI timestamp
operations. Timestamps have millisecond resolution, reads use noatime, and
snapshot commits, live workers, persistence and backups preserve these fields.
Old snapshots without access time default it to modification time.

This stage requires the workspace Container `virtual-metadata-v1` host. Website
preparation verifies that selection before generating assets, fingerprints its
entry points and profile, and bundles its actual workers. A legacy published
0.1.0 host cannot satisfy the new BusyBox metadata imports.

Numeric uid/gid 0 and link count 1 describe the virtual filesystem. Account names,
allocated blocks and physical device fields are unavailable and `stat` reports
them as `UNKNOWN`; `ls -s` fails explicitly. Creation modes remain host-owned,
with no chmod, chown or hardlink commands. `touch` dates rejected by pinned libc,
including pre-epoch/overflow values, fail before mutation. In live execution,
libc stat and the stored-mode lookup are separate observations, so a concurrent
rename can change the namespace between those operations.

```sh
touch -t 202001020304.05 /workspace/example.txt
stat -c '%s %a %X %Y' /workspace/example.txt
ls -ln /workspace/example.txt
```

Producer, container and actual Bash qualification receipts for this stage are
retained under `runtimes/wasm-busybox/evidence/commands-stage3-*.json`.

Stage 3 qualification: the 598,169-byte Wasm SHA-256 is `fc34cb5005690d5fc00f3df973014d3978d97c7ecfcbebdcaa6f7b81b9a793e9`. All 196 cumulative native/WASI command invocations and 784 Node/Chromium batch/live invocations pass, with the retained B0 and 104-invocation B1 gates. Focused host metadata, RPC, persistence and backup tests also pass.

## Stage 4 archives and compression

`tar` creates, lists and extracts regular files, directories and symbolic links.
`gzip`/`gunzip` use the upstream gzip codec for file or stream compression,
decompression and integrity checks. `unzip` reads stored/deflated ZIP data and
supported stored Unix symlinks. The codecs run inside the Wasm applet, with real
byte streams and filesystem operations.

Tar compression options `-z/-a` require a separate transformer profile and fail
explicitly. Compressed archives work through actual Bash pipelines:

```sh
tar -cf - source | gzip -c > bundle.tar.gz
mkdir unpacked
gunzip -c bundle.tar.gz | tar -xf - -C unpacked
gunzip -c bundle.tar.gz | tar -tf -
unzip -q bundle.zip -d zip-output
```

Creation modes remain host-owned. Tar restores supported timestamps and accepts
`-m` to omit that step. Directory timestamps are restored after child entries and
deferred symlinks; the last header wins for repeated directory names. Directory
creation errors return nonzero, including missing directories on readonly mounts
with `-m` and directory headers conflicting with existing regular files. Those conflicts preserve the
existing file bytes and timestamps. Permission/ownership restoration, hardlinks
and special file extraction are unsupported. Archive files and extracted files
require exclusive creation: conflicts return an error and retain existing file bytes.
Gzip/gunzip file overwrite `-f` and unzip `-n/-o/-K/-t` are explicit errors.
For gzip integrity checking, `gunzip -t` still decodes and checks the real stream
without producing output. Unzip checks CRC32 for both stored and deflated data,
including stored symlink targets. Corrupt input, readonly mounts and quota errors
return nonzero statuses. Extraction may have written partial bytes before a CRC
error is discovered.

Upstream tar/unzip strip unsafe absolute and parent prefixes from member names,
warning when names change. Extraction then rejects any remaining `..` components
and existing symlink parents. It is not transactional: an error may leave newly
created partial entries. Normal VFS capability checks and quotas continue to apply.

The cumulative command corpus covers both invocation forms and all four real
container profiles. Additional reproducible archive checks run against explicit
final artifacts:

```sh
node scripts/container-archive-qualification/test-archive-extra.mjs \
  --artifact /path/to/busybox.wasm --native /path/to/native/busybox \
  --work /new/archive-extra --output /new/archive-extra.json
node scripts/container-archive-qualification/test-archive-host.mjs \
  --artifact /path/to/busybox.wasm --source-root "$PWD" \
  --work /new/archive-host --output /new/archive-host.json
```

These downstream checks validate archive byte trees, unsupported options,
existing-file preservation, readonly and quota failures, and real timestamp
restoration. Full producer, container, archive and Bash receipts are retained
under `runtimes/wasm-busybox/evidence/commands-stage4-*.json`.

Stage 4 qualification: the 634,131-byte Wasm SHA-256 is `3170b30f9200ef58f38f7cfa54bb7fbf855065a4cc444a461d458c62510d19e9`. All 218 cumulative native/WASI invocations and 872 Node/Chromium batch/live invocations pass, plus 22 boundary/pipeline/lifecycle checks and the retained B0/B1 gates. Additional archive native/WASI and actual-host checks cover content, modes, timestamp restoration, readonly/quota failures and preservation of existing files.

## Review corrections

The reviewed profile retains the same 40 applets. `sort -o FILE` and
`uniq INPUT OUTPUT`, and their delegated stdout streams, now report buffered
write failures even when a later close succeeds. Actual full-quota regressions
exercise the 1,024-byte boundary and 1,025/8,193-byte payloads, with matching
successful-output controls.

Additional archive regressions cover directory creation failures, preservation
of existing file bytes and times, directory timestamps after children and
deferred symlinks, repeated directory headers, and stored ZIP CRC failures for
streams, files and symlinks. Native upstream differences are asserted and
recorded explicitly alongside the corrected WASI expectations.

The initial Stage 4 qualification above is historical. Review qualification
receipts are retained separately under
`runtimes/wasm-busybox/evidence/commands-review-fixes-*.json`.

The reviewed Wasm is 634,885 bytes, SHA-256
`30ea0ce3a36013b343dddc0045c72f490c468268c1a1fd2050fdc8702f97bd40`.
Its pinned producer and source-pack verification pass the retained B0 gates
(20 native and 24 WASI checks), 104 B1 invocations and 218 cumulative command
invocations. Independent archive qualification passes 120 native/WASI
invocations across 35 scenarios and 26 actual-host checks.

Node and Chromium batch/live qualification passes all 872 cumulative command
invocations and 166 boundary, archive, pipeline and lifecycle checks. Existing
readonly directories with `tar -m` remain successful no-ops with unchanged
metadata; missing-directory creation on the same kind of mount fails with EROFS.
The actual GNU Bash browser gate passes all 10 checks and 61 routed invocations.
All 70 owned workers terminate, and the final browser worker and process lists
are empty. These gates use the same receipt-pinned reviewed Wasm.
