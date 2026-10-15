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
