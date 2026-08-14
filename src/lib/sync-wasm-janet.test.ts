// @vitest-environment node

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	computeJanetRuntimeFingerprint,
	syncWasmJanetAssets
} from '../../scripts/sync-wasm-janet.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
const staticRuntimeDir = path.join(repositoryRoot, 'static', 'wasm-janet');
const workerSourcePath = path.join(
	repositoryRoot,
	'scripts',
	'runtime-workers',
	'wasm-janet-runner-worker.js'
);
const runnerSourcePath = path.join(
	repositoryRoot,
	'scripts',
	'runtime-build',
	'wasm-janet-runner.c'
);
const lockFilePath = path.join(repositoryRoot, 'scripts', 'wasm-janet-assets.lock.json');
const temporaryRoots: string[] = [];
const originalSourceDir = process.env.WASM_JANET_SOURCE_DIR;
const originalLicenseFile = process.env.WASM_JANET_LICENSE_FILE;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

type MutableJanetInputLock = {
	[key: string]: unknown;
	assets: Array<Record<string, unknown>>;
	components: Record<string, Record<string, unknown>>;
	license: Record<string, unknown>;
};

async function writeMutatedLock(root: string, mutate: (lock: MutableJanetInputLock) => void) {
	const lock = JSON.parse(await readFile(lockFilePath, 'utf8')) as MutableJanetInputLock;
	mutate(lock);
	const filePath = path.join(root, 'wasm-janet-assets.mutated.lock.json');
	await writeFile(filePath, `${JSON.stringify(lock, null, '\t')}\n`);
	return filePath;
}

async function createFixture() {
	const root = await mkdtemp(path.join(tmpdir(), 'wasm-janet-sync-'));
	temporaryRoots.push(root);
	const sourceDir = path.join(root, 'source');
	await mkdir(sourceDir, { recursive: true });
	await Promise.all([
		writeFile(
			path.join(sourceDir, 'janet.js'),
			await readFile(path.join(staticRuntimeDir, 'janet.js'))
		),
		writeFile(
			path.join(sourceDir, 'janet.wasm'),
			gunzipSync(await readFile(path.join(staticRuntimeDir, 'janet.wasm.gz')))
		),
		writeFile(
			path.join(sourceDir, 'LICENSE.txt'),
			await readFile(path.join(staticRuntimeDir, 'LICENSE.txt'))
		)
	]);
	return {
		root,
		sourceDir,
		targetDir: path.join(root, 'published'),
		versionModulePath: path.join(root, 'wasmJanetVersion.ts'),
		lspVersionModulePath: path.join(root, 'bundledJanetRuntime.ts')
	};
}

async function listFiles(root: string, relative = ''): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
		const child = path.posix.join(relative.split(path.sep).join('/'), entry.name);
		if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
		else if (entry.isFile()) files.push(child);
	}
	return files.sort();
}

afterEach(async () => {
	if (originalSourceDir === undefined) delete process.env.WASM_JANET_SOURCE_DIR;
	else process.env.WASM_JANET_SOURCE_DIR = originalSourceDir;
	if (originalLicenseFile === undefined) delete process.env.WASM_JANET_LICENSE_FILE;
	else process.env.WASM_JANET_LICENSE_FILE = originalLicenseFile;
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
});

describe('syncWasmJanetAssets', () => {
	it('publishes a deterministic exact receipt graph and generated host pins', async () => {
		const fixture = await createFixture();
		const result = await syncWasmJanetAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			workerSourcePath,
			runnerSourcePath,
			lockFilePath
		});

		expect(await listFiles(fixture.targetDir)).toEqual([
			'LICENSE.txt',
			'janet.js',
			'janet.wasm.gz',
			'runner-worker.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json'
		]);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest).toMatchObject({
			format: 'wasm-janet-runtime-manifest-v2',
			runtime: 'janet-lang-janet',
			fingerprint: result.fingerprint,
			artifact: { kind: 'opaque-vendored', verifiedBuildInput: false }
		});
		expect(computeJanetRuntimeFingerprint(manifest)).toBe(result.fingerprint);
		for (const storage of manifest.storage) {
			const stored = await readFile(path.join(fixture.targetDir, storage.path));
			expect(stored.byteLength).toBe(storage.size);
			expect(sha256(stored)).toBe(storage.sha256);
			const logical = storage.encoding === 'gzip' ? gunzipSync(stored) : stored;
			const receipt = manifest.assets.find(
				(candidate: { path: string }) => candidate.path === storage.logicalPath
			);
			expect(logical.byteLength).toBe(receipt.size);
			expect(sha256(logical)).toBe(receipt.sha256);
		}
		const worker = await readFile(path.join(fixture.targetDir, 'runner-worker.js'));
		expect(result.workerReceipt).toEqual({
			bytes: worker.byteLength,
			sha256: sha256(worker)
		});
		for (const modulePath of [fixture.versionModulePath, fixture.lspVersionModulePath]) {
			const source = await readFile(modulePath, 'utf8');
			expect(source).toContain(result.fingerprint);
			expect(source).toContain(result.workerReceipt.sha256);
		}

		const second = await createFixture();
		await syncWasmJanetAssets({
			sourceDir: second.sourceDir,
			targetDir: second.targetDir,
			versionModulePath: second.versionModulePath,
			lspVersionModulePath: second.lspVersionModulePath,
			workerSourcePath,
			runnerSourcePath,
			lockFilePath
		});
		for (const file of await listFiles(fixture.targetDir)) {
			expect(await readFile(path.join(second.targetDir, file))).toEqual(
				await readFile(path.join(fixture.targetDir, file))
			);
		}
	});

	it('rejects a source receipt mismatch before replacing published outputs', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous app pin');
		await writeFile(fixture.lspVersionModulePath, 'previous lsp pin');
		const wasm = await readFile(path.join(fixture.sourceDir, 'janet.wasm'));
		wasm[wasm.byteLength - 1] ^= 1;
		await writeFile(path.join(fixture.sourceDir, 'janet.wasm'), wasm);

		await expect(
			syncWasmJanetAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				runnerSourcePath,
				lockFilePath
			})
		).rejects.toThrow('does not match the input lock');
		expect(await readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).toBe(
			'previous runtime'
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous app pin');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('previous lsp pin');
	});

	it.each<[string, (lock: MutableJanetInputLock) => void]>([
		['top-level schema extension', (lock) => (lock.unexpected = true)],
		['component provenance drift', (lock) => (lock.components.janet.revision = '0'.repeat(40))],
		['license mapping drift', (lock) => (lock.license.path = 'OTHER-LICENSE.txt')],
		['duplicate logical asset', (lock) => (lock.assets[1].path = 'janet.js')]
	])('rejects %s in the input lock', async (_label, mutate) => {
		const fixture = await createFixture();
		const mutatedLockPath = await writeMutatedLock(fixture.root, mutate);

		await expect(
			syncWasmJanetAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				runnerSourcePath,
				lockFilePath: mutatedLockPath
			})
		).rejects.toThrow(/input lock/u);
	});

	it('fails closed when an explicit source environment path is missing', async () => {
		const fixture = await createFixture();
		await syncWasmJanetAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			workerSourcePath,
			runnerSourcePath,
			lockFilePath
		});
		process.env.WASM_JANET_SOURCE_DIR = path.join(fixture.root, 'missing-explicit-source');

		await expect(
			syncWasmJanetAssets({
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				runnerSourcePath,
				lockFilePath
			})
		).rejects.toThrow('Janet MIT license file was not found');
	});

	it('publishes from an immutable source snapshot when inputs change during rename', async () => {
		const fixture = await createFixture();
		const original = await readFile(path.join(fixture.sourceDir, 'janet.js'));
		let mutated = false;
		await syncWasmJanetAssets({
			sourceDir: fixture.sourceDir,
			targetDir: fixture.targetDir,
			versionModulePath: fixture.versionModulePath,
			lspVersionModulePath: fixture.lspVersionModulePath,
			workerSourcePath,
			runnerSourcePath,
			lockFilePath,
			renamePath: async (source, target) => {
				if (!mutated) {
					mutated = true;
					await writeFile(path.join(fixture.sourceDir, 'janet.js'), 'replacement race');
				}
				await rename(source, target);
			}
		});

		expect(await readFile(path.join(fixture.targetDir, 'janet.js'))).toEqual(original);
	});

	it('restores all previous outputs when the final publication fails', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous runtime');
		await writeFile(fixture.versionModulePath, 'previous app pin');
		await writeFile(fixture.lspVersionModulePath, 'previous lsp pin');

		await expect(
			syncWasmJanetAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.targetDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				runnerSourcePath,
				lockFilePath,
				renamePath: async (source, target) => {
					if (target === fixture.lspVersionModulePath && source.includes('.staging-')) {
						throw new Error('fixture final publication failure');
					}
					await rename(source, target);
				}
			})
		).rejects.toThrow('fixture final publication failure');
		expect(await listFiles(fixture.targetDir)).toEqual(['previous.txt']);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe('previous app pin');
		expect(await readFile(fixture.lspVersionModulePath, 'utf8')).toBe('previous lsp pin');
	});

	it('rejects source and publication paths that overlap through resolved boundaries', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmJanetAssets({
				sourceDir: fixture.sourceDir,
				targetDir: fixture.sourceDir,
				versionModulePath: fixture.versionModulePath,
				lspVersionModulePath: fixture.lspVersionModulePath,
				workerSourcePath,
				runnerSourcePath,
				lockFilePath
			})
		).rejects.toThrow('publication targets must not overlap their inputs');
	});
});
