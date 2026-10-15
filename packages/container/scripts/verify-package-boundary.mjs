import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const files = await readdir(new URL('dist/', root), { recursive: true });
assert.ok(files.includes('index.js'));
for (const file of files) assert.ok(!/\.(?:wasm|webc|tar|gz|tgz|zip|data|a|o|pack)$/i.test(file), `Binary in host package: ${file}`);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.equal(pkg.sideEffects, false);
let requests = 0;
const original = globalThis.fetch;
globalThis.fetch = () => { requests++; throw new Error('Root import fetched an asset'); };
try { await import(new URL('dist/index.js', root)); } finally { globalThis.fetch = original; }
assert.equal(requests, 0);
console.log(`Host-only package boundary verified: ${fileURLToPath(root)}`);
