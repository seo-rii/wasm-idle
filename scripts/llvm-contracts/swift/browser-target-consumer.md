# Swift target acceptance in the wasm-idle consumer

`probe:swift-target-consumer` takes the native-compiled Swift/WASI fixture from
[wasm-llvm PR #1](https://github.com/seo-rii/wasm-llvm/pull/1) and executes it through the
existing production `src/lib/playground/worker/wasm.ts` in Chromium. This closes the target
execution handoff between producer and consumer. It leaves Swift compiler, SwiftPM, and language
registration gates false.

```sh
pnpm install --frozen-lockfile
pnpm probe:swift-target-consumer -- \
  --producer-receipt /path/to/wasm-llvm/swift-target/receipt.json \
  --wasm /path/to/BrowserStdin.wasm \
  --chromium /path/to/chromium
pnpm test:swift-target-consumer
```

The producer receipt must have format `wasm-llvm-swift-browser-target-v1`, a passing native
Swift 6.3.3/full Wasm SDK result, matching fixture bytes, all three expected producer outputs,
and false browser compiler/SwiftPM/readiness gates. The consumer reads the explicitly supplied
Wasm file, verifies its recorded size/SHA-256, and requires a WASI Preview 1 command. No runtime
assets are copied into `static/`, and the probe does not invoke a compiler or compile service.

The shared `scripts/lib/wasm-consumer-probe.mjs` builds the production Wasm Worker and the
production `stdinBuffer.ts` module with Vite/Oxc. The standalone build does not need generated
Svelte application configuration. A fresh Chromium Worker performs the real `load`, `prepare`,
and `run` protocol for each case. In shared-buffer mode the page calls the production
`flushQueuedStdin` and `flushBufferedEof` functions against a 16-byte SharedArrayBuffer, whose
8-byte payload exercises input chunking without splitting UTF-8 characters.

Each case must complete within 15 seconds, report execution readiness, and produce exactly the
expected terminal output without a Worker error. Shared-buffer cases must request input and
observe EOF. The production Worker combines stdout and stderr into its terminal `output` messages;
this consumer check validates that combined stream. Producer acceptance separately checked stderr.

Source, stdin transport, harness, and dependency-lock hashes are captured before bundling and
checked again after browser execution. The resulting receipt also records generated bundle hashes,
producer/fixture/target identities, Chromium version, input requests, and EOF writes. These local
receipts are evidence for target execution; the existing Swift runtime manifest validator rejects
the producer target receipt as a compiler runtime bundle.

## Verified on 2026-09-05

The producer fixture is 7,975,087 bytes, SHA-256
`bbbd74cd47521710ac1c1dc6fce9f2c0f96c50414477283c51ee7abd239cf35c`.
Chromium `149.0.7827.55` passed all six executions:

| Case                       | Expected terminal output        | Explicit input | Shared input requests / EOF writes |
| -------------------------- | ------------------------------- | -------------- | ---------------------------------- |
| UTF-8 and sum              | `sum=60\ntext=안녕\neof=true\n` | passed         | 4 / 1                              |
| Final line without newline | `sum=4\ntext=last\neof=true\n`  | passed         | 3 / 1                              |
| Empty EOF                  | `sum=0\ntext=<eof>\neof=true\n` | passed         | 1 / 1                              |

Six focused tests passed for producer/fixture/artifact verification, registration gates, missing
shared-input coverage, and expected runtime errors. Four existing support-matrix tests also passed.
The browser receipt is generated under `.cache/swift-target-consumer/probe-*/receipt.json`;
the measured run used `probe-63h6Nt`.

The final unit/browser/matrix/format checks exited 0 with a private background log at
`/home/seorii/logs/swift-consumer-final-ec414dda0ed145fe8c6b03ab3f64a63a.log` (PID 2703604).
The support-matrix tests exited 0 with log
`/home/seorii/logs/swift-consumer-support-matrix-24f2527b9b17430886cfbb78d62b0e96.log` (PID 2687891).

Browser-hosted `swiftc` and SwiftPM remain required. A future compiler bundle must satisfy the
existing source compilation, diagnostics, arguments, workspace, and stdin contracts before
`SWIFT` enters the runtime or page language registry.
