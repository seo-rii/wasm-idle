# Native debugger compiler gates: Go, Zig and TinyGo

The playground must obtain usable source locations from the real compiler before routing a
language into the LLDB/WAMR session. A successful compilation, a Wasm `name` section, or a
Debug Adapter Protocol connection is insufficient. These probes exercise the packaged browser
compilers with explicit debug requests and retain their actual diagnostics and section inventory.
They do not enable a debugger, alter the producer receipts, or substitute a host compiler.

## Reproduce

Use the repository's installed dependencies and prepared `static/wasm-*` assets. No network or
compiler rebuild is needed. Each invocation launches an isolated Node process, caps its lifetime
at three minutes, and writes a JSON receipt and any generated artifacts into the output directory.
Run the languages sequentially to avoid competing compiler heaps:

```sh
node scripts/probe-native-debug-compilers.mjs --language go --output out/native-debug-probe
node scripts/probe-native-debug-compilers.mjs --language zig --output out/native-debug-probe
node scripts/probe-native-debug-compilers.mjs --language tinygo --output out/native-debug-probe
node --test scripts/probe-native-debug-compilers.test.mjs
```

`--timeout-ms` accepts up to 600000 ms. TinyGo uses a 1 GiB Wasm memory limit. A `blocked`
receipt is a completed probe, while `probe-error` (including a timeout) is an unsuccessful probe
and must not be interpreted as an upstream limitation. `candidate` means only that nonempty
`.debug_info`, `.debug_abbrev`, and `.debug_line` sections exist; LLDB acceptance is still required.

## Results and implementation gates

The 2026-10-23 runs completed with probe exit code 0 for all three languages. The receipts retain
the compiler arguments, source, diagnostics, artifact hashes and Wasm custom-section inventory:
[Go](evidence/native-debug-20261023/go.json), [Zig](evidence/native-debug-20261023/zig.json), and
[TinyGo](evidence/native-debug-20261023/tinygo.json). Go consumed `7\n` and printed `12\n`;
all five Zig variants consumed and echoed `7\n`. Neither compiler emitted a DWARF section.

TinyGo rejected `debug:true` with exit code 1 and the exact producer diagnostic:

```text
tinygo-browser-adapter: compile protocol v5 does not provide a debug runtime closure
```

The shipped, verified receipt uses protocol **v6**. The `v5` in that message is the producer's
diagnostic text, not a claim that the probe loaded an older compiler.

| Compiler                  | Attempt                                                                                                                                                  | Native debugger gate                                                                                                                                                                    | Required implementation                                                                                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go 1.26.1                 | Browser `compile` with `-N -l`, browser `link` with `-w=false`; run the resulting WASI module with stdin                                                 | Inspect the linked module for DWARF; Go's linker explicitly disables DWARF for `Hwasip1` and `Hjs`                                                                                      | A producer/toolchain change must emit usable Wasm DWARF or a real Go runtime debugger must supply equivalent locations and variables. `-N -l` alone is insufficient. Keep the existing trace mode separate.                                             |
| Zig 0.11.0 selfhost       | Existing `-Dtarget` option with wasm64/wasm32, Debug and ReleaseSmall, `-fno-strip`; additionally try the explicit `-target wasm32-wasi` compiler option | Generated modules currently contain no source DWARF, including Debug builds. The two `-Dtarget` Debug outputs are identical, so that option is not evidence of distinct machine targets | Package a real compiler/backend that emits wasm32 source DWARF. Then preserve source paths, add the debug compile profile, and verify breakpoints, stepping, locals, stdin and stdout with LLDB/WAMR.                                                   |
| TinyGo 0.40.1 protocol v6 | Verify shipped compiler/root/LLD receipts, discover and validate the real Go package graph, then send `debug:true` directly to the Wasm producer         | The current consumer and runtime closure fix `debug:false`; its validated link plan requires `--strip-debug` and `--compress-relocations`                                               | Introduce a separately identified, receipt-backed producer debug profile. Permit debug metadata in compiler objects, preserve relocation offsets/DWARF through linking, and validate the effect of Asyncify on source locations before connecting LLDB. |

The Go linker gate can be inspected in the cached upstream source at
`runtimes/wasm-go/artifacts/cache/toolchains/go1.26.1/linux-x64/go/src/cmd/link/internal/ld/dwarf.go`,
function `dwarfEnabled`. The source excludes `objabi.Hwasip1` and `objabi.Hjs` independently of
`-w=false`. The packaged compiler probe remains the acceptance evidence, rather than that cache.

TinyGo deliberately tests the requested debug profile before a full release compilation. A prior
control compile of the `fmt` example reached the 180-second probe budget without finishing; that
timeout is not evidence that TinyGo cannot compile the program. The debug-profile probe avoids
repeating that unrelated work and records the actual producer response.

These are producer gates, so the application has not gained a Zig/Go/TinyGo LLDB support flag
from these probes. The next acceptance step after any producer change is a real browser debug
session covering a source breakpoint, step-over/step-in, stack and locals, input/output, stop,
and a second session without reloading the page.
