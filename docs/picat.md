# Picat browser profile

`PICAT` runs the real official [Picat playground](https://picat-lang.org/playground/)
WebAssembly interpreter in a fresh Worker. It includes the original compiler, VM,
standard library and bundled solvers. CP and SAT have browser acceptance coverage.

The default program uses `read_line()` and `println()`. Terminal input arrives while
the VM runs; closing stdin returns the upstream `end_of_file`. Buffered `stdin`,
workspace data files, exceptions, timeouts and cancellation use the normal playground API.
As in native Picat, call `flush()` after a prompt without a newline before waiting
for input; the starter demonstrates this [standard I/O behavior](https://picat-lang.org/download/picat_guide_html/picat_guide.html).

The upstream bridge compiles `/user_code.pi`. Source is passed unchanged: omit an
explicit `module` declaration or use `module user_code.`. Other names produce an
upstream compilation error. `activePath` is also mounted in `/workspace`, which is
the program's working directory; data files can be opened by relative path. This
profile does not promise arbitrary entry-module names or full multi-module projects.

MIP/SMT rely on external processes and are unavailable. Timers, networking, process
spawning, CLI arguments and the official web page's ASP pre-transpiler are outside
this profile. Browser execution can be cancelled by terminating its Worker.

Memory starts at 64 MiB. The Worker validates the pinned wasm32 memory section and
lowers its maximum to the requested `maxWasmMemoryBytes`; the browser enforces that
ceiling. Program instructions and data remain unchanged. Low budgets reject before
runtime download. This bounds Wasm linear memory, not the browser's total memory.

## Assets and provenance

Run `pnpm sync:wasm-picat` or `pnpm prepare:test-assets -- picat`. The sync verifies
all official bytes against `scripts/wasm-picat-assets.lock.json`, adds only an ES
module export to the JS loader and writes deterministic gzip `.gz.bin` deliveries.
The Worker verifies the decoded assets again before executing them. Downloads fail
closed if the upstream playground changes; update the reviewed lock deliberately.

The bundle identifies itself as experimental, based on Picat 3.9#12. The official
page does not publish an exact producer commit or build recipe for these artifacts.
The lock records this limitation and does not claim source-build reproducibility.
Upstream sources and licensing are at [picat-lang/Picat](https://github.com/picat-lang/Picat)
and [the official downloads](https://picat-lang.org/download.html). Picat's C sources
are MPL-2.0; bundled components retain their own licenses. See
`runtimes/wasm-picat/LICENSE` and `THIRD_PARTY_NOTICES.md`.
