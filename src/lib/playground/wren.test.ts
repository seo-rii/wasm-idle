// @vitest-environment node

import { WASI } from 'node:wasi';
import {
	closeSync,
	mkdtempSync,
	openSync,
	readFileSync,
	rmSync,
	writeFileSync,
	mkdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { WREN_INTERPRETER } from './wasmWrenVersion';

const binary = readFileSync('static/wasm-wren/wren.wasm');
async function run(source: string, input = '', files: Record<string, string> = {}) {
	const directory = mkdtempSync(join(tmpdir(), 'wasm-idle-wren-test-'));
	const descriptors: number[] = [];
	try {
		for (const [name, content] of Object.entries({ 'main.wren': source, ...files })) {
			const destination = join(directory, name);
			mkdirSync(join(destination, '..'), { recursive: true });
			writeFileSync(destination, content);
		}
		writeFileSync(join(directory, 'stdin'), input);
		descriptors.push(
			openSync(join(directory, 'stdin'), 'r'),
			openSync(join(directory, 'stdout'), 'w'),
			openSync(join(directory, 'stderr'), 'w')
		);
		const wasi = new WASI({
			version: 'preview1',
			returnOnExit: true,
			args: ['wren', '/work/main.wren'],
			preopens: { '/work': directory },
			stdin: descriptors[0],
			stdout: descriptors[1],
			stderr: descriptors[2]
		});
		const { instance } = await WebAssembly.instantiate(binary, {
			wasi_snapshot_preview1: wasi.wasiImport
		});
		const exitCode = wasi.start(instance);
		return {
			exitCode,
			stdout: readFileSync(join(directory, 'stdout'), 'utf8'),
			stderr: readFileSync(join(directory, 'stderr'), 'utf8')
		};
	} finally {
		for (const descriptor of descriptors) closeSync(descriptor);
		rmSync(directory, { recursive: true, force: true });
	}
}

describe('pinned upstream Wren VM', () => {
	it('pins the actual runtime bytes', () => {
		expect(binary.length).toBe(WREN_INTERPRETER.bytes);
		expect(createHash('sha256').update(binary).digest('hex')).toBe(WREN_INTERPRETER.sha256);
	});
	it('reads UTF-8 lines, CRLF, a final unterminated line and EOF', async () => {
		const report = await run(
			'import "io" for Stdin\nfor (i in 0..3) System.print(Stdin.readLine())',
			'한글 🦀\r\nsecond\nlast'
		);
		expect(report).toEqual({
			exitCode: 0,
			stdout: '한글 🦀\nsecond\nlast\nnull\n',
			stderr: ''
		});
	});
	it('preserves byte input and output including NUL', async () => {
		const report = await run(
			'import "io" for Stdin, Stdout\nwhile (true) {\n  var b = Stdin.readByte()\n  if (b == null) break\n  Stdout.write(String.fromByte(b))\n}',
			'A\0한글 🦀\n'
		);
		expect(report).toEqual({ exitCode: 0, stdout: 'A\0한글 🦀\n', stderr: '' });
	});
	it('runs classes, closures, fibers and optional modules in the real VM', async () => {
		const report = await run(
			'import "random" for Random\nclass Counter {\n  construct new(n) { _n = n }\n  next {\n    _n = _n + 1\n    return _n\n  }\n}\nvar c = Counter.new(40)\nvar f = Fiber.new {\n  Fiber.yield(c.next)\n  return c.next\n}\nSystem.print(f.call())\nSystem.print(f.call())\nSystem.print(Random.new(42).int(1))'
		);
		expect(report).toEqual({ exitCode: 0, stdout: '41\n42\n0\n', stderr: '' });
	});
	it('resolves nested workspace modules and caches normalized imports', async () => {
		const report = await run(
			'import "./lib/value" for Value\nimport "lib/../lib/value" for Value as Again\nSystem.print(Value.answer + Again.answer)',
			'',
			{ 'lib/value.wren': 'System.print("loaded")\nclass Value { static answer { 21 } }' }
		);
		expect(report).toEqual({ exitCode: 0, stdout: 'loaded\n42\n', stderr: '' });
	});
	it('uses the entry module identity when a script imports itself', async () => {
		const report = await run(
			'System.print("entry")\nclass Value { static answer { 42 } }\nimport "./main" for Value as Again\nSystem.print(Again.answer)'
		);
		expect(report).toEqual({ exitCode: 0, stdout: 'entry\n42\n', stderr: '' });
	});
	it('returns compile and runtime errors with diagnostics and starts fresh next time', async () => {
		const invalid = await run('var broken =');
		expect(invalid.exitCode).toBe(65);
		expect(invalid.stderr).toContain('Error');
		const aborted = await run('Fiber.abort("wren-failure")');
		expect(aborted.exitCode).toBe(70);
		expect(aborted.stderr).toContain('wren-failure');
		expect(await run('System.print(6 * 7)')).toEqual({
			exitCode: 0,
			stdout: '42\n',
			stderr: ''
		});
	});
});
