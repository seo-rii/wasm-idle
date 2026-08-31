import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import { verifyPageWasmDebugRelease } from './verify-page-wasm-debug.mjs';

const DEBUG_PREFIX = 'wasm-debug/';

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function verifyPageWasmDebug({ rootDir, ...options }) {
	return verifyPageWasmDebugRelease({ buildDir: rootDir, ...options });
}

async function writeJson(filePath, value) {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createFixture(t, { compressed = new Set() } = {}) {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-pages-'));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	const debugRoot = path.join(rootDir, 'wasm-debug');
	const manifestPath = path.join(debugRoot, 'runtime-manifest.v2.json');
	const compressedManifestPath = path.join(rootDir, 'compressed-runtime-assets.v1.json');
	const assets = {
		'debug/lldb-web-dap.js': Buffer.from('verified lldb javascript'),
		'debug/lldb-web-dap.wasm': Buffer.from('verified lldb webassembly'),
		'debug/lldb-web-dap.pthread.mjs': Buffer.from('verified lldb worker'),
		'debug/wamr-debug.js': Buffer.from('verified wamr javascript'),
		'debug/wamr-debug.wasm': Buffer.from('verified wamr webassembly'),
		'debug/wamr-debug.worker.mjs': Buffer.from('verified wamr worker')
	};
	const manifest = {
		manifestVersion: 2,
		version: 'fixture',
		debugger: {
			protocolVersion: 1,
			transport: 'shared-ring-v1',
			lldb: {
				js: 'debug/lldb-web-dap.js',
				wasm: 'debug/lldb-web-dap.wasm',
				worker: 'debug/lldb-web-dap.pthread.mjs',
				jsSha256: sha256(assets['debug/lldb-web-dap.js']),
				wasmSha256: sha256(assets['debug/lldb-web-dap.wasm']),
				workerSha256: sha256(assets['debug/lldb-web-dap.pthread.mjs']),
				llvmRevision: 'a'.repeat(40)
			},
			targetRuntime: {
				name: 'wamr',
				js: 'debug/wamr-debug.js',
				wasm: 'debug/wamr-debug.wasm',
				worker: 'debug/wamr-debug.worker.mjs',
				jsSha256: sha256(assets['debug/wamr-debug.js']),
				wasmSha256: sha256(assets['debug/wamr-debug.wasm']),
				workerSha256: sha256(assets['debug/wamr-debug.worker.mjs']),
				revision: 'b'.repeat(40)
			}
		}
	};
	const compressedManifest = { assets: [], sizes: {} };
	for (const [assetPath, bytes] of Object.entries(assets)) {
		const logicalPath = `${DEBUG_PREFIX}${assetPath}`;
		const targetPath = path.join(rootDir, logicalPath);
		await mkdir(path.dirname(targetPath), { recursive: true });
		if (compressed.has(assetPath)) {
			await writeFile(`${targetPath}.gz`, gzipSync(bytes, { level: 9 }));
			compressedManifest.assets.push(logicalPath);
			compressedManifest.sizes[logicalPath] = bytes.byteLength;
		} else {
			await writeFile(targetPath, bytes);
		}
	}
	await writeJson(manifestPath, manifest);
	await writeJson(compressedManifestPath, compressedManifest);

	const fixture = {
		assets,
		compressedManifest,
		compressedManifestPath,
		debugRoot,
		manifest,
		manifestPath,
		profile: undefined,
		rootDir,
		async refreshProfile() {
			const manifestBytes = await readFile(manifestPath);
			this.profile = {
				schemaVersion: 1,
				producerRevision: 'c'.repeat(40),
				manifestReceipt: {
					bytes: manifestBytes.byteLength,
					sha256: sha256(manifestBytes)
				}
			};
			return this.profile;
		},
		async writeCompressedManifest() {
			await writeJson(compressedManifestPath, compressedManifest);
		},
		async writeManifest() {
			await writeJson(manifestPath, manifest);
			await this.refreshProfile();
		}
	};
	await fixture.refreshProfile();
	return fixture;
}

test('verifies exactly six mixed raw and gzip Pages debug assets', async (t) => {
	const fixture = await createFixture(t, {
		compressed: new Set([
			'debug/lldb-web-dap.wasm',
			'debug/wamr-debug.js',
			'debug/wamr-debug.worker.mjs'
		])
	});

	const result = await verifyPageWasmDebug({
		rootDir: fixture.rootDir,
		profile: fixture.profile
	});

	assert.equal(result.assetCount, 6);
	assert.equal(result.compressedAssetCount, 3);
	assert.equal(
		result.logicalBytes,
		Object.values(fixture.assets).reduce((total, bytes) => total + bytes.byteLength, 0)
	);
});

test('rejects transaction recovery and lock artifacts from the Pages output root', async (t) => {
	for (const artifactName of [
		'.wasm-debug.next-fixture',
		'.wasm-debug.previous-fixture',
		'.wasm-debug.sync.lock.candidate-fixture'
	]) {
		await t.test(artifactName, async (t) => {
			const fixture = await createFixture(t);
			const artifactPath = path.join(fixture.rootDir, artifactName);
			await mkdir(artifactPath, { recursive: true });
			await writeFile(path.join(artifactPath, 'unverified.wasm'), 'unverified runtime');

			await assert.rejects(
				verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
				/recovery artifact.*must not be published/iu
			);
		});
	}
});

test('rejects a wasm-debug root directory symlink', async (t) => {
	const fixture = await createFixture(t);
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-pages-link-'));
	t.after(() => rm(rootDir, { recursive: true, force: true }));
	await symlink(fixture.debugRoot, path.join(rootDir, 'wasm-debug'), 'dir');
	await writeFile(
		path.join(rootDir, 'compressed-runtime-assets.v1.json'),
		await readFile(fixture.compressedManifestPath)
	);

	await assert.rejects(
		verifyPageWasmDebug({ rootDir, profile: fixture.profile }),
		/wasm debug Pages root.*real directory/u
	);
});

test('requires the exact pinned manifest receipt and compressed asset index', async (t) => {
	const fixture = await createFixture(t);

	await assert.rejects(
		verifyPageWasmDebug({
			rootDir: fixture.rootDir,
			profile: {
				...fixture.profile,
				manifestReceipt: {
					...fixture.profile.manifestReceipt,
					bytes: 64 * 1024 + 1
				}
			}
		}),
		/invalid.*release profile manifestReceipt/u
	);
	await assert.rejects(
		verifyPageWasmDebug({
			rootDir: fixture.rootDir,
			profile: {
				...fixture.profile,
				manifestReceipt: { ...fixture.profile.manifestReceipt, sha256: '0'.repeat(64) }
			}
		}),
		/manifest receipt/u
	);
	await rm(fixture.compressedManifestPath);
	await assert.rejects(
		verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
		/compressed-runtime-assets\.v1\.json.*missing/u
	);
});

test('rejects missing, duplicate-storage, corrupt, and oversized logical assets', async (t) => {
	await t.test('missing', async (t) => {
		const fixture = await createFixture(t);
		await rm(path.join(fixture.debugRoot, 'debug/wamr-debug.js'));
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/asset is missing.*wamr-debug\.js/u
		);
	});

	await t.test('both raw and gzip', async (t) => {
		const fixture = await createFixture(t, {
			compressed: new Set(['debug/lldb-web-dap.wasm'])
		});
		await writeFile(
			path.join(fixture.debugRoot, 'debug/lldb-web-dap.wasm'),
			fixture.assets['debug/lldb-web-dap.wasm']
		);
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/both raw and gzip/u
		);
	});

	await t.test('corrupt', async (t) => {
		const fixture = await createFixture(t);
		await writeFile(path.join(fixture.debugRoot, 'debug/lldb-web-dap.js'), 'corrupt');
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/SHA-256 mismatch.*lldb-web-dap\.js/u
		);
	});

	await t.test('oversized', async (t) => {
		const fixture = await createFixture(t);
		await assert.rejects(
			verifyPageWasmDebug({
				rootDir: fixture.rootDir,
				profile: fixture.profile,
				maxLogicalBytes: 10
			}),
			/logical byte budget/u
		);
	});
});

test('rejects unsafe or duplicate manifest asset paths', async (t) => {
	await t.test('unsafe path', async (t) => {
		const fixture = await createFixture(t);
		fixture.manifest.debugger.lldb.js = '../escape.js';
		await fixture.writeManifest();
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/unsafe.*asset path/u
		);
	});

	await t.test('duplicate path', async (t) => {
		const fixture = await createFixture(t);
		fixture.manifest.debugger.targetRuntime.js = fixture.manifest.debugger.lldb.js;
		fixture.manifest.debugger.targetRuntime.jsSha256 = fixture.manifest.debugger.lldb.jsSha256;
		await fixture.writeManifest();
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/duplicate.*asset path/u
		);
	});
});

test('rejects stale compressed indexes and every invalid gzip representation', async (t) => {
	await t.test('gzip missing from index', async (t) => {
		const fixture = await createFixture(t, {
			compressed: new Set(['debug/wamr-debug.wasm'])
		});
		fixture.compressedManifest.assets = [];
		fixture.compressedManifest.sizes = {};
		await fixture.writeCompressedManifest();
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/gzip asset is missing from compressed.*wamr-debug\.wasm/u
		);
	});

	await t.test('raw asset stale in index', async (t) => {
		const fixture = await createFixture(t);
		const logicalPath = 'wasm-debug/debug/wamr-debug.js';
		fixture.compressedManifest.assets.push(logicalPath);
		fixture.compressedManifest.sizes[logicalPath] =
			fixture.assets['debug/wamr-debug.js'].byteLength;
		await fixture.writeCompressedManifest();
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/stale compressed.*wamr-debug\.js/u
		);
	});

	await t.test('unknown stale debug entry', async (t) => {
		const fixture = await createFixture(t);
		fixture.compressedManifest.assets.push('wasm-debug/debug/removed.wasm');
		fixture.compressedManifest.sizes['wasm-debug/debug/removed.wasm'] = 4;
		await fixture.writeCompressedManifest();
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/stale.*removed\.wasm/u
		);
	});

	await t.test('wrong originalSize', async (t) => {
		const fixture = await createFixture(t, {
			compressed: new Set(['debug/lldb-web-dap.js'])
		});
		fixture.compressedManifest.sizes['wasm-debug/debug/lldb-web-dap.js'] += 1;
		await fixture.writeCompressedManifest();
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/originalSize mismatch.*lldb-web-dap\.js/u
		);
	});

	await t.test('corrupt gzip', async (t) => {
		const fixture = await createFixture(t, {
			compressed: new Set(['debug/lldb-web-dap.wasm'])
		});
		await writeFile(
			path.join(fixture.debugRoot, 'debug/lldb-web-dap.wasm.gz'),
			Buffer.from('not gzip')
		);
		await assert.rejects(
			verifyPageWasmDebug({ rootDir: fixture.rootDir, profile: fixture.profile }),
			/invalid gzip.*lldb-web-dap\.wasm/u
		);
	});

	await t.test('declared gzip expansion exceeds budget', async (t) => {
		const fixture = await createFixture(t, {
			compressed: new Set(['debug/wamr-debug.worker.mjs'])
		});
		fixture.compressedManifest.sizes['wasm-debug/debug/wamr-debug.worker.mjs'] = 100;
		await fixture.writeCompressedManifest();
		await assert.rejects(
			verifyPageWasmDebug({
				rootDir: fixture.rootDir,
				profile: fixture.profile,
				maxLogicalBytes: 50
			}),
			/logical byte budget/u
		);
	});
});
