import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createJavacsCspRuntime } from '../../scripts/teavm/javacs-csp-runtime.mjs';

// TeaVM's WasmGCJsoCommonGenerator.writeToInitializer emits every reachable
// @JSBody factory into the eager Wasm module initializer. Loading the module
// therefore inventories the complete program, without a request coverage guess.
const dist = new URL('./build/dist/', import.meta.url);
const scratch = new URL('../../.cache/javacs-teavm/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('./jso-bodies.expected.json', import.meta.url), 'utf8'));
const raw = await readFile(new URL('javacs-runtime.mjs', dist), 'utf8');
await mkdir(scratch, { recursive: true });
const runtime = new URL('producer-csp-runtime.mjs', scratch);
await writeFile(runtime, createJavacsCspRuntime(raw, expected));
const { load } = await import(runtime);
const bodies = [];
const wasm = await readFile(new URL('javacs.wasm', dist));
await WebAssembly.compile(wasm, { builtins: ['js-string'] });
await load(wasm, {
  stackDeobfuscator: { enabled: false },
  noAutoImports: true,
  installImports(imports) {
    const jso = imports.teavmJso;
    for (const key of Object.keys(jso)) {
      if (!/^createFunction\d+$/.test(key)) continue;
      const original = jso[key];
      jso[key] = function (...args) {
        bodies.push({ params: args.slice(0, -1), body: args.at(-1) });
        return original.apply(this, args);
      };
    }
  }
});
const canonical = (items) => items.map((entry) => JSON.stringify(entry)).sort();
assert.deepEqual(canonical(bodies), canonical(expected), 'The reachable JavaScript body inventory changed');
await writeFile(new URL('jso-bodies.json', dist), `${JSON.stringify(bodies, null, 2)}\n`);
console.log(`Validated Wasm and all ${bodies.length} eager JavaScript bodies with static CSP factories`);
