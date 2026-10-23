# Brotli quality 5 delivery experiment — 2026-10-23

Brotli quality 5 reduced the eight pinned payloads by **10.2–20.7%**. With a
10 Mbps payload shaper, native HTTP Brotli had lower median artifact preparation
time than native HTTP gzip for every payload in this run. This does not establish
an application startup improvement: the endpoint is verified decoded bytes and
`WebAssembly.compile`, without instantiation, language-service initialization, or
user-program output.

The current explicit decoder path cannot switch to Brotli on the tested browser:
Chromium 153.0.8010.12 rejected `new DecompressionStream('brotli')`. Native HTTP
`Content-Encoding: br` worked. Supporting that transport would need a separate
loader/receipt design because `fetch` exposes decoded response bytes. This PR
changes neither production assets, hosting headers, nor the default codec.

## Results

Payload sizes are MiB. Times are seconds, medians of three fresh-browser runs at
10 Mbps with a 50 ms server delay. Each transport includes its own hash work:
explicit decoding verifies encoded and decoded receipts; HTTP decoding verifies
the decoded receipt. Compare the two HTTP columns to isolate the codec choice
within the same transport. The explicit gzip column represents the current
buffered decode mechanism, not a full application startup.

| Artifact | Shipped gzip MiB | Brotli Q5 MiB | Payload reduction | Explicit gzip s | HTTP gzip s | HTTP Brotli s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Clang | 12.52 | 10.64 | 15.0% | 12.53 | 11.19 | 9.52 |
| LLD | 6.12 | 5.43 | 11.3% | 5.80 | 5.77 | 5.18 |
| clangd | 15.95 | 12.67 | 20.5% | 16.23 | 14.93 | 12.13 |
| LLDB | 14.24 | 11.88 | 16.6% | 14.00 | 12.98 | 11.03 |
| Python / Pyodide | 3.43 | 3.08 | 10.2% | 3.27 | 3.60 | 3.04 |
| Java / TeaVM compiler | 1.61 | 1.38 | 14.3% | 1.75 | 1.66 | 1.40 |
| Rust compiler | 20.13 | 15.95 | 20.7% | 19.89 | 17.97 | 14.53 |
| Rust Preview 1 sysroot | 23.49 | 18.99 | 19.1% | 21.17 | 20.72 | 16.78 |

Loopback results were mixed: native HTTP Brotli medians were slower for Clang,
LLD, Pyodide, and rustc, and faster for clangd, LLDB, TeaVM, and the sysroot pack.
The CPU measurements ran on a shared VM while other build/unit-test work was
active; three samples are insufficient to conclude a universal decode or CPU
speedup. Exact min/median/max values and every observation are retained in the
[raw report](../../scripts/performance/reports/brotli-q5-20261023.json).

There were **288 successful observations, 48 explicitly skipped unsupported
Brotli stream-decoder cases, and zero failures**. Skips are not counted as
successful measurements. Every successful decoded payload matched its pinned
SHA-256 and byte count. All seven Wasm payloads compiled with the same options in
each codec arm; TeaVM retained the `js-string` builtin option. The sysroot endpoint
was verified bytes, because the pack is not a Wasm module.

## Method and limits

- Consumer baseline: `f34e21990`, runtime asset lock version `1.1.2`. The raw report
  includes each exact encoded and decoded receipt. Local stale artifacts are
  rejected before measurement.
- Baseline compression is the **shipped gzip file**, not a new gzip recompression.
  Brotli uses Node's quality 5 and the decoded size hint, with a verified
  byte-identical round trip. `encodeMs` is a single candidate preparation sample,
  not a gzip-versus-Brotli production encoding-speed benchmark.
- Host: Linux x64, 8 virtual CPUs, AMD EPYC 7B12, Node 22.23.3. Browser:
  Chromium 153.0.8010.12, headless. Browser performance jobs were serialized, but
  the host was not reserved exclusively for this experiment.
- Each artifact/network/codec/transport/repetition starts a fresh Chromium
  process with the HTTP cache disabled. Codec/transport order rotates across
  repetitions. This clears browser caches, not the host OS file cache.
- The loopback server uses `Cache-Control: no-store`. The shaped arm delays the
  response by 50 ms and writes at most 25,000 payload bytes every 20 ms. Host
  scheduling can make delivery slower. This is a payload shaper, not an exact
  emulation of an end-to-end Internet connection. Counts exclude HTTP/TLS headers.
- Native HTTP decoding overlaps download; its decoder CPU cannot be separated
  from `fetchMs`. Explicit decoding fetches an encoded buffer and then applies
  `DecompressionStream`. Both paths finish decoding before Wasm compilation;
  streaming compilation is not measured.
- `warm-buffer` repeats preparation with an encoded buffer for the explicit path
  and a decoded buffer for HTTP. It includes the engine's compile-cache effects.
  These are different retained states and are not application persistent-cache
  or module-reuse measurements.
- No resident-memory, full language startup, debug pause, compiler output, CDN
  negotiation, cross-browser compatibility, or JavaScript Brotli fallback cost
  is measured. Production adoption needs those checks plus an integrity strategy
  for HTTP-decoded data and reliable gzip fallback.

## Reproduce

Use the repository's supported Node version and install its dependencies and
Chromium. Prepare receipt-matching runtime assets using the normal browser-test
asset preparation, or point `--asset-root` at an existing verified checkout.
`--fallback-root` supplies an optional second location; both paths still enforce
the current lock receipts.

```sh
node --test scripts/performance/brotli-q5.test.mjs
node scripts/performance/brotli-q5.mjs \
  --asset-root static \
  --json scripts/performance/reports/brotli-q5-local.json \
  --runs 3
```

Optional flags: `--assets` (comma-separated names from `DEFAULT_ASSETS`),
`--networks loopback,10mbps`, `--transports explicit,http`, and `--chromium PATH`.
The harness records unsupported decoders and failures in the report, and exits
nonzero on a failed measurement. Receipt/round-trip and summary accounting tests
are included in the existing performance-audit test glob.
