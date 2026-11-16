import { readFile } from 'node:fs/promises';
import { WASI } from 'node:wasi';
const args = process.argv.slice(2);
const wasi = new WASI({ version: 'preview1', args, env: {}, returnOnExit: true });
const module = await WebAssembly.compile(await readFile(args[0]));
const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi.wasiImport });
process.exitCode = wasi.start(instance);
