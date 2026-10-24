# GCC generated corpus replay in Chromium

`fuzz-x86-cross-gcc.mjs` replays the deterministic, generated corpus produced by
`wasm-llvm/producer/gcc-browser` through the current public `createCrossGccWorker`
API from `@wasm-idle/gcc`. It loads the built package entry and emitted Worker,
runs actual GCC Wasm modules in Chromium, and checks the generated oracle.
The producer campaign additionally compares the same cases with native GCC.
This is bounded generated testing, not a coverage-guided fuzzer or a proof of
compiler correctness. Synthetic runtime/contract fuzzing is reported separately.

From the consumer repository root:

```sh
pnpm --filter @wasm-idle/core build
pnpm --filter @wasm-idle/gcc build
pnpm exec playwright-core install chromium
node scripts/fuzz-x86-cross-gcc.mjs \
  /path/to/bundle/gcc-toolchain.v1.json \
  /path/to/producer-results/corpus.json \
  /path/to/new-browser-results \
  --manifest-sha256 "$GCC_MANIFEST_SHA256" \
  --corpus-sha256 "$GCC_CORPUS_SHA256" \
  --max-cases 32 --max-seconds 600 --case-seconds 90
```

Obtain the manifest digest independently from the producer build receipt. The
manifest is verified before initialization, and the public Worker verifies every
execution asset and the GNU sysroot. The corpus must contain the same manifest,
compiler, target, host, asset and sysroot identities. The optional corpus digest
pins the exact generated cases. Use the producer's generated corpus: executable
cases are trusted local test programs and run as native child processes, with a
10-second execution timeout and bounded output, rather than in a security sandbox.

Each case gets a fresh dedicated Worker. A per-case deadline covers loading and
compilation; abortion terminates that Worker even when GCC's synchronous `main`
is blocked. A second Node watchdog closes Chromium if the page does not respond
within two seconds of that deadline. The campaign also has a global time budget.
Any selected case failure or timeout exits nonzero; it is never silently skipped.
`--max-cases` intentionally selects a prefix and the report states the omitted
count. Defaults are 32 cases, 600 campaign seconds, and 90 seconds per case;
limits are 256 cases, 3600 campaign seconds, and 600 seconds per case. Shutdown
and evidence writing can add a few seconds beyond the execution budget.

The script validates assembly identity, ELF64 little endian x86-64 output types,
and static executables without an ELF interpreter. AVX2/FMA cases must contain
the relevant YMM integer/FMA instructions. Function-scoped corpus assertions also
check pragma push/pop boundaries. Object cases use native `objdump`. Only baseline
executable cases are run in separate Linux x86-64 processes with the generated
stdin/stdout oracle; AVX cases are compile/disassembly only. No generated ELF is
ever passed to `WebAssembly.compile` or `WebAssembly.instantiate`.

`report.json` is updated after each case, including before output assertions, and
the first failure stops the campaign. Each case retains its exact source,
request, stdin, expected stdout, compiler diagnostics, produced artifact and
SHA-256, stage arguments/timing/Wasm memory, and native output when applicable.
Earlier successful results survive a later failure. The report records the seed,
corpus/manifest/sysroot hashes, consumer revision, source and emitted-module hashes
for `@wasm-idle/gcc` and its shared `@wasm-idle/core` dependency,
Chromium version, selected/omitted case counts, and an exact replay argv array.
`nodeMaxRssKiB` measures the Node harness, not total Chromium RSS; stage linear
memory likewise excludes JS and MEMFS allocations.

The harness gate tests use small synthetic byte buffers solely to test validation:

```sh
node --test scripts/fuzz-x86-cross-gcc.test.mjs
```

Their success does not establish a real GCC compilation. Preserve the actual
campaign's `report.json`, corpus and case files as the real-compiler evidence.
