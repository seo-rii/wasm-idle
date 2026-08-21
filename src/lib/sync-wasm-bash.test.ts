import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { syncWasmBashAssets } from '../../scripts/sync-wasm-bash.mjs';
import { WASM_BASH_ASSET_VERSION, WASM_BASH_WEBC_RECEIPT } from './playground/wasmBashVersion';

const temporaryDirectories: string[] = [];
const repositoryRoot = process.cwd();
const sourceRevision = 'fc8096485478055f4fcf31402004fdd8ff6b72b7';
const sdkPackageIntegrity =
	'sha512-k/CY19NfeLCjA9ZpX69JAoZKiuMT3hKjDFJYWdRGkCdfig9NtC9Op7Gpg2LeezuuQKd4WaSSq8bpSMdHw1BMgg==';

const expectedPublishedFiles = [
	'LICENSE.txt',
	'bash.webc.gz',
	'bash.webc.gz.bin',
	'runtime-build.json',
	'runtime-manifest.v1.json',
	'runtime-manifest.v2.json',
	'sdk/LICENSE.txt',
	'sdk/index.mjs',
	'sdk/index.mjs.bin',
	'sdk/runtime-manifest.v1.json',
	'sdk/wasmer_js_bg.wasm.gz',
	'sdk/wasmer_js_bg.wasm.gz.bin',
	'sdk/worker.mjs'
] as const;

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(',')}}`;
	}
	const primitive = JSON.stringify(value);
	if (primitive === undefined) throw new TypeError('fixture contains a non-JSON value');
	return primitive;
}

function computeManifestFingerprint(manifest: Record<string, any>) {
	const hash = createHash('sha256');
	hash.update('wasm-idle:bash-runtime-manifest:v2\n');
	for (const key of ['format', 'runtime', 'profileId', 'licenseExpression'] as const) {
		hash.update(`${key}\0${manifest[key]}\n`);
	}
	for (const key of ['artifact', 'components', 'build', 'license'] as const) {
		hash.update(`${key}\0${canonicalJson(manifest[key])}\n`);
	}
	hash.update(
		`metadata\0${manifest.metadata.path}\0${manifest.metadata.mediaType}\0${manifest.metadata.size}\0${manifest.metadata.sha256}\n`
	);
	for (const asset of [...manifest.assets].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		hash.update(`asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`);
	}
	for (const storage of [...manifest.storage].sort((left, right) =>
		left.path.localeCompare(right.path)
	)) {
		hash.update(
			`storage\0${storage.path}\0${storage.logicalPath}\0${storage.encoding}\0${storage.size}\0${storage.sha256}\n`
		);
	}
	return hash.digest('hex');
}

async function collectRelativeFiles(root: string, current = root): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(current, { withFileTypes: true })) {
		const entryPath = path.join(current, entry.name);
		if (entry.isDirectory()) files.push(...(await collectRelativeFiles(root, entryPath)));
		else if (entry.isFile())
			files.push(path.relative(root, entryPath).split(path.sep).join('/'));
	}
	return files.sort();
}

async function treeReceipt(root: string) {
	const hash = createHash('sha256');
	for (const relativePath of await collectRelativeFiles(root)) {
		hash.update(relativePath);
		hash.update('\0');
		hash.update(await readFile(path.join(root, relativePath)));
		hash.update('\n');
	}
	return hash.digest('hex');
}

async function createFixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-bash-receipt-'));
	temporaryDirectories.push(root);
	const sourceDir = path.join(root, 'source');
	const sdkPackageDir = path.join(root, 'sdk-package');
	const targetDir = path.join(root, 'target');
	const versionModulePath = path.join(root, 'wasmBashVersion.ts');
	const lockFilePath = path.join(root, 'wasm-bash-assets.lock.json');
	const pnpmLockPath = path.join(root, 'pnpm-lock.yaml');
	await mkdir(sourceDir, { recursive: true });
	await mkdir(path.join(sdkPackageDir, 'dist'), { recursive: true });
	const webc = new TextEncoder().encode('fixture Bash WEBc package');
	const license = new TextEncoder().encode('fixture license');
	const sdkJavaScript = new TextEncoder().encode('export const fixtureSdk = true;\n');
	const sdkWorker = new TextEncoder().encode('self.onmessage = () => {};\n');
	const wasmerWasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
	const sdkLicense = new TextEncoder().encode('fixture SDK license');
	await writeFile(path.join(sourceDir, 'bash.webc'), webc);
	await writeFile(path.join(sourceDir, 'LICENSE.txt'), license);
	const runtimeBuild = {
		schemaVersion: 1,
		package: 'wasmer/bash',
		packageVersion: '1.0.25',
		sourceRepository: 'https://github.com/wasix-org/bash',
		sourceRevision,
		sourceArchiveUrl: `https://github.com/wasix-org/bash/archive/${sourceRevision}.tar.gz`,
		sourceArchiveSha256: '8dc67f0d1dd04fed7f0e2a976b24ca4e915c2ea8216e1742705546780f03db41',
		sysrootRelease: 'v2024-07-08.1',
		sysrootArchiveUrl:
			'https://github.com/wasix-org/wasix-libc/releases/download/v2024-07-08.1/sysroot.tar.gz',
		sysrootArchiveSha256: 'ab48114f09d6092eeab6752e50feaa34da8fe33112e02aadc81ea7e664ec7bd9',
		toolchain: 'WASI SDK 20.0 (LLVM 16.0.0)',
		toolchainArchiveUrl:
			'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz',
		toolchainArchiveSha256: '7030139d495a19fbeccb9449150c2b1531e15d8fb74419872a719a7580aad0f9',
		binaryenVersion: '108',
		binaryenArchiveUrl:
			'https://github.com/WebAssembly/binaryen/releases/download/version_108/binaryen-version_108-x86_64-linux.tar.gz',
		binaryenArchiveSha256: '7bb8a2d97214f40bf34abc31d49b34aa5deab10b25d6d13c5f72cb395cf142fb',
		wasmerVersion: '7.2.0',
		wasmerArchiveUrl:
			'https://github.com/wasmerio/wasmer/releases/download/v7.2.0/wasmer-linux-amd64.tar.gz',
		wasmerArchiveSha256: 'fce71a4b0d504b9925e2461d1368b24cce60001111edb3fa871df8187a8a40f2',
		buildTarget: 'shell',
		postprocessArgs: ['--strip-debug'],
		wasmFeatures: ['threads', 'mutable-globals', 'bulk-memory', 'sign-ext'],
		wasmSha256: '62a39c0b18b34ad15eb54388dfc4c323430cd002cc45a54f121690c9b459d3d0',
		wasmBytes: 1_807_388,
		webcSha256: sha256(webc),
		webcBytes: webc.byteLength,
		abi: 'wasix_32v1',
		license: 'GPL-3.0-or-later',
		licenseSha256: sha256(license),
		limitations: [
			'Only Bash builtins are bundled; external coreutils commands are unavailable.'
		]
	};
	await writeFile(
		path.join(sourceDir, 'runtime-build.json'),
		`${JSON.stringify(runtimeBuild, null, 2)}\n`
	);
	await writeFile(
		path.join(sdkPackageDir, 'package.json'),
		`${JSON.stringify(
			{
				name: '@wasmer/sdk',
				version: '0.9.0',
				license: 'MIT',
				repository: {
					type: 'git',
					url: 'git+https://github.com/wasmerio/wasmer-js.git'
				}
			},
			null,
			2
		)}\n`
	);
	await writeFile(path.join(sdkPackageDir, 'dist/index.mjs'), sdkJavaScript);
	await writeFile(path.join(sdkPackageDir, 'dist/worker.mjs'), sdkWorker);
	await writeFile(path.join(sdkPackageDir, 'dist/wasmer_js_bg.wasm'), wasmerWasm);
	await writeFile(path.join(sdkPackageDir, 'LICENSE'), sdkLicense);
	const lock = {
		schemaVersion: 1,
		bash: {
			license: {
				path: 'LICENSE.txt',
				sourceUrl: `https://github.com/wasix-org/bash/blob/${sourceRevision}/COPYING`,
				spdx: 'GPL-3.0-or-later'
			},
			runtimeBuild
		},
		wasmerSdk: {
			npmPackage: '@wasmer/sdk',
			npmVersion: '0.9.0',
			packageIntegrity: sdkPackageIntegrity,
			tarballUrl: 'https://registry.npmjs.org/@wasmer/sdk/-/sdk-0.9.0.tgz',
			license: {
				path: 'LICENSE',
				sourceUrl: 'https://registry.npmjs.org/@wasmer/sdk/-/sdk-0.9.0.tgz#package/LICENSE',
				spdx: 'MIT'
			},
			files: {
				LICENSE: { bytes: sdkLicense.byteLength, sha256: sha256(sdkLicense) },
				'dist/index.mjs': {
					bytes: sdkJavaScript.byteLength,
					sha256: sha256(sdkJavaScript)
				},
				'dist/wasmer_js_bg.wasm': {
					bytes: wasmerWasm.byteLength,
					sha256: sha256(wasmerWasm)
				},
				'dist/worker.mjs': {
					bytes: sdkWorker.byteLength,
					sha256: sha256(sdkWorker)
				}
			}
		}
	};
	await writeFile(lockFilePath, `${JSON.stringify(lock, null, 2)}\n`);
	await writeFile(
		pnpmLockPath,
		`'@wasmer/sdk@0.9.0':\n  resolution: {integrity: ${sdkPackageIntegrity}}\n`
	);
	return {
		sourceDir,
		sdkPackageDir,
		targetDir,
		versionModulePath,
		lockFilePath,
		pnpmLockPath,
		webc,
		sdkJavaScript,
		sdkWorker,
		wasmerWasm,
		lock
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true }))
	);
});

describe('syncWasmBashAssets', () => {
	it('publishes one provenance-bound Bash and Wasmer SDK generation', async () => {
		const fixture = await createFixture();
		const result = await syncWasmBashAssets(fixture);
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');
		const manifestBytes = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
		const profile = result.runtimeProfile;

		expect(result.webcReceipt).toEqual({
			bytes: fixture.webc.byteLength,
			sha256: sha256(fixture.webc)
		});
		expect(await collectRelativeFiles(fixture.targetDir)).toEqual(expectedPublishedFiles);
		expect(manifest).toMatchObject({
			format: 'wasm-bash-runtime-manifest-v2',
			runtime: 'wasmer-bash-wasix',
			profileId: `bash-1.0.25-wasmer-sdk-0.9.0-${sourceRevision.slice(0, 8)}`,
			licenseExpression: 'GPL-3.0-or-later AND MIT',
			components: {
				wasmerSdk: {
					version: '0.9.0',
					package: '@wasmer/sdk',
					packageIntegrity: sdkPackageIntegrity
				}
			}
		});
		expect(Object.keys(manifest).sort()).toEqual(
			[
				'artifact',
				'assets',
				'build',
				'components',
				'fingerprint',
				'format',
				'license',
				'licenseExpression',
				'metadata',
				'profileId',
				'runtime',
				'storage'
			].sort()
		);
		expect(manifest.assets.map(({ path: assetPath }: { path: string }) => assetPath)).toEqual([
			'sdk/index.mjs',
			'sdk/wasmer_js_bg.wasm',
			'bash.webc'
		]);
		expect(
			manifest.storage.map(({ path: storagePath }: { path: string }) => storagePath)
		).toEqual(['sdk/index.mjs.bin', 'sdk/wasmer_js_bg.wasm.gz.bin', 'bash.webc.gz.bin']);
		expect(manifest.fingerprint).toBe(computeManifestFingerprint(manifest));
		expect(profile).toEqual({
			profileId: manifest.profileId,
			bashPackageVersion: '1.0.25',
			bashSourceRevision: sourceRevision,
			wasmerSdkVersion: '0.9.0',
			wasmerSdkPackageIntegrity: sdkPackageIntegrity,
			manifestFingerprint: manifest.fingerprint,
			manifestReceipt: {
				bytes: manifestBytes.byteLength,
				sha256: sha256(manifestBytes)
			},
			sdkJavaScriptReceipt: {
				bytes: fixture.sdkJavaScript.byteLength,
				sha256: sha256(fixture.sdkJavaScript)
			},
			wasmerWasmReceipt: expect.objectContaining({
				uncompressedBytes: fixture.wasmerWasm.byteLength,
				uncompressedSha256: sha256(fixture.wasmerWasm)
			}),
			webcReceipt: expect.objectContaining({
				uncompressedBytes: fixture.webc.byteLength,
				uncompressedSha256: sha256(fixture.webc)
			})
		});
		expect(versionModule).toContain('export const WASM_BASH_RUNTIME_PROFILE = Object.freeze(');
		expect(versionModule).toContain('export const WASM_BASH_RUNTIME_BUNDLE = Object.freeze({');
		expect(versionModule).toContain(
			'export const WASM_BASH_ASSET_VERSION = WASM_BASH_RUNTIME_PROFILE.manifestFingerprint;'
		);
		expect(versionModule).toContain(
			'bytes: WASM_BASH_RUNTIME_PROFILE.webcReceipt.uncompressedBytes'
		);
		expect(versionModule).toContain(
			'sha256: WASM_BASH_RUNTIME_PROFILE.webcReceipt.uncompressedSha256'
		);
		expect(await readFile(path.join(fixture.targetDir, 'sdk/index.mjs.bin'))).toEqual(
			await readFile(path.join(fixture.targetDir, 'sdk/index.mjs'))
		);
		expect(
			await readFile(path.join(fixture.targetDir, 'sdk/wasmer_js_bg.wasm.gz.bin'))
		).toEqual(await readFile(path.join(fixture.targetDir, 'sdk/wasmer_js_bg.wasm.gz')));
		expect(await readFile(path.join(fixture.targetDir, 'bash.webc.gz.bin'))).toEqual(
			await readFile(path.join(fixture.targetDir, 'bash.webc.gz'))
		);
		expect(
			JSON.parse(
				await readFile(path.join(fixture.targetDir, 'runtime-manifest.v1.json'), 'utf8')
			)
		).toMatchObject({
			format: 'wasm-bash-runtime-manifest-v1',
			fingerprint: result.legacyFingerprint
		});
	});

	it('rejects source and SDK bytes that do not match the external lock', async () => {
		const fixture = await createFixture();
		await writeFile(path.join(fixture.sdkPackageDir, 'dist/index.mjs'), 'tampered SDK');

		await expect(syncWasmBashAssets(fixture)).rejects.toThrow(
			'@wasmer/sdk dist/index.mjs does not match the Bash asset lock'
		);

		await writeFile(path.join(fixture.sdkPackageDir, 'dist/index.mjs'), fixture.sdkJavaScript);
		await writeFile(path.join(fixture.sourceDir, 'bash.webc'), 'tampered WEBc');
		await expect(syncWasmBashAssets(fixture)).rejects.toThrow(
			'wasm-bash runtime-build.json does not match the Bash asset lock'
		);
	});

	it('requires the exact lock schema and the pnpm package integrity', async () => {
		const wrongIntegrity = await createFixture();
		await writeFile(
			wrongIntegrity.pnpmLockPath,
			`'@wasmer/sdk@0.9.0':\n  resolution: {integrity: sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==}\n`
		);
		await expect(syncWasmBashAssets(wrongIntegrity)).rejects.toThrow(
			'pnpm lock does not contain the pinned @wasmer/sdk package integrity'
		);

		const extraKey = await createFixture();
		await writeFile(
			extraKey.lockFilePath,
			`${JSON.stringify({ ...extraKey.lock, unexpected: true }, null, 2)}\n`
		);
		await expect(syncWasmBashAssets(extraKey)).rejects.toThrow(
			'wasm-bash asset lock has an invalid root shape'
		);
	});

	it('is deterministic across repeated unified producer entrypoints', async () => {
		const fixture = await createFixture();
		const first = await syncWasmBashAssets(fixture);
		const firstTree = await treeReceipt(fixture.targetDir);
		const firstVersion = await readFile(fixture.versionModulePath, 'utf8');
		const second = await syncWasmBashAssets(fixture);

		expect(await treeReceipt(fixture.targetDir)).toBe(firstTree);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(firstVersion);
		expect(second.runtimeProfile).toEqual(first.runtimeProfile);
	});

	it('rolls back the static tree when the generated profile cannot be published', async () => {
		const fixture = await createFixture();
		await mkdir(fixture.targetDir, { recursive: true });
		await writeFile(path.join(fixture.targetDir, 'previous.txt'), 'previous static tree');
		await writeFile(fixture.versionModulePath, 'previous generated profile\n');
		const blockedParent = path.join(path.dirname(fixture.versionModulePath), 'blocked');
		await writeFile(blockedParent, 'not a directory');

		await expect(
			syncWasmBashAssets({
				...fixture,
				versionModulePath: path.join(blockedParent, 'wasmBashVersion.ts')
			})
		).rejects.toThrow();

		expect(await collectRelativeFiles(fixture.targetDir)).toEqual(['previous.txt']);
		expect(await readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).toBe(
			'previous static tree'
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(
			'previous generated profile\n'
		);
	});

	it('pins the production SDK package and every copied source asset', async () => {
		const lock = JSON.parse(
			await readFile(path.join(repositoryRoot, 'scripts/wasm-bash-assets.lock.json'), 'utf8')
		);

		expect(Object.keys(lock).sort()).toEqual(['bash', 'schemaVersion', 'wasmerSdk']);
		expect(lock.wasmerSdk).toMatchObject({
			npmPackage: '@wasmer/sdk',
			npmVersion: '0.9.0',
			packageIntegrity: sdkPackageIntegrity,
			tarballUrl: 'https://registry.npmjs.org/@wasmer/sdk/-/sdk-0.9.0.tgz'
		});
		expect(Object.keys(lock.wasmerSdk.files).sort()).toEqual([
			'LICENSE',
			'dist/index.mjs',
			'dist/wasmer_js_bg.wasm',
			'dist/worker.mjs'
		]);
		for (const [relativePath, receipt] of Object.entries(
			lock.wasmerSdk.files as Record<string, { bytes: number; sha256: string }>
		)) {
			const bytes = await readFile(
				path.join(repositoryRoot, 'node_modules/@wasmer/sdk', relativePath)
			);
			expect({ bytes: bytes.byteLength, sha256: sha256(bytes) }).toEqual(receipt);
		}
	});

	it('pins the checked-in compressed WEBc to the producer receipt and generated constants', async () => {
		const metadata = JSON.parse(
			await readFile(path.join(repositoryRoot, 'static/wasm-bash/runtime-build.json'), 'utf8')
		);
		const logicalBytes = gunzipSync(
			await readFile(path.join(repositoryRoot, 'static/wasm-bash/bash.webc.gz'))
		);
		const actualReceipt = {
			bytes: logicalBytes.byteLength,
			sha256: sha256(logicalBytes)
		};

		expect(actualReceipt).toEqual(WASM_BASH_WEBC_RECEIPT);
		expect(metadata).toMatchObject({
			webcBytes: WASM_BASH_WEBC_RECEIPT.bytes,
			webcSha256: WASM_BASH_WEBC_RECEIPT.sha256
		});
		expect(WASM_BASH_ASSET_VERSION).toMatch(/^[a-f0-9]{64}$/u);
	});
});
