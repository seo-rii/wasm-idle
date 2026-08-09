import { createHash } from 'node:crypto';
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORTH_MANIFEST_FORMAT, syncWasmForthAssets } from '../../scripts/sync-wasm-forth.mjs';

const tempDirs: string[] = [];
const sourceText =
	'module.exports = { default: function WAForth() {}, isSuccess() { return true; } }; WebAssembly.instantiate;\n';
const workerText = `const format = '${FORTH_MANIFEST_FORMAT}'; self.onmessage = () => format;\n`;

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-forth-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

async function writeInputLock(
	contents = sourceText,
	overrides: { profileId?: string; packageVersion?: string; bytes?: number; sha256?: string } = {}
) {
	const bytes = Buffer.from(contents, 'utf8');
	const packageVersion = overrides.packageVersion ?? '1.2.3';
	const lockFilePath = path.join(await makeTempDir(), 'wasm-forth-assets.lock.json');
	await writeFile(
		lockFilePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId: overrides.profileId ?? `waforth-${packageVersion}`,
				upstream: {
					packageName: 'waforth',
					packageVersion,
					assetPath: 'dist/index.js',
					bytes: overrides.bytes ?? bytes.byteLength,
					sha256: overrides.sha256 ?? sha256(bytes)
				}
			},
			null,
			'\t'
		)}\n`,
		'utf8'
	);
	return lockFilePath;
}

async function createFixture() {
	const sourceFile = await writeFixtureFile(await makeTempDir(), 'index.js', sourceText);
	const workerSourcePath = await writeFixtureFile(
		await makeTempDir(),
		'runner-worker.js',
		workerText
	);
	return {
		sourceFile,
		workerSourcePath,
		lockFilePath: await writeInputLock()
	};
}

describe('syncWasmForthAssets', () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('pins the source and publishes deterministic manifest and worker receipts', async () => {
		const fixture = await createFixture();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmForthVersion.ts');
		await writeFixtureFile(targetDir, 'stale.js', 'stale');

		const result = await syncWasmForthAssets({
			...fixture,
			targetDir,
			versionModulePath
		});

		expect((await readdir(targetDir)).sort()).toEqual([
			'runner-worker.js',
			'runtime-manifest.v2.json',
			'waforth.js'
		]);
		const waforthBytes = await readFile(path.join(targetDir, 'waforth.js'));
		const workerBytes = await readFile(path.join(targetDir, 'runner-worker.js'));
		expect(waforthBytes.toString('utf8')).toContain('self.WAForthPackage = module.exports;');
		expect(workerBytes.toString('utf8')).toBe(workerText);

		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v2.json'), 'utf8')
		) as {
			format: string;
			profileId: string;
			waforthVersion: string;
			fingerprint: string;
			assets: Array<{ path: string; size: number; sha256: string }>;
		};
		expect(manifest).toMatchObject({
			format: FORTH_MANIFEST_FORMAT,
			profileId: 'waforth-1.2.3',
			waforthVersion: '1.2.3',
			fingerprint: result.fingerprint,
			assets: [
				{
					path: 'waforth.js',
					size: waforthBytes.byteLength,
					sha256: sha256(waforthBytes)
				}
			]
		});
		expect(result.workerReceipt).toEqual({
			bytes: workerBytes.byteLength,
			sha256: sha256(workerBytes)
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe(
			`export const WASM_FORTH_ASSET_VERSION =\n\t'${result.fingerprint}';\nexport const WASM_FORTH_RUNNER_RECEIPT = {\n\tbytes: ${workerBytes.byteLength},\n\tsha256: '${sha256(workerBytes)}'\n} as const;\n`
		);
	});

	it('reproduces the same fingerprint and bytes from the same pinned inputs', async () => {
		const fixture = await createFixture();
		const firstTarget = await makeTempDir();
		const secondTarget = await makeTempDir();
		const firstVersion = path.join(await makeTempDir(), 'first.ts');
		const secondVersion = path.join(await makeTempDir(), 'second.ts');

		const first = await syncWasmForthAssets({
			...fixture,
			targetDir: firstTarget,
			versionModulePath: firstVersion
		});
		const second = await syncWasmForthAssets({
			...fixture,
			targetDir: secondTarget,
			versionModulePath: secondVersion
		});

		expect(second.fingerprint).toBe(first.fingerprint);
		for (const file of await readdir(firstTarget)) {
			await expect(readFile(path.join(secondTarget, file))).resolves.toEqual(
				await readFile(path.join(firstTarget, file))
			);
		}
		await expect(readFile(secondVersion, 'utf8')).resolves.toBe(
			await readFile(firstVersion, 'utf8')
		);
	});

	it('uses an adjacent generated version module for a custom target', async () => {
		const fixture = await createFixture();
		const targetDir = path.join(await makeTempDir(), 'runtime');

		const result = await syncWasmForthAssets({ ...fixture, targetDir });

		expect(result.versionModulePath).toBe(`${targetDir}.version.ts`);
		await expect(readFile(result.versionModulePath, 'utf8')).resolves.toContain(
			'WASM_FORTH_RUNNER_RECEIPT'
		);
	});

	it('rejects mismatched and malformed source bundles before replacing outputs', async () => {
		const fixture = await createFixture();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');
		await writeFixtureFile(targetDir, 'existing.txt', 'old runtime');
		await writeFile(versionModulePath, 'old version', 'utf8');
		await writeFile(fixture.sourceFile, `${sourceText}// changed\n`, 'utf8');

		await expect(
			syncWasmForthAssets({ ...fixture, targetDir, versionModulePath })
		).rejects.toThrow('does not match its pinned receipt');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'old runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');

		const malformed = 'module.exports = {};\n';
		await writeFile(fixture.sourceFile, malformed, 'utf8');
		const malformedLock = await writeInputLock(malformed);
		await expect(
			syncWasmForthAssets({
				...fixture,
				lockFilePath: malformedLock,
				targetDir,
				versionModulePath
			})
		).rejects.toThrow('does not look like the expected WebAssembly runtime');
	});

	it('rejects symlink inputs and destructive output overlap', async () => {
		const fixture = await createFixture();
		const sourceLink = path.join(await makeTempDir(), 'source-link.js');
		await symlink(fixture.sourceFile, sourceLink);

		await expect(
			syncWasmForthAssets({
				...fixture,
				sourceFile: sourceLink,
				targetDir: await makeTempDir()
			})
		).rejects.toThrow('must be a regular file');
		await expect(
			syncWasmForthAssets({
				...fixture,
				targetDir: path.dirname(fixture.sourceFile),
				versionModulePath: path.join(await makeTempDir(), 'version.ts')
			})
		).rejects.toThrow('source bundle and runtime target must not overlap');
		await expect(
			syncWasmForthAssets({
				...fixture,
				targetDir: await makeTempDir(),
				versionModulePath: fixture.lockFilePath
			})
		).rejects.toThrow('input lock and version module must not overlap');
	});

	it('rolls both outputs back when version publication fails', async () => {
		const fixture = await createFixture();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');
		await writeFixtureFile(targetDir, 'existing.txt', 'old runtime');
		await writeFile(versionModulePath, 'old version', 'utf8');
		const renamePath = vi.fn(async (source: string, target: string) => {
			if (target === versionModulePath && source.includes('.next-')) {
				throw new Error('injected version publication failure');
			}
			await rename(source, target);
		});

		await expect(
			syncWasmForthAssets({
				...fixture,
				targetDir,
				versionModulePath,
				renamePath
			})
		).rejects.toThrow('injected version publication failure');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'old runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
	});

	it('rejects malformed lock metadata and unsafe existing output types', async () => {
		const fixture = await createFixture();
		const mismatchedProfile = await writeInputLock(sourceText, {
			profileId: 'waforth-other'
		});
		await expect(
			syncWasmForthAssets({
				...fixture,
				lockFilePath: mismatchedProfile,
				targetDir: await makeTempDir()
			})
		).rejects.toThrow('profile does not match the package version');

		const targetFile = path.join(await makeTempDir(), 'runtime');
		await writeFile(targetFile, 'do not replace', 'utf8');
		await expect(syncWasmForthAssets({ ...fixture, targetDir: targetFile })).rejects.toThrow(
			'runtime target must be a directory'
		);
		await expect(readFile(targetFile, 'utf8')).resolves.toBe('do not replace');
	});
});
