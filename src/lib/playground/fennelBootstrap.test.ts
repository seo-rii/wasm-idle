// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { executeBrowserLuaArtifact } from '../../../runtimes/wasm-lua/src/index';
import { editorDefaults } from '../../routes/editor-defaults';
import {
	buildFennelCompileChunk,
	buildFennelRunChunk,
	luaQuotedString,
	parseFennelDiagnostic,
	stripHostLuaTraceback,
	verifyFennelCompilerBytes
} from './fennelBootstrap';
import { WASM_FENNEL_COMPILER_RECEIPT } from './wasmFennelVersion';

const repoRoot = process.cwd();
const compilerAsset = new Uint8Array(
	readFileSync(resolve(repoRoot, 'static', WASM_FENNEL_COMPILER_RECEIPT.path))
);
const wasmUrl = resolve(repoRoot, 'runtimes/wasm-lua/node_modules/wasmoon/dist/glue.wasm');

async function runFennel(code: string, stdinChunks: string[] = [], args: string[] = []) {
	const fennelSource = await verifyFennelCompilerBytes(
		compilerAsset,
		WASM_FENNEL_COMPILER_RECEIPT
	);
	const compile = await executeBrowserLuaArtifact(
		{ source: buildFennelCompileChunk(fennelSource, code, 'main.fnl'), fileName: 'main.fnl' },
		{ wasmUrl, stdin: () => null }
	);
	if (compile.exitCode !== 0) return { phase: 'compile' as const, ...compile };
	const pending = [...stdinChunks];
	const run = await executeBrowserLuaArtifact(
		{ source: buildFennelRunChunk(fennelSource, code, 'main.fnl'), fileName: 'main.fnl' },
		{ wasmUrl, args, stdin: () => pending.shift() ?? null }
	);
	return { phase: 'run' as const, ...run };
}

describe('Fennel bootstrap on the wasm-lua runtime', () => {
	it('verifies the pinned official fennel.lua receipt', async () => {
		expect(compilerAsset.byteLength).toBe(WASM_FENNEL_COMPILER_RECEIPT.bytes);
		const source = await verifyFennelCompilerBytes(compilerAsset, WASM_FENNEL_COMPILER_RECEIPT);
		expect(source.length).toBeGreaterThan(100_000);
		expect(source).toContain('local version = "1.6.1"');
		expect(source.startsWith('-- SPDX-License-Identifier: MIT')).toBe(true);
	});

	it('accepts server-decoded compiler bytes against the uncompressed receipt', async () => {
		const decoded = new Uint8Array(gunzipSync(compilerAsset));
		await expect(
			verifyFennelCompilerBytes(decoded, WASM_FENNEL_COMPILER_RECEIPT)
		).resolves.toContain('fennel');
	});

	it('rejects tampered compiler assets', async () => {
		const tampered = compilerAsset.slice();
		tampered[tampered.length - 9] ^= 0xff;
		await expect(
			verifyFennelCompilerBytes(tampered, WASM_FENNEL_COMPILER_RECEIPT)
		).rejects.toThrow(/SHA-256/);
		const decoded = new Uint8Array(gunzipSync(compilerAsset));
		decoded[100] ^= 0x01;
		await expect(
			verifyFennelCompilerBytes(decoded, WASM_FENNEL_COMPILER_RECEIPT)
		).rejects.toThrow(/SHA-256/);
		await expect(
			verifyFennelCompilerBytes(compilerAsset.slice(0, 100), WASM_FENNEL_COMPILER_RECEIPT)
		).rejects.toThrow(/receipt expects/);
	});

	it('quotes arbitrary source text as a Lua string literal', () => {
		expect(luaQuotedString('a"b\\c\n\u0001é]]')).toBe('"a\\"b\\\\c\\010\\001é]]"');
	});

	it('runs the editor default through fennel.eval with stdin and stdout', async () => {
		const result = await runFennel(editorDefaults.fennel, ['5\n']);
		expect(result.phase).toBe('run');
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('fibonacci=11\n');
	});

	it('streams multiple stdin lines, reads to EOF, and exposes program args', async () => {
		const result = await runFennel(
			`(local name (io.read))
(local rest (io.read :a))
(print (.. "hello " name))
(print (.. "rest=" (rest:gsub "\\n" ",")))
(print (.. "arg1=" (. arg 1)))`,
			['fennel\n', 'one\n', 'two\n'],
			['demo']
		);
		expect(result.stderr).toBe('');
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('hello fennel\nrest=one,two,\narg1=demo\n');
	});

	it('supports macros and pattern matching from the real compiler', async () => {
		const result = await runFennel(`(macro twice [x] \`(do ,x ,x))
(var n 0)
(twice (set n (+ n 1)))
(case [1 2 3]
  [a b c] (print (+ a b c n)))`);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe('8\n');
	});

	it('reports compile errors with the Fennel file position before running', async () => {
		const result = await runFennel('(print "before")\n(undefined-thing 1)');
		expect(result.phase).toBe('compile');
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe('');
		const diagnostic = parseFennelDiagnostic(result.stderr, 'main.fnl');
		expect(diagnostic).toMatchObject({
			fileName: 'main.fnl',
			lineNumber: 2,
			columnNumber: 2,
			severity: 'error'
		});
		expect(diagnostic.message).toContain('unknown identifier: undefined-thing');
		expect(diagnostic.message).not.toContain('stack traceback');
	});

	it('reports parse errors from the Fennel reader', async () => {
		const result = await runFennel('(print "unclosed"');
		expect(result.phase).toBe('compile');
		const diagnostic = parseFennelDiagnostic(result.stderr, 'main.fnl');
		expect(diagnostic.lineNumber).toBe(1);
		expect(diagnostic.message).toContain('Parse error');
	});

	it('surfaces runtime errors without the host Lua traceback', async () => {
		const result = await runFennel('(print "start")\n(error "boom")');
		expect(result.phase).toBe('run');
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe('start\n');
		expect(stripHostLuaTraceback(result.stderr)).toBe('main.fnl:2: boom');
	});
});
