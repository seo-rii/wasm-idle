# Optional real-Bash exec shim producer

This opt-in experiment links [the lossless `execve.c` encoder](../execve.c) into
the same pinned upstream GNU Bash parser/evaluator as the existing producer.
It does not change `scripts/prepare-runtime.mjs`, the original expected hashes,
the playground assets or its Wasmer SDK. Neither a successful source preparation
nor an import verifier result establishes a supported shell backend.

The patched SDK library and external snapshot example have passed a real Rust
typecheck, as recorded by the preceding source-bridge change. A built SDK binary,
real guest exec/wait and common Supervisor fd/filesystem bindings remain separate
gates. This producer has not yet built or executed a Bash artifact.

## Pinned inputs and build boundary

[inputs.lock.json](inputs.lock.json) retains the exact five archive URLs/hashes
from the existing producer: Bash `fc8096485478055f4fcf31402004fdd8ff6b72b7`,
WASIX libc sysroot `v2024-07-08.1`, WASI SDK 20.0/LLVM 16.0.0, Binaryen 108 and
optional Wasmer CLI 7.2.0. `verify.mjs` pins the complete lock digest. The unchanged
original producer, C encoder, Rust decoder/import implementation, compile probe
and all five SDK/runtime patches are verified by their independent hashes before
reading cache inputs. Arbitrary URLs, compiler programs and JavaScript imports
cannot be provided as runtime metadata.

The script extracts complete verified archives into a new private output. It
uses the existing resource-directory/builtins setup, `make shell`, source epoch
and upstream configure/Asyncify recipe. The one addition is an `execve.o` compiled
for the WASIX wasm32 target with shared-memory features. A generated compiler
wrapper adds that object to link invocations before the original arguments; it
passes compilation, preprocessing, assembly and compiler metadata queries
through unchanged. It never interprets a Bash command, replaces upstream parsing
or returns fake syscall success. A Bash build that does not actually import
`wasm_idle_shell_v1.exec_v1` fails verification.

After upstream Asyncify/fpcast processing, Binaryen strips debug information as
in the original recipe. The verifier validates the entire Wasm module, requires
the exact seven-i32-to-i32 import, shared bounded wasm32 memory and the normal
start/Asyncify exports. Other imports must belong to the original Bash import
allowlist observed in the pinned G0 receipt. An unexpected new libc import is
an explicit producer failure requiring review, not an automatically accepted
host capability. The receipt records every import/export and executable hash.

## Run in a private supervised build slot

All commands below run from the repository root. Output/cache paths must be
absolute ASCII paths without shell/make metacharacters and outside this checkout.
The cache must be owned by the current user with mode `0700`; its parent must
already exist. No existing output directory is accepted. No data is deleted.

```sh
# Read-only input/source validation and recipe planning; no network or tools.
node runtimes/wasm-bash/bridge/producer/build.mjs --plan --webc --jobs 1

# Explicitly prefetch the exact missing inputs. No source extraction/build.
node runtimes/wasm-bash/bridge/producer/build.mjs \
  --cache /private/inputs --download --fetch-only --webc

# Offline build from those verified inputs into a fresh directory.
node runtimes/wasm-bash/bridge/producer/build.mjs \
  --cache /private/inputs --output /private/new-bash-build --jobs 1 --webc

# Producer guard and argv/ABI unit checks; these do not qualify Bash execution.
node --test runtimes/wasm-bash/bridge/producer/build.test.mjs
```

Omit `--webc` to build only the raw Wasm candidate using four archives. `--download`
may accompany a build but is never implied by a missing input. Downloads are
bounded at 512 MiB per complete archive and may follow only approved HTTPS GitHub
release/codeload hosts. A matching complete digest is required before publication
in the named cache entry. Partial or mismatching files are retained under unique
diagnostic names; an existing mismatching cache entry is rejected and preserved.
There is no mutable `latest`, registry resolution or version substitution.

Reserve a sequential SDK/Bash build slot, initially one make job, with a private
disk budget on the order of 6 GiB and a separately enforced time/memory budget.
These are planning allowances, not measured Bash producer requirements; the
five archive size caps alone total 2.5 GiB. This script does not enforce an
aggregate process-tree memory limit or qualify build speed. Use the workspace's
bounded background supervisor, private log and exit-status file, and descendant
cleanup rather than running a lengthy producer in the foreground. No Rust build
is invoked here; the SDK requires its own unique physical Cargo target and
intermediate directories and must keep its original nightly/lockfile pins.

## Outputs and remaining acceptance

`build-receipt.json` records the input lock, local dependency hashes, native tool
version output, actual commands/exit codes, elapsed command times, object and
artifact hashes, module imports/exports/memory and source-materials identity.
After output allocation, a failed or cancelled command leaves a failure receipt
and all build data in place. A success says
`built-imports-verified-not-runtime-qualified`, with `runtimeQualified: false`.

The candidate directory contains `bash-exec-shim.wasm`, the verified GNU Bash
license and optional `bash-exec-shim.webc`. It is separate from every original
`dist` or browser asset and is never automatically mounted, published or deployed.
`source-materials.tar.gz` includes the complete original Bash source archive,
GNU COPYING, the C/Rust bridge sources, five runtime patches, exact producer and
lock, generated compiler wrapper/configuration and recorded build commands.
It is a reviewable source-materials bundle, not a claim that all corresponding
sources/notices for linked WASIX libc and runtime libraries are release-qualified.
That license/source inventory remains a release gate.

Next run the actual patched SDK with this candidate and real external Wasm
commands. Preserve empty, LF/CR and Korean arguments, explicit empty/replaced
environment, real child cwd, nonzero exit and tail exec. Then establish live
shared fd/pipe/filesystem ownership and foreground cancellation with complete
descendant cleanup. A successful local build/import inspection cannot replace
those browser fixtures or qualify the first Clang/BusyBox shell scenario.
