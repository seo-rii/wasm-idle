#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const producer = fileURLToPath(
	new URL('../runtimes/wasm-scala/prepare-assets.mjs', import.meta.url)
);
const output = fileURLToPath(new URL('../static/wasm-scala/', import.meta.url));
const child = spawn(process.execPath, [producer, '--output', output, ...process.argv.slice(2)], {
	stdio: 'inherit'
});
child.on('error', (error) => {
	console.error(error);
	process.exitCode = 1;
});
child.on('exit', (code) => {
	process.exitCode = code ?? 1;
});
