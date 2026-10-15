# Shell acceptance script

This opt-in Chromium probe runs the development plan's acceptance script, unchanged, in
actual GNU Bash (`bash --noprofile --norc -c`):

```sh
set -eu
mkdir -p /workspace/demo
cd /workspace/demo
printf '#include <stdio.h>\nint main(void){puts("hello");return 0;}\n' > main.c
clang main.c -o hello.wasm
./hello.wasm | grep hello > result.txt
cat result.txt
```

One owner Worker holds the patched SDK, one container Supervisor and one filesystem:

- Bash's `/workspace` is the container VFS through `Directory.fromHostFileSystem`.
- `/usr/local/bin` holds placeholder files for Bash's PATH search only. Each path is
  registered with `Runtime.registerHostCommand` and routed by `createHostCommandHandler`:
    - `mkdir`, `grep`, `cat` (and `cp`, `mv`, `rm`) are BusyBox B1 package commands on the
      live adapter, with the shell child's descriptors delegated.
    - `clang` is the real Clang on its snapshot adapter with forwarded output.
- `/workspace` is also registered with `registerHostCommandDirectory`. Bash's exec of
  `./hello.wasm` therefore runs the artifact as `wasm-run` on the live artifact adapter
  instead of natively inside the Bash runtime.

Bash does its own parsing, lookup, fork/exec, pipe, redirections and waits. There is no
shell parser, command-string interception or stdout protocol in JavaScript.

## Distribution profile

The pinned distribution has two packages:

- `busybox`: the B1 artifact and producer receipt qualified in `runtimes/wasm-busybox`.
- `llvm`: Clang and LLD from the producer gates used by the Clang browser qualification
  (`CLANG.md`), and the process-profile sysroot from
  [wasm-llvm#34](https://github.com/seo-rii/wasm-llvm/pull/34). That sysroot is the full
  selected-target sysroot with the `initial_cwd` constructor linked into `crt1.o`; every
  other entry is byte-identical. Without it, `hello.wasm` would start with libc's default
  cwd `/`, and the live adapter correctly refuses to run such a module in
  `/workspace/demo`.

Both are resolved from metadata only. A package's bodies are fetched when its first
command is dispatched.

The distribution's `clang` command carries the target profile as `prefixArgs`, before the
user's arguments: `--target=wasm32-wasi`, the pinned linker, `--sysroot`, `-resource-dir`
and a maximum artifact memory. A shipped toolchain would record these in a Clang
configuration file. The pinned Clang 22 deprecates its own `wasm32-wasi` triple and prints
one warning per driver run, even without `--target`. The selected sysroot is laid out for
`wasm32-wasi` only, so the profile cannot switch to `wasm32-wasip1`. The script's stderr is
therefore exactly that one warning line, forwarded from the real compiler. The sysroot is a
verified tar file in the `llvm` package. As in the Clang browser fixture, the
owner extracts it into a readonly mount, but only on the first `clang` dispatch.

## Acceptance

The probe runs the script twice in one browser profile:

1. **cold**: an empty cache;
2. **warm**: a new owner Worker, container and package manager.

Asset responses are `no-store`, so the warm run can reuse a body only from the verified
persistent cache. Each run requires:

| Check | Required observation |
| --- | --- |
| script | exit 0, stdout exactly `hello\n`, stderr exactly the one Clang triple warning |
| workspace-files | `main.c` holds the printf bytes and `result.txt` holds `hello\n` in the container VFS |
| artifact | `hello.wasm` exists in the container VFS and starts with the Wasm magic |
| dispatch-order | mkdir, clang, the pipeline (artifact and grep, in either order), cat |
| shared-cwd | mkdir in `/workspace`; every later command in `/workspace/demo` |
| supervisor-exits | five Supervisor records with pids, each exiting 0 |
| artifact-in-supervisor | `/workspace/demo/hello.wasm` ran as a Supervisor process |
| processes-retired | no container process after Bash exits |
| metadata-only-lookup | commands resolve before any asset is cached |
| busybox-lazy / clang-lazy (cold) | each body is fetched once, after its first command's dispatch |
| verified-cache-reuse (warm) | no asset body request at all |
| sysroot-closure | 2,285 entries, 2,168 files |
| public-api / browser-errors / owned-workers-retired | as in the other shell probes |

`shellBackendReady` and `commonContainerFdVfsQualified` stay false. Passing this script
does not qualify descriptors beyond stdio, cancellation of a running shell command, job
control, signals, PTY behavior, or Clang reading the shell's stdin.

## Running

Build nothing first: the probe bundles the container, Core and LLVM tool-host sources with
esbuild. `--check` validates every pin and the bundles without launching Chromium.

```sh
node scripts/probe-container-shell-acceptance.mjs --check /absolute/config.json
node scripts/probe-container-shell-acceptance.mjs --run /absolute/config.json
```

The configuration names absolute paths and independently reviewed digests:
`packageReceipt`/`packageReceiptSha256`, `bashWebc`, `busyboxReceipt`/`busyboxReceiptSha256`,
`busyboxWasm`, `clangProducerReceipt`/`clangProducerReceiptSha256`,
`clangProducerSmoke`/`clangProducerSmokeSha256`, `clangWasm`, `lldWasm`, `sysroot` (the
pinned input it was derived from), `processSysrootReceipt`/`processSysrootReceiptSha256`,
`processSysroot`,
optional `chromium`, and a fresh `output` directory outside the checkout.

## Interrupt run

A third run in the same profile checks owner-initiated cancellation with a surviving shell.
The owner calls the handler's `interrupt()` once the foreground command is actually running:

```sh
set -u
mkdir -p /workspace/demo
cd /workspace/demo
printf 'int main(void){for(;;){}}\n' > spin.c
clang spin.c -o spin.wasm
./spin.wasm; printf 'spin=%d\n' "$?"
printf '#include <stdio.h>\nint main(void){puts("hello");return 0;}\n' > main.c
clang main.c -o interrupted.wasm; printf 'clang=%d\n' "$?"
if [ -e interrupted.wasm ]; then echo kept; else echo discarded; fi
clang main.c -o hello.wasm && ./hello.wasm
```

The first interrupt stops the running artifact; the second stops the second Clang compile.
Bash must print `spin=130`, `clang=130`, `discarded` and `hello`, the Supervisor records
must be 0, 0, 130, 130, 0, 0, each interrupt must land between its command's dispatch and
completion, the interrupted compile's output must not reach the workspace, and every
process and Worker must retire.

## Results

Every attempt's original browser and process receipts are archived under
[`evidence/`](evidence/).

| Attempt | Commit | Result |
| --- | --- | --- |
| [`distribution-id`](evidence/distribution-id.json) | `5717ae7b` | Failed before Bash: the distribution id joined two digests and exceeded the 128-byte bound |
| [`mkdir-root-einval`](evidence/mkdir-root-einval.json) | `a9a8cf3b` | BusyBox loaded lazily on `mkdir`; `mkdir -p /workspace/demo` failed because the VFS answered `mkdir("/")` with `EINVAL` |
| [`mkdir-workspace-erofs`](evidence/mkdir-workspace-erofs.json) | `7ccad493` | Then `mkdir("/workspace/")` gave `EROFS`: the read-only root was checked before existence |
| [`cold-timeout-warm-pass`](evidence/cold-timeout-warm-pass.json) | `97a8e329` | **Warm run passes the whole script**; cold run timed out during Clang |
| [`streamed-run-1`](evidence/streamed-run-1.json) | `04aac7e0` | **30/30: cold and warm pass** |
| [`streamed-run-2`](evidence/streamed-run-2.json), [`-3`](evidence/streamed-run-3.json) | `04aac7e0` | Warm passes; cold stops right after Clang completes with status 0 |
| [`service-run-1` … `service-run-5`](evidence/) | `1df732f1` | **All five pass 30/30, cold and warm**, with the SDK that keeps host-command WASIX work off the scheduler thread |

The two VFS defects are fixed in this branch: `mkdir` of the root, `.` or `..` and of an
existing entry under a read-only parent now report `EEXIST`, as on Linux.

In the passing runs, every check holds:

- stdout `hello\n` and only the one Clang triple warning on stderr;
- `main.c` and `result.txt` in the container VFS, and `hello.wasm` starting with the Wasm magic;
- five Supervisor processes with pids, all exiting 0, including
  `/workspace/demo/hello.wasm` run through the module directory route;
- BusyBox fetched once after the `mkdir` dispatch, and Clang, LLD and the sysroot fetched
  once after the `clang` dispatch;
- no asset body request at all in the warm run;
- every Worker retired.

The cold and warm script take 46 and 61 seconds in the passing run; nearly all of it is the
Clang command.

**The hang and its fix.** With the earlier SDK, three of four cold runs (and one warm run
of the interrupt attempt) stopped right after Clang's host command completed with status
0: the owner posted one more heartbeat and then nothing, `./hello.wasm` was never
dispatched, and the owner did not answer cleanup. A local diagnostic SDK that logs on
every thread captured the cycle:

- A Bash child resolving a path below the live `/workspace` held a directory inode's write
  lock while waiting for the owner to serve a `stat`.
- The owner was preparing the next host command's invocation, which needs the same lock.

The SDK change on the stacked SDK branch moves all host-command WASIX work to a dedicated
service thread. With it, five consecutive runs pass all 30 checks, cold and warm. The
whole script now takes 8–11 seconds per run instead of 39–61, because the owner no longer
stalls while Clang's output and completion are handled. Heartbeats still show the owner
busy for a few seconds around Clang (snapshot export, transfer and commit of the
toolchain-sized VFS), but never for more than one five-second interval.
