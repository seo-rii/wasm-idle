# MoonBit browser execution

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

`pnpm sync:wasm-moonbit` prepares missing payloads from the exact official archive
and verifies every file. Builds and browser tests prepare them automatically.
Payloads remain ignored locally; pins, reproducible producer, original notices
and generated host remain in Git. Gzip-only delivery works without a service
worker. `runtimeAssets.rootUrl` relocates `wasm-moonbit/`.

The compiler retains the [MoonBit Public Source License](../runtimes/wasm-moonbit/licenses/COMPILER-LICENSE.txt),
including its redistribution/service terms. The retained compiler-output
exception permits compiler portions embedded in compiled output to be conveyed
under MIT; it does not replace Section 14's separate service condition. Its
exact source is [commit d4ada10d](https://github.com/moonbitlang/moonbit-compiler/tree/d4ada10d212b5376f7f8bf49cd2fbaa275a395df).
The matching core sources are inside the pinned official release archive and
retain [Apache-2.0](../runtimes/wasm-moonbit/licenses/CORE-LICENSE.txt) plus the
original [third-party notices](../runtimes/wasm-moonbit/licenses/CORE-NOTICE.txt).
The project's MIT license does not replace these upstream licenses.

Run `pnpm test:browser:moonbit` for original source compilation, standard language
features, UTF-8/delayed stdin/EOF, workspace files, errors, limits, recovery and the
normal playground page.
