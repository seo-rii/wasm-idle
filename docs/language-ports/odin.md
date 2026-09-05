# Odin consumer handoff

This PR is the consumer counterpart to [wasm-llvm #2](https://github.com/seo-rii/wasm-llvm/pull/2).
The producer builds a real WASI program with the pinned native Odin compiler.
The consumer probe executes that program through the existing production
`src/lib/playground/worker/wasm.ts` and its actual stdin transport in Chromium.

`ODIN` remains unavailable in the language registry. The compiler itself still
needs a browser host port, so this is target execution evidence and a consumer
acceptance contract, not an Odin source compiler registration.

On 2026-09-05, Chromium 149.0.7827.55 passed all eight consumer cases (four
inputs in two modes), and three receipt/tampering tests passed. The complete
validation process exited 0. The tested target was 354,509 bytes with SHA-256
`e6499f50590dd3753c15e7f8f3368b7543755013ec6db79c856771519ff43668`.

## Reproduce the consumer check

Prepare the native baseline described by the producer PR, then run:

```sh
node scripts/probe-odin-wasi-consumer.mjs \
  --receipt /path/to/native-baseline-receipt.json \
  --chromium /path/to/chromium
```

The object and linked `stdin-sum.wasm` must be next to the producer receipt.
The probe checks both byte counts and SHA-256 hashes, the pinned Odin revision
`a2fb372b76e81ef31fbbc8a2cf2b4fdf5ac6c924`, source fixture identities and all four
producer input/output results. It accepts only a linked WASI Preview 1 program
with standard-input/output imports and a command entry point. It does not run
commands or executable paths supplied by the receipt.

For each case, Chromium starts the production Worker's load, prepare and run
phases. Both explicit stdin and the production SharedArrayBuffer transport are
tested. The small buffer forces multiple input requests. The input cases are:

| Input        | Combined output     | Result                                |
| ------------ | ------------------- | ------------------------------------- |
| `5\n7\n30\n` | `count=3 sum=42\n`  | success                               |
| `-9\n4\n2`   | `count=3 sum=-3\n`  | success, no final newline in input    |
| empty        | `count=0 sum=0\n`   | success at EOF                        |
| `abc\n`      | `invalid integer\n` | production Worker reports exit code 2 |

The existing generic WASM Worker combines stdout and stderr in its output
callback, so the probe asserts combined output rather than claiming separate
stream delivery. Every case requires the production readiness event and exact
completion or error result. The harness uses a fresh Worker, bounded output and
a deadline per case.

`--out <new-directory>` selects a local evidence directory; the default is a
temporary directory. `odin-consumer-receipt.json` records compiler host, input
artifact identity, producer receipt hash, production source/bundle identities,
browser version and all case results. Existing receipts are never overwritten.
The receipt always leaves browser compiler and language-registration gates false.
This locally checked provenance is not a signed publisher trust anchor.

## Work required for source execution

The producer's real Emscripten host probe fails on unsupported OS/CPU branches
and missing `sys/sendfile.h` in upstream `gb.h`. The host platform, filesystem,
threading and external linker boundaries need an implementation. The native
baseline alone cannot establish that those paths work inside a Worker.

After a browser compiler artifact exists, the consumer needs a verified local
asset handoff, isolated compiler Worker, original-source compilation and
diagnostics, standard-library files, and in-browser linking. Acceptance must
exercise delayed stdin, EOF, UTF-8, output/memory limits, abort during compile
and input wait, and a fresh run after cancellation through the Odin sandbox.
Only that result can justify the `ODIN` catalog entry and browser coverage row.
No language parser, remote compilation service, deployment or runtime asset
publication is introduced by this target probe.
