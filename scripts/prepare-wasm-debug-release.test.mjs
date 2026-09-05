import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	MAX_WASM_DEBUG_MANIFEST_BYTES,
	MAX_WASM_DEBUG_RUNTIME_BYTES,
	prepareWasmDebugRelease
} from './prepare-wasm-debug-release.mjs';

const PRODUCER_REVISION = '1111111111111111111111111111111111111111';
const RELEASE_BASE_URL = `https://raw.githubusercontent.com/seo-rii/wasm-llvm/${PRODUCER_REVISION}/artifacts/runtime-source/`;

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function createFixture() {
	const assets = {
		'debug/lldb-web-dap.js': Buffer.from('lldb-js'),
		'debug/lldb-web-dap.wasm': Buffer.from('lldb-wasm'),
		'debug/lldb-web-dap.pthread.mjs': Buffer.from('lldb-worker'),
		'debug/wamr-debug.js': Buffer.from('wamr-js'),
		'debug/wamr-debug.wasm': Buffer.from('wamr-wasm'),
		'debug/wamr-debug.worker.mjs': Buffer.from('wamr-worker')
	};
	const manifest = {
		manifestVersion: 2,
		version: 'release-fixture',
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
				llvmRevision: 'llvm-revision'
			},
			targetRuntime: {
				name: 'wamr',
				js: 'debug/wamr-debug.js',
				wasm: 'debug/wamr-debug.wasm',
				worker: 'debug/wamr-debug.worker.mjs',
				jsSha256: sha256(assets['debug/wamr-debug.js']),
				wasmSha256: sha256(assets['debug/wamr-debug.wasm']),
				workerSha256: sha256(assets['debug/wamr-debug.worker.mjs']),
				revision: 'wamr-revision'
			}
		}
	};
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
	return { assets, manifest, manifestBytes };
}

async function writeProfile(root, manifestBytes, producerRevision = PRODUCER_REVISION) {
	const profilePath = path.join(root, 'wasm-debug-release.v2.json');
	await writeFile(
		profilePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				producerRevision,
				manifestReceipt: {
					bytes: manifestBytes.byteLength,
					sha256: sha256(manifestBytes)
				}
			},
			null,
			2
		)}\n`
	);
	return profilePath;
}

function response(bytes, init = {}) {
	return new Response(Uint8Array.from(bytes), { status: 200, ...init });
}

function fetchFixture(manifestBytes, assets, overrides = new Map()) {
	const requests = [];
	const fetchImpl = async (input) => {
		const url = String(input);
		requests.push(url);
		const overridden = overrides.get(url);
		if (overridden) return overridden;
		if (url === `${RELEASE_BASE_URL}runtime-manifest.v2.json`) {
			return response(manifestBytes);
		}
		const relativePath = url.slice(RELEASE_BASE_URL.length);
		const bytes = assets[relativePath];
		return bytes ? response(bytes) : new Response('missing', { status: 404 });
	};
	return { fetchImpl, requests };
}

async function createPaths(root) {
	const staticDir = path.join(root, 'static');
	const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
	return { staticDir, versionModulePath };
}

async function seedExistingInstall(staticDir, versionModulePath) {
	await mkdir(path.join(staticDir, 'wasm-debug'), { recursive: true });
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	await writeFile(path.join(staticDir, 'wasm-debug/sentinel.txt'), 'previous-runtime');
	await writeFile(versionModulePath, 'previous-receipt');
}

async function assertExistingInstallPreserved(staticDir, versionModulePath) {
	assert.equal(
		await readFile(path.join(staticDir, 'wasm-debug/sentinel.txt'), 'utf8'),
		'previous-runtime'
	);
	assert.equal(await readFile(versionModulePath, 'utf8'), 'previous-receipt');
}

test('downloads only the immutable producer revision and atomically installs verified assets', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-'));
	try {
		const { assets, manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		const { fetchImpl, requests } = fetchFixture(manifestBytes, assets);

		const result = await prepareWasmDebugRelease({
			fetchImpl,
			profilePath,
			staticDir,
			versionModulePath
		});

		assert.equal(result.producerRevision, PRODUCER_REVISION);
		assert.equal(result.releaseBaseUrl, RELEASE_BASE_URL);
		assert.equal(result.assetCount, 6);
		assert.equal(
			result.totalAssetBytes,
			Object.values(assets).reduce((sum, value) => sum + value.byteLength, 0)
		);
		assert.equal(requests[0], `${RELEASE_BASE_URL}runtime-manifest.v2.json`);
		assert.equal(requests.length, 7);
		assert.ok(requests.every((url) => url.startsWith(RELEASE_BASE_URL)));
		assert.ok(requests.every((url) => !url.includes('/main/')));
		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			manifestBytes
		);
		for (const [relativePath, bytes] of Object.entries(assets)) {
			assert.deepEqual(
				await readFile(path.join(staticDir, 'wasm-debug', relativePath)),
				bytes
			);
		}
		assert.match(
			await readFile(versionModulePath, 'utf8'),
			new RegExp(sha256(manifestBytes), 'u')
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('rejects a manifest receipt mismatch before fetching assets and preserves the install', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-manifest-'));
	try {
		const { assets, manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, Buffer.from('different manifest'));
		const { staticDir, versionModulePath } = await createPaths(root);
		await seedExistingInstall(staticDir, versionModulePath);
		const { fetchImpl, requests } = fetchFixture(manifestBytes, assets);

		await assert.rejects(
			prepareWasmDebugRelease({ fetchImpl, profilePath, staticDir, versionModulePath }),
			/manifest.*(?:size|SHA-256)/iu
		);
		assert.deepEqual(requests, [`${RELEASE_BASE_URL}runtime-manifest.v2.json`]);
		await assertExistingInstallPreserved(staticDir, versionModulePath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('validates decoded manifest bytes when Content-Length describes encoded transfer bytes', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-encoding-'));
	try {
		const { assets, manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		const manifestUrl = `${RELEASE_BASE_URL}runtime-manifest.v2.json`;
		const { fetchImpl } = fetchFixture(
			manifestBytes,
			assets,
			new Map([
				[
					manifestUrl,
					response(manifestBytes, {
						headers: {
							'content-encoding': 'gzip',
							'content-length': '17'
						}
					})
				]
			])
		);

		await prepareWasmDebugRelease({ fetchImpl, profilePath, staticDir, versionModulePath });
		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			manifestBytes
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('retries a transient producer response within the bounded attempt budget', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-retry-'));
	try {
		const { assets, manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		const fixtureFetch = fetchFixture(manifestBytes, assets);
		let manifestAttempts = 0;
		const fetchImpl = async (input, init) => {
			if (
				String(input) === `${RELEASE_BASE_URL}runtime-manifest.v2.json` &&
				manifestAttempts++ === 0
			) {
				return new Response('temporary failure', { status: 503 });
			}
			return fixtureFetch.fetchImpl(input, init);
		};

		await prepareWasmDebugRelease({
			fetchImpl,
			profilePath,
			staticDir,
			versionModulePath,
			maxAttempts: 2,
			retryDelayMs: 0,
			requestTimeoutMs: 1_000
		});

		assert.equal(manifestAttempts, 2);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('times out a stalled producer request before an external safety abort', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-timeout-'));
	const safety = new AbortController();
	const safetyTimer = setTimeout(() => safety.abort(new Error('test safety abort fired')), 250);
	try {
		const { manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		const fetchImpl = (_input, { signal }) =>
			new Promise((resolve, reject) => {
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});

		await assert.rejects(
			prepareWasmDebugRelease({
				fetchImpl,
				profilePath,
				staticDir,
				versionModulePath,
				signal: safety.signal,
				maxAttempts: 1,
				requestTimeoutMs: 10
			}),
			/timed out after 10 ms/iu
		);
	} finally {
		clearTimeout(safetyTimer);
		safety.abort();
		await rm(root, { recursive: true, force: true });
	}
});

test('rejects a corrupt asset before publication and preserves the install', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-asset-'));
	try {
		const { assets, manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		await seedExistingInstall(staticDir, versionModulePath);
		const corruptUrl = `${RELEASE_BASE_URL}debug/wamr-debug.js`;
		const { fetchImpl } = fetchFixture(
			manifestBytes,
			assets,
			new Map([[corruptUrl, response(Buffer.from('corrupt'))]])
		);

		await assert.rejects(
			prepareWasmDebugRelease({ fetchImpl, profilePath, staticDir, versionModulePath }),
			/debug\/wamr-debug\.js.*SHA-256/iu
		);
		await assertExistingInstallPreserved(staticDir, versionModulePath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('rejects unsafe manifest asset paths before issuing an asset request', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-path-'));
	try {
		const fixture = createFixture();
		fixture.manifest.debugger.lldb.js = '../outside.js';
		const manifestBytes = Buffer.from(`${JSON.stringify(fixture.manifest)}\n`);
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		const { fetchImpl, requests } = fetchFixture(manifestBytes, fixture.assets);

		await assert.rejects(
			prepareWasmDebugRelease({ fetchImpl, profilePath, staticDir, versionModulePath }),
			/unsafe.*asset path/iu
		);
		assert.deepEqual(requests, [`${RELEASE_BASE_URL}runtime-manifest.v2.json`]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('enforces bounded manifest and aggregate asset Content-Length before reading bodies', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-release-bounds-'));
	try {
		const { assets, manifestBytes } = createFixture();
		const profilePath = await writeProfile(root, manifestBytes);
		const { staticDir, versionModulePath } = await createPaths(root);
		const manifestUrl = `${RELEASE_BASE_URL}runtime-manifest.v2.json`;
		const oversizedManifestFetch = fetchFixture(
			manifestBytes,
			assets,
			new Map([
				[
					manifestUrl,
					response(Buffer.from('x'), {
						headers: { 'content-length': String(MAX_WASM_DEBUG_MANIFEST_BYTES + 1) }
					})
				]
			])
		);
		await assert.rejects(
			prepareWasmDebugRelease({
				fetchImpl: oversizedManifestFetch.fetchImpl,
				profilePath,
				staticDir,
				versionModulePath
			}),
			/manifest.*limit/iu
		);
		assert.deepEqual(oversizedManifestFetch.requests, [manifestUrl]);

		const firstAssetUrl = `${RELEASE_BASE_URL}debug/lldb-web-dap.js`;
		const oversizedAssetFetch = fetchFixture(
			manifestBytes,
			assets,
			new Map([
				[
					firstAssetUrl,
					response(Buffer.from('x'), {
						headers: { 'content-length': String(MAX_WASM_DEBUG_RUNTIME_BYTES + 1) }
					})
				]
			])
		);
		await assert.rejects(
			prepareWasmDebugRelease({
				fetchImpl: oversizedAssetFetch.fetchImpl,
				profilePath,
				staticDir,
				versionModulePath
			}),
			/aggregate runtime asset.*limit/iu
		);
		assert.deepEqual(oversizedAssetFetch.requests, [manifestUrl, firstAssetUrl]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('the tracked release profile pins the qualified producer and manifest receipt', async () => {
	const profile = JSON.parse(await readFile('scripts/wasm-debug-release.v2.json', 'utf8'));
	assert.deepEqual(profile, {
		schemaVersion: 1,
		producerRevision: 'adac1d77676e48eb994c78f3053057708d389ca2',
		manifestReceipt: {
			bytes: 2853,
			sha256: 'a43dfb9c1fa41ba10bb408bf48ee41bc51834d499f11a26f4c37e3ad1f74ef54'
		}
	});
});
