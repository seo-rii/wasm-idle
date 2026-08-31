import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { compressStaticRuntimeAssets } from './compress-static-runtime-assets.mjs';
import {
	DEFAULT_WASM_DEBUG_VERSION_MODULE_PATH,
	syncWasmDebugDist,
	verifySyncedWasmDebugDist
} from './sync-wasm-debug.mjs';
import { verifyPageWasmDebugRelease } from './verify-page-wasm-debug.mjs';

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(root, marker = '', { largeWasm = false } = {}) {
	const source = path.join(root, 'source');
	await mkdir(path.join(source, 'debug'), { recursive: true });
	const assets = {
		'debug/lldb-web-dap.js': Buffer.from('lldb-js'),
		'debug/lldb-web-dap.wasm': largeWasm
			? Buffer.alloc(300_000, 0x6c)
			: Buffer.from('lldb-wasm'),
		'debug/lldb-web-dap.pthread.mjs': Buffer.from('lldb-worker'),
		'debug/wamr-debug.js': Buffer.from('wamr-js'),
		'debug/wamr-debug.wasm': largeWasm ? Buffer.alloc(300_000, 0x77) : Buffer.from('wamr-wasm'),
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

test('replaces a compressed Pages runtime during a repeated release preparation', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-compressed-repeat-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ', { largeWasm: true });
		const newFixture = await fixture(path.join(root, 'new'), '  ', { largeWasm: true });
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({
			sourceDir: oldFixture.source,
			staticDir,
			versionModulePath
		});
		const compression = await compressStaticRuntimeAssets({ rootDir: staticDir });
		assert.equal(compression.compressed.length, 2);

		await syncWasmDebugDist({
			sourceDir: newFixture.source,
			staticDir,
			versionModulePath
		});

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			newFixture.manifestBytes
		);
		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/debug/lldb-web-dap.wasm')),
			newFixture.assets['debug/lldb-web-dap.wasm']
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(newFixture.manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });
		await compressStaticRuntimeAssets({ rootDir: staticDir });
		await verifyPageWasmDebugRelease({
			buildDir: staticDir,
			profile: {
				schemaVersion: 1,
				producerRevision: 'b'.repeat(40),
				manifestReceipt: {
					bytes: newFixture.manifestBytes.byteLength,
					sha256: sha256(newFixture.manifestBytes)
				}
			}
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('restores an exact compressed Pages baseline when replacement fails', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-compressed-rollback-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ', { largeWasm: true });
		const newFixture = await fixture(path.join(root, 'new'), '  ', { largeWasm: true });
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({
			sourceDir: oldFixture.source,
			staticDir,
			versionModulePath
		});
		await compressStaticRuntimeAssets({ rootDir: staticDir });
		const oldLldbGzip = await readFile(
			path.join(staticDir, 'wasm-debug/debug/lldb-web-dap.wasm.gz')
		);

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: newFixture.source,
				staticDir,
				versionModulePath,
				testOnlyAfterRuntimePublish() {
					throw new Error('injected compressed replacement failure');
				}
			}),
			/injected compressed replacement failure/u
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/debug/lldb-web-dap.wasm.gz')),
			oldLldbGzip
		);
		assert.equal(
			await readFile(
				path.join(staticDir, 'wasm-debug/debug/lldb-web-dap.wasm'),
				'utf8'
			).catch((error) => {
				if (error?.code === 'ENOENT') return null;
				throw error;
			}),
			null
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(oldFixture.manifestBytes)
		);
		await verifyPageWasmDebugRelease({
			buildDir: staticDir,
			profile: {
				schemaVersion: 1,
				producerRevision: 'a'.repeat(40),
				manifestReceipt: {
					bytes: oldFixture.manifestBytes.byteLength,
					sha256: sha256(oldFixture.manifestBytes)
				}
			}
		});
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('bounds every installed runtime entry and releases locks after rejection', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-entry-budget-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const newFixture = await fixture(path.join(root, 'new'), '  ');
		const staticDir = path.join(root, 'static');
		const current = path.join(staticDir, 'wasm-debug');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({
			sourceDir: oldFixture.source,
			staticDir,
			versionModulePath
		});
		const emptyDirectories = path.join(current, 'empty-directories');
		await Promise.all(
			Array.from({ length: 129 }, (_, index) =>
				mkdir(path.join(emptyDirectories, String(index)), { recursive: true })
			)
		);

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: newFixture.source,
				staticDir,
				versionModulePath
			}),
			/entry-count budget/u
		);

		await rm(emptyDirectories, { recursive: true, force: true });
		await syncWasmDebugDist({
			sourceDir: newFixture.source,
			staticDir,
			versionModulePath
		});
		assert.deepEqual(
			await readFile(path.join(current, 'runtime-manifest.v2.json')),
			newFixture.manifestBytes
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('preserves a foreign entry added to the published runtime before rollback', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-published-extra-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const newFixture = await fixture(path.join(root, 'new'), '  ');
		const staticDir = path.join(root, 'static');
		const current = path.join(staticDir, 'wasm-debug');
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
				async testOnlyAfterRuntimePublish() {
					await writeFile(path.join(current, 'foreign.txt'), 'foreign publication entry');
					throw new Error('injected foreign publication entry');
				}
			}),
			/ownership changed/u
		);

		assert.equal(
			await readFile(path.join(current, 'foreign.txt'), 'utf8'),
			'foreign publication entry'
		);
		assert.deepEqual(
			await readFile(path.join(current, 'runtime-manifest.v2.json')),
			newFixture.manifestBytes
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

test('keeps the published pair coherent when rollback cannot detach its receipt', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-detach-failure-'));
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
				testOnlyAfterReceiptPublish() {
					throw new Error('injected completed publication failure');
				},
				testOnlyAfterRollbackRuntimeDetach() {
					throw new Error('injected receipt detach failure');
				}
			}),
			/published pair could not be detached safely/u
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			newFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(newFixture.manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });

		const previousRootName = (await readdir(staticDir)).find((entry) =>
			entry.startsWith('.wasm-debug.previous-')
		);
		assert.ok(previousRootName);
		assert.deepEqual(
			await readFile(
				path.join(staticDir, previousRootName, 'wasm-debug/runtime-manifest.v2.json')
			),
			oldFixture.manifestBytes
		);
		const previousReceiptName = (await readdir(path.dirname(versionModulePath))).find((entry) =>
			entry.includes('.previous-')
		);
		assert.ok(previousReceiptName);
		assert.equal(
			await readFile(path.join(path.dirname(versionModulePath), previousReceiptName), 'utf8'),
			expectedVersionModule(oldFixture.manifestBytes)
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('restores the published pair when rollback cannot finish restoring the previous pair', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-restore-failure-'));
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
				testOnlyAfterReceiptPublish() {
					throw new Error('injected completed publication failure');
				},
				testOnlyAfterPreviousRuntimeRestore() {
					throw new Error('injected previous receipt restore failure');
				}
			}),
			/previous pair could not be restored safely/u
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			newFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(newFixture.manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });

		const previousRootName = (await readdir(staticDir)).find((entry) =>
			entry.startsWith('.wasm-debug.previous-')
		);
		assert.ok(previousRootName);
		assert.deepEqual(
			await readFile(
				path.join(staticDir, previousRootName, 'wasm-debug/runtime-manifest.v2.json')
			),
			oldFixture.manifestBytes
		);
		const previousReceiptName = (await readdir(path.dirname(versionModulePath))).find((entry) =>
			entry.includes('.previous-')
		);
		assert.ok(previousReceiptName);
		assert.equal(
			await readFile(path.join(path.dirname(versionModulePath), previousReceiptName), 'utf8'),
			expectedVersionModule(oldFixture.manifestBytes)
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('serializes overlapping publishers so an aborted rollback cannot delete the successor', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-concurrent-'));
	let releaseFirst;
	const holdFirst = new Promise((resolve) => {
		releaseFirst = resolve;
	});
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const firstFixture = await fixture(path.join(root, 'first'), '  ');
		const secondFixture = await fixture(path.join(root, 'second'), '   ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({
			sourceDir: oldFixture.source,
			staticDir,
			versionModulePath
		});
		const firstController = new AbortController();
		let markFirstPublished;
		const firstPublished = new Promise((resolve) => {
			markFirstPublished = resolve;
		});
		const firstPublication = syncWasmDebugDist({
			sourceDir: firstFixture.source,
			staticDir,
			versionModulePath,
			signal: firstController.signal,
			testOnlyAfterRuntimePublish() {
				markFirstPublished();
				return holdFirst;
			}
		});
		await firstPublished;

		let markSecondEntered;
		const secondEntered = new Promise((resolve) => {
			markSecondEntered = resolve;
		});
		const secondPublication = syncWasmDebugDist({
			sourceDir: secondFixture.source,
			staticDir,
			versionModulePath,
			testOnlyAfterRuntimePublish() {
				markSecondEntered();
			}
		});
		const secondState = await Promise.race([
			secondEntered.then(() => 'entered'),
			new Promise((resolve) => setTimeout(() => resolve('queued'), 100))
		]);
		if (secondState === 'entered') await secondPublication;

		firstController.abort(new DOMException('first publication cancelled', 'AbortError'));
		releaseFirst();
		await assert.rejects(firstPublication, /first publication cancelled/u);
		await secondPublication;

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			secondFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8'),
			expectedVersionModule(secondFixture.manifestBytes)
		);
		await verifySyncedWasmDebugDist({ staticDir, versionModulePath });
	} finally {
		releaseFirst?.();
		await rm(root, { recursive: true, force: true });
	}
});

test('aborts a queued publisher promptly without blocking its successor', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-queued-abort-'));
	let releaseFirst;
	const holdFirst = new Promise((resolve) => {
		releaseFirst = resolve;
	});
	const publications = [];
	try {
		const firstFixture = await fixture(path.join(root, 'first'), ' ');
		const secondFixture = await fixture(path.join(root, 'second'), '  ');
		const thirdFixture = await fixture(path.join(root, 'third'), '   ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		let markFirstPublished;
		const firstPublished = new Promise((resolve) => {
			markFirstPublished = resolve;
		});
		const firstPublication = syncWasmDebugDist({
			sourceDir: firstFixture.source,
			staticDir,
			versionModulePath,
			testOnlyAfterRuntimePublish() {
				markFirstPublished();
				return holdFirst;
			}
		});
		publications.push(firstPublication);
		await firstPublished;

		const secondController = new AbortController();
		const secondPublication = syncWasmDebugDist({
			sourceDir: secondFixture.source,
			staticDir,
			versionModulePath,
			signal: secondController.signal
		});
		publications.push(secondPublication);
		const secondOutcome = secondPublication.then(
			() => ({ status: 'fulfilled' }),
			(error) => ({ error, status: 'rejected' })
		);
		const thirdPublication = syncWasmDebugDist({
			sourceDir: thirdFixture.source,
			staticDir,
			versionModulePath
		});
		publications.push(thirdPublication);

		secondController.abort(new DOMException('queued publication cancelled', 'AbortError'));
		const promptOutcome = await Promise.race([
			secondOutcome,
			new Promise((resolve) => setTimeout(() => resolve({ status: 'timeout' }), 100))
		]);
		assert.equal(promptOutcome.status, 'rejected');
		assert.match(String(promptOutcome.error), /queued publication cancelled/u);

		releaseFirst();
		await firstPublication;
		await thirdPublication;
		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			thirdFixture.manifestBytes
		);
	} finally {
		releaseFirst?.();
		await Promise.allSettled(publications);
		await rm(root, { recursive: true, force: true });
	}
});

test('does not mutate either current target when receipt ownership changed before rollback', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-receipt-owner-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const nextFixture = await fixture(path.join(root, 'next'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({ sourceDir: oldFixture.source, staticDir, versionModulePath });

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterRuntimePublish() {
					await writeFile(versionModulePath, 'foreign receipt');
					throw new Error('injected receipt ownership change');
				}
			}),
			/ownership|rolled back/iu
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			nextFixture.manifestBytes
		);
		assert.equal(await readFile(versionModulePath, 'utf8'), 'foreign receipt');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('preserves a foreign receipt that appears during a first publication', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-first-receipt-owner-'));
	try {
		const nextFixture = await fixture(path.join(root, 'next'), ' ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterRuntimePublish() {
					await writeFile(versionModulePath, 'foreign first receipt');
					throw new Error('injected first receipt ownership change');
				}
			}),
			/ownership|rolled back/iu
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			nextFixture.manifestBytes
		);
		assert.equal(await readFile(versionModulePath, 'utf8'), 'foreign first receipt');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('does not restore a previous runtime whose content changed in place', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-previous-runtime-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const nextFixture = await fixture(path.join(root, 'next'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({ sourceDir: oldFixture.source, staticDir, versionModulePath });

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterRuntimePublish() {
					const previousRootName = (await readdir(staticDir)).find((entry) =>
						entry.startsWith('.wasm-debug.previous-')
					);
					assert.ok(previousRootName);
					await writeFile(
						path.join(staticDir, previousRootName, 'wasm-debug/debug/wamr-debug.js'),
						'corrupt previous runtime'
					);
					throw new Error('injected previous runtime change');
				}
			}),
			/ownership|rolled back/iu
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			nextFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8').catch((error) => {
				if (error?.code === 'ENOENT') return null;
				throw error;
			}),
			null
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('does not restore a previous receipt whose content changed in place', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-previous-receipt-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const nextFixture = await fixture(path.join(root, 'next'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		const versionDir = path.dirname(versionModulePath);
		await syncWasmDebugDist({ sourceDir: oldFixture.source, staticDir, versionModulePath });

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterRuntimePublish() {
					const previousReceiptName = (await readdir(versionDir)).find((entry) =>
						entry.includes('.previous-')
					);
					assert.ok(previousReceiptName);
					await writeFile(
						path.join(versionDir, previousReceiptName),
						'corrupt previous receipt'
					);
					throw new Error('injected previous receipt change');
				}
			}),
			/ownership|rolled back/iu
		);

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			nextFixture.manifestBytes
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8').catch((error) => {
				if (error?.code === 'ENOENT') return null;
				throw error;
			}),
			null
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('does not combine a restored runtime with a receipt changed between moves', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-between-moves-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const nextFixture = await fixture(path.join(root, 'next'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({ sourceDir: oldFixture.source, staticDir, versionModulePath });

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterPreviousRuntimeMove() {
					await writeFile(versionModulePath, 'foreign receipt between moves');
					throw new Error('injected change between moves');
				}
			}),
			/ownership|between moves/iu
		);

		assert.equal(
			await readFile(
				path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json'),
				'utf8'
			).catch((error) => {
				if (error?.code === 'ENOENT') return null;
				throw error;
			}),
			null
		);
		assert.equal(await readFile(versionModulePath, 'utf8'), 'foreign receipt between moves');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('does not combine a restored receipt with a runtime changed after its move', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-receipt-only-move-'));
	try {
		const nextFixture = await fixture(path.join(root, 'next'), ' ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await mkdir(path.dirname(versionModulePath), { recursive: true });
		await writeFile(versionModulePath, 'receipt-only baseline');

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterPreviousReceiptMove() {
					await mkdir(path.join(staticDir, 'wasm-debug'), { recursive: true });
					await writeFile(
						path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json'),
						'foreign runtime after receipt move'
					);
					throw new Error('injected runtime after receipt move');
				}
			}),
			/ownership|receipt move/iu
		);

		assert.equal(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json'), 'utf8'),
			'foreign runtime after receipt move'
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8').catch((error) => {
				if (error?.code === 'ENOENT') return null;
				throw error;
			}),
			null
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('does not mutate either current target when runtime ownership changed before rollback', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-runtime-owner-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const nextFixture = await fixture(path.join(root, 'next'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		const current = path.join(staticDir, 'wasm-debug');
		await syncWasmDebugDist({ sourceDir: oldFixture.source, staticDir, versionModulePath });

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				async testOnlyAfterRuntimePublish() {
					await rm(current, { recursive: true, force: true });
					await mkdir(current, { recursive: true });
					await writeFile(
						path.join(current, 'runtime-manifest.v2.json'),
						'foreign runtime'
					);
					throw new Error('injected runtime ownership change');
				}
			}),
			/ownership|rolled back/iu
		);

		assert.equal(
			await readFile(path.join(current, 'runtime-manifest.v2.json'), 'utf8'),
			'foreign runtime'
		);
		assert.equal(
			await readFile(versionModulePath, 'utf8').catch((error) => {
				if (error?.code === 'ENOENT') return null;
				throw error;
			}),
			null
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('cleans an uninitialized lock candidate so the next publication can succeed', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-debug-sync-lock-init-'));
	try {
		const oldFixture = await fixture(path.join(root, 'old'), ' ');
		const nextFixture = await fixture(path.join(root, 'next'), '  ');
		const staticDir = path.join(root, 'static');
		const versionModulePath = path.join(root, 'src/wasmDebugVersion.ts');
		await syncWasmDebugDist({ sourceDir: oldFixture.source, staticDir, versionModulePath });

		await assert.rejects(
			syncWasmDebugDist({
				sourceDir: nextFixture.source,
				staticDir,
				versionModulePath,
				testOnlyAfterLockCandidateOpen() {
					throw new Error('injected lock initialization failure');
				}
			}),
			/injected lock initialization failure/u
		);
		await syncWasmDebugDist({
			sourceDir: nextFixture.source,
			staticDir,
			versionModulePath
		});

		assert.deepEqual(
			await readFile(path.join(staticDir, 'wasm-debug/runtime-manifest.v2.json')),
			nextFixture.manifestBytes
		);
		for (const directory of [staticDir, path.dirname(versionModulePath)]) {
			assert.deepEqual(
				(await readdir(directory)).filter((entry) => entry.includes('.sync.lock')),
				[]
			);
		}
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
