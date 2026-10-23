# Java output and compiled-module reuse

The Java worker retains the compiled `WebAssembly.Module` with its existing single
TeaVM artifact cache. A warm run of identical sources and workspace files creates
a fresh instance, so static fields, heap, arguments and stdin do not leak between
runs. Changing a source or failing a rebuild invalidates both artifact forms.
The module uses the pinned loader's `js-string` compile option; custom byte-only
loaders retain their previous input contract.

Stdout and stderr share an ordered buffer capped at 16,384 UTF-16 code units. The
first output is sent immediately, and subsequent writes flush after 16 ms or at
the size bound. Checking time during writes matters because synchronous Wasm
cannot yield to a timer. Explicit Java `flush()`, stdin requests, completion and
errors also drain the buffer. Surrogate pairs stay together. A real Java
`PrintStream` forwards formatting and encoding to the existing runtime and bridges
explicit flushes to the worker; `println` no longer creates one message per line.

Validation uses the pinned TeaVM compiler/runtime and Chromium. The browser test
checks Unicode, 10,000 short lines, 30,000 newline-free characters, mixed stderr,
repeated stdin/args, exception stacks, unchanged engine-compile counts on a warm
run, and a static counter restarting at one. Focused tests also cover bounds,
timed flushing, engine-compile failure/retry and custom byte-only loaders.

The change reduces worker messages and avoids repeating engine compilation.
It does not remove TeaVM's per-character host callback or persist compiled user
programs across workers. Browser tests assert these mechanisms, without claiming
a general wall-clock speedup from a single machine's timings.
