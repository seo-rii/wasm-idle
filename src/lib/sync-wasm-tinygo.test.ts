import {
	lstat,
	mkdtemp,
	mkdir,
	readFile,
	readdir,
	rename,
	rm,
	symlink,
	utimes,
	writeFile
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	computeTinyGoExecutableGraphFingerprint,
	extractTinyGoExecutableImports,
	getTinyGoSyncControlPaths,
	parseTinyGoExecutableGraphLock,
	syncWasmTinyGoDist,
	TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN,
	TINYGO_EXECUTABLE_GRAPH_FORMAT
} from '../../scripts/sync-wasm-tinygo.mjs';
import { generateTinyGoExecutableLock } from '../../scripts/generate-tinygo-executable-lock.mjs';

const tempDirs: string[] = [];
const GRAPH_LOCK_FORMAT = 'wasm-idle-tinygo-executable-graph-lock-v1';

describe('TinyGo executable graph generation', () => {
	it('recognizes Vite empty-string URL bases while rejecting nonempty concatenation', () => {
		const specifier = './upstream-binaryen-0123456789abcdef.wasm.gz.bin';
		for (const base of [
			'import.meta.url',
			'``+import.meta.url',
			'"" + import.meta.url',
			"''+import.meta.url"
		]) {
			const source = `new URL('${specifier}',${base})`;
			expect(extractTinyGoExecutableImports(source, 'assets/worker.js')).toEqual([
				{
					specifier,
					target: specifier.replace('./', 'assets/'),
					kind: 'asset'
				}
			]);
		}
		expect(
			extractTinyGoExecutableImports(
				`new URL('${specifier}','wrong/'+import.meta.url)`,
				'assets/worker.js'
			)
		).toEqual([]);
	});

	it('generates both delivery and logical receipts from the actual emitted graph', async () => {
		const root = await makeTempDir();
		const sourceDir = path.join(root, 'dist');
		const output = path.join(root, 'lock.json');
		const assetPath = 'assets/upstream-binaryen-0123456789abcdef.wasm.gz.bin';
		const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);
		const compressed = gzipSync(wasm);
		await writeFixtureFile(
			sourceDir,
			'upstream.js',
			`export const asset = new URL('${assetPath}',\`\`+import.meta.url);`
		);
		await writeFixtureFile(sourceDir, assetPath, compressed);
		await writeFixtureFile(sourceDir, 'tools/upstream/tinygo-compiler.wasm', wasm);
		const generated = await generateTinyGoExecutableLock(sourceDir, output);
		expect(generated.modules).toHaveLength(2);
		expect(generated.modules[0]).toEqual({
			path: assetPath,
			bytes: compressed.length,
			sha256: sha256(compressed),
			imports: [],
			uncompressedBytes: wasm.length,
			uncompressedSha256: sha256(wasm)
		});
		expect(parseTinyGoExecutableGraphLock(await readFile(output)).modules.size).toBe(2);
		const original = await readFile(output);
		await generateTinyGoExecutableLock(sourceDir, output);
		expect(await readFile(output)).toEqual(original);
		await writeFixtureFile(sourceDir, 'assets/unreachable.js', 'export {};');
		await expect(generateTinyGoExecutableLock(sourceDir, output)).rejects.toThrow(
			'unreachable'
		);
		expect(await readFile(output)).toEqual(original);
		await rm(path.join(sourceDir, 'assets/unreachable.js'));
		await writeFixtureFile(sourceDir, assetPath, gzipSync(Buffer.from('not Wasm')));
		await expect(generateTinyGoExecutableLock(sourceDir, output)).rejects.toThrow(
			'not valid Wasm'
		);
		expect(await readFile(output)).toEqual(original);
	});

	it('rejects unknown graph binaries, symlinks and an output inside the source tree', async () => {
		const root = await makeTempDir();
		const sourceDir = path.join(root, 'dist');
		const output = path.join(root, 'lock.json');
		await writeFixtureFile(sourceDir, 'upstream.js', 'export {};');
		await expect(
			generateTinyGoExecutableLock(sourceDir, path.join(sourceDir, 'lock.json'))
		).rejects.toThrow('outside');
		await writeFixtureFile(sourceDir, 'assets/unrecognized.wasm.gz.bin', 'unknown');
		await expect(generateTinyGoExecutableLock(sourceDir, output)).rejects.toThrow(
			'unsupported executable'
		);
		await rm(path.join(sourceDir, 'assets/unrecognized.wasm.gz.bin'));
		await symlink(path.join(sourceDir, 'upstream.js'), path.join(sourceDir, 'alias.js'));
		await expect(generateTinyGoExecutableLock(sourceDir, output)).rejects.toThrow(
			'non-regular'
		);
	});
});

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-tinygo-'));
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
}

function sha256(bytes: Uint8Array | string) {
	return createHash('sha256').update(bytes).digest('hex');
}

const GRAPH_SOURCES = Object.freeze({
	'assets/shared.js': 'export const shared = true;\n',
	'assets/node-helper.js': "import './shared.js';\nexport const node = true;\n",
	'assets/worker-main.js':
		"import './shared.js';\nexport async function node() { return import('./node-helper.js'); }\n",
	'assets/worker-loader.js':
		"export async function load() { return import('./worker-main.js'); }\n",
	'upstream.js':
		"export const worker = new Worker(new URL('assets/worker-loader.js', import.meta.url), { type: 'module' });\n"
});

type GraphImport = {
	specifier: string;
	target: string;
	kind: 'static' | 'dynamic' | 'worker';
};

const GRAPH_IMPORTS: Record<keyof typeof GRAPH_SOURCES, GraphImport[]> = {
	'assets/shared.js': [],
	'assets/node-helper.js': [
		{
			specifier: './shared.js',
			target: 'assets/shared.js',
			kind: 'static'
		}
	],
	'assets/worker-main.js': [
		{
			specifier: './shared.js',
			target: 'assets/shared.js',
			kind: 'static'
		},
		{
			specifier: './node-helper.js',
			target: 'assets/node-helper.js',
			kind: 'dynamic'
		}
	],
	'assets/worker-loader.js': [
		{
			specifier: './worker-main.js',
			target: 'assets/worker-main.js',
			kind: 'dynamic'
		}
	],
	'upstream.js': [
		{
			specifier: 'assets/worker-loader.js',
			target: 'assets/worker-loader.js',
			kind: 'worker'
		}
	]
};

function makeGraphLock() {
	return {
		format: GRAPH_LOCK_FORMAT,
		entryPath: 'upstream.js',
		modules: Object.entries(GRAPH_SOURCES)
			.sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
			.map(([modulePath, source]) => ({
				path: modulePath,
				bytes: Buffer.byteLength(source),
				sha256: sha256(source),
				imports: GRAPH_IMPORTS[modulePath as keyof typeof GRAPH_SOURCES].map(
					(graphImport) => ({ ...graphImport })
				)
			}))
	};
}

async function writeGraphFixture(baseDir: string) {
	for (const [relativePath, source] of Object.entries(GRAPH_SOURCES)) {
		await writeFixtureFile(baseDir, relativePath, source);
	}
}

async function writeGraphLock(lockPath: string, lock = makeGraphLock()) {
	await writeFixtureFile(
		path.dirname(lockPath),
		path.basename(lockPath),
		`${JSON.stringify(lock)}\n`
	);
}

async function writeUpstreamToolchainFixture(baseDir: string) {
	const values = {
		'producer-receipt.json': 'producer receipt\n',
		'package-graph-provider-receipt.json': 'package graph receipt\n',
		'tinygo-compiler.wasm': 'compiler wasm\n',
		'tinygo-package-graph.wasm': 'package graph wasm\n',
		'tinygoroot.tar.gz.bin': 'root archive\n',
		'lld.wasm': 'lld wasm\n'
	};
	const evidence = (assetPath: keyof typeof values) => {
		const bytes = Buffer.from(values[assetPath], 'utf8');
		return {
			path: assetPath,
			bytes: bytes.byteLength,
			sha256: sha256(bytes)
		};
	};
	for (const [assetPath, contents] of Object.entries(values)) {
		await writeFixtureFile(baseDir, `tools/upstream/${assetPath}`, contents);
	}
	await writeFixtureFile(
		baseDir,
		'tools/upstream/upstream-toolchain.v2.json',
		`${JSON.stringify({
			schemaVersion: 2,
			format: 'wasm-idle-tinygo-upstream-assets-v2',
			producerReceipt: evidence('producer-receipt.json'),
			packageGraphReceipt: evidence('package-graph-provider-receipt.json'),
			assets: {
				compiler: evidence('tinygo-compiler.wasm'),
				packageGraph: evidence('tinygo-package-graph.wasm'),
				rootArchive: evidence('tinygoroot.tar.gz.bin'),
				lld: evidence('lld.wasm')
			}
		})}\n`
	);
}

async function replaceCompilerSnapshot(baseDir: string, contents: string) {
	const compilerPath = path.join(baseDir, 'tools/upstream/tinygo-compiler.wasm');
	const manifestPath = path.join(baseDir, 'tools/upstream/upstream-toolchain.v2.json');
	const compilerBytes = Buffer.from(contents, 'utf8');
	const compilerSha256 = sha256(compilerBytes);
	const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
	manifest.assets.compiler = {
		...manifest.assets.compiler,
		bytes: compilerBytes.byteLength,
		sha256: compilerSha256
	};
	await writeFile(compilerPath, compilerBytes);
	await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
	return { compilerBytes, compilerSha256 };
}

async function makeFixture() {
	const root = await makeTempDir();
	const targetDir = path.join(root, 'runtime');
	const versionModulePath = path.join(root, 'generated', 'wasmTinyGoVersion.ts');
	const graphLockPath = path.join(root, 'input', 'graph.lock.json');
	await writeGraphFixture(targetDir);
	await writeUpstreamToolchainFixture(targetDir);
	await writeFixtureFile(targetDir, 'tools/upstream/preserved-note.txt', 'preserve me\n');
	await writeFixtureFile(root, 'generated/wasmTinyGoVersion.ts', 'last good profile\n');
	await writeGraphLock(graphLockPath);
	return { root, targetDir, versionModulePath, graphLockPath };
}

async function readProtectedFiles(targetDir: string) {
	const relativePaths = [
		'tools/upstream/lld.wasm',
		'tools/upstream/package-graph-provider-receipt.json',
		'tools/upstream/preserved-note.txt',
		'tools/upstream/producer-receipt.json',
		'tools/upstream/tinygo-compiler.wasm',
		'tools/upstream/tinygo-package-graph.wasm',
		'tools/upstream/tinygoroot.tar.gz.bin',
		'tools/upstream/upstream-toolchain.v2.json'
	];
	return Promise.all(
		relativePaths.map((relativePath) => readFile(path.join(targetDir, relativePath)))
	);
}

describe('syncWasmTinyGoDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('refreshes the checked-in-style static graph without changing protected toolchain assets', async () => {
		const fixture = await makeFixture();
		const protectedBefore = await readProtectedFiles(fixture.targetDir);

		const result = await syncWasmTinyGoDist(fixture);

		expect(result.sourceMode).toBe('published-static');
		expect(result.sourceDir).toBe(fixture.targetDir);
		expect(result.executableGraphProfile).toMatchObject({
			schemaVersion: 1,
			format: TINYGO_EXECUTABLE_GRAPH_FORMAT,
			entryPath: 'upstream.js'
		});
		expect(result.executableGraphProfile.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
		expect(Object.keys(result.executableGraphProfile.modules)).toHaveLength(5);
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-executable-graph.v1.json'), 'utf8')
		);
		expect(manifest).toEqual(result.executableGraphProfile);
		const versionModule = await readFile(fixture.versionModulePath, 'utf8');
		expect(versionModule).toContain('WASM_TINYGO_RUNTIME_PROFILE');
		expect(versionModule).toContain('WASM_TINYGO_EXECUTABLE_GRAPH_PROFILE');
		expect(versionModule).toContain(result.executableGraphProfile.fingerprint);
		expect((await lstat(fixture.versionModulePath)).mode & 0o777).toBe(0o644);
		const protectedAfter = await readProtectedFiles(fixture.targetDir);
		expect(protectedAfter).toEqual(protectedBefore);
		const controls = getTinyGoSyncControlPaths(fixture.targetDir);
		await expect(lstat(controls.syncLockPath)).rejects.toThrow();
		await expect(lstat(controls.transactionMarkerPath)).rejects.toThrow();
	});

	it('pins the checked-in executable graph receipts', async () => {
		const repositoryRoot = path.resolve(import.meta.dirname, '..', '..');
		const lock = parseTinyGoExecutableGraphLock(
			await readFile(path.join(repositoryRoot, 'scripts', 'wasm-tinygo-assets.lock.json'))
		);
		expect(TINYGO_EXECUTABLE_GRAPH_FINGERPRINT_DOMAIN).toBe(
			'wasm-idle:tinygo-executable-graph:v1\n'
		);
		expect(computeTinyGoExecutableGraphFingerprint(lock)).toBe(
			'8ecbffd4b4e44ff67288d8c46328a1b06d0a0ac76d7a50a9e458603b68d0d795'
		);
		expect(
			[...lock.modules.values()].map(({ path: modulePath, bytes, sha256: digest }) => ({
				modulePath,
				bytes,
				digest
			}))
		).toEqual([
			{
				modulePath: 'assets/upstream-binaryen-59aad93503b5fd53.wasm.gz.bin',
				bytes: 2366782,
				digest: 'e497b67a6bcbee29639792a3d58ecacb22781287f7fe155bfdf079e6ca159dff'
			},
			{
				modulePath: 'assets/upstream-compile-worker-CFw6Ych6.js',
				bytes: 558,
				digest: '03a76345c69f8bd751dac18894f65c0918f1690fbbb661f38052819cd5ae8209'
			},
			{
				modulePath: 'assets/upstream-compile-worker-CUrboB1_.js',
				bytes: 103559,
				digest: '42337c2f06d04b51d79f0ec66ae685f0cfb2a78718b0636df980dc92dd1db9d5'
			},
			{
				modulePath: 'assets/upstream-compile-worker-CeYS3ydo.js',
				bytes: 181175,
				digest: 'faa2bf6a310cd23991babde1fb62cd34253d692fee03029fe3508eae4c24b1c0'
			},
			{
				modulePath: 'assets/upstream-compile-worker-NPJcbr3r.js',
				bytes: 110,
				digest: '2ac9a6dff1bfd7198815ead612722d9b2ffbbc6c8a0e62958444ee84ff155b80'
			},
			{
				modulePath: 'upstream.js',
				bytes: 126073,
				digest: '136a957aa940c3e2b8c7a925eb538f3fce81f699aa9113e1fd93ce0b35c879aa'
			}
		]);
	});
	it('is deterministic when only source mtimes change', async () => {
		const fixture = await makeFixture();
		const first = await syncWasmTinyGoDist(fixture);
		const firstModule = await readFile(fixture.versionModulePath, 'utf8');
		const shifted = new Date(Date.now() + 60_000);
		await utimes(path.join(fixture.targetDir, 'upstream.js'), shifted, shifted);
		const second = await syncWasmTinyGoDist(fixture);

		expect(second.fingerprint).toBe(first.fingerprint);
		expect(second.executableGraphProfile.fingerprint).toBe(
			first.executableGraphProfile.fingerprint
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toBe(firstModule);
	});

	it('derives the runtime profile from the isolated staging snapshot after a coherent live mutation', async () => {
		const fixture = await makeFixture();
		const originalCompilerSha256 = sha256(
			await readFile(path.join(fixture.targetDir, 'tools/upstream/tinygo-compiler.wasm'))
		);
		let stagedMutation: Awaited<ReturnType<typeof replaceCompilerSnapshot>> | undefined;
		let liveOnlyMutation: Awaited<ReturnType<typeof replaceCompilerSnapshot>> | undefined;
		let protectedHookCalls = 0;
		let stagedHookCalls = 0;

		const result = await syncWasmTinyGoDist({
			...fixture,
			beforeProtectedSnapshot: async () => {
				protectedHookCalls += 1;
				stagedMutation = await replaceCompilerSnapshot(
					fixture.targetDir,
					'compiler wasm from staged snapshot\n'
				);
			},
			beforeStagedProfileSnapshot: async () => {
				stagedHookCalls += 1;
				liveOnlyMutation = await replaceCompilerSnapshot(
					fixture.targetDir,
					'compiler wasm from later live mutation\n'
				);
			}
		});

		expect(protectedHookCalls).toBe(1);
		expect(stagedHookCalls).toBe(1);
		expect(stagedMutation).toBeDefined();
		expect(liveOnlyMutation).toBeDefined();
		expect(stagedMutation!.compilerSha256).not.toBe(originalCompilerSha256);
		expect(liveOnlyMutation!.compilerSha256).not.toBe(stagedMutation!.compilerSha256);
		expect(result.profile.assetReceipts['tools/upstream/tinygo-compiler.wasm']).toEqual({
			bytes: stagedMutation!.compilerBytes.byteLength,
			sha256: stagedMutation!.compilerSha256
		});
		expect(
			sha256(
				await readFile(path.join(fixture.targetDir, 'tools/upstream/tinygo-compiler.wasm'))
			)
		).toBe(stagedMutation!.compilerSha256);
		expect(await readFile(fixture.versionModulePath, 'utf8')).toContain(
			stagedMutation!.compilerSha256
		);
		expect(await readFile(fixture.versionModulePath, 'utf8')).not.toContain(
			liveOnlyMutation!.compilerSha256
		);
	});

	it('rejects same-length module corruption before publishing anything', async () => {
		const fixture = await makeFixture();
		const entryPath = path.join(fixture.targetDir, 'upstream.js');
		const originalEntry = await readFile(entryPath);
		const corrupted = Buffer.from(originalEntry);
		corrupted[0] ^= 1;
		await writeFile(entryPath, corrupted);
		const oldVersion = await readFile(fixture.versionModulePath);

		await expect(syncWasmTinyGoDist(fixture)).rejects.toThrow('differs from its lock');
		expect(await readFile(entryPath)).toEqual(corrupted);
		expect(await readFile(fixture.versionModulePath)).toEqual(oldVersion);
	});

	it('rejects duplicate, unknown, unreachable, cyclic, and unsafe graph records', () => {
		const duplicate = makeGraphLock();
		duplicate.modules.push({ ...duplicate.modules[0] });
		expect(() =>
			parseTinyGoExecutableGraphLock(Buffer.from(JSON.stringify(duplicate)))
		).toThrow('repeats module');

		const unknown = makeGraphLock();
		unknown.modules.find((module) => module.path === 'upstream.js')!.imports[0].target =
			'assets/missing.js';
		unknown.modules.find((module) => module.path === 'upstream.js')!.imports[0].specifier =
			'assets/missing.js';
		expect(() => parseTinyGoExecutableGraphLock(Buffer.from(JSON.stringify(unknown)))).toThrow(
			'unknown edge'
		);

		const unreachable = makeGraphLock();
		unreachable.modules.find((module) => module.path === 'upstream.js')!.imports = [];
		expect(() =>
			parseTinyGoExecutableGraphLock(Buffer.from(JSON.stringify(unreachable)))
		).toThrow('unreachable modules');

		const cyclic = makeGraphLock();
		cyclic.modules.find((module) => module.path === 'assets/shared.js')!.imports = [
			{
				specifier: './node-helper.js',
				target: 'assets/node-helper.js',
				kind: 'dynamic'
			}
		];
		expect(() => parseTinyGoExecutableGraphLock(Buffer.from(JSON.stringify(cyclic)))).toThrow(
			'contains a cycle'
		);

		const unsafe = makeGraphLock();
		unsafe.modules[0].path = '../escape.js';
		expect(() => parseTinyGoExecutableGraphLock(Buffer.from(JSON.stringify(unsafe)))).toThrow(
			'safe canonical relative path'
		);
	});

	it('rejects an unpinned JavaScript file without replacing the live tree', async () => {
		const fixture = await makeFixture();
		await writeFixtureFile(fixture.targetDir, 'assets/unpinned.js', 'export {};\n');
		const oldVersion = await readFile(fixture.versionModulePath);

		await expect(syncWasmTinyGoDist(fixture)).rejects.toThrow(
			'executable JS inventory differs from the lock'
		);
		await expect(
			readFile(path.join(fixture.targetDir, 'assets/unpinned.js'), 'utf8')
		).resolves.toBe('export {};\n');
		expect(await readFile(fixture.versionModulePath)).toEqual(oldVersion);
	});

	it('rolls back both publications when the final generated-module swap fails', async () => {
		const fixture = await makeFixture();
		const oldVersion = await readFile(fixture.versionModulePath);
		const oldEntry = await readFile(path.join(fixture.targetDir, 'upstream.js'));
		const renamePath: typeof rename = async (source, destination) => {
			if (
				path.resolve(destination.toString()) === path.resolve(fixture.versionModulePath) &&
				source.toString().includes('.staging-')
			) {
				throw new Error('injected final swap failure');
			}
			await rename(source, destination);
		};

		await expect(syncWasmTinyGoDist({ ...fixture, renamePath })).rejects.toThrow(
			'injected final swap failure'
		);
		expect(await readFile(path.join(fixture.targetDir, 'upstream.js'))).toEqual(oldEntry);
		expect(await readFile(fixture.versionModulePath)).toEqual(oldVersion);
		await expect(
			lstat(path.join(fixture.targetDir, 'runtime-executable-graph.v1.json'))
		).rejects.toThrow();
	});

	it('fails closed on an existing lock and leaves it untouched', async () => {
		const fixture = await makeFixture();
		const controls = getTinyGoSyncControlPaths(fixture.targetDir);
		await writeFile(controls.syncLockPath, 'pre-existing lock\n');
		const oldVersion = await readFile(fixture.versionModulePath);

		await expect(syncWasmTinyGoDist(fixture)).rejects.toThrow('sync lock already exists');
		expect(await readFile(controls.syncLockPath, 'utf8')).toBe('pre-existing lock\n');
		expect(await readFile(fixture.versionModulePath)).toEqual(oldVersion);
	});

	it('rejects control/input collisions before deleting the colliding file', async () => {
		const fixture = await makeFixture();
		const collisionBase = path.join(fixture.root, 'collision-control');
		const collidingGraphLock = `${collisionBase}.next`;
		await writeGraphLock(collidingGraphLock);
		const before = await readFile(collidingGraphLock);

		await expect(
			syncWasmTinyGoDist({
				...fixture,
				graphLockPath: collidingGraphLock,
				transactionMarkerPath: collisionBase
			})
		).rejects.toThrow('sync controls must not overlap inputs or outputs');
		expect(await readFile(collidingGraphLock)).toEqual(before);
	});

	it('rejects symlinked graph inputs before creating a transaction', async () => {
		const fixture = await makeFixture();
		const entryPath = path.join(fixture.targetDir, 'upstream.js');
		const externalPath = path.join(fixture.root, 'external-upstream.js');
		await writeFile(externalPath, GRAPH_SOURCES['upstream.js']);
		await rm(entryPath);
		await symlink(externalPath, entryPath);
		const controls = getTinyGoSyncControlPaths(fixture.targetDir);

		await expect(syncWasmTinyGoDist(fixture)).rejects.toThrow('non-regular path');
		expect((await lstat(entryPath)).isSymbolicLink()).toBe(true);
		await expect(lstat(controls.transactionMarkerPath)).rejects.toThrow();
	});

	it('uses an explicit graph source only for JavaScript and preserves target tools', async () => {
		const fixture = await makeFixture();
		const sourceDir = path.join(fixture.root, 'explicit-source');
		await writeGraphFixture(sourceDir);
		await writeFile(
			path.join(fixture.targetDir, 'upstream.js'),
			'export const stale = true;\n'
		);
		await writeFixtureFile(fixture.targetDir, 'assets/stale-worker.js', 'export {};\n');
		for (const name of await readdir(path.join(fixture.targetDir, 'assets'))) {
			if (name !== 'stale-worker.js') await rm(path.join(fixture.targetDir, 'assets', name));
		}
		const protectedBefore = await readProtectedFiles(fixture.targetDir);

		const result = await syncWasmTinyGoDist({ ...fixture, sourceDir });

		expect(result.sourceMode).toBe('explicit-graph-source');
		expect(await readFile(path.join(fixture.targetDir, 'upstream.js'), 'utf8')).toBe(
			GRAPH_SOURCES['upstream.js']
		);
		await expect(
			readFile(path.join(fixture.targetDir, 'assets/stale-worker.js'))
		).rejects.toThrow();
		expect(await readProtectedFiles(fixture.targetDir)).toEqual(protectedBefore);
	});

	it('recovers a prepared interrupted publication before reading the static source', async () => {
		const fixture = await makeFixture();
		const controls = getTinyGoSyncControlPaths(fixture.targetDir);
		const transactionId = '11111111-1111-4111-8111-111111111111';
		const publications = [
			{ target: fixture.targetDir, kind: 'directory' },
			{ target: fixture.versionModulePath, kind: 'file' }
		].map(({ target, kind }) => ({
			target,
			kind,
			staging: path.join(
				path.dirname(target),
				`.${path.basename(target)}.staging-${transactionId}`
			),
			previous: path.join(
				path.dirname(target),
				`.${path.basename(target)}.previous-${transactionId}`
			),
			hadTarget: true
		}));
		await rename(fixture.targetDir, publications[0].previous);
		await mkdir(publications[0].staging);
		await writeFile(publications[1].staging, 'stranded generated module\n');
		await writeFile(
			controls.transactionMarkerPath,
			`${JSON.stringify({
				format: 'wasm-idle-tinygo-sync-transaction-v1',
				transactionId,
				phase: 'prepared',
				publications
			})}\n`
		);

		const result = await syncWasmTinyGoDist(fixture);

		expect(result.sourceMode).toBe('published-static');
		expect(await readFile(path.join(fixture.targetDir, 'upstream.js'), 'utf8')).toBe(
			GRAPH_SOURCES['upstream.js']
		);
		await expect(lstat(controls.transactionMarkerPath)).rejects.toThrow();
	});
});
