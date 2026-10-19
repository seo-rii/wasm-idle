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
gates. Both the original producer and the startup cwd variant have built real
Bash Wasm/WEBc candidates. Their distinct receipts below cover build/import
inspection; actual browser qualification is recorded separately.

The rebuilt SDK resolver on [#196](https://github.com/seo-rii/wasm-idle/pull/196)
and this Bash variant pass all 18 selected actual Chromium observations on
[#199](https://github.com/seo-rii/wasm-idle/pull/199). Those results cover native
WASIX Directory/stdio only; common Container ownership and shell MVP remain open.

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

The startup cwd variant was built offline from application commit
`7d15375967ed557e724488e82bab75cb5c4b41cb` on 2026-10-15. Its unchanged
[build receipt](evidence.startup-cwd-build.json) records all 14 successful
commands and the separate 708-byte startup object with SHA-256
`653f5b867e93d0a1a9059e2a60bf479d3e531ff6a0308d25bc9cc71cb4699a7a`.
The [process receipt](evidence.startup-cwd-process.json) records exit 0,
129.466 seconds and complete descendant cleanup with no cleanup errors or
termination signals. `make shell` took 110.262 seconds in this local run.
These observations do not establish clean/cold build performance or a speedup
over the earlier build.

The [recheck receipt](evidence.startup-cwd-recheck.json) preserves the original
build/process digests, all 29 supervisor source/input/tool pins, complete input
archive identities and all 25 source-materials file identities. The actual
extracted libc and CRT match `startup-cwd.lock.json`. The pack includes the
startup source, manifest and native fixture; the second link object has its own
artifact identity. The 1,811,371-byte Wasm validates with the same 50 imports, 15 exports,
seven-i32 exec signature and shared memory profile described below. Its SHA-256
is `2728fc7856c5fc4d78da1ad239421b4198fe4f0a78e8d7ae4b244898d8cf770c`.
The 1,812,678-byte WEBc has SHA-256
`045fe12ba2ae1b417c9413f85ac21a7370d9a8ee13a9de9bebaf4682e81e17c4`.
The 10,447,539-byte source-materials archive remains
`completeReleaseSourcePack: false`. No binary or archive is committed to Git.

Verify this variant's pinned receipts and current executable source dependencies
without external artifacts, or supply both paths to recheck complete inputs,
both objects, artifacts, actual CRT/libc and the full Wasm inventory:

```sh
node runtimes/wasm-bash/bridge/producer/verify-startup-cwd-evidence.mjs

node --disable-wasm-trap-handler --wasm-num-compilation-tasks=1 \
  runtimes/wasm-bash/bridge/producer/verify-startup-cwd-evidence.mjs \
  --artifact-root /private/startup-cwd-bash-build \
  --input-cache /private/inputs
```

These readers never execute a guest. `runtimeQualified` remains false in the
producer receipts, and common Container fd/VFS, command dispatch, foreground
cancellation and the Clang/BusyBox shell scenario remain independent gates.

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

## Opt-in primary Readline workspace control

The WASI Readline input-gathering and queued-input checks omit exception sets: the pinned
WASIX libc rejects any nonempty exception set with `ENOSYS` before polling input.
The read descriptor and existing keyboard timeout remain in place, so terminal
input and bounded idle callbacks both keep working. A native pipe fixture checks
ready input, the idle timeout, and subsequent input using both actual patched calls.

`--readline-control` additionally applies `readline-control.patch` to the exact
pinned `bashline.c`; both the original and patched file identities are verified
before compilation. Ordinary builds leave Bash sources unchanged. The resulting
candidate enables the hook only when `WASM_IDLE_SHELL_CONTROL=1` at Readline
initialization and the running shell defines a readonly `__wasm_idle_poll`
function. The application supplies that fixed function through Bash's standard
`BASH_FUNC___wasm_idle_poll%%` environment-function import. In this opt-in profile
only, initialization makes that exact imported function readonly and clears its
export attribute, so commands do not inherit the host control body. Functions
without Bash's imported attribute remain unchanged; an ordinary rcfile may still
define the fixed function as readonly. There is no environment bootstrap eval or
special parser for the function body.

The callback runs at real primary Readline idle boundaries. It defers while a
foreground command, `read -e`, heredoc, secondary prompt, search, completion,
macro, or incomplete key sequence is active. It never writes command text to
stdin. The shared implementation of Bash's existing `bind -x` execution keeps
the parser state, previous exit status and `PIPESTATUS`, editing buffer, cursor,
and mark. The callback also restores the previous signal status and `$_`.
Alias expansion is disabled only for the fixed readonly function invocation.
The new internal `SEVAL_IGNORE_RETURN` flag applies Bash's actual
`CMD_IGNORE_RETURN` conditional context to that invocation, so an intentional
`124` cannot activate a user's `set -e` or `ERR` trap. Existing eval/bind callers
retain their original behavior.

The function returns `0` for an unchanged state or `124` after a transition that
requires a redraw. On `124`, Bash decodes the current `PS1` again and redraws the
preserved editing line. The function must not read terminal input, replace the
editing variables, execute an unbounded command, or print terminal output.
Mailbox handling, allowed cwd targets, and actual `builtin cd` belong to the
trusted function and application. This cooperative hook is not an isolation
boundary against arbitrary shell code. A language switch during a foreground
command or continuation remains queued until a genuine primary prompt boundary.

```sh
node runtimes/wasm-bash/bridge/producer/build.mjs \
  --cache /private/inputs --output /private/new-control-build --jobs 1 --webc \
  --readline-control
node --test runtimes/wasm-bash/bridge/producer/readline-control.test.mjs
```

The native unit fixture exercises only the idle-boundary gate. Set
`WASM_IDLE_BASH_SOURCE_ARCHIVE` to a local pinned Bash archive to also exercise
exact patch application. Neither fixture qualifies real Readline or browser
behavior: primary/partial input, foreground input, continuation, cwd changes,
exit status, and subsequent commands require actual guest/browser fixtures.
The receipt and source-materials pack include the additional patch, input lock,
and unit fixture whenever this profile is selected. No SDK or Rust build changes.

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
