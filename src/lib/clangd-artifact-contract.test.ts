import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertClangdStdinBridge } from '../../scripts/llvm-contracts/clangd-artifact-contract.mjs';

function wasmImport(module = 'a', name = 'ca', kind = 'function') {
	const string = (value: string) => {
		const bytes = [...new TextEncoder().encode(value)];
		return [bytes.length, ...bytes];
	};
	const entry = [
		...string(module),
		...string(name),
		...(kind === 'function' ? [0, 0] : [3, 0x7f, 0])
	];
	return new Uint8Array([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		1,
		4,
		1,
		0x60,
		0,
		0,
		2,
		entry.length + 1,
		1,
		...entry
	]);
}

const callback =
	'function __asyncjs__waitForStdin(){return Asyncify.handleAsync(async()=>{await Module.stdinReady()})}';
const table =
	'function assignWasmImports(){wasmImports={ca:__asyncjs__waitForStdin,D:otherImport}}';
const namespace =
	'function getWasmImports(){assignWasmImports();var imports={a:wasmImports};return imports}';
const loader = `${callback};var wasmImports;${table};${namespace}`;

test('accepts the legacy named Asyncify import', async () => {
	await assertClangdStdinBridge(callback, wasmImport('env', '__asyncjs__waitForStdin'));
});

test('accepts optimized Emscripten import wiring without executing the loader', async () => {
	await assertClangdStdinBridge(`throw new Error('must not execute');${loader}`, wasmImport());
	await assertClangdStdinBridge(new TextEncoder().encode(loader), wasmImport());
});

test('accepts quoted keys and arbitrary minified names derived from the loader', async () => {
	const source = loader.replace('ca:', '"xyz":').replace('a:wasmImports', '"q":wasmImports');
	await assertClangdStdinBridge(source, wasmImport('q', 'xyz'));
});

test('rejects mismatched names, namespaces, and non-function imports', async () => {
	for (const bytes of [
		wasmImport('a', 'wrong'),
		wasmImport('env', 'ca'),
		wasmImport('a', 'ca', 'global')
	]) {
		await assert.rejects(
			assertClangdStdinBridge(loader, bytes),
			/missing the Asyncify stdin import/
		);
	}
});

test('requires the loader stdin readiness callback', async () => {
	await assert.rejects(
		assertClangdStdinBridge(`${table};${namespace}`, wasmImport()),
		/missing the browser stdin readiness callback/
	);
});

test('rejects unrelated tables and import mappings present only in comments or strings', async () => {
	for (const source of [
		`${callback};const unrelated={ca:__asyncjs__waitForStdin};${namespace}`,
		`${callback};/* ${table};${namespace} */`,
		`${callback};const decoy=${JSON.stringify(`${table};${namespace}`)}`,
		loader.replace('ca:__asyncjs__waitForStdin', 'ca:otherImport')
	]) {
		await assert.rejects(
			assertClangdStdinBridge(source, wasmImport()),
			/missing the Asyncify stdin import/
		);
	}
});

test('rejects ambiguous, dynamic, or overridden import mappings', async () => {
	for (const source of [
		loader.replace('D:otherImport', 'ca:otherImport'),
		loader.replace('D:otherImport', 'D:__asyncjs__waitForStdin'),
		loader.replace('ca:', '["ca"]:'),
		loader.replace('D:otherImport', '...extraImports'),
		loader.replace('a:wasmImports', 'a:wasmImports,b:wasmImports'),
		loader.replace('a:wasmImports', 'a:otherImports'),
		loader.replace('return imports', 'return anotherImports'),
		loader.replace('assignWasmImports();var', 'var'),
		loader.replace('};return imports', '};imports.a=otherImports;return imports'),
		`function first(){${loader}} function second(){${loader}}`
	]) {
		await assert.rejects(
			assertClangdStdinBridge(source, wasmImport()),
			/missing the Asyncify stdin import/
		);
	}
});
