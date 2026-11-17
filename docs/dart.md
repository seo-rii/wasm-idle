# Dart browser execution

`DART` uses the official Dart 3.14.0 DartPad toolchain. The original DDC compiler,
analyzer dependencies and SDK filesystem run in a WebAssembly Worker; DDC output
runs against the original Dart web SDK in a separate, disposable Worker. User
source is compiled normally. It is never parsed or translated by this adapter.

```dart
import 'dart:io';

void main() {
  print(stdin.readLineSync() ?? '');
}
```

The host installs standard streams through Dart's `IOOverrides`. It supports
`stdin.readLineSync()`, `stdin.readByteSync()`, UTF-8 stream reads,
`stdout`/`stderr`, `print`, program arguments and `exit(code)`. Input can arrive
after execution begins; EOF returns `null` from `readLineSync()`, including the
normal Dart behavior of returning a final unterminated line before EOF. The host
uses UTF-8 for the platform's default encoding and has no terminal/raw mode.

`activePath` selects the source file (default `main.dart`), and additional Dart
modules are supplied through `workspaceFiles`. Relative imports work normally.
Each run gets a fresh compiler workspace and execution realm. The internal
`.wasm-idle/` directory is reserved for host bindings. `prepare` starts the host
Worker without compiling or executing user source.

This is Dart's web target, with its web numeric behavior and library availability.
Native filesystem access, network sockets, processes, FFI, isolates, terminal
control, Flutter/DOM rendering and native-only libraries are unavailable. The
host does not run `pub get` or fetch external package dependencies. Unsupported
native APIs retain the SDK's `UnsupportedError` behavior. Compiler flag overrides
are rejected; SDK assets are fixed by the release SHA-256 and individual receipts.

Hosts serve `static/wasm-dart/` underneath `runtimeAssets.rootUrl`. Every compiler
and SDK asset is byte-count/SHA-256 checked before use. Cancellation, execution
timeouts and output limits use the existing shared Worker lifecycle.
Run `pnpm sync:wasm-dart` to download missing original payloads from the pinned
official archive. Builds and browser tests prepare them automatically; payloads
are ignored locally, while pins, metadata, license and the host remain in Git.
The loader also accepts the repository's gzip-only production delivery, with
bounded decompression and verification of the original bytes. It does not require
a service worker.
The compiler requires the WasmGC and JavaScript string built-ins used by the
official DartPad bundle. Delayed synchronous input requires the playground's
COOP/COEP headers and `SharedArrayBuffer` support.

Run `pnpm test:browser:dart` for real Chromium source compilation, standard input,
arguments, relative imports, original errors, limits and recovery.
