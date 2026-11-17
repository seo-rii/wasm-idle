# GNU APL

The `APL` runtime runs the original GNU APL 2.0 console interpreter in a fresh
WebAssembly/WASI instance. Its original parser, array evaluator, traditional
function editor, label/arrow control flow, nested arrays, complex arithmetic and
workspace serialization are retained. `GNUAPL` and `GNU-APL` select this runtime.

```apl
∇ Z←Fact N
Z←1
LOOP: →(N=0)/END
Z←Z×N
N←N-1
→LOOP
END: Z←Z
∇
⎕←Fact 5
```

Source files use `.apl`; `activePath` selects the source and `workspaceFiles`
supplies additional files. The source is passed with GNU APL's `-f` option, so
program stdin remains available to `⍞`, `⎕` and the native file functions.
Explicit stdin, delayed terminal input, Unicode and EOF are supported. For
example, `⎕←⍞` echoes one line. GNU APL keeps its numeric-input prompt and the
final newline produced by `)OFF`.

`programArgs` are passed after GNU APL's `--` separator. The original `⎕ARG`
contains the command line, including the interpreter options and source path.
`compileArgs` are rejected. The browser invokes the original CLI with
`--script --rawCIN --OFF --noSV -f <source>`.

Workspace files can be read through `⎕FIO`, for example
`⎕←1⊃(⎕FIO[49] 'data/input.txt')`. The original `)SAVE` and `)LOAD` operate on
the private filesystem during a run. Each execution starts with a fresh
workspace and filesystem.

Syntax errors, undefined names and invalid function definitions keep the
original diagnostics and return a failing batch status. Errors caught with
GNU APL's `⎕EC` retain their normal language behavior. Output, timeout,
cancellation and Wasm memory limits use the common sandbox controls. The
interpreter has a fixed 256 MiB Wasm memory ceiling. Heap exhaustion can surface
as an interpreter error or a timeout.

The browser build has no native processes, dynamic libraries, DNS, socket
creation, terminal attributes or kernel resource limits. Those host operations
fail with unavailable-operation errors. Shared-variable APserver support is
disabled. Optional native regex, FFT, GUI, image, GSL, PostgreSQL and SQLite
libraries are omitted; their GNU APL dependency diagnostics remain available.
The standard GNU APL engine and its built-in array operations are included.

The producer pins the official source archive, wasi-sdk 33 and every host port
and license input. It includes a small libc++ output-buffer portability fix and
records batch diagnostics without replacing language evaluation. GNU APL and
the host port use GPL-3.0-or-later. The shipped notices include the GNU APL,
wasi-libc, musl, libc++, libc++abi, libunwind and compiler-rt licenses.

See [the producer](../runtimes/wasm-apl/README.md) for the reproducible recipe and
[the GNU APL manual](https://www.gnu.org/software/apl/apl.html) for the dialect.
