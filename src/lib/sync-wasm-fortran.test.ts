// @vitest-environment node

import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
	syncWasmFortranAssets,
	WASM_FORTRAN_EXECUTION_ASSET_FILES
} from '../../scripts/sync-wasm-fortran.mjs';

const temporaryDirectories: string[] = [];
const PROFILE_ID = 'fixture-f2c-1';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function fingerprintReceipts(receipts: Record<string, { bytes: number; sha256: string }>) {
	const hash = createHash('sha256');
	hash.update('wasm-fortran-f2c-logical-asset-receipts-v1\0');
	hash.update(PROFILE_ID);
	hash.update('\0');
	for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
		const receipt = receipts[asset];
		hash.update(asset);
		hash.update('\0');
		hash.update(String(receipt.bytes));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex').slice(0, 16);
}

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-fortran-sync-'));
	temporaryDirectories.push(root);
	const sourceDir = path.join(root, 'source');
	const targetDir = path.join(root, 'target');
	const versionModulePath = path.join(root, 'generated', 'wasmFortranExecutionAssets.ts');
	await mkdir(sourceDir, { recursive: true });
	await mkdir(targetDir, { recursive: true });
	const assets = {
		'f2c.wasm': new Uint8Array([0, 97, 115, 109, 1]),
		'libf2c.a': new Uint8Array([2, 3, 4, 5]),
		'f2c.h': new TextEncoder().encode('typedef int integer;\n')
	};
	for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
		await writeFile(path.join(sourceDir, asset), assets[asset]);
		await writeFile(path.join(targetDir, asset), `old ${asset}`);
		await writeFile(path.join(targetDir, `${asset}.gz`), `stale ${asset}`);
	}
	await writeFile(path.join(targetDir, 'analyzer.js'), 'preserved analyzer\n');
	await writeFile(path.join(targetDir, 'lfortran.data'), 'preserved analyzer data\n');
	await writeFile(path.join(targetDir, 'runtime-build.json'), '{"old":true}\n');
	await mkdir(path.dirname(versionModulePath), { recursive: true });
	await writeFile(versionModulePath, 'old version module\n');
	await writeProducerReceipt(sourceDir, assets);
	return { assets, root, sourceDir, targetDir, versionModulePath };
}

async function writeProducerReceipt(
	sourceDir: string,
	assets: Record<(typeof WASM_FORTRAN_EXECUTION_ASSET_FILES)[number], Uint8Array>,
	profileId = PROFILE_ID
) {
	await writeFile(
		path.join(sourceDir, 'producer-receipt.json'),
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId,
				assets: Object.fromEntries(
					WASM_FORTRAN_EXECUTION_ASSET_FILES.map((asset) => [
						asset,
						{ bytes: assets[asset].byteLength, sha256: sha256(assets[asset]) }
					])
				)
			},
			null,
			2
		)}\n`,
		'utf8'
	);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('sync-wasm-fortran', () => {
	it('requires an explicit generated-module path for a custom target', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmFortranAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir
			})
		).rejects.toThrow('custom targets require an explicit versionModulePath');
	});

	it('rejects a producer source nested inside the runtime target without mutating it', async () => {
		const fixture = await createFixture();
		const nestedSourceDir = path.join(fixture.targetDir, 'producer');
		await cp(fixture.sourceDir, nestedSourceDir, { recursive: true });
		const previousRuntime = await readFile(
			path.join(fixture.targetDir, 'runtime-build.json'),
			'utf8'
		);
		const previousVersion = await readFile(fixture.versionModulePath, 'utf8');

		await expect(
			syncWasmFortranAssets({ ...fixture, sourceDir: nestedSourceDir })
		).rejects.toThrow('source and target directories must not overlap');
		expect(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')).toBe(
			previousRuntime
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(previousVersion);
	});

	it('rejects a runtime target nested inside the producer source', async () => {
		const fixture = await createFixture();
		const nestedTargetDir = path.join(fixture.sourceDir, 'installed-runtime');
		await cp(fixture.targetDir, nestedTargetDir, { recursive: true });
		const previousSource = await readFile(path.join(fixture.sourceDir, 'f2c.wasm'));
		const previousRuntime = await readFile(
			path.join(nestedTargetDir, 'runtime-build.json'),
			'utf8'
		);

		await expect(
			syncWasmFortranAssets({ ...fixture, targetDir: nestedTargetDir })
		).rejects.toThrow('source and target directories must not overlap');
		expect(await readFile(path.join(fixture.sourceDir, 'f2c.wasm'))).toEqual(previousSource);
		expect(await readFile(path.join(nestedTargetDir, 'runtime-build.json'), 'utf8')).toBe(
			previousRuntime
		);
	});

	it('rejects a generated module path inside the immutable producer source', async () => {
		const fixture = await createFixture();
		const sourceAssetPath = path.join(fixture.sourceDir, 'f2c.wasm');
		const previousSource = await readFile(sourceAssetPath);
		const previousRuntime = await readFile(
			path.join(fixture.targetDir, 'runtime-build.json'),
			'utf8'
		);

		await expect(
			syncWasmFortranAssets({ ...fixture, versionModulePath: sourceAssetPath })
		).rejects.toThrow('version module must be outside the producer source directory');
		expect(await readFile(sourceAssetPath)).toEqual(previousSource);
		expect(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')).toBe(
			previousRuntime
		);
	});

	it('rejects a generated module path inside the runtime target', async () => {
		const fixture = await createFixture();
		const analyzerPath = path.join(fixture.targetDir, 'analyzer.js');
		const previousAnalyzer = await readFile(analyzerPath, 'utf8');
		const previousRuntime = await readFile(
			path.join(fixture.targetDir, 'runtime-build.json'),
			'utf8'
		);

		await expect(
			syncWasmFortranAssets({ ...fixture, versionModulePath: analyzerPath })
		).rejects.toThrow('version module must be outside the runtime target directory');
		expect(await readFile(analyzerPath, 'utf8')).toBe(previousAnalyzer);
		expect(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')).toBe(
			previousRuntime
		);
	});

	it('validates the producer receipt and overlays execution assets without deleting analyzer files', async () => {
		const fixture = await createFixture();
		const first = await syncWasmFortranAssets(fixture);
		const firstBuild = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')
		);
		const firstVersion = await readFile(fixture.versionModulePath, 'utf8');

		expect(first.fingerprint).toBe(fingerprintReceipts(firstBuild.assets));
		expect(firstBuild).toEqual({
			schemaVersion: 1,
			profileId: PROFILE_ID,
			fingerprint: first.fingerprint,
			assets: Object.fromEntries(
				WASM_FORTRAN_EXECUTION_ASSET_FILES.map((asset) => [
					asset,
					{
						bytes: fixture.assets[asset].byteLength,
						sha256: sha256(fixture.assets[asset])
					}
				])
			)
		});
		expect(await readFile(path.join(fixture.targetDir, 'analyzer.js'), 'utf8')).toBe(
			'preserved analyzer\n'
		);
		expect(await readFile(path.join(fixture.targetDir, 'lfortran.data'), 'utf8')).toBe(
			'preserved analyzer data\n'
		);
		for (const asset of WASM_FORTRAN_EXECUTION_ASSET_FILES) {
			expect(new Uint8Array(await readFile(path.join(fixture.targetDir, asset)))).toEqual(
				fixture.assets[asset]
			);
			await expect(
				readFile(path.join(fixture.targetDir, `${asset}.gz`))
			).rejects.toMatchObject({
				code: 'ENOENT'
			});
		}
		expect(firstVersion).not.toContain('WASM_FORTRAN_ASSET_VERSION');
		expect(firstVersion).toContain(
			`export const WASM_FORTRAN_EXECUTION_ASSET_VERSION = '${first.fingerprint}';`
		);

		const second = await syncWasmFortranAssets(fixture);
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(firstVersion);
	});

	it('rejects a source replacement after preflight without mutating the installation', async () => {
		const fixture = await createFixture();
		const previousAnalyzer = await readFile(
			path.join(fixture.targetDir, 'analyzer.js'),
			'utf8'
		);
		const previousRuntime = await readFile(path.join(fixture.targetDir, 'f2c.wasm'), 'utf8');
		const previousVersion = await readFile(fixture.versionModulePath, 'utf8');
		let replaced = false;

		await expect(
			syncWasmFortranAssets({
				...fixture,
				copyAsset: async (source, destination, options) => {
					if (
						!replaced &&
						path.resolve(String(source)) === path.join(fixture.sourceDir, 'f2c.wasm')
					) {
						replaced = true;
						await writeFile(source, 'replaced after validation');
					}
					await cp(source, destination, options);
				}
			})
		).rejects.toThrow('f2c.wasm does not match producer-receipt.json');

		expect(await readFile(path.join(fixture.targetDir, 'analyzer.js'), 'utf8')).toBe(
			previousAnalyzer
		);
		expect(await readFile(path.join(fixture.targetDir, 'f2c.wasm'), 'utf8')).toBe(
			previousRuntime
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(previousVersion);
	});

	it('changes the execution fingerprint when producer profile provenance changes', async () => {
		const fixture = await createFixture();
		const first = await syncWasmFortranAssets(fixture);
		await writeProducerReceipt(fixture.sourceDir, fixture.assets, 'fixture-f2c-2');

		const second = await syncWasmFortranAssets(fixture);
		const runtimeBuild = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')
		);

		expect(second.fingerprint).not.toBe(first.fingerprint);
		expect(runtimeBuild.profileId).toBe('fixture-f2c-2');
		expect(runtimeBuild.fingerprint).toBe(second.fingerprint);
	});

	it.each(['missing', 'extra'] as const)(
		'rejects a %s producer receipt entry before mutating the installation',
		async (variant) => {
			const fixture = await createFixture();
			const receiptPath = path.join(fixture.sourceDir, 'producer-receipt.json');
			const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
			if (variant === 'missing') {
				delete receipt.assets['f2c.h'];
			} else {
				receipt.assets['unexpected.bin'] = {
					bytes: 1,
					sha256: 'a'.repeat(64)
				};
			}
			await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
			const previousRuntime = await readFile(
				path.join(fixture.targetDir, 'runtime-build.json'),
				'utf8'
			);
			const previousVersion = await readFile(fixture.versionModulePath, 'utf8');

			await expect(syncWasmFortranAssets(fixture)).rejects.toThrow(
				'does not describe exactly three assets'
			);
			expect(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')).toBe(
				previousRuntime
			);
			expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(previousVersion);
		}
	);

	it('rejects symlinked producer assets before mutating the installation', async () => {
		const fixture = await createFixture();
		const assetPath = path.join(fixture.sourceDir, 'f2c.wasm');
		const backingPath = path.join(fixture.sourceDir, 'f2c.wasm.backing');
		await rename(assetPath, backingPath);
		await symlink(backingPath, assetPath);
		const previousRuntime = await readFile(
			path.join(fixture.targetDir, 'runtime-build.json'),
			'utf8'
		);
		const previousVersion = await readFile(fixture.versionModulePath, 'utf8');

		await expect(syncWasmFortranAssets(fixture)).rejects.toThrow(
			'execution asset must be a regular file: f2c.wasm'
		);
		expect(await readFile(path.join(fixture.targetDir, 'runtime-build.json'), 'utf8')).toBe(
			previousRuntime
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(previousVersion);
	});

	it('rolls back the overlay and generated module when the second publication fails', async () => {
		const fixture = await createFixture();
		const previousTargetEntries = await Promise.all(
			['analyzer.js', 'f2c.wasm', 'runtime-build.json'].map(
				async (file) =>
					[file, await readFile(path.join(fixture.targetDir, file), 'utf8')] as const
			)
		);
		const previousVersion = await readFile(fixture.versionModulePath, 'utf8');
		let failed = false;

		await expect(
			syncWasmFortranAssets({
				...fixture,
				renamePath: async (source, destination) => {
					if (
						!failed &&
						String(source).includes('.next-') &&
						path.resolve(String(destination)) ===
							path.resolve(fixture.versionModulePath)
					) {
						failed = true;
						throw new Error('injected version publication failure');
					}
					await rename(source, destination);
				}
			})
		).rejects.toThrow('injected version publication failure');

		for (const [file, contents] of previousTargetEntries) {
			expect(await readFile(path.join(fixture.targetDir, file), 'utf8')).toBe(contents);
		}
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(previousVersion);
	});

	it('surfaces rollback failures without replacing the publication failure', async () => {
		const fixture = await createFixture();
		let publicationFailed = false;
		let restoreFailed = false;

		const outcome = syncWasmFortranAssets({
			...fixture,
			renamePath: async (source, destination) => {
				if (
					!publicationFailed &&
					String(source).includes(`${fixture.versionModulePath}.next-`) &&
					path.resolve(String(destination)) === path.resolve(fixture.versionModulePath)
				) {
					publicationFailed = true;
					throw new Error('primary publication failure');
				}
				if (
					publicationFailed &&
					!restoreFailed &&
					String(source).includes(`${fixture.targetDir}.previous-`) &&
					path.resolve(String(destination)) === path.resolve(fixture.targetDir)
				) {
					restoreFailed = true;
					throw new Error('target restore failure');
				}
				await rename(source, destination);
			}
		});

		await expect(outcome).rejects.toMatchObject({
			name: 'AggregateError',
			message:
				'wasm-fortran sync failed and rollback could not restore the previous installation',
			errors: [
				expect.objectContaining({ message: 'primary publication failure' }),
				expect.objectContaining({ message: 'target restore failure' })
			]
		});
		expect(publicationFailed).toBe(true);
		expect(restoreFailed).toBe(true);
	});
});
