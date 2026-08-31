import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH,
	syncWasmDebugDist,
	verifySyncedWasmDebugDist
} from './sync-wasm-debug.mjs';

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(root, marker = '') {
	const source = path.join(root, 'source');
	await mkdir(path.join(source, 'debug'), { recursive: true });
	const assets = {
		'debug/lldb-web-dap.js': Buffer.from('lldb-js'),
		'debug/lldb-web-dap.wasm': Buffer.from('lldb-wasm'),
		'debug/lldb-web-dap.pthread.mjs': Buffer.from('lldb-worker'),
		'debug/wamr-debug.js': Buffer.from('wamr-js'),
		'debug/wamr-debug.wasm': Buffer.from('wamr-wasm'),
		'debug/wamr-debug.worker.mjs': Buffer.from('wamr-worker')
	};
	for (const [relativePath, bytes] of Object.entries(assets)) {
		await writeFile(path.join(source, relativePath), bytes);
	}
	const manifest = {
		manifestVersion: 2,
		version: '디버그-fixture',
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
	const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}${marker}\n`);
	await writeFile(path.join(source, 'runtime-manifest.v2.json'), manifestBytes);
	return { source, assets, manifestBytes };
}

function expectedVersionModule(manifestBytes) {
	return `export const WASM_DEBUG_RUNTIME_PROFILE = Object.freeze({
\tmanifestReceipt: Object.freeze({
\t\tbytes: ${manifestBytes.byteLength},
\t\tsha256: '${sha256(manifestBytes)}'
\t})
});
`;
}

test('defaults the generated receipt to the tracked wasm debug version module', () => {
	assert.equal(
		DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH,
		path.resolve('src/lib/playground/wasmDebugVersion.ts')
	);
});

test('atomically installs a hash-verified LLDB/WAMR debug runtime', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-'));
	try {
		const { source, assets, manifestBytes } = await fixture(root, ' ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({ sourceDir: source, staticDir, versionModulePath });
		assert.equal(
			await readFile(path.join(staticDir, 'wasm-debug/debug/lldb-web-dap.js'), 'utf8'),
			assets['debug/lldb-web-dap.js'].toString()
		);
		assert.equal(
			JSON.parse(
				await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json'), 'utf8')
			).manifestVersion,
			2
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });

		await writeFile(path.join(source, 'debug/wamr-debug.js'), 'corrupt');
		await assert.rejects(
			syncWasmDebugDist({ sourceDir: source, staticDir, versionModulePath }),
			/SHA-256 verification/u
		);
		assert.equal(
			await readFile(path.join(staticDir, 'wasm-debug/debug/wamr-debug.js'), 'utf8'),
			assets['debug/wamr-debug.js'].toString()
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(manifestBytes)
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('restores both the runtime and receipt when publication fails between replacements', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-rollback-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const newFixture = await fixture(path.join(root, 'new'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({
			sourceDir: oldFixture.source,
			staticDir,
			versionModulePath
		});

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: newFixture.source,
				staticDir,
				versionModulePath,
				testOnlyAfterRuntimePublish() {
					throw new Error('injected publication failure');
				}
			}),
			/injected publication failure/u
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			oldFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(oldFixture.manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('rolls back both replacements when publication is aborted', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-abort-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const newFixture = await fixture(path.join(root, 'new'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({
			sourceDir: oldFixture.source,
			staticDir,
			versionModulePath
		});
		const controller = new AbortController();

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: newFixture.source,
				staticDir,
				versionModulePath,
				signal: controller.signal,
				testOnlyAfterRuntimePublish() {
					controller.abort(
						new DOMException('release publication cancelled', 'AbortError')
					);
				}
			}),
			/release publication cancelled/u
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			oldFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(oldFixture.manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('detects drift between the installed manifest and generated receipt', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-drift-'));
	try {
		const { source } = await fixture(root);
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({ sourceDir: source, staticDir, versionModulePath });
		await writeFile(
			versionModulePath,
			expectedVersionModule(Buffer.from('different manifest'))
		);

		await assert.rejects(
			verifySyncedWasmDebugDist({ staticDir, versionModulePath }),
			/receipt does not match/u
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
