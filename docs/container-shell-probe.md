# Real shell feasibility probe (C-02)

This is an executable G0 experiment, not a supported container shell. The selected SDK can
execute real WASI children from real Bash, but the shell backend qualification fails. See
[ADR-002](adr/ADR-002-shell-backend.md) for the decision and remaining porting work.

## Reproduce

Use the repository's installed `playwright-core`, a cached Chromium build, and a host Clang
capable of the `wasm32` freestanding target. The helper programs use no libc or downloaded
toolchain. The harness compiles their C source into a temporary directory, verifies the
existing Bash assets, serves only its explicit fixture files from a loopback HTTP server,
and removes temporary binaries on exit.

```sh
node --test scripts/probe-container-shell.test.mjs
node scripts/probe-container-shell.mjs
```

The second command collects observations and returns zero when it produced a report. Use
`--require-shell-gate` to require qualification; it currently exits 1 and retains the report.
Missing Clang experiments are `not-run`, never passing evidence.

```sh
WASM_IDLE_CONTAINER_CLANG_GZIP="$PWD/static/clang/bin/clang.wasm.gz" \
  WASM_IDLE_CONTAINER_PROBE_OUTPUT=/tmp/container-shell-probe.json \
  node scripts/probe-container-shell.mjs --require-shell-gate
```

For a sparse worktree, set `WASM_IDLE_CONTAINER_BASH_ASSETS` to the existing read-only
`static/wasm-bash` directory. This avoids copying or rebuilding large artifacts.
`WASM_IDLE_CONTAINER_FIXTURE_CLANG` and `WASM_IDLE_CHROMIUM_EXECUTABLE` select explicit local
executables. `WASM_IDLE_CONTAINER_PROBE_CASES` can select comma-separated experiment IDs;
omitted cases remain unqualified. The optional repository browser-cookie helper applies
`WASM_IDLE_TEST_BYPASS_COOKIE` through the cookie jar without logging it.

For long local runs, follow the workspace's restricted background-log/status-file convention.
The report output contains only fixed synthetic test source/arguments, no user workspace,
stdin or environment. The harness closes every browser context, including cases where an
SDK descendant survived the measured cleanup gate.

## Evidence

The checked-in [Chromium receipt](../packages/container/test/g0-shell/evidence.chromium.json)
records the application base commit, harness/source hashes, compiler/browser/OS identity,
logical and delivery asset hashes, import inventory, byte arrays, exit status, gate results,
Worker retirement and request paths. The
[early selective-run receipt](../packages/container/test/g0-shell/evidence.selective.chromium.json)
includes the fixture's real object output as bytes. It predates final harness fingerprinting
and is retained as a diagnostic observation, not qualification evidence. The complete rerun
has unstable exit and completion results: an [earlier exit observation](../packages/container/test/g0-shell/evidence.exit.chromium.json)
of 23 becomes 0, and the previously successful Clang `-c` times out. The observations are
retained to avoid reporting a one-off success as support.
The receipt identifies uncommitted harness source through its content hashes; it does not
pretend that the application base commit already included the new harness.

The initial environment is Chromium 153.0.8010.12 on Linux, cross-origin isolated using
COOP/COEP headers, with a fresh context per case and `Cache-Control: no-store`. It is an
exploratory result, not a release browser/OS image qualification or a cache benchmark.

| Input               | Pinned identity                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Bash source         | `fc8096485478055f4fcf31402004fdd8ff6b72b7` / `wasmer/bash@1.0.25`                            |
| Bash WEBc           | SHA-256 `73e34672254faf20f54fa0e7f8ffa8a6117017e8779aaa75c80682c00e6d8468`                   |
| SDK                 | `@wasmer/sdk@0.10.0`, repository lock's JavaScript/Wasm digests                              |
| Optional real Clang | 35,658,969 bytes, SHA-256 `d92ef06cdd3fea88acf384db15a6f2a344790c05bcba8e9f13f5b75b36ad4a99` |

The Clang source is `int f(void) { return 1; }`, so its absolute-path link experiment requires
no C library or sysroot headers. Its subprocess diagnostic therefore identifies a driver
boundary, not a missing standard library. The harness preserves the arguments and does not
parse `clang -###`, invent linker commands, or substitute a high-level compiler wrapper.

## Experiments and gates

| ID                                       | Actual operation                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `G0-SHELL`                               | Bash invokes a Preview 1 guest with spaces, Korean and an empty argument; guest reports arguments/environment and raw stderr.                                                                          |
| `G0-EXIT`                                | The child calls `proc_exit(23)`; Bash observes `$?`.                                                                                                                                                   |
| `G0-CWD`                                 | Bash changes directory; a separate Wasm guest calls actual WASIX `getcwd`.                                                                                                                             |
| `G0-TAIL-EXEC`                           | A script ends with an external command, without a trailing builtin to bypass the observed wait problem.                                                                                                |
| `G0-FD`                                  | Binary input passes through two child processes, redirect, reopen and stdout; host directory visibility is checked separately.                                                                         |
| `G0-FS`                                  | Shell creates a relative file in a subdirectory; the child opens it through Preview 1 and creates another file; shell and host read it.                                                                |
| `G0-BRIDGE-IMPORT`                       | A real module attempts `container.dispatch`; missing host integration is recorded, not mocked.                                                                                                         |
| `G0-CANCEL-CPU/READ`                     | Wait for the child to emit `ready`, then terminate its runtime group while looping or blocked on stdin.                                                                                                |
| `G0-CANCEL-DOWNLOAD`                     | Abort a deliberately unfinished response for the pinned Bash package; verify the server request closes and another group starts.                                                                       |
| `G0-CLANG-VERSION/RELATIVE/COMPILE/LINK` | Execute the real producer binary with original argv; distinguish relative-path failure, successful absolute `-c`, and failed subprocess linking. Execute the linked function if linking ever succeeds. |

The report compares bytes, exit codes and actual filesystem results. A printed expected
string or exit zero alone cannot qualify an experiment. Unit tests exercise that report
classification only; they are not substitutes for browser execution.

This C-02 fixture does not implement BusyBox, a Supervisor exec callback, live container VFS,
interactive terminal/job control, independent process cancellation inside a surviving shell,
command-lazy compiler downloads, a persistent workspace or production origin/CSP qualification.
Those remain separate gates in the development plan.
