// Run a compiled program in a disposable process so a Wasm trap or an infinite
// loop cannot poison the qualification host. stdin/stdout are real host FDs.
import fs from 'node:fs/promises';
import { WASI } from 'node:wasi';

const [program, ...args] = process.argv.slice(2);
if (!program) throw new Error('Usage: node gcc-wasi-node-runner.mjs PROGRAM.wasm [ARGS...]');
const wasi = new WASI({
	version: 'preview1',
	args: ['program', ...args],
	env: {},
	returnOnExit: true
});
const module = await WebAssembly.compile(await fs.readFile(program));
const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
process.exitCode = wasi.start(instance);
