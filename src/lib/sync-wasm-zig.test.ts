import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncWasmZigAssets } from '../../scripts/sync-wasm-zig.mjs';

const tempDirs: string[] = [];
const compilerBytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const stdlibZip = zipSync({ 'std/std.zig': strToU8('pub const std = true;') });
const releaseBaseUrl = 'https://downloads.example.test/zigc-wasm/v0.11.0';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-zig-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: Uint8Array) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
}

async function writeInputLock(
	inputs: Record<string, Uint8Array> = {
		'zig_small.wasm': compilerBytes,
		'std.zip': stdlibZip
	}
) {
	const lockFilePath = path.join(await makeTempDir(), 'wasm-zig-assets.lock.json');
	await writeFile(
		lockFilePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId: 'fixture-zigc-wasm',
				releaseBaseUrl,
				inputs: Object.fromEntries(
					Object.entries(inputs).map(([asset, bytes]) => [
						asset,
						{ bytes: bytes.byteLength, sha256: sha256(bytes) }
					])
				)
			},
			null,
			'\t'
		)}\n`,
		'utf8'
	);
	return lockFilePath;
}

async function writeValidSource() {
	const sourceDir = await makeTempDir();
	await writeFixtureFile(sourceDir, 'zig_small.wasm', compilerBytes);
	await writeFixtureFile(sourceDir, 'std.zip', stdlibZip);
	return sourceDir;
}

async function syncFromRemote(fetchImpl: typeof fetch) {
	const parentDir = await makeTempDir();
	return await syncWasmZigAssets({
		targetDir: path.join(parentDir, 'runtime'),
		versionModulePath: path.join(parentDir, 'version.ts'),
		lockFilePath: await writeInputLock(),
		fetchImpl,
		releaseBaseUrl
	});
}

describe('syncWasmZigAssets', () => {
	afterEach(async () => {
		vi.restoreAllMocks();
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('pins the inputs and publishes deterministic execution receipts', async () => {
		const sourceDir = await writeValidSource();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmZigVersion.ts');
		const lockFilePath = await writeInputLock();

		const result = await syncWasmZigAssets({
			sourceDir,
			targetDir,
			versionModulePath,
			lockFilePath
		});

		await expect(readFile(path.join(targetDir, 'zig_small.wasm'))).resolves.toEqual(
			Buffer.from(compilerBytes)
		);
		const compressedStdlib = await readFile(path.join(targetDir, 'std.tar.gz'));
		const stdlibTar = gunzipSync(compressedStdlib);
		expect(stdlibTar.subarray(0, 100).toString('utf8').replaceAll('\0', '')).toBe(
			'std/std.zig'
		);
		expect(stdlibTar.subarray(257, 262).toString('ascii')).toBe('ustar');
		await expect(readFile(path.join(targetDir, 'std.zip'))).rejects.toThrow();

		const runtimeBuild = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')
		) as {
			profileId: string;
			assets: Record<string, Record<string, string | number>>;
		};
		expect(runtimeBuild.profileId).toBe('fixture-zigc-wasm');
		expect(runtimeBuild.assets['zig_small.wasm']).toEqual(result.receipts['zig_small.wasm']);
		expect(runtimeBuild.assets['std.tar.gz']).toEqual(result.receipts['std.tar.gz']);
		expect(runtimeBuild.assets['std.tar.gz'].uncompressedBytes).toBe(stdlibTar.byteLength);
		expect(runtimeBuild.assets['std.tar.gz'].uncompressedSha256).toBe(sha256(stdlibTar));
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_ZIG_ASSET_VERSION = '${result.fingerprint}';`
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`sha256: '${result.receipts['std.tar.gz'].sha256}'`
		);
	});

	it('produces the same fingerprint and bytes from the same pinned inputs', async () => {
		const sourceDir = await writeValidSource();
		const lockFilePath = await writeInputLock();
		const firstTarget = await makeTempDir();
		const secondTarget = await makeTempDir();
		const firstVersion = path.join(await makeTempDir(), 'first.ts');
		const secondVersion = path.join(await makeTempDir(), 'second.ts');

		const first = await syncWasmZigAssets({
			sourceDir,
			targetDir: firstTarget,
			versionModulePath: firstVersion,
			lockFilePath
		});
		const second = await syncWasmZigAssets({
			sourceDir,
			targetDir: secondTarget,
			versionModulePath: secondVersion,
			lockFilePath
		});

		expect(second.fingerprint).toBe(first.fingerprint);
		await expect(readFile(path.join(secondTarget, 'std.tar.gz'))).resolves.toEqual(
			await readFile(path.join(firstTarget, 'std.tar.gz'))
		);
		await expect(readFile(secondVersion, 'utf8')).resolves.toBe(
			await readFile(firstVersion, 'utf8')
		);
	});

	it('keeps custom-target CLI callers safe with an adjacent generated version module', async () => {
		const sourceDir = await writeValidSource();
		const parentDir = await makeTempDir();
		const targetDir = path.join(parentDir, 'runtime');
		const lockFilePath = await writeInputLock();

		const result = await syncWasmZigAssets({ sourceDir, targetDir, lockFilePath });

		expect(result.versionModulePath).toBe(`${targetDir}.version.ts`);
		await expect(readFile(result.versionModulePath, 'utf8')).resolves.toContain(
			'WASM_ZIG_ASSET_VERSION'
		);
	});

	it('fails when a local source directory is incomplete or has extra files', async () => {
		const incompleteSource = await makeTempDir();
		await writeFixtureFile(incompleteSource, 'zig_small.wasm', compilerBytes);
		const extraSource = await writeValidSource();
		await writeFixtureFile(extraSource, 'unexpected.txt', new TextEncoder().encode('extra'));
		const lockFilePath = await writeInputLock();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');

		await expect(
			syncWasmZigAssets({
				sourceDir: incompleteSource,
				targetDir,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('exactly two pinned assets');
		await expect(
			syncWasmZigAssets({
				sourceDir: extraSource,
				targetDir,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('exactly two pinned assets');
	});

	it('rejects source bytes that do not match the input lock before replacing outputs', async () => {
		const sourceDir = await writeValidSource();
		const lockFilePath = await writeInputLock();
		await writeFixtureFile(sourceDir, 'zig_small.wasm', new Uint8Array([...compilerBytes, 1]));
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');
		await writeFixtureFile(targetDir, 'existing.txt', new TextEncoder().encode('existing'));
		await writeFile(versionModulePath, 'existing version', 'utf8');

		await expect(
			syncWasmZigAssets({ sourceDir, targetDir, versionModulePath, lockFilePath })
		).rejects.toThrow('pinned wasm-zig input receipt');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'existing'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('existing version');
	});

	it('rejects invalid compiler and stdlib bundle formats after receipt verification', async () => {
		const invalidCompiler = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
		const compilerSource = await makeTempDir();
		await writeFixtureFile(compilerSource, 'zig_small.wasm', invalidCompiler);
		await writeFixtureFile(compilerSource, 'std.zip', stdlibZip);
		const compilerLock = await writeInputLock({
			'zig_small.wasm': invalidCompiler,
			'std.zip': stdlibZip
		});
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');

		await expect(
			syncWasmZigAssets({
				sourceDir: compilerSource,
				targetDir,
				versionModulePath,
				lockFilePath: compilerLock
			})
		).rejects.toThrow('not a valid WebAssembly binary');

		const malformedZip = new Uint8Array([0x50, 0x4b, 3, 4, 1]);
		const archiveSource = await makeTempDir();
		await writeFixtureFile(archiveSource, 'zig_small.wasm', compilerBytes);
		await writeFixtureFile(archiveSource, 'std.zip', malformedZip);
		const archiveLock = await writeInputLock({
			'zig_small.wasm': compilerBytes,
			'std.zip': malformedZip
		});
		await expect(
			syncWasmZigAssets({
				sourceDir: archiveSource,
				targetDir,
				versionModulePath,
				lockFilePath: archiveLock
			})
		).rejects.toThrow('could not be repackaged');
	});

	it('verifies pinned remote downloads before publishing them', async () => {
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			const asset = String(url).endsWith('zig_small.wasm') ? compilerBytes : stdlibZip;
			return new Response(asset, {
				status: 200,
				headers: { 'content-length': String(asset.byteLength) }
			});
		});

		const result = await syncFromRemote(fetchImpl as typeof fetch);

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(fetchImpl).toHaveBeenCalledWith(`${releaseBaseUrl}/zig_small.wasm`, {
			credentials: 'omit',
			redirect: 'follow',
			referrerPolicy: 'no-referrer'
		});
		await expect(
			readFile(path.join(result.targetDir, 'runtime-build.json'), 'utf8')
		).resolves.toContain('fixture-zigc-wasm');
	});

	it('rejects a remote Content-Length that differs from the pinned receipt', async () => {
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			const asset = String(url).endsWith('zig_small.wasm') ? compilerBytes : stdlibZip;
			return new Response(asset, {
				status: 200,
				headers: {
					'content-length': String(
						String(url).endsWith('zig_small.wasm')
							? asset.byteLength + 1
							: asset.byteLength
					)
				}
			});
		});

		await expect(syncFromRemote(fetchImpl as typeof fetch)).rejects.toThrow(
			'download size does not match the pinned receipt'
		);
	});

	it('rejects and cancels a remote stream that exceeds its pinned byte size', async () => {
		const cancel = vi.fn(async () => undefined);
		const releaseLock = vi.fn();
		const read = vi.fn(async () => ({
			value: new Uint8Array([...compilerBytes, 0]),
			done: false
		}));
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			if (!String(url).endsWith('zig_small.wasm')) return new Response(stdlibZip);
			return {
				ok: true,
				status: 200,
				headers: { get: () => null },
				body: { getReader: () => ({ read, cancel, releaseLock }) }
			} as unknown as Response;
		});

		await expect(syncFromRemote(fetchImpl as typeof fetch)).rejects.toThrow(
			'download exceeds the pinned byte size'
		);
		expect(cancel).toHaveBeenCalledOnce();
		expect(releaseLock).toHaveBeenCalledOnce();
	});

	it('rejects same-length remote bytes with the wrong pinned hash', async () => {
		const corruptCompiler = Uint8Array.from(compilerBytes);
		corruptCompiler[7] ^= 1;
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			const asset = String(url).endsWith('zig_small.wasm') ? corruptCompiler : stdlibZip;
			return new Response(asset, {
				status: 200,
				headers: { 'content-length': String(asset.byteLength) }
			});
		});

		await expect(syncFromRemote(fetchImpl as typeof fetch)).rejects.toThrow(
			'does not match the pinned wasm-zig input receipt'
		);
	});

	it('rolls the runtime and version module back when the second publication fails', async () => {
		const sourceDir = await writeValidSource();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');
		const lockFilePath = await writeInputLock();
		await writeFixtureFile(targetDir, 'existing.txt', new TextEncoder().encode('old runtime'));
		await writeFile(versionModulePath, 'old version', 'utf8');
		const renamePath = vi.fn(async (source: string, target: string) => {
			if (target === versionModulePath && source.includes('.next-')) {
				throw new Error('injected version publication failure');
			}
			await rename(source, target);
		});

		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir,
				versionModulePath,
				lockFilePath,
				renamePath
			})
		).rejects.toThrow('injected version publication failure');
		await expect(readFile(path.join(targetDir, 'existing.txt'), 'utf8')).resolves.toBe(
			'old runtime'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old version');
	});

	it('rejects destructive path overlap and unpinned release overrides', async () => {
		const sourceDir = await writeValidSource();
		const lockFilePath = await writeInputLock();
		const versionModulePath = path.join(await makeTempDir(), 'version.ts');

		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir: sourceDir,
				versionModulePath,
				lockFilePath
			})
		).rejects.toThrow('must not overlap');
		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir: await makeTempDir(),
				versionModulePath,
				lockFilePath,
				releaseBaseUrl: 'https://other.example.test/release'
			})
		).rejects.toThrow('must match the pinned input lock');
	});

	it('rejects output paths that could replace the lock or an ancestor directory', async () => {
		const sourceDir = await writeValidSource();
		const lockFilePath = await writeInputLock();
		const targetParent = path.join(await makeTempDir(), 'output');
		const nestedTargetDir = path.join(targetParent, 'runtime');

		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir: nestedTargetDir,
				versionModulePath: targetParent,
				lockFilePath
			})
		).rejects.toThrow('version module must be outside the runtime target directory');
		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir: await makeTempDir(),
				versionModulePath: lockFilePath,
				lockFilePath
			})
		).rejects.toThrow('input lock and version module must not overlap');
		await expect(readFile(lockFilePath, 'utf8')).resolves.toContain('fixture-zigc-wasm');
	});

	it('rejects existing outputs with unsafe filesystem types', async () => {
		const sourceDir = await writeValidSource();
		const lockFilePath = await writeInputLock();
		const targetFile = path.join(await makeTempDir(), 'runtime');
		const versionDirectory = await makeTempDir();
		await writeFile(targetFile, 'do not replace', 'utf8');

		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir: targetFile,
				versionModulePath: path.join(await makeTempDir(), 'version.ts'),
				lockFilePath
			})
		).rejects.toThrow('runtime target must be a directory');
		await expect(
			syncWasmZigAssets({
				sourceDir,
				targetDir: await makeTempDir(),
				versionModulePath: versionDirectory,
				lockFilePath
			})
		).rejects.toThrow('version module must be a regular file');
		await expect(readFile(targetFile, 'utf8')).resolves.toBe('do not replace');
	});
});
