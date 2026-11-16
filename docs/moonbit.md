# MoonBit browser execution

MoonBit execution is **unavailable by default pending service-license review**.
The selector, editor and saved source remain available, with a visible status
message and disabled Run/restart controls. Default SDK `load` and `run` calls
reject with `runtime-configuration` before asset fetching or Worker creation.
Prewarming does not start this runtime. There is no production-enabling flag.

`MOONBIT` uses the unchanged official MoonBit `v0.10.19+97801ee1b` WebAssembly
compiler. The same compiler builds 96 packages from the matching
`moonbitlang/core 0.1.20261030+97801ee1b` sources. User source is compiled normally
to WasmGC and executed in a fresh Worker. The adapter does not parse, rewrite or
translate the MoonBit language.

The compiler uses the MoonBit Public Source License. Section 14 requires
commercial or competitive services offering its functionality to provide their
Service Source Code by free network download under that license. Its definition
includes the compiler and programs used to provide the service, including user
interfaces, management and hosting software. This condition needs review for the
proposed service use; this integration leaves the host project's licensing
unchanged and does not assert a browser-service exemption.

This technical restriction contains the unreviewed deployment; it does not
resolve the license question or accept terms for an operator. A service operator
still needs to establish suitable rights and obligations, for example through
applicable license review or a written upstream grant, before proposing an
explicitly reviewed change to this policy.

The following compiler/FFI contract is retained for explicit local research.
`new Moonbit({ localResearchOnly: true })` allows that adapter only on HTTP(S)
`localhost`, `127.0.0.1` or `[::1]` origins. This option is a technical research
restriction, not a grant of license permission; it never enables publication or
changes the playground's disabled state.

MoonBit's normal Wasm FFI supplies browser input. The host exports these exact
functions from module `wasm_idle`:

| Import            | MoonBit result | Behavior                                                   |
| ----------------- | -------------- | ---------------------------------------------------------- |
| `read_byte()`     | `Int`          | Next unsigned UTF-8 input byte, or `-1` at EOF             |
| `read_char()`     | `Int`          | Next Unicode code point decoded from UTF-8, or `-1` at EOF |
| `write_char(Int)` | `Unit`         | Write one Unicode code point to stdout                     |
| `exit(Int)`       | `Unit`         | End this run with the supplied exit status                 |

```moonbit
extern "wasm" fn read_char() -> Int = "wasm_idle" "read_char"

fn main {
  let text = StringBuilder()
  while true {
    let code = read_char()
    if code < 0 { break }
    text.write_char(code.unsafe_to_char())
  }
  println(text.to_string())
}
```

Input may arrive after execution starts. EOF closes the stream; delayed blocking
input requires the playground's COOP/COEP headers and `SharedArrayBuffer`.
`read_char` uses standard UTF-8 replacement decoding for malformed input.
`println` uses the upstream `spectest.print_char` ABI. The pinned core documents
that `eprintln` falls back to stdout on WasmGC; compiler diagnostics use stderr.
The native/async standard-library stdio package is unavailable in this browser
profile. These FFI functions do not claim to implement that package.

`activePath` selects a `.mbt` entry file (default `main.mbt`). Additional `.mbt`
files in its directory compile together as one normal MoonBit package. An
optional `moon.pkg.json` in that directory declares standard core imports:

```json
{ "import": [{ "path": "moonbitlang/core/env", "alias": "env" }] }
```

`@env.args()` then returns `[activePath, ...programArgs]`. Environment variables
are private to the run, the working directory is `/work`, and `@env.now()` uses
the host clock. Package metadata supports `import` and `is-main`; external
dependencies, separate local packages, modern `moon.pkg` project builds and custom
compiler flags are unavailable. The root `.wasm-idle/` directory is reserved.
Unknown Wasm host imports fail with their exact module/function names.

Asset size/hash, workspace, output, cancellation and phase timeout limits use the
shared Worker lifecycle. The compiler's virtual filesystem is capped at 64 MiB.
WasmGC heap memory is controlled by the browser; a linear-memory page limit does
not cap that heap. Native filesystem/process/socket APIs and asynchronous native
IO are unavailable. The compiler requires WasmGC, JavaScript string built-ins and
permission to evaluate its original JavaScript loader inside the Worker.

Default builds, grouped browser tests and `pnpm sync:wasm-moonbit` do not prepare
the compiler payloads. Local compiler research must explicitly use
`pnpm sync:wasm-moonbit --local-research` (or the producer's `--local-research`
argument). `--check` also requires this option and remains offline. Preparation
verifies the exact official archive and every output receipt. Payloads remain
ignored locally; pins, producer, original notices and generated host remain in
Git. `runtimeAssets.rootUrl` relocates `wasm-moonbit/`.

Production builds and the publisher reject compiler/core payloads in
`wasm-moonbit/`, including compressed variants and directories, and reject
MoonBit references in the compression, layer and compact-alias delivery indexes.
The generated service Worker is checked for stale MoonBit delivery aliases too,
including when its sidecar receipt is missing.
The retained notices, source metadata and project host Worker may remain. The
default core asset lock omits only the three withheld payload receipts; the
experimental profile retains their original pins. Local-research, skipped asset
verification and asset-reuse options cannot bypass this publication preflight.
Keep research payloads outside publication trees before building; a stale tree
fails with an explicit error and is never automatically deleted.

The compiler retains the [MoonBit Public Source License](../runtimes/wasm-moonbit/licenses/COMPILER-LICENSE.txt),
including its redistribution/service terms. The retained compiler-output
exception permits compiler portions embedded in compiled output to be conveyed
under MIT; it does not replace Section 14's separate service condition. Its
exact source is [commit d4ada10d](https://github.com/moonbitlang/moonbit-compiler/tree/d4ada10d212b5376f7f8bf49cd2fbaa275a395df).
The matching core sources are inside the pinned official release archive and
retain [Apache-2.0](../runtimes/wasm-moonbit/licenses/CORE-LICENSE.txt) plus the
original [third-party notices](../runtimes/wasm-moonbit/licenses/CORE-NOTICE.txt).
The project's MIT license does not replace these upstream licenses.

Run `pnpm test:browser:moonbit` for real Chromium checks of the SDK denial,
no-runtime-fetch/no-Worker behavior, visible page status, disabled controls,
source editing and another language's availability. This is also the required
MoonBit browser suite; it does not skip qualification merely because the runtime
is unavailable.

`pnpm test:browser:moonbit:research` is the separate explicit local compiler
qualification path. It prepares pinned payloads and exercises original source
compilation, language features, UTF-8/delayed stdin/EOF, workspace files, errors,
limits, recovery and gzip-only delivery. It does not enable the normal page or
permit publication. The full producer/integrity unit fixtures additionally
require `WASM_IDLE_MOONBIT_LOCAL_RESEARCH=1`.

The review checked the exact retained [pinned compiler license](https://raw.githubusercontent.com/moonbitlang/moonbit-compiler/d4ada10d212b5376f7f8bf49cd2fbaa275a395df/LICENSE.TXT).
Its appended exception addresses compiler portions embedded in output; no
explicit browser-service exception was established. The official
[Moonpad embedding tutorial](https://www.moonbitlang.com/blog/how-to-use-moonpad)
describes embedding, but does not state a separate service-license exception.
The Apache-2.0 [Moonpad Monaco wrapper](https://cdn.jsdelivr.net/npm/@moonbit/moonpad-monaco@0.2.0/package.json)
depends on a separate compiler Worker package; that wrapper license does not
establish a replacement grant for this compiler. The official Apache-2.0
[MiniMoonBit example](https://github.com/moonbitlang/llvm.mbt/blob/master/examples/minimoonbit/README.md)
is an incomplete example with native-only end-to-end tests, not an equivalent
full browser compiler. This bounded review established neither a separate
service exemption nor a compatible equivalent compiler; applicability to a
particular service remains a review decision.
