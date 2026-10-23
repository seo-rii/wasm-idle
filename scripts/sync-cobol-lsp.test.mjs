import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
	syncCobolLsp,
	verifyCobolLspAsset,
	adaptSuperbolBrowserRuntime
} from './sync-cobol-lsp.mjs';

const known = {
	bytes: 3,
	sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
};
test('COBOL source receipts reject changed or truncated release assets', () => {
	assert.equal(verifyCobolLspAsset(Buffer.from('abc'), known, 'fixture').length, 3);
	assert.throws(() => verifyCobolLspAsset(Buffer.from('ab'), known, 'fixture'), /size\/SHA-256/);
	assert.throws(() => verifyCobolLspAsset(Buffer.from('abd'), known, 'fixture'), /size\/SHA-256/);
});

test('adapts only the pinned js_of_ocaml VM primitive and rejects unexpected code', () => {
	const primitive = 'do{eB=40;try{c=V(c.joo_tramp,c.joo_args)}';
	const source = Buffer.from('prefix;' + primitive + ';suffix');
	assert.equal(
		adaptSuperbolBrowserRuntime(source).toString(),
		source.toString().replace('eB=40', 'eB=4')
	);
	assert.throws(() => adaptSuperbolBrowserRuntime(Buffer.from('other release')), /trampoline/);
	assert.throws(
		() => adaptSuperbolBrowserRuntime(Buffer.from(primitive + primitive)),
		/trampoline/
	);
});

test(
	'mirrors reproducible unmodified SuperBOL OSS JavaScript and dialect data',
	{ skip: process.env.WASM_IDLE_RUN_COBOL_LSP_ASSET_BUILD !== '1' },
	async () => {
		const directory = await mkdtemp(path.join(tmpdir(), 'wasm-idle-cobol-assets-'));
		try {
			const first = await syncCobolLsp({ targetDir: path.join(directory, 'one') });
			const second = await syncCobolLsp({ targetDir: path.join(directory, 'two') });
			assert.deepEqual(first.profile, second.profile);
			for (const [name, expected] of Object.entries(first.profile.assets))
				verifyCobolLspAsset(
					await readFile(path.join(directory, 'two', name)),
					expected,
					name
				);
			const server = gunzipSync(
				await readFile(path.join(directory, 'one/superbol-free.js.gz.bin'))
			);
			verifyCobolLspAsset(server, first.profile.server, 'original server');
			assert.equal(
				first.profile.server.sha256,
				'b86ba24a074bd555af024bd583dea81ad26703c63900ed0fd4f54a91fe96ba8a'
			);
			assert.equal(first.profile.revision, 'bf5491727e140334a1ec437ff1a3c3363f7bbe4e');
			const configuration = gunzipSync(
				await readFile(path.join(directory, 'one/gnucobol-config.json.gz.bin'))
			);
			verifyCobolLspAsset(
				configuration,
				first.profile.configuration,
				'dialect configuration'
			);
			assert.equal(JSON.parse(configuration).files.length, 38);
			assert.match(
				await readFile(path.join(directory, 'one/LICENSE.superbol.md'), 'utf8'),
				/GNU AFFERO GENERAL PUBLIC LICENSE/
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}
);
