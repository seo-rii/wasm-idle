import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmObjectiveCAssets } from '../../scripts/sync-wasm-objectivec.mjs';

const tempDirs: string[] = [];
const execFileAsync = promisify(execFile);
const syncScript = path.resolve('scripts/sync-wasm-objectivec.mjs');
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
		const receipt = await writeFixture(sourceDir);
		await writeExistingTarget(targetDir);

		expect(await syncWasmObjectiveCAssets({ sourceDir, targetDir })).toEqual({
			sourceDir,
			targetDir
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
		expect((await readdir(targetParent)).filter((name) => name.includes('.next-'))).toEqual([]);
		expect((await readdir(targetParent)).filter((name) => name.includes('.previous-'))).toEqual(
			[]
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
});
