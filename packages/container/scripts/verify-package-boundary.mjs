import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const files = await readdir(new URL('dist/', root), { recursive: true });
assert.ok(files.includes('index.js'));
for (const file of files) assert.ok(!/\.(?:wasm|webc|tar|gz|tgz|zip|data|a|o|pack)$/i.test(file), `Binary in host package: ${file}`);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
assert.equal(pkg.sideEffects, false);
const packed = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--dry-run'], {
  cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}));
assert.equal(packed.length, 1);
assert.equal(packed[0].name, pkg.name);
for (const { path } of packed[0].files) {
  assert.ok(/^(?:dist\/.*\.(?:js|d\.ts)|package\.json|[A-Z_-]+(?:\.md)?)$/u.test(path), `Unexpected tarball file: ${path}`);
}
for (const entry of Object.values(pkg.exports)) {
  for (const path of Object.values(entry)) assert.ok(packed[0].files.some((file) => file.path === path.replace(/^\.\//u, '')), `Missing export: ${path}`);
}
let requests = 0;
const original = globalThis.fetch;
globalThis.fetch = () => { requests++; throw new Error('Root import fetched an asset'); };
try { await import(new URL('dist/index.js', root)); } finally { globalThis.fetch = original; }
assert.equal(requests, 0);
console.log(`Host-only package boundary verified: ${packed[0].entryCount} files, ${packed[0].unpackedSize} bytes, ${fileURLToPath(root)}`);
