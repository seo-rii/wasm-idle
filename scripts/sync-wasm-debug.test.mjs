import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { syncWasmDebugDist } from './sync-wasm-debug.mjs';

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(root) {
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
	await writeFile(path.join(source, 'runtime-manifest.v2.json'), `${JSON.stringify(manifest)}\n`);
	return { source, assets };
}

test('atomically installs a hash-verified LLDB/WAMR debug runtime', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-'));
	try {
		const { source, assets } = await fixture(root);
		const staticDir = path.join(root, 'static');
		await syncWasmDebugDist({ sourceDir: source, staticDir });
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

		await writeFile(path.join(source, 'debug/wamr-debug.js'), 'corrupt');
		await assert.rejects(
			syncWasmDebugDist({ sourceDir: source, staticDir }),
			/SHA-256 verification/u
		);
		assert.equal(
			await readFile(path.join(staticDir, 'wasm-debug/debug/wamr-debug.js'), 'utf8'),
			assets['debug/wamr-debug.js'].toString()
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
