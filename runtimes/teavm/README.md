# TeaVM Assets

Java execution uses TeaVM's browser compiler/runtime assets from `static/teavm/`:

- `compiler.wasm`
- `compiler.wasm-runtime.js`
- `compile-classlib-teavm.bin`
- `runtime-classlib-teavm.bin`

No local TeaVM source checkout was found next to the existing runtime repositories. These files are
therefore tracked as external runtime artifacts with provenance documented here, while Java-specific
integration code lives in `src/lib/playground/worker/java.ts` and
`src/lib/playground/javaStdin.ts`.

If a local TeaVM build project is added later, put it under this directory and wire a sync script to
copy the four generated files into `static/teavm/`.
