# Selected-target header regression

This is CLI-03's bounded compile corpus for the command-container profile. A
successful receipt requires real pinned Clang in a Worker, the unchanged complete
selected-target sysroot, a Wasm object for every case, and compiler-produced
dependency files containing each case's required public headers. Merely mounting
2,168 files does not pass this gate.

The 14 cases preserve the existing producer corpus from
[`wasm-llvm@25ef7345`](https://github.com/seo-rii/wasm-llvm/tree/25ef7345eba86fce0352e7eb0a881e23ed0e684f):

| Corpus | Modes | Cases | Provenance |
| --- | --- | ---: | --- |
| C `stdio` probe | `gnu17` | 1 | `producer/clang-browser/scripts/sysroot-pruning.mjs`, `SYSROOT_C_PROBE` |
| C++ aggregate/extension probe | `gnu++98`, `gnu++03`, `gnu++11`, `gnu++14`, `gnu++17`, `gnu++20`, `gnu++23`, `gnu++26` | 8 | Same file, `SYSROOT_CPP_PROBE` |
| Public C families | `gnu11` | 1 | `test/clang-sysroot-pruning.test.mjs`, `publicCProbe` |
| Public C++ families | `gnu++20`, `gnu++23`, `gnu++26` | 3 | Same test, `publicCppProbe` |
| Clang resource headers | `gnu11` | 1 | New `stddef.h`/`stdint.h`/`stdatomic.h` fixture |

`corpus.json` copies the first four source programs without editing their text
and records both source-text SHA-256 and origin-file SHA-256 at the producer
revision. The additional resource-header case is marked separately. The producer
probe's legacy branch exercises 19 public C++ headers; its modern branch uses
the existing GNU aggregate and compatibility-extension headers. The public
family cases cover C complex/fenv/inttypes/tgmath/threads/uchar and C++
any/bit/charconv/chrono/complex/filesystem/forward_list/fstream/memory_resource/
random/ranges/regex/span/valarray. `gnu++26` describes the pinned compiler's draft
mode, not final-standard conformance.

The selected producer installs its aggregate compatibility headers at
`include/bits/stdc++.h` and `include/bits/extc++.h`, while its `ext/rope` and
`ext/pb_ds` headers live under `include/c++/v1/ext`. Required dependency paths use
those actual canonical locations from the pinned sysroot. The aggregate bytes
match `GCC_COMPATIBILITY_HEADERS` in the baseline producer's
`producer/clang-browser/scripts/gcc-compat.mjs`: `stdc++.h` is 754 bytes with
SHA-256 `67497db6594bfbb7c4b1e5d86f034e94073aa1504f7f28d7c943728922d80423`,
and `extc++.h` is 323 bytes with SHA-256
`e8e13f8051b1c07228c0385a77cc95553ef0ce5e59b8eea7a35d1528adff9b49`.
These paths describe the existing files; the fixture does not move, duplicate,
alias or rewrite headers. Compiler dependency evidence and header byte checks
still apply to every required family in every original case.
Before starting any compiler case, the runner checks that every required path
is readable as a file in the actual mounted tree. This metadata preflight does
not replace the later compiler dependency and byte-identity checks.

The runner passes `-fno-exceptions` explicitly for every C++ case. The selected
sysroot is the existing no-exception WASI profile; the adapter does not add or
remove flags. Every command uses `--target=wasm32-wasi`, the pinned sysroot and
Clang resource tree, `-c`, and `-MD`. Output and dependency files live in the
common workspace. Header search uses the real driver's defaults for those two
roots; the fixture does not inject `-I` or reorder system includes. libc++'s
C-header wrappers must precede WASI C headers.
Each case records argv, cwd, status, raw compiler diagnostics,
source/object/dependency hashes and actual header paths. The final receipt lists
the observed header union with byte identities and verifies that those bytes
remain unchanged. The full sysroot is mounted read-only and is never pruned to
that observed union.

This corpus qualifies these concrete compile-only cases. It does not establish
every header combination, runtime support for every included family, C++
exceptions, threads, a new standard's complete implementation, or a shell. Linking
and artifact execution remain in the separate real C/C++ CLI acceptance fixture.

Run from the repository after installing its existing development dependencies:

```sh
node packages/container/scripts/test-clang-headers.mjs --build-only
node packages/container/scripts/test-clang-browser.mjs --build-only --headers

# Set all inputs to independently reviewed local producer bytes and receipt pins.
export CONTAINER_PRODUCER_RECEIPT=/path/to/build-receipt.json
export CONTAINER_PRODUCER_RECEIPT_SHA256=<reviewed-build-receipt-sha256>
export CONTAINER_PRODUCER_SMOKE=/path/to/cli-receipt.json
export CONTAINER_PRODUCER_SMOKE_SHA256=<reviewed-cli-receipt-sha256>
export CONTAINER_CLANG_WASM=/path/to/clang.wasm.gz
export CONTAINER_LLD_WASM=/path/to/lld.wasm.gz
export CONTAINER_SYSROOT=/path/to/sysroot.tar

CONTAINER_EVIDENCE=/new/path/node-receipt.json \
  node packages/container/scripts/test-clang-headers.mjs
CONTAINER_EVIDENCE=/new/path/chromium-receipt.json \
  node packages/container/scripts/test-clang-browser.mjs --headers
```

Receipts use exclusive creation and must have distinct new paths. Missing
binaries, mismatched pins or failed cases fail the command. `--build-only` only
checks bundling and reports `not-run`; it is not compiler evidence. The Node
fixture bundles this checkout's sources directly and never executes another
worktree's `dist`. The Chromium fixture uses the existing restrictive CSP and
isolated localhost server, executes the full corpus once, then reloads and runs
only `--version` to check verified body-cache reuse. It does not claim a second
complete warm corpus run. Commands run sequentially, with the configured
per-command timeout, and each Worker must be reclaimed before the next command.

The original [Node Worker receipt](node-evidence.json) and
[Chromium receipt](chromium-evidence.json) both pass all 14 cases at source commit
`b8edc146c4ba26905c9a0639726f24407825b3a3`. Their SHA-256 values are respectively
`c69fa7bc702ba653e98e9919307de54cbbf120817181799cf7241d19f4a1329e`
and `c2c5de32cc85f53eb5dc051f599714e178ca8f0111593a0ae4083a159e3c4d6f`.
The corpus digest is
`f8c5a9360642a7fd676ba10edbc8ac5a07fea9c4f9d75698b6aad32d7769bee2`.
Both runs read the same 1,050 headers; every recorded byte identity matches the
original complete pinned sysroot tar. All 68 recorded Node source hashes and
67 Chromium source hashes match the tested checkout.

Node starts 14 Workers and Chromium 153.0.8010.12/Linux x64 starts 16 (version
plus 14 cold cases, then only version after reload). All Workers and process
entries are reclaimed. Chromium reports no CSP/browser faults and no additional
asset body downloads on reload; boot requests zero bodies and cold execution
requests each of Clang, LLD and the full sysroot once. The independent
[Node supervision record](node-process-evidence.json) and
[Chromium supervision record](chromium-process-evidence.json) both report exit 0
and all owned OS descendants reaped. These receipts keep the tested source
identity when later evidence or documentation commits are added.

The earlier include-order and expected GNU-path failures remain separate failed
attempts. The passing receipts qualify these concrete compile cases; they do not
qualify every included family's linked runtime behavior or exhaustive header
combinations.
