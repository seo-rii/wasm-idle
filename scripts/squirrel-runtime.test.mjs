import { WASI } from 'node:wasi';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const wasm = await WebAssembly.compile(
	await readFile(new URL('../static/wasm-squirrel/squirrel.wasm', import.meta.url))
);

async function execute(source, input = '') {
	const directory = await mkdtemp(path.join(tmpdir(), 'squirrel-test-'));
	const handles = [];
	try {
		await writeFile(path.join(directory, 'main.nut'), source);
		await writeFile(path.join(directory, 'input'), input);
		for (const [name, flags] of [
			['input', 'r'],
			['output', 'w'],
			['error', 'w']
		]) {
			handles.push(await open(path.join(directory, name), flags));
		}
		const wasi = new WASI({
			version: 'preview1',
			args: ['squirrel', '/main.nut'],
			preopens: { '/': directory },
			stdin: handles[0].fd,
			stdout: handles[1].fd,
			stderr: handles[2].fd,
			returnOnExit: true
		});
		const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
		const code = wasi.start(instance);
		return {
			code,
			output: await readFile(path.join(directory, 'output'), 'utf8'),
			error: await readFile(path.join(directory, 'error'), 'utf8')
		};
	} finally {
		await Promise.all(handles.map((handle) => handle.close()));
		await rm(directory, { recursive: true, force: true });
	}
}

test('real Squirrel runs classes, closures, generators and float64 math', async () => {
	const result = await execute(`
class Counter { value = 40; function next() { return ++value; } }
local c = Counter();
function values() { yield c.next(); yield c.next(); }
foreach (n in values()) print(n + "\\n");
local f = function(x) { return function(y) { return x + y; }; };
print(f(10)(32) + "\\n");
print(format("%.0f", 16777217.0));
`);
	assert.equal(result.code, 0);
	assert.equal(result.output, '41\n42\n42\n16777217');
});

test('byte stdin preserves UTF-8, NUL, partial final lines and EOF', async () => {
	const input = '한글 🦀\n\0partial';
	const result = await execute(
		`while (true) {
try { stdout.writen(stdin.readn('b'), 'b'); }
catch (error) { if (stdin.eos()) break; throw error; }
}`,
		input
	);
	assert.equal(result.code, 0);
	assert.equal(result.output, input);
});

test('compiler and regexp errors use real longjmp recovery and return failures', async () => {
	const syntax = await execute('local = ;');
	assert.equal(syntax.code, 1);
	assert.match(syntax.error, /error/i);
	const runtime = await execute('throw "runtime failure";');
	assert.equal(runtime.code, 1);
	assert.match(runtime.error, /runtime failure/);
	const regex = await execute('try { regexp("["); } catch (error) { print("caught"); }');
	assert.equal(regex.code, 0);
	assert.equal(regex.output, 'caught');
	assert.equal((await execute('print(6 * 7);')).output, '42');
});
