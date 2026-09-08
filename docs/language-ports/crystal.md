# Crystal consumer handoff

This is the consumer counterpart to [wasm-llvm #3](https://github.com/seo-rii/wasm-llvm/pull/3).
The pinned Crystal 1.21.0 native compiler emits a WASI object for the real
standard-input fixture. This consumer probe links that object with a pinned
WASI libc and executes the program through the production WASM Worker in
Chromium, including its existing SharedArrayBuffer input transport.

`CRYSTAL` remains outside the language registry. Target execution does not
provide a browser-hosted source compiler. The producer's compiler self-host
probe fails at `Crystal::System::Process.prepare_args` in its WASI implementation.

On 2026-09-08, Chromium 149.0.7827.55 passed all eight consumer cases (four
inputs in two modes), and five receipt/linker/tampering tests passed. The complete
validation process exited 0. The linked target was 543,003 bytes with SHA-256
`a8c1ebadbb18b357dca6efd22a89d8187a5aea437c2356eabf5a6d355ee222e5`.

## Reproduce target execution

Produce `baseline.wasm` and its portability receipt using the producer PR. That
file is a relocatable object despite its extension. Then run:

```sh
node scripts/probe-crystal-wasi-consumer.mjs \
  --receipt /path/to/portability/receipt.json \
  --libc /path/to/swift-6.3.3-WASI.sdk/lib/wasm32-wasip1/libc.a \
  --wasm-ld /path/to/swift-6.3.3/usr/bin/wasm-ld \
  --chromium /path/to/chromium
```

The probe accepts producer commit `9b74e5c9ff67c505cadd272571abfeb127b5468e`,
source commit `57cf7da5094db6c5d3c058c6d054a757b5ced19e`, the pinned bootstrap archive
and the producer's standard-input fixture. It checks producer and fixture identities,
object bytes and hash, a version-2 Wasm linking section and the native/host gate
split. It reads the adjacent `baseline.wasm`, never an arbitrary path or command
printed by the compiler receipt.

Linking uses native LLD 21.0.0 from Swift LLVM revision
`82cdc19fa54d566969527b56f587ea8ea30bef51`. The WASI libc from
`swift-6.3.3-RELEASE_wasm` must be 1,040,606 bytes with SHA-256
`42d929e52aaeac6c4ed56946cd3e92e40574322bc43af529c19cfbf67893b352`.
The link command is constructed from verified inputs, uses a private output
directory and has a deadline. The probe copies the verified linker bytes to a
private executable before invoking them, so replacing either the caller's
symlink or its resolved target cannot change the executed program. It preserves
the original toolchain library path and `wasm-ld` argument zero. The local
linker executable identity and command are recorded. This is a native target-link
baseline, not in-browser linking.

For each input, a fresh Chromium Worker runs the existing production load,
prepare and execution phases. Both explicit stdin and the production shared
buffer transport are exercised:

| Input             | Expected stdout                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `10 20 30\n`      | `60\n`                                                                                         |
| `-5 6 7 8`        | `16\n`, with no final input newline                                                            |
| `1 2\nabc한xyz\n` | `abc한xyz\n3\n`; `한` begins at byte 7 and crosses the shared buffer's 8-byte payload boundary |
| empty             | `0\n`, at EOF                                                                                  |

The production generic WASM Worker combines stdout and stderr. The probe
requires exact combined output, readiness and successful completion, and limits
output and case duration. It does not claim separate stream delivery.

`--out <new-directory>` selects a local evidence directory; the default is
temporary. `crystal-consumer-receipt.json` binds producer receipt, source pin,
object, libc, linker and executable hashes to production Worker/bundle hashes,
browser version and all results. Existing receipts are never overwritten.
Browser source-compiler and language-registration gates remain false. These
local provenance checks are not a signed publisher trust anchor.

## Remaining compiler and consumer contract

The compiler needs real implementations for unavailable WASI process operations
and a compatible Wasm LLVM toolchain. No browser compiler artifact is available
yet. After that port, wasm-idle still needs source and standard-library files,
verified artifact loading, compiler and execution Worker ownership, diagnostics,
in-browser linking, delayed stdin/EOF, UTF-8, limits and cancellation coverage.
The same consumer API must compile original Crystal source and recover with a
fresh run after cancellation before a `CRYSTAL` catalog entry is appropriate.

This probe installs no compiler runtime, registers no language, and performs no
deployment. It gives the producer a concrete consumer execution contract while
that compiler port is incomplete.
