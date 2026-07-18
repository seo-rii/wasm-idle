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
