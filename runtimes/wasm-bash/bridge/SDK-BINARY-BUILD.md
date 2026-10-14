# Experimental SDK Wasm build gate

`scripts/prepare-container-shell-sdk-binary.py` prepares a single offline build of
the already type-checked private SDK/WASIX sources. Preparation creates a frozen
recipe and copies the bounded process owner and static Wasm inspector; it does
not install tools, fetch, build Rust, invoke wasm-pack/npm, or run a guest.
Only `--launch` starts the persistent background attempt. `--check` verifies the
prepared recipe and current resource admission without launching it.

This work unit has not built or qualified the modified SDK. The passing SDK/lib
and external snapshot-example type check is a prerequisite, not guest evidence.
The runtime hook still defaults to `None`; no JavaScript command registry,
common filesystem/fd routing, or supported shell adapter is provided here.

## Pinned inputs and preserved producer settings

Supply the successful type-check process receipt and the source policy with
independently known SHA-256 values. The policy contains the complete prepared
SDK/WASIX source inventory, both locks and the actual private nightly executables.
Every input hash and the exact source-file inventories are rechecked before
preparation, launch and after each build stage. Failed checks, force-cleaned
successful checks, unlisted source files and changed inputs are rejected.

| Input                         | Required identity                                                                                                                       |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Investigated SDK npm artifact | `@wasmer/sdk@0.10.0`, recorded source revision `93b8b738ebd3ee57e118da0f0eb795b97d5b999e`                                               |
| SDK source archive            | 2,888,858 bytes, SHA-256 `ca5df306ffcb260fb3086e89d450aafac106e200ccf7b49bb03c348bc2208712`                                             |
| WASIX crate archive           | `wasmer-wasix@0.601.0`, 2,831,166 bytes, SHA-256 `a9a804fcfbdbbfe5b2d6fb30e741e22a21e88e964dedfea9e609f13a52823bfe`                     |
| SDK crate / CLI ABI           | `wasm-bindgen` exactly `0.2.101`; matching externally supplied CLI version **and** expected executable SHA-256                          |
| Rust                          | `nightly-2025-07-05`, private toolchain home, `rust-src`                                                                                |
| Target                        | `wasm32-unknown-unknown`; original `+atomics,+bulk-memory`, `--no-check-features`, `web_sys_unstable_apis`, build-std `std,panic_abort` |

The archived SDK source `package.json` identifies itself as 0.8.0; this is
preserved and is not substituted for the investigated npm artifact's identity.
The existing source-preparation receipt records the five patches and compile
probe hashes. The output source archive contains that receipt and **all**
prepared SDK/WASIX source files, including the SDK MIT license. Its digest is
recorded alongside both executable forms and the generated glue. Full notices
and corresponding sources for every linked dependency remain a distribution
gate; this source archive does not claim to satisfy them on its own.

The default `--profile release` preserves the SDK's `lto=true`, `opt-level='z'`
profile, original lock, source configuration and target features. The optional
`--profile dev` uses `CARGO_PROFILE_DEV_DEBUG=0` and is separately identified;
it does not qualify the release profile. No extra `wasm-opt` pass is applied.
Raw Cargo Wasm and bindgen-transformed Wasm are retained as separate identities.
Matching bindgen runs with `--target web --weak-refs` and release
`--no-demangle`, preserving the source's disabled name demangling/debug-glue/DWARF
settings. In the exact 0.2.101 CLI source, `--weak-refs` is a deprecated compatibility
flag and weak-reference support is detected at runtime; it does not independently
prove a browser feature. The inspector uses
`WebAssembly.Module` only for static compile/import/export inspection and checks
the pinned one-memory, shared wasm32 profile with an explicit maximum. It never
instantiates or executes the module or supplies host imports.

Static Node inspection passes `--disable-wasm-trap-handler` and
`--wasm-num-compilation-tasks=1` so the engine does not require the trap handler's
large virtual-address reservation under the process address-space cap. These
are host inspection settings; they do not patch the Wasm or change its profile.
The bounded tests compile a small shared-memory Wasm module under the same
12 GiB address-space cap with those settings before any SDK build is launched.

## Tool provisioning is a separate, explicit step

The preparation helper never obtains the CLI itself. A bounded, separately
receipted `cargo install wasm-bindgen-cli --version '=0.2.101' --locked -j 1`
can provision it into a private `--root` and unique native `--target-dir` using
the private nightly. That step may fetch its locked dependencies and must
finish before its binary digest/version are injected here. Preserve its source
crate/lock/tool receipts; a prebuilt binary's self-computed digest alone is not
a supply-chain trust decision. Do not install globally, update the SDK lock,
change the default toolchain, or let wasm-pack implicitly fetch a replacement.

## Prepare and launch

After explicitly provisioning and recording the CLI, from the repository root:

```sh
python3 scripts/prepare-container-shell-sdk-binary.py \
  --source-policy /private/passing-typecheck/policy.json \
  --source-policy-sha256 "$container_sdk_policy_sha256" \
  --typecheck-receipt /private/passing-typecheck/sdk-check.process.json \
  --typecheck-receipt-sha256 "$container_sdk_check_sha256" \
  --bindgen /private/bindgen/tools/bin/wasm-bindgen \
  --bindgen-sha256 "$container_bindgen_sha256" \
  --node /pinned/node/bin/node \
  --node-sha256 "$container_node_sha256" \
  --output /private/new-sdk-binary-attempt \
  --profile release

python3 scripts/prepare-container-shell-sdk-binary.py \
  --check /private/new-sdk-binary-attempt
python3 scripts/prepare-container-shell-sdk-binary.py \
  --launch /private/new-sdk-binary-attempt
```

The output directory must be new. By default both Cargo target and intermediate
outputs are private to this attempt. `--reuse-checked-target` explicitly reuses
only the target recorded by the independently pinned successful check of
**this same physical SDK source copy**; it never selects another worktree's
target. Intermediate outputs remain private to the new attempt. No target,
cache, source copy or existing log is deleted or replaced.

The staged Cargo command uses the actual source-policy-pinned nightly executable:

```text
<private-nightly>/bin/cargo build --locked --offline \
  --target wasm32-unknown-unknown --lib -j 1 --release
<pinned-bindgen> --target web --weak-refs --out-dir <attempt>/artifacts/web \
  --out-name wasmer_js <attempt>/artifacts/raw/wasmer_js.wasm --no-demangle
```

Admission requires 8 GiB available memory and 8 GiB free disk. Cargo has a
3,600-second outer wall deadline, bindgen 600 seconds and inspection 120 seconds.
The process owner enforces a 3,000/3,060-second CPU soft/hard limit and 12 GiB
address-space limit **per child process**, and stops at 2 GiB remaining disk.
These are initial admission/control settings, not measured SDK requirements or
an aggregate RSS bound. One Cargo job is used; stages are sequential. Sampled
RSS may count shared pages more than once and is labeled accordingly.

Logs are unique private files under `~/logs` (or `--log-directory`). The launcher
prints the persistent supervisor PID, log and `final.status` paths; it records
them in `supervisor.json`. Check `phase.json` while running and read bounded log
excerpts only after completion. SIGTERM/SIGHUP/SIGINT wake the supervisor's
polling loop; its subreaper cleans and reaps owned descendants, including
detached children, and records cleanup in each stage's process receipt. A zero
exit leaving live descendants is rejected. A completed successful build has
`final.status` 0 and `receipt.json` with `complete: true`, verified input hashes,
artifact hashes and static inventory. `guestQualified` remains false.

Process discovery enumerates the `children` file of every Linux task, recursively,
so a child spawned by a Cargo worker thread is included. A real thread-spawn
regression verifies observation, kill and reap; the fixture fails against the
earlier main-thread-only traversal. Task exit races are tolerated and PID/start
ticks are rechecked before signaling.

Cleanup requires the supervisor to remain alive through its bounded cleanup
loop. If the supervisor itself is killed or runs out of memory, its final
receipt may be absent; inspect its owned process generations separately.

Previously sealed attempts keep their original process-owner bytes. Their
sampled process/RSS observations may omit children created by worker threads;
an `allReaped` result from that older traversal does not independently qualify
that boundary. Do not edit the running recipe or upgrade historical evidence
to the corrected owner. After an older attempt exits, inspect every owned task's
descendants and record any supplementary cleanup separately before using its
output or starting another build.

## Remaining gates

Generated web glue is not the complete npm module graph. The SDK's original
index/worker packaging must be prepared as a separately pinned local build,
with the real thread-worker assets and caller-supplied verified module/memory.
This helper does not run the Rollup/unpkg entries, npm install, or inject remote
JavaScript. It does not replace the current SDK/Bash distribution.

After local packaging, the next gates are the real Bash private exec-shim
build, registered external-command dispatch, actual argv/env/cwd/exit and
fd/VFS behavior, descendant-worker ownership and browser acceptance. The
Clang-to-BusyBox workspace/pipeline fixture remains mandatory for shell MVP.

Bounded guard tests, which do not build or qualify the SDK:

```sh
python3 scripts/test_prepare_container_shell_sdk_binary.py
```
