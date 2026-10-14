import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../', import.meta.url));
for (const [name, initial] of [['command', 131072], ['live', 524288], ['path', 131072]]) {
  const args = ['--target=wasm32', '-nostdlib', '-O0', '-Wl,--no-entry', '-Wl,--export-memory', `-Wl,--initial-memory=${initial}`, '-Wl,--max-memory=8388608', `test/fixtures/${name}.c`, '-o', `test/fixtures/${name}.wasm`];
  const result = spawnSync(process.env.CLANG ?? 'clang', args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(JSON.stringify({ args, sha256: createHash('sha256').update(readFileSync(`${cwd}/test/fixtures/${name}.wasm`)).digest('hex') }));
}
