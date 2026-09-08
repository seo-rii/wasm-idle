import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compressStaticRuntimeAssets } from './compress-static-runtime-assets.mjs';
import { verifyPinnedRuntimeAssets } from './verify-pinned-runtime-assets.mjs';

async function fixture(t) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'pinned-compiler-page-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const rootDir = path.join(root, 'static');
	const directory = 'wasm-fixture';
	await mkdir(path.join(rootDir, directory), { recursive: true });
	const files = {
		'compiler.wasm': Buffer.alloc(300_000, 17),
		'runner-worker.js': Buffer.from('verified worker')
	};
	const assets = {};
	for (const [name, bytes] of Object.entries(files)) {
		assets[name] = {
			bytes: bytes.length,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		await writeFile(path.join(rootDir, directory, name), bytes);
	}
	return { root, rootDir, directory, assets };
}

test('verifies release input and the copied, twice-compressed page output', async (t) => {
	const f = await fixture(t);
	const expected = await verifyPinnedRuntimeAssets(f);
	await compressStaticRuntimeAssets({ rootDir: f.rootDir });
	await verifyPinnedRuntimeAssets(f);
	const buildDir = path.join(f.root, 'build');
	await cp(f.rootDir, buildDir, { recursive: true });
	await compressStaticRuntimeAssets({ rootDir: buildDir });
	assert.deepEqual(await verifyPinnedRuntimeAssets({ ...f, rootDir: buildDir }), expected);
});

test('fails when an enabled compiler bundle is missing in a fresh checkout', async (t) => {
	const f = await fixture(t);
	await rm(path.join(f.rootDir, f.directory), { recursive: true });
	await assert.rejects(verifyPinnedRuntimeAssets(f), /Missing.*runtime directory/);
});

test('rejects tampered compiler bytes and missing worker files', async (t) => {
	for (const mutation of ['tamper', 'missing']) {
		await t.test(mutation, async (t) => {
			const f = await fixture(t);
			const file = path.join(
				f.rootDir,
				f.directory,
				mutation === 'tamper' ? 'compiler.wasm' : 'runner-worker.js'
			);
			if (mutation === 'tamper') await writeFile(file, Buffer.alloc(300_000, 18));
			else await rm(file);
			await assert.rejects(verifyPinnedRuntimeAssets(f), /mismatch|Missing/);
		});
	}
});

test('rejects compressed output with a missing or stale delivery index', async (t) => {
	for (const mutation of ['missing', 'size', 'duplicate', 'stale']) {
		await t.test(mutation, async (t) => {
			const f = await fixture(t);
			await compressStaticRuntimeAssets({ rootDir: f.rootDir });
			const file = path.join(f.rootDir, 'compressed-runtime-assets.v1.json');
			const index = JSON.parse(await readFile(file));
			if (mutation === 'missing') await rm(file);
			else {
				if (mutation === 'size') index.sizes['wasm-fixture/compiler.wasm']++;
				if (mutation === 'duplicate') index.assets.push(index.assets[0]);
				if (mutation === 'stale') index.assets.push('wasm-fixture/old.wasm');
				await writeFile(file, JSON.stringify(index));
			}
			await assert.rejects(verifyPinnedRuntimeAssets(f), /Missing|Stale/);
		});
	}
});

test('rejects symlinked or unexpected bundle content', async (t) => {
	for (const mutation of ['symlink', 'extra']) {
		await t.test(mutation, async (t) => {
			const f = await fixture(t);
			const file = path.join(f.rootDir, f.directory, 'runner-worker.js');
			if (mutation === 'symlink') {
				const copy = path.join(f.root, 'worker.js');
				await cp(file, copy);
				await rm(file);
				await symlink(copy, file);
			} else await writeFile(path.join(f.rootDir, f.directory, 'stale.js'), 'stale');
			await assert.rejects(verifyPinnedRuntimeAssets(f), /non-regular|Unexpected/);
		});
	}
});
