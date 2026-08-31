import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	unlink,
	writeFile
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
	AWK_MANIFEST_FORMAT,
	computeAwkRuntimeFingerprint,
	computeLegacyAwkRuntimeFingerprint,
	getAwkSyncControlPaths,
	syncWasmAwkAssets
} from '../../scripts/sync-wasm-awk.mjs';

const tempDirs: string[] = [];
const buildArguments = [
	'build',
	'-buildvcs=false',
	'-trimpath',
	'-ldflags=-s -w -buildid=',
	'GOOS=js',
	'GOARCH=wasm'
];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-awk-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string | Buffer) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents);
	return targetPath;
}

function sha256(bytes: Uint8Array) {
	return createHash('sha256').update(bytes).digest('hex');
}

function fixtureWasmBytes(label = 'fixture') {
	return Buffer.concat([
		Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]),
		Buffer.from(label, 'utf8')
	]);
}

function fixtureBuildBytes() {
	return Buffer.from(
		`${JSON.stringify({ goVersion: 'go1.25.3', goawkVersion: 'v1.31.0' }, null, 2)}\n`,
		'utf8'
	);
}

async function writeSourceSnapshot(sourceDir: string, wasmBytes: Buffer, goShimBytes: Buffer) {
	const runtimeBuildBytes = fixtureBuildBytes();
	await Promise.all([
		writeFixtureFile(sourceDir, 'goawk.wasm', wasmBytes),
		writeFixtureFile(sourceDir, 'runtime-build.json', runtimeBuildBytes),
		writeFixtureFile(sourceDir, 'wasm_exec.js', goShimBytes)
	]);
	return runtimeBuildBytes;
}

async function writeFixtureLock(
	baseDir: string,
	wasmBytes: Buffer,
	runtimeBuildBytes: Buffer,
	goShimBytes: Buffer,
	legacyWorkerBytes: Buffer
) {
	return writeFixtureFile(
		baseDir,
		'wasm-awk-assets.lock.json',
		`${JSON.stringify(
			{
				format: 'wasm-awk-assets-lock-v1',
				profileId: 'goawk-fixture-go1.25.3',
				source: {
					repository: 'https://github.com/benhoyt/goawk',
					goVersion: 'go1.25.3',
					goawkModule: 'github.com/benhoyt/goawk',
					goawkVersion: 'v1.31.0',
					buildArguments
				},
				legacyWorker: {
					path: 'runner-worker.js',
					bytes: legacyWorkerBytes.byteLength,
					sha256: sha256(legacyWorkerBytes)
				},
				assets: [
					{ path: 'goawk.wasm', bytes: wasmBytes.byteLength, sha256: sha256(wasmBytes) },
					{
						path: 'runtime-build.json',
						bytes: runtimeBuildBytes.byteLength,
						sha256: sha256(runtimeBuildBytes)
					},
					{
						path: 'wasm_exec.js',
						bytes: goShimBytes.byteLength,
						sha256: sha256(goShimBytes)
					}
				]
			},
			null,
			2
		)}\n`
	);
}

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture(label = 'fixture') {
	const sourceDir = await makeTempDir();
	const publicationRoot = await makeTempDir();
	const targetDir = path.join(publicationRoot, 'runtime');
	const versionModulePath = path.join(publicationRoot, 'wasmAwkVersion.ts');
	const lspVersionModulePath = path.join(publicationRoot, 'bundledAwkRuntime.ts');
	const wasmBytes = fixtureWasmBytes(label);
	const goShimBytes = Buffer.from('globalThis.Go = class FixtureGo {};\n', 'utf8');
	const runtimeBuildBytes = await writeSourceSnapshot(sourceDir, wasmBytes, goShimBytes);
	const workerTemplateBytes = Buffer.from(
		`const fixtureProfile = {
	profileId: '__WASM_IDLE_AWK_PROFILE_ID__',
	goShimBytes: Number('__WASM_IDLE_AWK_GO_SHIM_BYTES__'),
	goShimSha256: '__WASM_IDLE_AWK_GO_SHIM_SHA256__',
	logicalWasmBytes: Number('__WASM_IDLE_AWK_LOGICAL_WASM_BYTES__'),
	logicalWasmSha256: '__WASM_IDLE_AWK_LOGICAL_WASM_SHA256__'
};
self.onmessage = () => fixtureProfile;
`,
		'utf8'
	);
	const workerSourcePath = await writeFixtureFile(
		await makeTempDir(),
		'runner-worker.v2.template.js',
		workerTemplateBytes
	);
	const legacyWorkerBytes = Buffer.from('self.onmessage = () => {};\n', 'utf8');
	const legacyWorkerSourcePath = await writeFixtureFile(
		await makeTempDir(),
		'runner-worker.v1.js',
		legacyWorkerBytes
	);
	const lockFilePath = await writeFixtureLock(
		await makeTempDir(),
		wasmBytes,
		runtimeBuildBytes,
		goShimBytes,
		legacyWorkerBytes
	);
	return {
		sourceDir,
		targetDir,
		versionModulePath,
		lspVersionModulePath,
		wasmBytes,
		goShimBytes,
		runtimeBuildBytes,
		workerTemplateBytes,
		workerSourcePath,
		legacyWorkerBytes,
		legacyWorkerSourcePath,
		lockFilePath
	};
}

function syncFixture(fixture: Fixture, overrides: Record<string, unknown> = {}) {
	return syncWasmAwkAssets({
		sourceDir: fixture.sourceDir,
		targetDir: fixture.targetDir,
		workerSourcePath: fixture.workerSourcePath,
		legacyWorkerSourcePath: fixture.legacyWorkerSourcePath,
		versionModulePath: fixture.versionModulePath,
		lspVersionModulePath: fixture.lspVersionModulePath,
		lockFilePath: fixture.lockFilePath,
		...overrides
	});
}

function transactionSibling(target: string, transactionId: string, role: 'staging' | 'previous') {
	return path.join(path.dirname(target), `.${path.basename(target)}.${role}-${transactionId}`);
}

describe('syncWasmAwkAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('publishes a deterministic full-SHA receipt graph and dual generated profiles', async () => {
		const fixture = await createFixture();
		const first = await syncFixture(fixture);
		const firstManifestSource = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json'),
			'utf8'
		);
		const firstAppProfile = await readFile(fixture.versionModulePath, 'utf8');
		const firstLspProfile = await readFile(fixture.lspVersionModulePath, 'utf8');

		expect((await readdir(fixture.targetDir)).sort()).toEqual([
			'goawk.wasm.gz',
			'goawk.wasm.gz.bin',
			'runner-worker.js',
			'runner-worker.v2.js',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'wasm_exec.js'
		]);
		const legacyStorage = await readFile(path.join(fixture.targetDir, 'goawk.wasm.gz'));
		const verifiedStorage = await readFile(path.join(fixture.targetDir, 'goawk.wasm.gz.bin'));
		expect(legacyStorage).toEqual(verifiedStorage);
		expect(verifiedStorage).toEqual(gzipSync(fixture.wasmBytes, { level: 9 }));
		expect(gunzipSync(verifiedStorage)).toEqual(fixture.wasmBytes);
		expect(await readFile(path.join(fixture.targetDir, 'wasm_exec.js'))).toEqual(
			fixture.goShimBytes
		);
		expect(await readFile(path.join(fixture.targetDir, 'runner-worker.js'))).toEqual(
			fixture.legacyWorkerBytes
		);
		const verifiedWorker = await readFile(path.join(fixture.targetDir, 'runner-worker.v2.js'));
		expect(verifiedWorker).not.toEqual(fixture.workerTemplateBytes);
		expect(verifiedWorker.toString('utf8')).toContain(`profileId: 'goawk-fixture-go1.25.3'`);
		expect(verifiedWorker.toString('utf8')).toContain(
			`goShimSha256: '${sha256(fixture.goShimBytes)}'`
		);
		expect(verifiedWorker.toString('utf8')).toContain(
			`logicalWasmSha256: '${sha256(fixture.wasmBytes)}'`
		);

		const manifest = JSON.parse(firstManifestSource);
		expect(manifest).toEqual({
			format: AWK_MANIFEST_FORMAT,
			runtime: 'GoAWK',
			profileId: 'goawk-fixture-go1.25.3',
			goVersion: 'go1.25.3',
			goawkVersion: 'v1.31.0',
			assets: {
				worker: {
					path: 'runner-worker.v2.js',
					bytes: verifiedWorker.byteLength,
					sha256: sha256(verifiedWorker)
				},
				goShim: {
					path: 'wasm_exec.js',
					bytes: fixture.goShimBytes.byteLength,
					sha256: sha256(fixture.goShimBytes)
				},
				wasm: {
					path: 'goawk.wasm.gz.bin',
					bytes: verifiedStorage.byteLength,
					sha256: sha256(verifiedStorage),
					uncompressedBytes: fixture.wasmBytes.byteLength,
					uncompressedSha256: sha256(fixture.wasmBytes)
				}
			},
			fingerprint: first.fingerprint
		});
		expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
		expect(computeAwkRuntimeFingerprint(manifest)).toBe(first.fingerprint);
		const legacyFingerprint = computeLegacyAwkRuntimeFingerprint({
			'goawk.wasm': fixture.wasmBytes,
			'runner-worker.js': fixture.legacyWorkerBytes,
			'runtime-build.json': fixture.runtimeBuildBytes,
			'wasm_exec.js': fixture.goShimBytes
		});
		expect(
			JSON.parse(
				await readFile(path.join(fixture.targetDir, 'runtime-manifest.v1.json'), 'utf8')
			)
		).toEqual({
			format: 'wasm-awk-runtime-manifest-v1',
			runtime: 'GoAWK',
			goVersion: 'go1.25.3',
			goawkVersion: 'v1.31.0',
			fingerprint: legacyFingerprint,
			files: ['goawk.wasm', 'runtime-build.json', 'wasm_exec.js']
		});
		expect(legacyFingerprint).toMatch(/^[a-f0-9]{16}$/u);
		expect(firstAppProfile).toContain(`manifestFingerprint: '${first.fingerprint}'`);
		expect(firstAppProfile).toContain('export const WASM_AWK_RUNTIME_BUNDLE');
		expect(firstLspProfile).toContain('export const BUNDLED_AWK_RUNTIME_PROFILE');
		expect(firstLspProfile).toContain('export const BUNDLED_AWK_RUNNER_RECEIPT');
		expect(first.profile.manifestReceipt).toEqual({
			bytes: Buffer.byteLength(firstManifestSource),
			sha256: sha256(Buffer.from(firstManifestSource))
		});

		const second = await syncFixture(fixture);
		expect(second.fingerprint).toBe(first.fingerprint);
		await expect(
			readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		).resolves.toBe(firstManifestSource);
		await expect(readFile(fixture.versionModulePath, 'utf8')).resolves.toBe(firstAppProfile);
		await expect(readFile(fixture.lspVersionModulePath, 'utf8')).resolves.toBe(firstLspProfile);
	});

	it('rejects same-length source corruption before replacing any installed output', async () => {
		const fixture = await createFixture('locked');
		await Promise.all([
			writeFixtureFile(fixture.targetDir, 'previous.txt', 'previous runtime\n'),
			writeFile(fixture.versionModulePath, 'previous app profile\n'),
			writeFile(fixture.lspVersionModulePath, 'previous lsp profile\n')
		]);
		const corrupted = Buffer.from(fixture.wasmBytes);
		corrupted[corrupted.byteLength - 1] ^= 0xff;
		await writeFile(path.join(fixture.sourceDir, 'goawk.wasm'), corrupted);

		await expect(syncFixture(fixture)).rejects.toThrow(
			'goawk.wasm does not match the input lock'
		);
		await expect(readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).resolves.toBe(
			'previous runtime\n'
		);
		await expect(readFile(fixture.versionModulePath, 'utf8')).resolves.toBe(
			'previous app profile\n'
		);
		await expect(readFile(fixture.lspVersionModulePath, 'utf8')).resolves.toBe(
			'previous lsp profile\n'
		);
	});

	it('rejects source/target overlap, including a symlink alias, without deleting source bytes', async () => {
		const fixture = await createFixture('overlap');
		const aliasParent = await makeTempDir();
		const sourceParent = path.dirname(fixture.sourceDir);
		const sourceName = path.basename(fixture.sourceDir);
		const aliasRoot = path.join(aliasParent, 'source-alias');
		await symlink(sourceParent, aliasRoot, 'dir');
		const aliasedTarget = path.join(aliasRoot, sourceName);

		await expect(syncFixture(fixture, { targetDir: aliasedTarget })).rejects.toThrow(
			'publication output and source directory must not overlap'
		);
		await expect(readFile(path.join(fixture.sourceDir, 'goawk.wasm'))).resolves.toEqual(
			fixture.wasmBytes
		);
	});

	it('rejects control-path collisions with inputs without deleting the colliding file', async () => {
		const fixture = await createFixture('control-collision');
		const collisionWorkerPath = await writeFixtureFile(
			path.dirname(fixture.targetDir),
			'transaction-marker.next',
			fixture.workerTemplateBytes
		);
		const transactionMarkerPath = path.join(
			path.dirname(fixture.targetDir),
			'transaction-marker'
		);

		await expect(
			syncFixture(fixture, {
				workerSourcePath: collisionWorkerPath,
				transactionMarkerPath
			})
		).rejects.toThrow(
			'wasm-awk transaction marker temporary and v2 worker template must not overlap'
		);
		await expect(readFile(collisionWorkerPath)).resolves.toEqual(fixture.workerTemplateBytes);
	});

	it('rejects symlinked source inputs before reading or publishing them', async () => {
		const fixture = await createFixture('symlink-input');
		const externalShimPath = await writeFixtureFile(
			await makeTempDir(),
			'wasm_exec.js',
			fixture.goShimBytes
		);
		await unlink(path.join(fixture.sourceDir, 'wasm_exec.js'));
		await symlink(externalShimPath, path.join(fixture.sourceDir, 'wasm_exec.js'));

		await expect(syncFixture(fixture)).rejects.toThrow(
			'wasm-awk source wasm_exec.js must be an existing non-symlink regular file'
		);
		await expect(readFile(externalShimPath)).resolves.toEqual(fixture.goShimBytes);
		await expect(readFile(fixture.versionModulePath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('refuses a second publisher while an active exclusive sync lock exists', async () => {
		const fixture = await createFixture('locked-publisher');
		const { syncLockPath } = getAwkSyncControlPaths(fixture.targetDir);
		await writeFile(
			syncLockPath,
			`${JSON.stringify(
				{
					format: 'wasm-awk-sync-lock-v1',
					pid: process.pid,
					token: '00000000-0000-4000-8000-000000000000',
					createdAt: new Date().toISOString()
				},
				null,
				2
			)}\n`
		);

		await expect(syncFixture(fixture)).rejects.toThrow(
			`wasm-awk sync is already running under PID ${process.pid}`
		);
		await expect(readFile(syncLockPath, 'utf8')).resolves.toContain(
			'00000000-0000-4000-8000-000000000000'
		);
	});

	it('serializes two real contenders without removing the live publisher lock', async () => {
		const fixture = await createFixture('concurrent-publishers');
		let releaseFirstPublisher!: () => void;
		const firstPublisherGate = new Promise<void>((resolve) => {
			releaseFirstPublisher = resolve;
		});
		let reportFirstRename!: () => void;
		const firstRenameReached = new Promise<void>((resolve) => {
			reportFirstRename = resolve;
		});
		let renameCount = 0;
		const firstPublisher = syncFixture(fixture, {
			renamePath: async (sourcePath: string, destinationPath: string) => {
				renameCount += 1;
				if (renameCount === 1) {
					reportFirstRename();
					await firstPublisherGate;
				}
				await rename(sourcePath, destinationPath);
			}
		});
		await firstRenameReached;
		try {
			await expect(syncFixture(fixture)).rejects.toThrow(
				`wasm-awk sync is already running under PID ${process.pid}`
			);
		} finally {
			releaseFirstPublisher();
		}
		await expect(firstPublisher).resolves.toMatchObject({ targetDir: fixture.targetDir });
	});

	it('fails closed on an inactive stale lock instead of racing to unlink it', async () => {
		const fixture = await createFixture('stale-lock');
		const child = spawn(process.execPath, ['-e', '']);
		if (!child.pid) throw new Error('fixture child PID is unavailable');
		const deadPid = child.pid;
		await new Promise<void>((resolve, reject) => {
			child.once('error', reject);
			child.once('exit', () => resolve());
		});
		const { syncLockPath } = getAwkSyncControlPaths(fixture.targetDir);
		await writeFile(
			syncLockPath,
			`${JSON.stringify(
				{
					format: 'wasm-awk-sync-lock-v1',
					pid: deadPid,
					token: '22222222-2222-4222-8222-222222222222',
					createdAt: new Date().toISOString()
				},
				null,
				2
			)}\n`
		);

		await expect(syncFixture(fixture)).rejects.toThrow(
			`wasm-awk sync lock belongs to inactive PID ${deadPid}; remove the verified stale lock manually`
		);
		await expect(readFile(syncLockPath, 'utf8')).resolves.toContain(
			'22222222-2222-4222-8222-222222222222'
		);
	});

	it('recovers a prepared cross-invocation transaction before validating new inputs', async () => {
		const fixture = await createFixture('recoverable');
		await syncFixture(fixture);
		const priorManifest = await readFile(
			path.join(fixture.targetDir, 'runtime-manifest.v2.json')
		);
		const priorAppProfile = await readFile(fixture.versionModulePath);
		const priorLspProfile = await readFile(fixture.lspVersionModulePath);
		const transactionId = '11111111-1111-4111-8111-111111111111';
		const basePublications = [
			{ target: fixture.targetDir, kind: 'directory' },
			{ target: fixture.versionModulePath, kind: 'file' },
			{ target: fixture.lspVersionModulePath, kind: 'file' }
		] as const;
		const publications = basePublications.map((publication) => ({
			...publication,
			staging: transactionSibling(publication.target, transactionId, 'staging'),
			previous: transactionSibling(publication.target, transactionId, 'previous'),
			hadTarget: true
		}));
		await rename(publications[0].target, publications[0].previous);
		await writeFixtureFile(publications[0].target, 'new.txt', 'interrupted runtime\n');
		await rename(publications[1].target, publications[1].previous);
		await writeFile(publications[1].target, 'interrupted app profile\n');
		await writeFile(publications[2].staging, 'interrupted lsp profile\n');
		const { transactionMarkerPath, syncLockPath } = getAwkSyncControlPaths(fixture.targetDir);
		await writeFile(
			transactionMarkerPath,
			`${JSON.stringify(
				{
					format: 'wasm-awk-sync-transaction-v1',
					transactionId,
					phase: 'prepared',
					publications
				},
				null,
				2
			)}\n`
		);
		await writeFile(`${transactionMarkerPath}.next`, 'partial marker write\n');
		const corruptedWasm = Buffer.from(fixture.wasmBytes);
		corruptedWasm[corruptedWasm.byteLength - 1] ^= 0xff;
		await writeFile(path.join(fixture.sourceDir, 'goawk.wasm'), corruptedWasm);

		await expect(syncFixture(fixture)).rejects.toThrow(
			'goawk.wasm does not match the input lock'
		);
		await expect(
			readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'))
		).resolves.toEqual(priorManifest);
		await expect(readFile(fixture.versionModulePath)).resolves.toEqual(priorAppProfile);
		await expect(readFile(fixture.lspVersionModulePath)).resolves.toEqual(priorLspProfile);
		for (const publication of publications) {
			await expect(readFile(publication.staging)).rejects.toMatchObject({ code: 'ENOENT' });
			await expect(readFile(publication.previous)).rejects.toMatchObject({ code: 'ENOENT' });
		}
		await expect(readFile(transactionMarkerPath)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(readFile(`${transactionMarkerPath}.next`)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(readFile(syncLockPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('rolls back the runtime and both generated profiles when the final swap fails', async () => {
		const fixture = await createFixture('rollback');
		await Promise.all([
			writeFixtureFile(fixture.targetDir, 'previous.txt', 'previous runtime\n'),
			writeFile(fixture.versionModulePath, 'previous app profile\n'),
			writeFile(fixture.lspVersionModulePath, 'previous lsp profile\n')
		]);
		let renameCount = 0;

		await expect(
			syncFixture(fixture, {
				renamePath: async (sourcePath: string, destinationPath: string) => {
					renameCount += 1;
					if (renameCount === 6) throw new Error('fixture LSP publication failure');
					await rename(sourcePath, destinationPath);
				}
			})
		).rejects.toThrow('fixture LSP publication failure');
		await expect(readFile(path.join(fixture.targetDir, 'previous.txt'), 'utf8')).resolves.toBe(
			'previous runtime\n'
		);
		await expect(readFile(fixture.versionModulePath, 'utf8')).resolves.toBe(
			'previous app profile\n'
		);
		await expect(readFile(fixture.lspVersionModulePath, 'utf8')).resolves.toBe(
			'previous lsp profile\n'
		);
		const controls = getAwkSyncControlPaths(fixture.targetDir);
		await expect(readFile(controls.transactionMarkerPath)).rejects.toMatchObject({
			code: 'ENOENT'
		});
		await expect(readFile(controls.syncLockPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});
});
