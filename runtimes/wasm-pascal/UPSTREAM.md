# wasm-pascal upstream notes

This runtime uses Free Pascal `pas2js` 3.2.1 as the in-browser Pascal compiler.

- `src/wasm_idle_pascal_compiler.pas` is a small wrapper around upstream `TPas2JSWebCompiler`.
- `src/webfilecache.pp` is copied from upstream `compiler/utils/pas2js/webfilecache.pp` with verbose logging disabled.
- `src/system.pas` is copied from upstream `packages/rtl/src/system.pas` with `ReadLn` bindings added for wasm-idle stdin.
- `dist/compiler.js` is generated from the wrapper with a native `pas2js` build and is synced to `static/wasm-pascal`.

To regenerate `dist`, build upstream `pas2js`, then run:

```sh
PAS2JS_REPO_DIR=/path/to/pas2js node runtimes/wasm-pascal/scripts/build.mjs
npm run sync:wasm-pascal
npm run compress:static-runtimes
```
