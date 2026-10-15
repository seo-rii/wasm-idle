# Shell acceptance script

The final SDK with patches 0001–0020 passes **72/72 checks across seven actual
Chromium scenarios** through the public session and shared workbench profile:
[full receipt](./evidence/public-session-0020.json) and
[process cleanup](./evidence/public-session-0020-process.json). Cold/warm execution,
foreground interruption, package/compiler failures, pipelines, redirections and
startup failures are included. Every scenario retires all owned Workers; the warm
run reuses all retained asset bodies. Total guarded time was 103.064 seconds on the
recorded machine. This qualifies the selected snapshot-Clang shell profile, not
PTY/job-control, live compiler visibility, or a production release.

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

One owner Worker uses the public `createWasixShellSession` and the same trusted
`examples/container/bash-profile.mjs` as the product workbench. It holds the statically
imported patched SDK, one container Supervisor and one filesystem:

- Bash's `/workspace`, `/tmp` and `/home/user` are separate capabilities on the
  container VFS through `Directory.fromHostFileSystem`.
- `/usr/local/bin` holds readonly virtual executable metadata with no readable body. Each path is
  registered with `Runtime.registerHostCommand` and routed by `createHostCommandHandler`:
    - `mkdir`, `grep`, `cat` (and `cp`, `mv`, `rm`) are BusyBox B1 package commands on the
      live adapter, with the shell child's descriptors delegated.
    - `clang` defaults to the real snapshot adapter with forwarded output. The explicit
      live application profile uses the fixed live adapter and delegates stdio.
- `/workspace` is also registered with `registerHostCommandDirectory`. Bash's exec of
  `./hello.wasm` therefore runs the artifact as `wasm-run` on the live artifact adapter
  instead of natively inside the Bash runtime. Direct dispatch requires executable
  VFS metadata. The Clang adapter grants it only to successfully changed outputs
  that qualify as bounded process-profile Wasm modules, never by filename alone.
  `wasm-run` provides an explicit entry for a data file containing supported Wasm.

Bash does its own parsing, lookup, fork/exec, pipe, redirections and waits. The public
session uses raw stdin and `waitForExit()`; the test drains stdout and stderr concurrently
under one 8 MiB capture bound. Its owned worker group and filesystem bindings are disposed
before it reports completion. After the parent requests cleanup, the fixture owner
acknowledges the awaited cleanup and closes its own dedicated realm; the parent
also requests native termination. The CDP gate still requires every owner and
nested Worker target to disappear before the next scenario. There is no
shell parser, command-string interception or stdout protocol in JavaScript.

## Distribution profile

The pinned distribution has three packages:

- `shell`: the SDK Wasm and Bash WEBc, fetched and verified only on shell startup. The
  actual Bash executable is separately checked against its immutable digest. The
  statically imported SDK JavaScript and nested-worker module remain trusted app code.
  The fixed SDK module URL is preserved as an external static import; inlining the
  module would change its verified worker/bootstrap URL contract.

- `busybox`: the B1 artifact and producer receipt qualified in `runtimes/wasm-busybox`.
- `llvm`: Clang and LLD from the producer gates used by the Clang browser qualification
  (`CLANG.md`), and the process-profile sysroot from
  [wasm-llvm#34](https://github.com/seo-rii/wasm-llvm/pull/34). That sysroot is the full
  selected-target sysroot with the `initial_cwd` constructor linked into `crt1.o`; every
  other entry is byte-identical. Without it, `hello.wasm` would start with libc's default
  cwd `/`, and the live adapter correctly refuses to run such a module in
  `/workspace/demo`.

Commands resolve from metadata only. BusyBox/LLVM bodies are fetched when their first
command is dispatched. SDK and Bash assets use the same verified cache policy.
The distribution identity covers the command, mount, asset URL and package policy;
the separately supplied manifest digest remains the trust root.

The producer's Clang artifact is an LLVM multicall executable. The distribution
mounts those actual bytes at `/opt/toolchains/llvm/bin/llvm`, declares that full
path as `argv0`, and prepends the `clang` subcommand. The real driver's canonical
self-invocation therefore remains `[llvm, clang, -cc1, ...]`; naming the multicall
binary `clang` would make its own dispatch consume that argv differently.
`compilerPaths` allows only this canonical LLVM executable for the driver's own
`-cc1`/`-cc1as` subprocess. Its original argv reaches the same pinned bytes without
host argument rewriting. The shell's `/usr/local/bin/clang` remains a separate
virtual dispatch entry and requires no compiler body before first use.

After the multicall subcommand, `prefixArgs` carries the target profile before the
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
| clang-multicall-profile | the command names the actual LLVM executable and retains its `clang` subcommand and target profile |
| busybox-lazy / clang-lazy (cold) | each body is fetched once, after its first command's dispatch |
| verified-cache-reuse (warm) | no asset body request at all |
| sysroot-closure | 2,285 entries, 2,168 files |
| virtual-command-metadata / executable-artifact | readonly command markers and executable metadata on the qualified artifact |
| public-api / sdk-group-retired | public session used, group disposed, created and terminated worker counts match |
| browser-errors / owned-workers-retired | no browser errors or remaining dedicated Workers |

`shellBackendReady` and `commonContainerFdVfsQualified` stay false. Passing this script
does not qualify descriptors beyond stdio, job control, signals, PTY behavior, or
Clang reading the shell's stdin. The separate interrupt scenario qualifies the
explicit owner cancellation it actually exercises.

## Running

Build nothing first: the probe bundles the container, Core and LLVM tool-host sources with
esbuild. `--check` validates every pin and the bundles without launching Chromium.

```sh
node scripts/probe-container-shell-acceptance.mjs --check /absolute/config.json
node scripts/probe-container-shell-acceptance.mjs --run /absolute/config.json
node scripts/probe-container-shell-acceptance.mjs --run-syntax /absolute/config.json
```

`--run-syntax` runs only the SH-02/SH-03 syntax scenario below, with a 60-second
scenario deadline and 30-second command deadlines. It reads and verifies the
same local input pins, but never executes Clang or downloads compiler/sysroot
bodies in the browser. Its receipt reports `scenario: "syntax-only"` and the
independent `shellSyntaxPassed` flag; `shellAcceptancePassed` stays false. The
default `--run` now includes this scenario after the seven existing ones.

The configuration names absolute paths and independently reviewed digests:
`packageReceipt`/`packageReceiptSha256`, `bashWebc`, `busyboxReceipt`/`busyboxReceiptSha256`,
`busyboxWasm`, `clangProducerReceipt`/`clangProducerReceiptSha256`,
`clangProducerSmoke`/`clangProducerSmokeSha256`, `clangWasm`, `lldWasm`, `sysroot` (the
pinned input it was derived from), `processSysrootReceipt`/`processSysrootReceiptSha256`,
`processSysroot`,
optional `chromium`, and a fresh `output` directory outside the checkout.
`clangFilesystem` is omitted or `"snapshot"` for the existing eight-scenario gate.
An explicit `"live"` selects the separate live gate; other values fail.

For a failed startup, `sdkDiagnostics: true` records bounded SDK logs and actual
host filesystem operations in the private receipt. The optional diagnostic-only
`sdkDiagnosticsOmitTmp: true` isolates the SDK's default `/tmp` collision; every
such receipt fails the required mount-profile gate even if its scripts pass.
It does not alter the public session's mounts. The compiler and shell traces are
fixture data; this logging is absent from the product owner.

## Live compiler filesystem and stdin

```sh
node scripts/probe-container-shell-acceptance.mjs --run-live /absolute/live-config.json
```

This requires `"clangFilesystem": "live"`. The fixed adapter ID
`llvm-clang-tool-host-live-v1` changes the manifest/distribution identity and selects
the live compiler Worker. The default snapshot manifest remains unchanged.

Cold and warm runs execute the plan's unchanged compile/link/artifact/BusyBox
script. A third run executes a real Bash producer→Clang `-E -P -x c -`→BusyBox
pipeline. Bash holds its producer open on `read` while the owner waits for a real
running Clang process, edits `live.h`, and runs a concurrent real BusyBox `cat`.
The utility must read the edited bytes while Clang is still running. Only then
does the owner release Bash's input, allowing Clang to preprocess the new header.
The pipeline file and final stdout must contain identical bytes. A following
`clang --version 0<&-` preserves the shell's closed stdin and output redirections.
Preprocessing preserves the complete driver profile and its exact stderr: the
target warning followed by the unused linker-memory and linker-path warnings.
The compile/link runs still require only the original target warning. The gate
does not filter either phase's diagnostics or drop driver arguments.

This receipt reports `scenario: "live-only"` and its independent
`liveShellAcceptancePassed`/`liveCompilerFilesystemQualified` flags. It does not
reuse interrupted snapshot-output expectations or set the complete snapshot
`shellAcceptancePassed` flag. Live writes are not rolled back on cancellation.
The mode is a trusted application choice, never a remote JavaScript import.

## Quoting, exported environment and shell syntax

The standalone scenario passes **12/12 checks** in actual Chromium with the same
0001–0020 SDK: [receipt](./evidence/syntax-0020.json),
[process cleanup](./evidence/syntax-0020-process.json) and
[execution/source pins](./evidence/syntax-0020-metadata.json). Guarded time was
19.952 seconds; all 16 SDK Workers retired and no compiler, linker or sysroot body
was downloaded. This additional result preserves the earlier seven-scenario
72/72 receipt unchanged.

The syntax scenario uses the public session, real GNU Bash and the pinned BusyBox
`mkdir`, `cp`, `cat` and `grep` commands. It adds the coverage missing from the
earlier seven scenarios:

- Single/double quoting preserves spaces, Korean UTF-8 and an empty `grep` pattern
  in actual external-command argv; quoted file names remain in the common VFS.
- `export CONTAINER_SYNTAX_VALUE='value with spaces 한글'` reaches each later
  external-command invocation unchanged. The owner records only that fixed
  fixture key, never arbitrary environment entries. Each invocation also has
  the actual cwd `/workspace/syntax 한글`, and relative BusyBox file access works.
- `&&` and `||` follow real `grep` statuses 0 and 1, including a skipped success
  branch and a selected fallback. Supervisor statuses and file bytes are checked.
- `$(cat 'input file')` captures the real command's output, strips its final
  newline and preserves its embedded newline inside double quotes.
- `<`, truncating `>`, and `>>` preserve exact input/file bytes. A group containing
  real `cat` followed by a stderr write distinguishes `>merged.out 2>&1` from
  `2>&1 >split.out`: only the latter leaves that stderr write on the original
  stdout. The test checks both files and both captured streams.

Twelve actual BusyBox dispatches must produce their expected argv, cwd and exit
statuses. The scenario additionally requires zero compiler body requests, no
prepared sysroot, no browser errors, and full process/Worker cleanup. Judge unit
tests mutate these observations to show that a matching final success marker
alone cannot qualify the run. They do not replace the actual Chromium evidence.
This covers these named Bash constructs only; no shebang, PTY or general POSIX
conformance claim is added.

## Interrupt run

A third run in the same profile checks owner-initiated cancellation with a surviving shell.
The owner calls the session's `interrupt()` once the foreground command is actually running:

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

The first interrupt stops the running artifact one second after it starts. The second stops
the second Clang compile 50 ms after the snapshot adapter reports it running: the adapter
reports running only once its Worker is ready, and the compile itself then takes about a
second, so a later interrupt can race its completion.
Bash must print `spin=130`, `clang=130`, `discarded` and `hello`, the Supervisor records
must be 0, 0, 130, 130, 0, 0, each interrupt must land between its command's dispatch and
completion, the interrupted compile's output must not reach the workspace, and every
process and Worker must retire.

## Failure run

A fourth run uses its own cache namespace and a distribution whose BusyBox asset URL
serves the pinned bytes with one byte flipped; the manifest keeps the pinned digest:

```sh
set -u
mkdir -p /workspace/demo; printf 'mkdir=%d\n' "$?"
mkdir -p /workspace/demo; printf 'retry=%d\n' "$?"
cd /workspace
printf 'int main(void){' > bad.c
clang bad.c -o bad.wasm; printf 'bad=%d\n' "$?"
if [ -e bad.wasm ]; then echo artifact; else echo no-artifact; fi
nosuch-command; printf 'missing=%d\n' "$?"
printf '#include <stdio.h>\nint main(void){puts("hello");return 0;}\n' > main.c
clang main.c -o hello.wasm && ./hello.wasm
```

It must print `mkdir=126`, `retry=126`, `bad=1`, `no-artifact`, `missing=127` and `hello`:

- Each integrity failure is one `mkdir: …` diagnostic and a Supervisor record with
  `startError: INTEGRITY`.
- The retry fetches the corrupt body again; a failed body is never cached, and the real
  body is never substituted.
- The compile error keeps Clang's own diagnostics (`bad.c:1:…: error:`) and status 1, and
  leaves no artifact.
- Bash reports the missing command itself (127) without a dispatch.
- The Clang package is unaffected, so the last line compiles and runs.

## Pipeline run

A fifth run checks the descriptor juggling Bash does for a brace group or subshell in a
pipeline, where descriptor 1 is the pipe:

```sh
set -u
cd /workspace
printf 'top\n' >&2
{ printf 'group\n' >&2; } | cat
{ printf 'file\n' > group-file; } | cat
IFS= read -r g < group-file; printf 'file=%s\n' "$g"
( printf 'sub\n' > sub-file ) | cat
IFS= read -r s < sub-file; printf 'sub=%s\n' "$s"
{ printf 'kept\n'; printf 'aside\n' >&2; } 2> err-file | grep kept
```

stdout must be `file=file`, `sub=sub` and `kept`, stderr exactly `top` and `group`, the
three files must hold their bytes in the container VFS, and the BusyBox `cat`, `cat`, `cat`
and `grep` processes must exit 0. Before bridge patch 0014, each of these redirections
failed with `Invalid argument`.

`PIPESTATUS` and `pipefail` are not checked: the pinned Bash is built without job control
(`nojobs.c`), which records no per-command pipeline statuses. That is a property of the
Bash build, not of WASIX.

## Compiler redirection and command metadata

The sixth run uses real Bash `command -v`, `test -f` and `test -x` for the readonly
Clang command, then compiles with `>compile.out 2>compile.err`. It invokes
`clang --version` with stderr append and checks a failing compile's diagnostics in
`failed.err`. These retain the shell's open descriptions across the snapshot lease;
the compiler's normal failure must commit its diagnostic files without leaving an
artifact or silently replacing the parent's descriptors.

The successfully linked program runs directly. A byte-for-byte copy produced by
`cat` is a data file: direct dispatch returns 126, while explicit `wasm-run` executes
the same supported bytes. Reading the virtual Clang entry through BusyBox `cat`
must fail without emitting a fabricated executable body. This qualifies dispatch
policy and these actual lookup checks; it does not claim complete POSIX mode,
chmod, signal or PTY semantics.

The final run asks the real SDK to start with an absent initial cwd. Its environment
setup fails before Bash executes. The public session must settle with a null code
and `runtime-error`, preserve empty output, dispatch no command and retire all
owned Workers. Converting this host failure into ordinary guest exit 1 fails the
gate. This independently exercises the corrected SDK exit contract.

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

| [`interrupt-run-1`](evidence/interrupt-run-1.json) | `6251c8b7` | **Interrupt run passes all 8 checks**; cold passes; warm stops right after Clang completes |
| [`interrupt-run-2`](evidence/interrupt-run-2.json) | `46522577` | With the service SDK: **38/38**, cold, warm and interrupt |
| [`interrupt-run-3`](evidence/interrupt-run-3.json), [`-4`](evidence/interrupt-run-4.json) | `46522577` | Cold and warm pass; the second interrupt arrived 1 ms before the compile completed with 0, so Bash printed `clang=0` and kept the output |
| [`interrupt-run-5` … `-7`](evidence/) | `5c55b7b7` | **All three pass 38/38**, cold, warm and interrupt, with the 50 ms compile interrupt |
| [`failure-run-1` … `-3`](evidence/) | `d7ae6f8c` | With the failure run: **47/47, 47/47**, and 46/47 where only the owner Worker outlived the five-second retirement window |

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
