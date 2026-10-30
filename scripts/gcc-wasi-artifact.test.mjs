// Synthetic binary/host tests only. They do not establish GCC compilation.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectWasm, runNodeWasi } from './gcc-wasi-artifact.mjs';

const header = [0, 97, 115, 109, 1, 0, 0, 0];
const section = (id, payload) => [id, payload.length, ...payload];
const encodeName = (name) => [name.length, ...new TextEncoder().encode(name)];
function syntheticCommand(imported = false) {
	return Uint8Array.from([
		...header,
		...section(1, [1, 0x60, 0, 0]),
		...(imported
			? section(2, [1, ...encodeName('env'), ...encodeName('unresolved'), 0, 0])
			: []),
		...section(3, [1, 0]),
		...section(5, [1, 0, 1]),
		...section(7, [
			2,
			...encodeName('memory'),
			2,
			0,
			...encodeName('_start'),
			0,
			imported ? 1 : 0
		]),
		...section(10, [1, 2, 0, 0x0b])
	]);
}

test('synthetic Wasm inspection distinguishes relocatable objects and WASI commands', () => {
	const command = inspectWasm(syntheticCommand());
	assert.equal(command.kind, 'wasi-preview1-command');
	assert.equal(command.memories[0].initial, 1);
	assert.deepEqual(command.imports, []);
	const object = Uint8Array.from([...header, ...section(0, [...encodeName('linking'), 2])]);
	assert.equal(inspectWasm(object, { object: true }).kind, 'wasm-relocatable-object');
	assert.throws(
		() => inspectWasm(syntheticCommand(), { object: true }),
		/linking custom section/
	);
});

test('synthetic ABI negatives reject foreign imports, malformed lengths and non-Wasm output', () => {
	assert.throws(() => inspectWasm(syntheticCommand(true)), /other than WASI Preview 1/);
	assert.throws(
		() => inspectWasm(Uint8Array.from([...header, 5, 100, 0])),
		/beyond the artifact/
	);
	assert.throws(() => inspectWasm(Uint8Array.from([0x7f, 69, 76, 70])), /WebAssembly v1/);
	assert.throws(() => inspectWasm(Uint8Array.from([...header, 5, 3, 1, 4, 0])), /wasm32 limits/);
});

test('synthetic empty WASI command executes in the disposable Node host', async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-wasi-host-test-'));
	try {
		const file = path.join(directory, 'synthetic.wasm');
		await fs.writeFile(file, syntheticCommand());
		assert.equal(
			runNodeWasi(file, { id: 'synthetic-host-only', stdin: '', stdout: '' }).exitCode,
			0
		);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test('independent Node host preserves binary preopen inputs and checks complete sorted snapshots', async () => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gcc-wasi-preopen-test-'));
	try {
		const file = path.join(directory, 'synthetic.wasm');
		await fs.writeFile(file, syntheticCommand());
		const input = Uint8Array.from([0, 128, 255, 10]);
		const fixture = {
			id: 'synthetic-preopen-host-only',
			stdin: '',
			stdout: '',
			runOptions: {
				preopens: [
					{
						path: '/z',
						directories: ['empty'],
						files: [{ path: 'binary', contents: input }]
					},
					{ path: '/a', files: [{ path: 'nested/text', contents: '한글\n' }] }
				]
			},
			expectedFiles: [
				{ path: '/a/nested/text', contents: '한글\n' },
				{ path: '/z/binary', contents: input }
			]
		};
		const result = runNodeWasi(file, fixture);
		assert.deepEqual(result.files[1].contents, [0, 128, 255, 10]);
		assert.deepEqual([...input], [0, 128, 255, 10]);
		assert.throws(
			() => runNodeWasi(file, { ...fixture, expectedFiles: [] }),
			/Node WASI files/
		);
	} finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
});

test('independent Node host does not claim to enforce SDK read-only mounts or quotas', () => {
	const fixture = { id: 'unsupported-host-policy', stdin: '', stdout: '' };
	assert.throws(
		() =>
			runNodeWasi('unused.wasm', {
				...fixture,
				runOptions: { preopens: [{ path: '/readonly', readonly: true }] }
			}),
		/read-only preopens/
	);
	assert.throws(
		() =>
			runNodeWasi('unused.wasm', {
				...fixture,
				runOptions: { filesystemLimits: { maxEntries: 2 } }
			}),
		/memory filesystem quotas/
	);
});
