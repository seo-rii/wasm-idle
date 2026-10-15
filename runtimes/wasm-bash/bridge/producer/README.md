# Optional real-Bash exec shim producer

This opt-in experiment links [the lossless `execve.c` encoder](../execve.c) and
a separate [startup cwd initializer](../startup_cwd.c) into the same pinned
upstream GNU Bash parser/evaluator as the existing producer.
It does not change `scripts/prepare-runtime.mjs`, the original expected hashes,
the playground assets or its Wasmer SDK. Neither a successful source preparation
nor an import verifier result establishes a supported shell backend.

The patched SDK library and external snapshot example have passed a real Rust
typecheck, as recorded by the preceding source-bridge change. A built SDK binary,
real guest exec/wait and common Supervisor fd/filesystem bindings remain separate
gates. The original producer built a real Bash Wasm/WEBc candidate. The startup
cwd addition requires a fresh producer build and actual browser qualification;
the historical receipts below do not cover that addition.

## Startup cwd compatibility

The pinned WASIX libc has two cwd states. Its `getcwd()` reads the host's actual
cwd, but relative `open()` calls use a legacy `__wasilibc_cwd` initialized to
`/`. Its `chdir()` updates both. Actual Chromium comparisons with the unchanged
Bash/SDK observed `/workspace` from the host cwd syscall while relative shell
redirects were absent from the mounted `Directory`. An absolute
`/workspace/binary` redirect and an explicit initial `cd /workspace` each wrote
the exact nine binary fixture bytes into that same mount. A parent shell builtin
relative redirect reproduced the failure, so a pipeline fork alone cannot
explain it. These comparisons identify this selected libc's startup boundary;
they do not qualify the common Container filesystem.

The new fixed-source constructor calls `getcwd(NULL, 0)`, `chdir()` with that
actual path and `free()` before Bash's `main`. It reads no environment variable
and changes no script or argument. The pinned CRT initializes TLS and invokes
constructors before `main`; its preopen constructor runs at priority 51, before
this initializer's priority 65,535. On getcwd/chdir failure the initializer emits
a fixed stderr diagnostic and exits 125 before the shell runs. Partial diagnostic
writes are drained; a closed or zero-progress stderr stops diagnostic output
and still fails, rather than hanging. The cwd allocation is freed after either
successful or failed `chdir`.

[startup-cwd.lock.json](startup-cwd.lock.json) independently pins this C source,
the exact extracted libc/CRT bytes, constructor priorities and failure status.
`build.mjs` pins that complete manifest digest. The original `inputs.lock.json`,
`verify.mjs`, exec encoder and archived build receipts remain unchanged so the
historical reader continues to verify the original candidate. A new receipt
records both manifests, `startupCwdObject`, its source and the second link object;
the source-materials pack includes the initializer, manifest and native fixture.
The current source/native checks verify constructor ordering, argv preservation,
error cleanup and bounded failure output. They do not run WASIX or Bash.

This is a port for the selected Bash producer. It does not automatically repair
other WASIX command binaries, replace dirfd/path semantics or implement the
trusted Supervisor command registry, common live fd/VFS or shell MVP.

## Archived real build and read-only verification

The original build ran at application commit
`74abe3922c5a248b57ef0cb2d38d2d9a86fa1fc5` on 2026-10-14 and finished with
`built-imports-verified-not-runtime-qualified`. The unchanged original
[build receipt](evidence.bash-build.json) preserves all 13 commands, their successful
exit codes, exact source/input identities and the module inventory. The unchanged
[process receipt](evidence.bash-build-process.json) records exit 0, 587.243 seconds
of wall time and complete descendant cleanup. Upstream `make shell` took 489.288
seconds in that run. These are measurements from one local build.

The archive was prepared from later application commit
`f5844b5212621a949318638ec7263faba2c1f3dd`, recorded as
`archiveBaseApplicationCommit` in the [recheck receipt](evidence.bash-build-recheck.json).
That source includes the CLI symlink fix and pinned G0 allowlist test added after
the build. The build receipt's `producerFiles` retains the original producer
hashes; the archive base is not the source commit of the built candidate. The
verifier and input lock remained byte-identical, and the recheck verified the
original producer files against the tested commit and source-materials directory.

All five complete input archives and all five artifact hashes were checked again
locally. The actual 1,811,021-byte Wasm passed full module validation and the
current verifier: 50 imports, 15 exports, exactly one
`wasm_idle_shell_v1.exec_v1` with seven i32 parameters and one i32 result, and one
shared wasm32 memory with initial 133 and maximum 65,536 pages. The 1,812,328-byte
WEBc is packaging evidence; the 10,442,324-byte source-materials archive is still
marked `completeReleaseSourcePack: false`. Binary files and archives remain
outside Git. Neither these receipts nor the recheck executes a guest;
`runtimeQualified` stays false.

The reader verifies the pinned original receipt bytes, current source dependencies
and lock without requiring the external artifacts. Supply both external paths to
also hash the original inputs/artifacts and validate the actual Wasm inventory:

```sh
node runtimes/wasm-bash/bridge/producer/verify-evidence.mjs

node --disable-wasm-trap-handler --wasm-num-compilation-tasks=1 \
  runtimes/wasm-bash/bridge/producer/verify-evidence.mjs \
  --artifact-root /private/original-bash-build \
  --input-cache /private/inputs
```

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
and upstream configure/Asyncify recipe. The `execve.o` and `startup_cwd.o`
objects are compiled separately for the WASIX wasm32 target with shared-memory
features. A generated compiler wrapper adds both objects to link invocations
before the original arguments; it
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
node --test runtimes/wasm-bash/bridge/producer/startup-cwd.test.mjs
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
both locks, startup initializer/native fixture, generated compiler
wrapper/configuration and recorded build commands.
It is a reviewable source-materials bundle, not a claim that all corresponding
sources/notices for linked WASIX libc and runtime libraries are release-qualified.
That license/source inventory remains a release gate.

Next run the actual patched SDK with this candidate and real external Wasm
commands. Preserve empty, LF/CR and Korean arguments, explicit empty/replaced
environment, real child cwd, nonzero exit and tail exec. Then establish live
shared fd/pipe/filesystem ownership and foreground cancellation with complete
descendant cleanup. A successful local build/import inspection cannot replace
those browser fixtures or qualify the first Clang/BusyBox shell scenario.
