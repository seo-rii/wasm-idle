# @wasm-idle/llvm-core

Browser-side LLVM runtime hosts used by wasm-idle. This package contains JavaScript and TypeScript
code only. Compiler modules, sysroots, archives, and other runtime assets must be deployed
separately and supplied through explicit HTTP(S) URLs.

```ts
import { createClangCompiler } from '@wasm-idle/llvm-core/clang';

const compiler = await createClangCompiler({
	runtimeBaseUrl: new URL('https://cdn.example.com/llvm/clang/')
});
```

The corresponding compiler patches, source pins, and reproducible asset producers are maintained
in the `wasm-llvm` repository. This package does not read files from that repository or its npm
package.

The wasm-idle sync step deterministically repackages the producer's single-entry archives as native
gzip delivery assets. Clang uses `memfs.wasm.gz`, `clang.wasm.gz`, `lld.wasm.gz`, and
`sysroot.tar.gz`; COBOL uses `cobc.wasm.gz`, `rootfs.tar.gz`, and `c-sysroot.tar.gz`. The browser
loader pipes gzip response bodies through `DecompressionStream('gzip')`. Runtime manifests from
older external deployments may still reference ZIP files; those load `fflate` only on the legacy
compatibility path.

## LLDB debug sessions

`@wasm-idle/llvm-core/debug` provides the low-level browser session that connects a dedicated LLDB
worker to a dedicated WAMR target worker. DAP and GDB RSP are carried on separate
`SharedArrayBuffer` byte queues, and stdin, stdout, and stderr use independent queues. The session
verifies the module, source, loader, Wasm, and pthread-sidecar hashes before creating either worker.

```ts
import { createBrowserLldbSession } from '@wasm-idle/llvm-core/debug';

const session = await createBrowserLldbSession({
	manifest,
	runtimeBaseUrl: new URL('https://cdn.example.com/llvm/clang/'),
	module: artifact.bytes,
	moduleSha256: artifact.debug?.moduleSha256,
	sources,
	launch: {
		program: '/workspace/program.wasm',
		stopOnEntry: true,
		args: ['demo'],
		env: { MODE: 'debug' },
		cwd: '/workspace'
	}
});
await session.initialize();
```

Compile C/C++ LLDB artifacts with `compileArtifact(..., { debugMode: 'lldb' })`. They contain
untouched source, embedded DWARF, stable `/workspace/...` paths, and exact Clang provenance.
`compileLinkRun()` rejects `lldb` because an LLDB artifact must not be instantiated through the
normal browser execution path. Launch arguments, WASI environment variables, and the `/workspace`
working directory are forwarded to WAMR rather than being applied only to LLDB's attach request.
The target launch also reserves a 1 MiB WAMR app heap for the debugger's scratch region, matching
the verified native source-debug baseline, and runs WAMR at verbosity zero so runtime diagnostics
do not contaminate the guest's stdout/stderr streams.
The LLDB producer runs its blocking DAP main loop on an Emscripten pthread. Its JavaScript
proxy-main stub returns as soon as that pthread starts, so the LLDB worker remains alive until the
runtime reports a real exit, abort, or session disposal.

The debug runtime requires a cross-origin-isolated page with `SharedArrayBuffer`. LLDB and WAMR
assets are lazy-loaded from the versioned producer manifest and are not included in this npm
package.

Repository CI runs `test:browser:debug:lldb` for every pull request and `main` push in a dedicated
Chromium job. The gate installs Chromium, prepares the external Clang test assets, and requires the
pinned product LLDB/WAMR binaries for C, C++, and Rust; the test cannot silently fall back to trace
debugging.
