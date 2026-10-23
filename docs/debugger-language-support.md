# Language debugger support

These results refer to the compiler and runtime bundles pinned by this repository on
2026-10-23. Debugger support is enabled after running the real browser runtime; a successful
compile or a debugger transport connection alone is insufficient.

Enabled debugger backends run in the page and its Workers. They require no browser extension,
remote debugging port or external debugger service.

| Language                   | Backend and verified behavior                                                                                                                                                                                    | Limitations or next step                                                                                                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C, C++, Rust               | Existing LLDB/WAMR integration                                                                                                                                                                                   | Rust uses `wasm32-wasip1`.                                                                                                                                                                                                                                        |
| Objective-C, Objective-C++ | Real Clang DWARF → LLDB/WAMR; original source breakpoints, integer locals, stepping, stdin/stdout                                                                                                                | Foundation needs host libffi imports unavailable in the current WAMR target. Object layout and Objective-C expression evaluation are not qualified.                                                                                                               |
| V                          | Real V `-g` line directives → Clang DWARF → LLDB/WAMR; original `.v` breakpoints, integer locals, stepping, stdin/stdout                                                                                         | V-specific expression evaluation and rich type inspection are not qualified.                                                                                                                                                                                      |
| JavaScript, TypeScript     | Ordinary execution remains available; source debugging is disabled                                                                                                                                               | The extension-dependent CDP integration has been removed. No extension-free backend is qualified for the current runtime.                                                                                                                                         |
| Java                       | Real javac/TeaVM source hooks; original-file breakpoints, genuine Java stacks, current-frame locals, array inspection, read-only scalar/String snapshot expressions, stepping, Pause, stdin/stdout, stop/restart | Only safely captured bindings in the stopped frame are exposed. Objects remain opaque; expression restrictions are described below. Debug rejects Unicode preprocessing escapes and unsupported parser syntax.                                                    |
| Lua                        | Pinned, unmodified MobDebug engine in the actual Lua VM; breakpoints, stack/locals, evaluation, step into/over/out, stdin/stdout, restart                                                                        | Its socket transport is replaced by a Worker mailbox. Evaluation currently supports the top frame. Fennel is not enabled.                                                                                                                                         |
| D                          | Genuine LDC debug profile and source artifact handoff implemented; full-runtime rejection verified                                                                                                               | The full D runtime emits Wasm exception-handling tags unsupported by the pinned WAMR debugger. The UI stays disabled. No `-betterC` subset substitution.                                                                                                          |
| C#, VB.NET, F#             | Portable PDB generation/loading, virtual source paths and native Mono agent bridge prerequisites implemented                                                                                                     | Actual compilers passed PDB/sequence-point/local metadata and stdin/stdout checks. The shipped native debugger exports are stubs; a real native debugger component, repackaged compiler and managed debugger proxy are still required. No debugger UI is enabled. |
| Ordinary Go                | Actual `-N -l`, `-w=false` compile/link and stdin/stdout probe                                                                                                                                                   | The Go Wasm linker omits DWARF. Keep existing trace mode; native requests fail explicitly.                                                                                                                                                                        |
| Zig                        | Five actual target/debug/strip option combinations, successful compile and stdin/stdout                                                                                                                          | Current selfhost outputs have no DWARF. Native requests fail explicitly.                                                                                                                                                                                          |
| TinyGo                     | Receipt-verified direct `debug:true` producer request                                                                                                                                                            | The producer rejects the missing debug runtime closure. A separately identified producer debug profile is required.                                                                                                                                               |
| Nim                        | Explicit debugger producer gate                                                                                                                                                                                  | The current LLVM 8 release-only producer has no source debug artifact handoff.                                                                                                                                                                                    |
| PHP                        | Actual shipped PHP 8.4.25 extension/INI probe and stdin/stdout                                                                                                                                                   | Xdebug is absent. Package a real Xdebug-enabled engine and connect its DBGp transport before exposing source debugging.                                                                                                                                           |
| Ruby                       | Real CRuby TracePoint fallback; source breakpoints, Binding locals/evaluation, stack, step into/over/out, dynamic breakpoints, stdin/stdout, stop and restart                                                    | `rdbg`/socket are absent and native threads are unimplemented. User source is evaluated unchanged with its original filename.                                                                                                                                     |

Ruby was qualified through the actual website binding: document → container owner Worker →
nested execution Worker, including ordinary execution after
stopping and restarting a debug session.

Java was qualified through the same container binding in ordinary Chromium without an extension.
The gate covers main and auxiliary source breakpoints, genuine Java method frames, stepping,
pausing in an empty loop, input/output and stop/restart. Switching between Debug and Run with the
same original source recompiles the appropriate artifact. Java hooks use the upstream
`java-parser` CST and TeaVM's existing JSO bridge; Java execution stays in the real compiler/VM.

Java value hooks capture parameters, initialized local declarations, loop/catch/resource variables,
and a valid instance receiver. Genuine javac overload resolution distinguishes primitive values,
Java Strings and references, including inferred `var` declarations; inspection never calls user
getters or `toString()`. Only the currently stopped frame has a value snapshot. Initially
uninitialized declarations, flow-pattern bindings and outer lambda bindings are omitted rather
than read before definite assignment or accidentally captured. Caller frames remain available in
the genuine stack without fabricated local values. Primitive, object and nested arrays expose
paged element values; general objects show type and identity without reflective field access.
Displayed stacks are bounded to 64 frames; stepping retains full depth.

Java expression evaluation compiles a standalone helper with the shipped javac/TeaVM, using the
stopped primitive/String values as runtime arguments. It does not rerun the user's program or
copy target references into another Java heap. Arithmetic, comparisons, casts, approved String
methods and fully qualified pure `java.lang` library operations are supported, for example
`number + 5`, `text.substring(1)`, and `java.lang.Math.max(number, 10)`. `long` values retain
precision beyond JavaScript's safe integer range. Special floating-point values and negative zero
are restored through Java constants and bit conversion.

Evaluation is read-only and has snapshot semantics. Assignments, allocation, ternary expressions,
String reference-identity comparisons, default-locale String case conversion, user methods and
target object/array expressions are rejected explicitly. Ternaries require original compile-time
constant metadata to preserve Java narrowing rules; short library class names could be shadowed
in the target's lexical scope. Content comparison with `equals()` and null comparisons remain
available. Array elements can be inspected in the Variables tree. Stop, resume, frame selection and
a new pause cancel outstanding evaluations. Handles expire when execution resumes or a new pause
starts. Evaluation compilers are reused during a debug run and disposed when it ends. Strings are shortened only for display;
oversized evaluation inputs are rejected instead of silently truncated.

For LLDB languages the compiler Worker is retired before the separate WAMR debug execution
starts. The target uses the full runtime artifact, original source snapshots and verified compiler
provenance. The existing LLDB manifest controls expression and memory capabilities. Languages
without a qualified trace implementation do not silently fall back to trace mode.

## Reproduce

Prepare the repository's pinned runtime assets and start the usual Vite development server.
Pass its complete application base URL, including `/wasm-idle/` when configured. The browser
fixtures use isolated documents and Chromium. Run compiler-heavy cases sequentially.

```sh
WASM_IDLE_RUN_COMPILED_LLDB=1 WASM_IDLE_BROWSER_URL=http://127.0.0.1:5173/wasm-idle/ \
  pnpm exec vitest run src/lib/playground/compiled-lldb.playwright.test.ts --maxWorkers=1

WASM_IDLE_RUN_LUA_DEBUG=1 WASM_IDLE_BROWSER_URL=http://127.0.0.1:5173/wasm-idle/ \
  pnpm exec vitest run src/lib/playground/lua-debug.playwright.test.ts --maxWorkers=1

WASM_IDLE_RUN_RUBY_DEBUG=1 WASM_IDLE_BROWSER_URL=http://127.0.0.1:5173/wasm-idle/ \
  pnpm exec vitest run src/lib/playground/ruby-debug.playwright.test.ts --maxWorkers=1

WASM_IDLE_RUN_JAVA_HOOKS=1 WASM_IDLE_BROWSER_URL=http://127.0.0.1:5173/wasm-idle/ \
  pnpm exec vitest run src/lib/playground/java-debug.playwright.test.ts --maxWorkers=1

WASM_IDLE_RUN_JAVA_VALUES=1 WASM_IDLE_BROWSER_URL=http://127.0.0.1:5173/wasm-idle/ \
  pnpm exec vitest run src/lib/playground/java-values.playwright.test.ts --maxWorkers=1

WASM_IDLE_RUN_JAVA_TRANSFORM_SEMANTICS=1 \
  pnpm exec vitest run src/lib/playground/javaDebugSource-semantics.test.ts --maxWorkers=1
```

Native compiler attempts and exact receipts are documented in
[Go/Zig/TinyGo probes](native-debug-compiler-probes.md),
[.NET prerequisites](../runtimes/wasm-dotnet/README.md#debugging-prerequisites), and
[PHP prerequisites](../producers/wasm-php/README.md).
