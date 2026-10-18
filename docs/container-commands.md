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
file watching requires a separate live-wait contract. Long directory metadata
(`ls -l`), timestamp changes and recursive copy are introduced in later stages.
The existing copy profile rejects metadata-preserving and recursive options
before changing the destination. Ownership, host identity and Unix permission
mutation are not modeled by these commands.

For example, these commands can inspect a workspace and process a text stream:

```sh
ls -a /workspace
printf 'beta\nalpha\nalpha\n' | sort | uniq | tee /workspace/names.txt
head -n 1 /workspace/names.txt
wc -l /workspace/names.txt
```

## Pending stages

The following stages are planned additions and are not advertised by the stage 1
registry or binary.

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
