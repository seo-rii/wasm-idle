#!/usr/bin/env node
// Isolated experiment, not a change to the public artifact/debugger export contract.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const dir = await mkdtemp(path.join(tmpdir(), 'wasm-link-exports-'));
try {
	await writeFile(path.join(dir, 'test.c'), `
volatile int value;
__attribute__((visibility("default"))) int unused_function(void) { return 123; }
int add(int a, int b) { return a + b; }
int (*volatile function_pointer)(int,int) = add;
void _start(void) { value = function_pointer(20,22); }
__attribute__((export_name("inspect"))) int inspect(void) { return value; }
`);
	const clang = process.env.CLANG || 'clang', linker = process.env.WASM_LD || 'wasm-ld';
	const version = execFileSync(clang, ['--version'], { encoding: 'utf8' }).split('\n')[0];
	execFileSync(clang, ['--target=wasm32-unknown-unknown', '-ffunction-sections', '-O0', '-c', path.join(dir, 'test.c'), '-o', path.join(dir, 'test.o')]);
	const report = { compiler: version, fixture: 'freestanding C; no WASI libc or LLDB', modes: {} };
	for (const dynamic of [true, false]) {
		const output = path.join(dir, dynamic ? 'dynamic.wasm' : 'explicit.wasm');
		execFileSync(linker, [path.join(dir, 'test.o'), ...(dynamic ? ['--export-dynamic'] : []), '-o', output]);
		const bytes = await readFile(output), module = await WebAssembly.compile(bytes);
		const instance = await WebAssembly.instantiate(module); instance.exports._start();
		assert.equal(instance.exports.inspect(), 42);
		const exports = WebAssembly.Module.exports(module).map(e => e.name);
		assert.equal(exports.includes('unused_function'), dynamic);
		report.modes[dynamic ? 'dynamic' : 'explicit'] = { bytes: bytes.length, exports, result: 42 };
	}
	console.log(JSON.stringify(report, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
