import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { syncNimLsp, verifyNimLspAsset } from './sync-nim-lsp.mjs';

test('Nim LSP source receipts reject changed, missing and truncated bytes', () => {
	const expected = {
		bytes: 3,
		sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
	};
	assert.equal(verifyNimLspAsset(Buffer.from('abc'), expected, 'fixture').length, 3);
	for (const [input, receipt] of [
		[Buffer.from('abd'), expected],
		[Buffer.from('ab'), expected],
		[Buffer.from('abc'), undefined]
	])
		assert.throws(() => verifyNimLspAsset(input, receipt, 'fixture'), /size\/SHA-256/);
});

test(
	'mirrors the source-built original Nim LSP and complete standard library reproducibly',
	{ skip: process.env.WASM_IDLE_RUN_NIM_LSP_ASSET_BUILD !== '1' },
	async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-nim-lsp-assets-'));
		try {
			const first = await syncNimLsp({ targetDir: path.join(directory, 'one') });
			// Compile again from separately extracted original sources. Reusing only the
			// verified immutable input archives cannot hide absolute source filenames.
			const root = fileURLToPath(new URL('../', import.meta.url));
			const cache = path.join(directory, 'a-separate-producer-directory');
			await mkdir(cache);
			const lock = JSON.parse(
				await readFile(path.join(root, 'scripts/nim-lsp-assets.lock.json'), 'utf8')
			);
			for (const input of Object.values(lock.inputs))
				await copyFile(
					path.join(root, '.cache/nim-lsp', input.archive),
					path.join(cache, input.archive)
				);
			const producerDir = path.join(directory, 'independent-output');
			execFileSync(
				'python3',
				[
					path.join(root, 'producers/nim-lsp/build.py'),
					'--cache-dir',
					cache,
					'--out-dir',
					producerDir
				],
				{ cwd: root, stdio: 'inherit' }
			);
			const second = await syncNimLsp({
				producerDir,
				buildProducer: false,
				targetDir: path.join(directory, 'two')
			});
			assert.deepEqual(first.profile, second.profile);
			for (const [name, expected] of Object.entries(first.profile.assets))
				verifyNimLspAsset(
					await readFile(path.join(directory, 'two', name)),
					expected,
					name
				);
			for (const [name, expected] of Object.entries(first.profile.logical))
				verifyNimLspAsset(
					gunzipSync(await readFile(path.join(directory, 'one', name))),
					expected,
					name
				);
			assert.equal(first.profile.revision, '5fa2846f04600c2cf1173625976e037389db4489');
			assert.equal(first.profile.compiler.version, '2.2.4');
			const library = JSON.parse(
				gunzipSync(await readFile(path.join(directory, 'one/stdlib.json.gz.bin')))
			);
			assert(library.files.some((file) => file.path === 'lib/system.nim'));
			assert(library.files.some((file) => file.path === 'config/nim.cfg'));
			assert(library.files.some((file) => file.path === 'lib/pure/strutils.nim'));
		} finally {
			if (process.env.WASM_IDLE_NIM_LSP_KEEP_PRODUCER === '1')
				console.log('Nim independent producer kept at', directory);
			else await rm(directory, { recursive: true, force: true });
		}
	}
);
