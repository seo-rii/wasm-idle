import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { compressStaticRuntimeAssets } from '../../scripts/compress-static-runtime-assets.mjs';
import {
	parseSyncWasmSwiftArgs,
	SWIFT_SYNC_RECEIPT_FILE,
	SWIFT_SYNC_RECEIPT_FORMAT,
	syncWasmSwiftAssets
} from '../../scripts/sync-wasm-swift.mjs';
import {
	BROWSER_BUILD_LOG_SNAPSHOT_FILE,
	EXPECTED_RUNTIME_CONTRACT,
	SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE,
	swiftBaselineReceiptSnapshotFile,
	validateSwiftRuntimeBuildInfo
} from '../../scripts/llvm-contracts/swift/runtime-build-info.mjs';
import {
	createSwiftRuntimeContract,
	validateSwiftRuntimeContract
} from '../../scripts/llvm-contracts/swift/runtime-contract.mjs';
import {
	buildFileEntries,
	createSwiftRuntimeManifest,
	fingerprintFileEntries,
	validateSwiftRuntimeManifestFiles
} from '../../scripts/llvm-contracts/swift/runtime-manifest.mjs';

const tempDirs: string[] = [];
const VALID_RUNNER_WORKER_SOURCE = `
self.onmessage = async (event) => {
	const {
		run,
		baseUrl,
		manifestUrl,
		code,
		stdin,
		args = [],
		activePath,
		workspaceFiles = []
	} = event.data || {};
	self.postMessage({ progress: { percent: 1, stage: 'Loading Swift' } });
	if (!run || !baseUrl || !manifestUrl || !code || !activePath) {
		self.postMessage({ error: 'invalid Swift run message' });
		return;
	}
	const manifest = await (await fetch(manifestUrl)).json();
	const swiftcUrl = new URL('swiftc.wasm', baseUrl).href;
	const swiftpmUrl = new URL('swiftpm.wasm', baseUrl).href;
	const sdkUrl = new URL('sdk.tar.gz', baseUrl).href;
	if (stdin || args.length || workspaceFiles.length) {
		self.postMessage({ output: [manifest.runtime, swiftcUrl, swiftpmUrl, sdkUrl].join('\\n').slice(0, 0) });
	}
	self.postMessage({ results: true });
};
`;
const VALID_SDK_ARCHIVE_BYTES = Uint8Array.from(gzipSync(Uint8Array.of(115, 100, 107)));
const VALID_SDK_ARCHIVE_SHA256 = createHash('sha256').update(VALID_SDK_ARCHIVE_BYTES).digest('hex');

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-swift-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(
	baseDir: string,
	relativePath: string,
	contents: string | Uint8Array
) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
	return targetPath;
}

function encodeU32Leb(value: number) {
	const bytes: number[] = [];
	let remaining = value;
	do {
		let byte = remaining & 0x7f;
		remaining >>>= 7;
		if (remaining !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (remaining !== 0);
	return Uint8Array.from(bytes);
}

function taggedWasmFixture(tag: string, paddingLength = 0, fill = 0) {
	const header = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
	const name = Uint8Array.from([
		119, 97, 115, 109, 45, 105, 100, 108, 101, 45, 116, 101, 115, 116
	]);
	const nameLength = encodeU32Leb(name.byteLength);
	const tagBytes = Buffer.from(tag, 'utf8');
	const payloadLength =
		nameLength.byteLength + name.byteLength + tagBytes.byteLength + paddingLength;
	const sectionLength = encodeU32Leb(payloadLength);
	const bytes = new Uint8Array(header.byteLength + 1 + sectionLength.byteLength + payloadLength);
	let offset = 0;
	bytes.set(header, offset);
	offset += header.byteLength;
	bytes[offset] = 0;
	offset += 1;
	bytes.set(sectionLength, offset);
	offset += sectionLength.byteLength;
	bytes.set(nameLength, offset);
	offset += nameLength.byteLength;
	bytes.set(name, offset);
	offset += name.byteLength;
	bytes.set(tagBytes, offset);
	offset += tagBytes.byteLength;
	bytes.fill(fill, offset);
	return bytes;
}

function largeWasmFixture(tag: string, fill: number) {
	const size = 1_000_001;
	const minimum = taggedWasmFixture(tag);
	return taggedWasmFixture(tag, size - minimum.byteLength, fill);
}

function runtimeBuildInfo(overrides: Record<string, unknown> = {}) {
	return {
		format: 'wasm-swift-runtime-build-v1',
		swiftVersion: '6.3.3',
		wasmSdkId: 'swift-6.3.3-RELEASE_wasm',
		wasmSdkUrl:
			'https://download.swift.org/swift-6.3.3-release/wasm-sdk/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz',
		wasmSdkChecksum: VALID_SDK_ARCHIVE_SHA256,
		runtimeContract: EXPECTED_RUNTIME_CONTRACT,
		runnerWorker: 'runner-worker.js',
		compilerWasm: 'swiftc.wasm',
		packageManagerWasm: 'swiftpm.wasm',
		sdkArchive: 'sdk.tar.gz',
		source: 'unit-test-source',
		...overrides
	};
}

async function writeValidSwiftSourceBundle(
	sourceDir: string,
	overrides: Record<string, unknown> = {}
) {
	await writeFixtureFile(sourceDir, 'runner-worker.js', VALID_RUNNER_WORKER_SOURCE);
	await writeFixtureFile(sourceDir, 'swiftc.wasm', taggedWasmFixture('swiftc Swift compiler'));
	await writeFixtureFile(sourceDir, 'swiftpm.wasm', taggedWasmFixture('swiftpm SwiftPM'));
	await writeFixtureFile(sourceDir, 'sdk.tar.gz', VALID_SDK_ARCHIVE_BYTES);
	await writeFixtureFile(
		sourceDir,
		'runtime-build.json',
		`${JSON.stringify(runtimeBuildInfo(overrides), null, 2)}\n`
	);
	await writeSourceManifest(sourceDir, {
		swiftVersion: typeof overrides.swiftVersion === 'string' ? overrides.swiftVersion : '6.3.3',
		wasmSdkId:
			typeof overrides.wasmSdkId === 'string'
				? overrides.wasmSdkId
				: 'swift-6.3.3-RELEASE_wasm'
	});
}

async function writeSourceManifest(sourceDir: string, overrides: Record<string, unknown> = {}) {
	const files = await buildFileEntries(sourceDir);
	const fingerprint = fingerprintFileEntries(files);
	await writeFixtureFile(
		sourceDir,
		'runtime-manifest.v1.json',
		`${JSON.stringify(
			{
				...createSwiftRuntimeManifest({
					files,
					swiftVersion: '6.3.3',
					wasmSdkId: 'swift-6.3.3-RELEASE_wasm',
					fingerprint
				}),
				...overrides
			},
			null,
			2
		)}\n`
	);
}

describe('syncWasmSwiftAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('loads Swift contracts from wasm-idle', async () => {
		const [source, declarations] = await Promise.all([
			readFile(path.resolve('scripts', 'sync-wasm-swift.mjs'), 'utf8'),
			readFile(path.resolve('scripts', 'sync-wasm-swift.d.mts'), 'utf8')
		]);

		expect(source).toContain("from './llvm-contracts/swift/runtime-manifest.mjs'");
		expect(source).toContain("from './llvm-contracts/swift/runtime-build-info.mjs'");
		expect(`${source}\n${declarations}`).not.toMatch(/from\s+['"]@seo-rii\/wasm-llvm/u);
		expect(validateSwiftRuntimeContract(createSwiftRuntimeContract())).toEqual([]);
	});

	it('parses and validates direct sync CLI arguments', () => {
		expect(parseSyncWasmSwiftArgs(['dist', 'static/wasm-swift'])).toEqual({
			sourceDir: path.resolve('dist'),
			targetDir: path.resolve('static/wasm-swift')
		});
		expect(
			parseSyncWasmSwiftArgs([], {
				WASM_SWIFT_RUNTIME_SOURCE_DIR: 'external/wasm-swift'
			})
		).toEqual({
			sourceDir: path.resolve('external/wasm-swift'),
			targetDir: path.resolve('static/wasm-swift')
		});
		expect(() => parseSyncWasmSwiftArgs([], {})).toThrow(
			/sourceDir is required.*WASM_SWIFT_RUNTIME_SOURCE_DIR/u
		);
		expect(parseSyncWasmSwiftArgs(['--help'])).toEqual({ help: true });
		expect(() => parseSyncWasmSwiftArgs(['--unknown'])).toThrow(/Unknown option/u);
		expect(() => parseSyncWasmSwiftArgs(['one', 'two', 'three'])).toThrow(
			/at most sourceDir and targetDir/u
		);
	});

	it('reports direct sync CLI argument errors without stack traces', async () => {
		const { spawnSync } = await import('node:child_process');
		const scriptPath = path.resolve('scripts', 'sync-wasm-swift.mjs');
		const help = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
		const invalid = spawnSync(process.execPath, [scriptPath, '--unknown'], {
			encoding: 'utf8'
		});
		const missingSource = spawnSync(process.execPath, [scriptPath], {
			encoding: 'utf8',
			env: { ...process.env, WASM_SWIFT_RUNTIME_SOURCE_DIR: '' }
		});
		const tooMany = spawnSync(process.execPath, [scriptPath, 'one', 'two', 'three'], {
			encoding: 'utf8'
		});

		expect(help.status).toBe(0);
		expect(help.stdout).toContain('Usage: pnpm run sync:wasm-swift');
		expect(help.stdout).toContain('runtime-build.json source provenance');
		expect(help.stdout).toContain('runtime assets must come from an external producer bundle');
		expect(help.stdout).toContain('runtimeContract format and version');
		expect(help.stdout).toContain('swiftc.wasm.gz and swiftpm.wasm.gz');
		expect(help.stdout).toContain('decompressed .wasm bytes');
		expect(help.stderr).toBe('');
		expect(invalid.status).not.toBe(0);
		expect(invalid.stderr).toMatch(/Unknown option: --unknown/u);
		expect(invalid.stderr).not.toMatch(/\n\s+at /u);
		expect(missingSource.status).not.toBe(0);
		expect(missingSource.stderr).toMatch(
			/sourceDir is required.*WASM_SWIFT_RUNTIME_SOURCE_DIR/u
		);
		expect(missingSource.stderr).not.toMatch(/\n\s+at /u);
		expect(tooMany.status).not.toBe(0);
		expect(tooMany.stderr).toMatch(/at most sourceDir and targetDir/u);
		expect(tooMany.stderr).not.toMatch(/\n\s+at /u);
	});

	it('copies a Swift compiler bundle and writes a validated runtime manifest', async () => {
		const sourceDir = await makeTempDir();
		const targetRootDir = await makeTempDir();
		const targetDir = path.join(targetRootDir, 'wasm-swift');
		const versionModulePath = path.join(await makeTempDir(), 'wasmSwiftVersion.ts');
		expect(versionModulePath).not.toContain(path.join('src', 'lib', 'playground'));
		await writeFixtureFile(targetDir, 'stale.txt', 'stale\n');
		await writeFixtureFile(
			targetRootDir,
			'compressed-runtime-assets.v1.json',
			`${JSON.stringify(
				{
					assets: ['wasm-rust/runtime/compiler.wasm', 'wasm-swift/stale-swiftc.wasm'],
					sizes: {
						'wasm-rust/runtime/compiler.wasm': 10,
						'wasm-swift/stale-swiftc.wasm': 1
					}
				},
				null,
				2
			)}\n`
		);
		await writeValidSwiftSourceBundle(sourceDir);
		await writeFixtureFile(sourceDir, 'LICENSE', 'Apache License 2.0\n');
		await writeFixtureFile(sourceDir, 'build-plan.snapshot.json', '{"format":"test-plan"}\n');
		await writeFixtureFile(sourceDir, BROWSER_BUILD_LOG_SNAPSHOT_FILE, 'browser build log\n');
		await writeFixtureFile(
			sourceDir,
			SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE,
			'{"format":"test-bootstrap"}\n'
		);
		await writeFixtureFile(
			sourceDir,
			swiftBaselineReceiptSnapshotFile('buildbot_linux_crosscompile_wasm'),
			'{"format":"test-receipt"}\n'
		);

		const result = await syncWasmSwiftAssets({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'self.onmessage'
		);
		await expect(readFile(path.join(targetDir, 'LICENSE'), 'utf8')).resolves.toContain(
			'Apache License'
		);
		await expect(
			readFile(path.join(targetDir, 'build-plan.snapshot.json'), 'utf8')
		).resolves.toBe('{"format":"test-plan"}\n');
		await expect(
			readFile(path.join(targetDir, BROWSER_BUILD_LOG_SNAPSHOT_FILE), 'utf8')
		).resolves.toBe('browser build log\n');
		await expect(
			readFile(path.join(targetDir, SOURCE_BOOTSTRAP_RECEIPT_SNAPSHOT_FILE), 'utf8')
		).resolves.toBe('{"format":"test-bootstrap"}\n');
		await expect(
			readFile(
				path.join(
					targetDir,
					swiftBaselineReceiptSnapshotFile('buildbot_linux_crosscompile_wasm')
				),
				'utf8'
			)
		).resolves.toBe('{"format":"test-receipt"}\n');
		await expect(readFile(path.join(targetDir, 'stale.txt'), 'utf8')).rejects.toThrow();
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as {
			format: string;
			runtime: string;
			swiftVersion: string;
			wasmSdkId: string;
			runtimeContract: typeof EXPECTED_RUNTIME_CONTRACT;
			fingerprint: string;
			files: Array<{ path: string; bytes: number; sha256: string }>;
		};
		expect(manifest).toMatchObject({
			format: 'wasm-swift-runtime-manifest-v1',
			runtime: 'Swift',
			swiftVersion: '6.3.3',
			wasmSdkId: 'swift-6.3.3-RELEASE_wasm',
			runtimeContract: EXPECTED_RUNTIME_CONTRACT,
			fingerprint: result.fingerprint
		});
		expect(manifest.files.map((file) => file.path).sort()).toEqual([
			'runner-worker.js',
			'sdk.tar.gz',
			'swiftc.wasm',
			'swiftpm.wasm'
		]);
		for (const file of manifest.files) {
			expect(file.bytes).toBeGreaterThan(0);
			expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
		}
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe(
			`export const WASM_SWIFT_ASSET_VERSION = '${result.fingerprint}';\n`
		);
		await expect(
			JSON.parse(await readFile(path.join(targetDir, 'runtime-build.json'), 'utf8'))
		).toMatchObject({
			format: 'wasm-swift-runtime-build-v1',
			swiftVersion: '6.3.3',
			wasmSdkId: 'swift-6.3.3-RELEASE_wasm',
			wasmSdkUrl:
				'https://download.swift.org/swift-6.3.3-release/wasm-sdk/swift-6.3.3-RELEASE/swift-6.3.3-RELEASE_wasm.artifactbundle.tar.gz',
			wasmSdkChecksum: VALID_SDK_ARCHIVE_SHA256,
			runtimeContract: EXPECTED_RUNTIME_CONTRACT,
			source: 'unit-test-source'
		});
		const receipt = JSON.parse(
			await readFile(path.join(targetDir, SWIFT_SYNC_RECEIPT_FILE), 'utf8')
		) as {
			format: string;
			sourceDir: string;
			targetDir: string;
			versionModulePath: string;
			fingerprint: string;
			swiftVersion: string;
			wasmSdkId: string;
			runtimeBuildSha256: string;
		};
		expect(receipt).toMatchObject({
			format: SWIFT_SYNC_RECEIPT_FORMAT,
			sourceDir,
			targetDir,
			versionModulePath,
			fingerprint: result.fingerprint,
			swiftVersion: '6.3.3',
			wasmSdkId: 'swift-6.3.3-RELEASE_wasm'
		});
		expect(receipt.runtimeBuildSha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(result.receipt).toEqual(receipt);
		await expect(
			JSON.parse(
				await readFile(
					path.join(targetRootDir, 'compressed-runtime-assets.v1.json'),
					'utf8'
				)
			)
		).toEqual({
			assets: ['wasm-rust/runtime/compiler.wasm'],
			sizes: {
				'wasm-rust/runtime/compiler.wasm': 10
			}
		});
		expect(result.compressedManifestAssets).toEqual([]);
	});

	it('keeps the Swift runtime manifest valid after static runtime compression', async () => {
		const sourceDir = await makeTempDir();
		const targetRootDir = await makeTempDir();
		const targetDir = path.join(targetRootDir, 'wasm-swift');
		const versionModulePath = path.join(await makeTempDir(), 'wasmSwiftVersion.ts');
		await writeFixtureFile(sourceDir, 'runner-worker.js', VALID_RUNNER_WORKER_SOURCE);
		await writeFixtureFile(
			sourceDir,
			'swiftc.wasm',
			largeWasmFixture('swiftc Swift compiler', 2)
		);
		await writeFixtureFile(sourceDir, 'swiftpm.wasm', largeWasmFixture('swiftpm SwiftPM', 3));
		await writeFixtureFile(sourceDir, 'sdk.tar.gz', VALID_SDK_ARCHIVE_BYTES);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo(), null, 2)}\n`
		);
		await writeSourceManifest(sourceDir);

		await syncWasmSwiftAssets({ sourceDir, targetDir, versionModulePath });
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		);
		const compressionResult = await compressStaticRuntimeAssets({ rootDir: targetRootDir });

		expect(
			compressionResult.compressed
				.map((entry) =>
					path.relative(targetRootDir, entry.originalPath).split(path.sep).join('/')
				)
				.sort()
		).toEqual(['wasm-swift/swiftc.wasm', 'wasm-swift/swiftpm.wasm']);
		await expect(stat(path.join(targetDir, 'swiftc.wasm'))).rejects.toThrow();
		await expect(stat(path.join(targetDir, 'swiftpm.wasm'))).rejects.toThrow();
		await expect(stat(path.join(targetDir, 'swiftc.wasm.gz'))).resolves.toMatchObject({
			size: expect.any(Number)
		});
		await expect(validateSwiftRuntimeManifestFiles(targetDir, manifest)).resolves.toEqual([]);
	});

	it('syncs a packaged Swift source bundle with gzip-only compiler wasm assets', async () => {
		const sourceDir = await makeTempDir();
		const targetRootDir = await makeTempDir();
		const targetDir = path.join(targetRootDir, 'wasm-swift');
		const versionModulePath = path.join(await makeTempDir(), 'wasmSwiftVersion.ts');
		await writeValidSwiftSourceBundle(sourceDir);
		for (const wasmFile of ['swiftc.wasm', 'swiftpm.wasm']) {
			const wasmPath = path.join(sourceDir, wasmFile);
			await writeFixtureFile(sourceDir, `${wasmFile}.gz`, gzipSync(await readFile(wasmPath)));
			await rm(wasmPath);
		}
		await writeFixtureFile(
			targetRootDir,
			'compressed-runtime-assets.v1.json',
			`${JSON.stringify(
				{
					assets: ['wasm-rust/runtime/compiler.wasm', 'wasm-swift/old-swiftc.wasm'],
					sizes: {
						'wasm-rust/runtime/compiler.wasm': 10,
						'wasm-swift/old-swiftc.wasm': 1
					}
				},
				null,
				2
			)}\n`
		);

		const result = await syncWasmSwiftAssets({ sourceDir, targetDir, versionModulePath });
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { files: Array<{ path: string; bytes: number }>; fingerprint: string };
		const compressedManifest = JSON.parse(
			await readFile(path.join(targetRootDir, 'compressed-runtime-assets.v1.json'), 'utf8')
		) as { assets: string[]; sizes: Record<string, number> };

		await expect(stat(path.join(targetDir, 'swiftc.wasm'))).rejects.toThrow();
		await expect(stat(path.join(targetDir, 'swiftpm.wasm'))).rejects.toThrow();
		await expect(stat(path.join(targetDir, 'swiftc.wasm.gz'))).resolves.toMatchObject({
			size: expect.any(Number)
		});
		await expect(stat(path.join(targetDir, 'swiftpm.wasm.gz'))).resolves.toMatchObject({
			size: expect.any(Number)
		});
		expect(manifest.fingerprint).toBe(result.fingerprint);
		expect(manifest.files.map((file: { path: string }) => file.path).sort()).toEqual([
			'runner-worker.js',
			'sdk.tar.gz',
			'swiftc.wasm',
			'swiftpm.wasm'
		]);
		expect(result.compressedManifestAssets).toEqual([
			'wasm-swift/swiftc.wasm',
			'wasm-swift/swiftpm.wasm'
		]);
		expect(compressedManifest.assets).toEqual([
			'wasm-rust/runtime/compiler.wasm',
			'wasm-swift/swiftc.wasm',
			'wasm-swift/swiftpm.wasm'
		]);
		expect(compressedManifest.sizes['wasm-rust/runtime/compiler.wasm']).toBe(10);
		expect(compressedManifest.sizes['wasm-swift/swiftc.wasm']).toBe(
			manifest.files.find((file) => file.path === 'swiftc.wasm')?.bytes
		);
		expect(compressedManifest.sizes['wasm-swift/swiftpm.wasm']).toBe(
			manifest.files.find((file) => file.path === 'swiftpm.wasm')?.bytes
		);
		expect(compressedManifest.assets).not.toContain('wasm-swift/old-swiftc.wasm');
		await expect(validateSwiftRuntimeManifestFiles(targetDir, manifest)).resolves.toEqual([]);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe(
			`export const WASM_SWIFT_ASSET_VERSION = '${result.fingerprint}';\n`
		);
	});

	it('rejects sources without required Swift compiler assets', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo(), null, 2)}\n`
		);

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/Swift runtime asset runner-worker\.js was not found/u
		);
	});

	it('validates a packaged source runtime manifest before syncing', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmSwiftVersion.ts');
		await writeValidSwiftSourceBundle(sourceDir);

		const result = await syncWasmSwiftAssets({ sourceDir, targetDir, versionModulePath });

		expect(result.fingerprint).toMatch(/^[a-f0-9]{16}$/u);
		await expect(
			readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		).resolves.toContain(result.fingerprint);
	});

	it('rejects packaged source bundles without runtime build provenance', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(targetDir, 'stale.txt', 'stale\n');
		await writeValidSwiftSourceBundle(sourceDir, { source: '   ' });

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/source provenance before syncing app assets/u
		);
		await expect(readFile(path.join(targetDir, 'stale.txt'), 'utf8')).resolves.toBe('stale\n');
		await expect(stat(path.join(targetDir, 'runtime-manifest.v1.json'))).rejects.toThrow();
	});

	it('rejects packaged source bundles whose SDK checksum metadata does not match sdk archive bytes', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeValidSwiftSourceBundle(sourceDir, { wasmSdkChecksum: 'd'.repeat(64) });
		await writeFixtureFile(targetDir, 'runtime-build.json', '{"existing":true}\n');

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/Swift runtime build metadata wasmSdkChecksum [a-f0-9]{64} does not match sdk\.tar\.gz sha256/u
		);
		await expect(readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')).resolves.toBe(
			'{"existing":true}\n'
		);
	});

	it('rejects packaged source manifests that do not match runtime metadata or files', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeValidSwiftSourceBundle(sourceDir);
		await writeSourceManifest(sourceDir, {
			fingerprint: '0123456789abcdef',
			swiftVersion: '6.3.4',
			wasmSdkId: 'swift-6.3.4-RELEASE_wasm',
			files: [
				{
					path: 'swiftc.wasm',
					bytes: 1,
					sha256: '0'.repeat(64)
				},
				{
					path: 'swiftpm.wasm',
					bytes: 1,
					sha256: '0'.repeat(64)
				},
				{
					path: 'sdk.tar.gz',
					bytes: 1,
					sha256: '0'.repeat(64)
				},
				{
					path: 'runner-worker.js',
					bytes: 1,
					sha256: '0'.repeat(64)
				}
			]
		});
		await writeFixtureFile(targetDir, 'runtime-build.json', '{"existing":true}\n');

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/Swift source runtime manifest is invalid/u
		);
		await expect(readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')).resolves.toBe(
			'{"existing":true}\n'
		);
	});

	it('rejects packaged source manifests whose runtime contract differs from build metadata', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeValidSwiftSourceBundle(sourceDir);
		await writeSourceManifest(sourceDir, {
			runtimeContract: {
				format: 'wasm-swift-runtime-contract-v1',
				version: 1
			}
		});

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/source manifest runtimeContract\.version 1 does not match runtime-build\.json 2/u
		);
	});

	it('preserves an existing target when source validation fails', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(sourceDir, 'runner-worker.js', VALID_RUNNER_WORKER_SOURCE);
		await writeFixtureFile(sourceDir, 'swiftc.wasm', 'not wasm');
		await writeFixtureFile(sourceDir, 'swiftpm.wasm', taggedWasmFixture('swiftpm SwiftPM'));
		await writeFixtureFile(sourceDir, 'sdk.tar.gz', VALID_SDK_ARCHIVE_BYTES);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo(), null, 2)}\n`
		);
		await writeFixtureFile(targetDir, 'runtime-build.json', '{"existing":true}\n');
		await writeFixtureFile(targetDir, 'swiftc.wasm', 'existing target compiler\n');

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/swiftc\.wasm must start with the WebAssembly binary magic header/u
		);
		await expect(readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')).resolves.toBe(
			'{"existing":true}\n'
		);
		await expect(readFile(path.join(targetDir, 'swiftc.wasm'), 'utf8')).resolves.toBe(
			'existing target compiler\n'
		);
	});

	it('rejects destructive source and target path combinations before syncing', async () => {
		const sourceDir = await makeTempDir();
		const parentTargetDir = await makeTempDir();
		const nestedSourceDir = path.join(parentTargetDir, 'source');
		await writeValidSwiftSourceBundle(sourceDir);
		await writeValidSwiftSourceBundle(nestedSourceDir);

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir: sourceDir })).rejects.toThrow(
			/targetDir must be different from sourceDir/u
		);
		await expect(
			syncWasmSwiftAssets({
				sourceDir: nestedSourceDir,
				targetDir: parentTargetDir
			})
		).rejects.toThrow(/targetDir must not be a parent directory of sourceDir/u);
		await expect(stat(path.join(sourceDir, 'swiftc.wasm'))).resolves.toMatchObject({
			size: expect.any(Number)
		});
		await expect(stat(path.join(nestedSourceDir, 'swiftc.wasm'))).resolves.toMatchObject({
			size: expect.any(Number)
		});
	});

	it('rejects Swift runner workers that do not implement the playground message contract', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(sourceDir, 'runner-worker.js', 'self.onmessage = () => {};\n');
		await writeFixtureFile(
			sourceDir,
			'swiftc.wasm',
			taggedWasmFixture('swiftc Swift compiler')
		);
		await writeFixtureFile(sourceDir, 'swiftpm.wasm', taggedWasmFixture('swiftpm SwiftPM'));
		await writeFixtureFile(sourceDir, 'sdk.tar.gz', VALID_SDK_ARCHIVE_BYTES);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo(), null, 2)}\n`
		);
		await writeSourceManifest(sourceDir);

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/runner-worker\.js must read baseUrl from run messages/u
		);
	});

	it('rejects Swift compiler bundles with invalid wasm or SDK archive signatures', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(sourceDir, 'runner-worker.js', VALID_RUNNER_WORKER_SOURCE);
		await writeFixtureFile(sourceDir, 'swiftc.wasm', 'not wasm');
		await writeFixtureFile(sourceDir, 'swiftpm.wasm', taggedWasmFixture('swiftpm SwiftPM'));
		await writeFixtureFile(sourceDir, 'sdk.tar.gz', 'not gzip');
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo(), null, 2)}\n`
		);
		await writeSourceManifest(sourceDir);

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/swiftc\.wasm must start with the WebAssembly binary magic header/u
		);
		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/sdk\.tar\.gz must be a gzip-compressed archive/u
		);
	});

	it('rejects incomplete Swift runtime build metadata before syncing', async () => {
		expect(validateSwiftRuntimeBuildInfo(runtimeBuildInfo())).toEqual([]);
		expect(
			validateSwiftRuntimeBuildInfo(
				runtimeBuildInfo({
					format: 'old',
					swiftVersion: 'nightly',
					wasmSdkId: 'swift-6.3.3-RELEASE',
					wasmSdkUrl: 'https://example.com/sdk.tar.gz',
					wasmSdkChecksum: 'BAD',
					compilerWasm: 'placeholder.wasm',
					runtimeContract: { format: 'old', version: 0 },
					source: 42
				})
			)
		).toEqual([
			'format must be wasm-swift-runtime-build-v1',
			'swiftVersion must be a Swift release version string such as 6.3.3',
			'wasmSdkId must name a Swift Wasm SDK ending in _wasm',
			'compilerWasm must be swiftc.wasm',
			'runtimeContract.format must be wasm-swift-runtime-contract-v1',
			'runtimeContract.version must be 2',
			'source must be a string when provided',
			'wasmSdkUrl must be a Swift.org artifact bundle HTTPS URL when provided',
			'wasmSdkChecksum must be a lowercase sha256 hex digest when provided',
			'wasmSdkUrl artifact name must match wasmSdkId'
		]);

		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(sourceDir, 'runner-worker.js', VALID_RUNNER_WORKER_SOURCE);
		await writeFixtureFile(
			sourceDir,
			'swiftc.wasm',
			taggedWasmFixture('swiftc Swift compiler')
		);
		await writeFixtureFile(sourceDir, 'swiftpm.wasm', taggedWasmFixture('swiftpm SwiftPM'));
		await writeFixtureFile(sourceDir, 'sdk.tar.gz', VALID_SDK_ARCHIVE_BYTES);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo({ format: 'old' }), null, 2)}\n`
		);
		await writeSourceManifest(sourceDir);

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/format must be wasm-swift-runtime-build-v1/u
		);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo({ runtimeContract: undefined }), null, 2)}\n`
		);
		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/runtimeContract must describe the Swift browser runtime contract/u
		);
	});

	it('requires packaged source manifests before syncing', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		await writeFixtureFile(sourceDir, 'runner-worker.js', VALID_RUNNER_WORKER_SOURCE);
		await writeFixtureFile(
			sourceDir,
			'swiftc.wasm',
			taggedWasmFixture('swiftc Swift compiler')
		);
		await writeFixtureFile(sourceDir, 'swiftpm.wasm', taggedWasmFixture('swiftpm SwiftPM'));
		await writeFixtureFile(sourceDir, 'sdk.tar.gz', VALID_SDK_ARCHIVE_BYTES);
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify(runtimeBuildInfo(), null, 2)}\n`
		);
		await writeFixtureFile(targetDir, 'runtime-build.json', '{"existing":true}\n');

		await expect(syncWasmSwiftAssets({ sourceDir, targetDir })).rejects.toThrow(
			/Swift source runtime manifest was not found/u
		);
		await expect(readFile(path.join(targetDir, 'runtime-build.json'), 'utf8')).resolves.toBe(
			'{"existing":true}\n'
		);
	});
});
