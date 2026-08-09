import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmObjectiveCAssets } from '../../scripts/sync-wasm-objectivec.mjs';
import {
	WASM_OBJECTIVEC_ASSET_RECEIPTS,
	WASM_OBJECTIVEC_ASSET_VERSION
} from './playground/wasmObjectiveCVersion';

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
const syncScript = path.resolve('scripts/sync-wasm-objectivec.mjs');
const repositoryRoot = process.cwd();
const assetFiles = [
	'libobjc.a',
	'headers.json',
	'libgnustep-base.a',
	'libgnustep-base.o',
	'foundation-headers.json',
	'libffi.a'
];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-objectivec-'));
	tempDirs.push(directory);
	return directory;
}

function sha256(contents: Buffer) {
	return createHash('sha256').update(contents).digest('hex');
}

async function writeFixture(sourceDir: string) {
	const assets = new Map(
		assetFiles.map((filename) => [filename, Buffer.from(`fixture:${filename}`)])
	);
	for (const [filename, contents] of assets) {
		await writeFile(path.join(sourceDir, filename), contents);
	}
	const receipt = {
		producer: { id: 'wasm-llvm/objective-c-browser' },
		target: 'wasm32-wasi',
		assets: Object.fromEntries(
			assetFiles.map((filename) => [
				filename,
				{
					bytes: assets.get(filename)!.byteLength,
					sha256: sha256(assets.get(filename)!)
				}
			])
		)
	};
	await writeFile(
		path.join(sourceDir, 'producer-receipt.json'),
		`${JSON.stringify(receipt, null, 2)}\n`
	);
	return receipt;
}

async function writeExistingTarget(targetDir: string) {
	await mkdir(targetDir);
	await writeFile(path.join(targetDir, 'existing.txt'), 'existing');
}

describe('syncWasmObjectiveCAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('requires an explicit source directory', async () => {
		await expect(syncWasmObjectiveCAssets()).rejects.toThrow(
			'wasm-objectivec sync requires an explicit source directory'
		);
	});

	it('validates and transactionally installs the complete producer asset set', async () => {
		const sourceDir = await makeTempDir();
		const targetParent = await makeTempDir();
		const targetDir = path.join(targetParent, 'wasm-objectivec');
		const versionModulePath = path.join(targetParent, 'wasmObjectiveCVersion.ts');
		const receipt = await writeFixture(sourceDir);
		await writeExistingTarget(targetDir);

		const result = await syncWasmObjectiveCAssets({
			sourceDir,
			targetDir,
			versionModulePath
		});
		const expectedFingerprint = sha256(
			await readFile(path.join(sourceDir, 'producer-receipt.json'))
		).slice(0, 16);
		expect(result).toEqual({
			sourceDir,
			targetDir,
			versionModulePath,
			fingerprint: expectedFingerprint,
			receipt: receipt.assets
		});
		expect((await readdir(targetDir)).sort()).toEqual(
			[...assetFiles, 'runtime-build.json'].sort()
		);
		await expect(readFile(path.join(targetDir, 'libobjc.a'), 'utf8')).resolves.toBe(
			'fixture:libobjc.a'
		);
		expect(
			JSON.parse(await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8'))
		).toEqual(receipt);
		const versionModule = await readFile(versionModulePath, 'utf8');
		expect(versionModule).toContain(
			`export const WASM_OBJECTIVEC_ASSET_VERSION = '${expectedFingerprint}'`
		);
		for (const [filename, metadata] of Object.entries(receipt.assets)) {
			expect(versionModule).toContain(`'${filename}': Object.freeze({`);
			expect(versionModule).toContain(`bytes: ${metadata.bytes}`);
			expect(versionModule).toContain(`sha256: '${metadata.sha256}'`);
		}
		expect((await readdir(targetParent)).filter((name) => name.includes('.next-'))).toEqual([]);
		expect((await readdir(targetParent)).filter((name) => name.includes('.previous-'))).toEqual(
			[]
		);
	});

	it('generates browser receipts from the verified installation snapshot', async () => {
		const sourceDir = await makeTempDir();
		const targetParent = await makeTempDir();
		const targetDir = path.join(targetParent, 'wasm-objectivec');
		const versionModulePath = path.join(targetParent, 'wasmObjectiveCVersion.ts');
		const originalReceipt = await writeFixture(sourceDir);
		const replacementLibffi = Buffer.from('replacement:libffi.a');
		const replacementReceipt = {
			...originalReceipt,
			assets: {
				...originalReceipt.assets,
				'libffi.a': {
					bytes: replacementLibffi.byteLength,
					sha256: sha256(replacementLibffi)
				}
			}
		};
		let replaced = false;

		const result = await syncWasmObjectiveCAssets({
			sourceDir,
			targetDir,
			versionModulePath,
			copyAsset: async (...args) => {
				await cp(...args);
				if (replaced || path.basename(String(args[0])) !== 'libobjc.a') return;
				replaced = true;
				await writeFile(path.join(sourceDir, 'libffi.a'), replacementLibffi);
				await writeFile(
					path.join(sourceDir, 'producer-receipt.json'),
					`${JSON.stringify(replacementReceipt, null, 2)}\n`
				);
			}
		});

		expect(replaced).toBe(true);
		expect(await readFile(path.join(targetDir, 'libffi.a'))).toEqual(replacementLibffi);
		expect(result.receipt?.['libffi.a']).toEqual(replacementReceipt.assets['libffi.a']);
		expect(await readFile(versionModulePath, 'utf8')).toContain(
			`sha256: '${replacementReceipt.assets['libffi.a'].sha256}'`
		);
	});

	it('accepts the pnpm argument separator in the CLI path', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-objectivec');
		await writeFixture(sourceDir);

		await execFileAsync(process.execPath, [syncScript, '--', sourceDir, targetDir]);

		expect((await readdir(targetDir)).sort()).toEqual(
			[...assetFiles, 'runtime-build.json'].sort()
		);
	});

	it('rejects a missing producer asset and preserves the existing target', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-objectivec');
		await writeFixture(sourceDir);
		await rm(path.join(sourceDir, 'libffi.a'));
		await writeExistingTarget(targetDir);

		await expect(syncWasmObjectiveCAssets({ sourceDir, targetDir })).rejects.toThrow(
			'libffi.a was not found'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('rejects a hash mismatch and preserves the existing target', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-objectivec');
		await writeFixture(sourceDir);
		await writeFile(path.join(sourceDir, 'libgnustep-base.a'), 'corrupted');
		await writeExistingTarget(targetDir);

		await expect(syncWasmObjectiveCAssets({ sourceDir, targetDir })).rejects.toThrow(
			'libgnustep-base.a does not match producer-receipt.json'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('rejects a byte count mismatch and preserves the existing target', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-objectivec');
		const receipt = await writeFixture(sourceDir);
		await writeFile(
			path.join(sourceDir, 'producer-receipt.json'),
			JSON.stringify({
				...receipt,
				assets: {
					...receipt.assets,
					'libobjc.a': {
						...receipt.assets['libobjc.a'],
						bytes: receipt.assets['libobjc.a'].bytes + 1
					}
				}
			})
		);
		await writeExistingTarget(targetDir);

		await expect(syncWasmObjectiveCAssets({ sourceDir, targetDir })).rejects.toThrow(
			'libobjc.a does not match producer-receipt.json'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('rejects a matching zero-byte producer asset before publishing it', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-objectivec');
		const receipt = await writeFixture(sourceDir);
		const emptyAsset = Buffer.alloc(0);
		await writeFile(path.join(sourceDir, 'libffi.a'), emptyAsset);
		await writeFile(
			path.join(sourceDir, 'producer-receipt.json'),
			`${JSON.stringify(
				{
					...receipt,
					assets: {
						...receipt.assets,
						'libffi.a': { bytes: 0, sha256: sha256(emptyAsset) }
					}
				},
				null,
				2
			)}\n`
		);
		await writeExistingTarget(targetDir);

		await expect(syncWasmObjectiveCAssets({ sourceDir, targetDir })).rejects.toThrow(
			'producer-receipt.json contains invalid metadata for libffi.a'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('rejects receipt metadata that does not describe the exact asset set', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = path.join(await makeTempDir(), 'wasm-objectivec');
		const receipt = await writeFixture(sourceDir);
		await writeFile(
			path.join(sourceDir, 'producer-receipt.json'),
			JSON.stringify({
				...receipt,
				assets: { ...receipt.assets, 'unexpected.a': { bytes: 0, sha256: '0'.repeat(64) } }
			})
		);
		await writeExistingTarget(targetDir);

		await expect(syncWasmObjectiveCAssets({ sourceDir, targetDir })).rejects.toThrow(
			'does not describe the complete runtime asset set'
		);
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
	});

	it('preserves the previous runtime backup and surfaces a rollback failure', async () => {
		const sourceDir = await makeTempDir();
		const targetParent = await makeTempDir();
		const targetDir = path.join(targetParent, 'wasm-objectivec');
		const versionModulePath = path.join(targetParent, 'wasmObjectiveCVersion.ts');
		await writeFixture(sourceDir);
		await writeExistingTarget(targetDir);
		await writeFile(versionModulePath, 'existing version module');
		let versionSwapFailed = false;
		let targetRestoreFailed = false;

		await expect(
			syncWasmObjectiveCAssets({
				sourceDir,
				targetDir,
				versionModulePath,
				renamePath: async (source, destination) => {
					const sourcePath = String(source);
					const destinationPath = String(destination);
					if (sourcePath.startsWith(`${versionModulePath}.next-`)) {
						versionSwapFailed = true;
						throw new Error('injected version swap failure');
					}
					if (
						sourcePath.startsWith(`${targetDir}.previous-`) &&
						destinationPath === targetDir
					) {
						targetRestoreFailed = true;
						throw new Error('injected target restore failure');
					}
					await rename(source, destination);
				}
			})
		).rejects.toThrow(
			'wasm-objectivec sync failed and rollback could not restore the previous installation'
		);

		expect(versionSwapFailed).toBe(true);
		expect(targetRestoreFailed).toBe(true);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('existing version module');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).rejects.toThrow();
		const targetParentEntries = await readdir(targetParent);
		const targetBackup = targetParentEntries.find((entry) =>
			entry.startsWith('wasm-objectivec.previous-')
		);
		expect(targetBackup).toBeDefined();
		await expect(
			readFile(path.join(targetParent, targetBackup!, 'existing.txt'), 'utf8')
		).resolves.toBe('existing');
		expect(targetParentEntries.some((entry) => entry.includes('.next-'))).toBe(false);
		expect(
			targetParentEntries.some((entry) =>
				entry.startsWith('wasmObjectiveCVersion.ts.previous-')
			)
		).toBe(false);
	});

	it('pins checked-in logical assets to the producer receipt and generated constants', async () => {
		const runtimeDir = path.join(repositoryRoot, 'static', 'wasm-objectivec');
		const receiptBytes = await readFile(path.join(runtimeDir, 'runtime-build.json'));
		const receipt = JSON.parse(receiptBytes.toString('utf8'));
		const compressedAssets = new Set([
			'libgnustep-base.a',
			'libgnustep-base.o',
			'foundation-headers.json'
		]);
		const actualReceipts: Record<string, { bytes: number; sha256: string }> = {};
		for (const filename of assetFiles) {
			const storedBytes = await readFile(
				path.join(runtimeDir, `${filename}${compressedAssets.has(filename) ? '.gz' : ''}`)
			);
			const logicalBytes = compressedAssets.has(filename)
				? gunzipSync(storedBytes)
				: storedBytes;
			actualReceipts[filename] = {
				bytes: logicalBytes.byteLength,
				sha256: sha256(logicalBytes)
			};
		}

		expect(actualReceipts).toEqual(WASM_OBJECTIVEC_ASSET_RECEIPTS);
		expect(receipt.assets).toEqual(WASM_OBJECTIVEC_ASSET_RECEIPTS);
		expect(WASM_OBJECTIVEC_ASSET_VERSION).toBe(sha256(receiptBytes).slice(0, 16));
	});
});
