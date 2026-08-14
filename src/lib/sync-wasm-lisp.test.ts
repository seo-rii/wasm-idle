import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmLispDist } from '../../scripts/sync-wasm-lisp.mjs';

const tempDirs: string[] = [];
const wasmHeader = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const profileId = 'puppy-scheme-fixture';
const provenanceLevel = 'pinned-release-artifact-and-receipted-derived-output';
const licenseExpression = 'BSD-3-Clause AND Apache-2.0 WITH LLVM-exception';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-lisp-'));
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

async function receipt(baseDir: string, relativePath: string) {
	const bytes = Uint8Array.from(await readFile(path.join(baseDir, relativePath)));
	return { path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function createFixture() {
	const root = await makeTempDir();
	const sourceDir = path.join(root, 'dist');
	const compilerInputPath = path.join(root, 'vendor', 'puppyc.wasm');
	const lockFilePath = path.join(root, 'wasm-lisp-assets.lock.json');
	await writeFixtureFile(
		sourceDir,
		'index.js',
		[
			'const compilerCoreModules = {};',
			'const compilerModule = {};',
			'export { compilerCoreModules, compilerModule };',
			'async function compiler() {}',
			'async function execute() {}',
			'export { compiler as createLispCompiler, execute as executeBrowserLispArtifact };',
			''
		].join('\n')
	);
	await writeFixtureFile(
		sourceDir,
		'puppyc.js',
		[
			'const locate = (name) => new URL(`./${name}`, import.meta.url);',
			'export function instantiate() { return locate; }',
			''
		].join('\n')
	);
	await writeFixtureFile(sourceDir, 'puppyc.core.wasm', wasmHeader);
	await writeFixtureFile(sourceDir, 'puppyc.core2.wasm', wasmHeader);
	await writeFixtureFile(sourceDir, 'LICENSE', 'fixture BSD license\n');
	await writeFixtureFile(sourceDir, 'THIRD_PARTY_NOTICES.md', '# Fixture notices\n');
	await writeFixtureFile(sourceDir, 'index.d.ts', 'export declare const fixture: true;\n');
	await writeFixtureFile(path.dirname(compilerInputPath), 'puppyc.wasm', wasmHeader);

	const artifactBytes = Uint8Array.from(await readFile(compilerInputPath));
	const artifact = {
		kind: 'github-release-asset',
		repository: 'https://github.com/matthewp/puppy-scheme',
		release: 'v0.0.7',
		revision: '315dcebacea3af8dbfa87285598210c71a4dca47',
		asset: 'puppyc.wasm',
		assetUrl: 'https://github.com/matthewp/puppy-scheme/releases/download/v0.0.7/puppyc.wasm',
		bytes: artifactBytes.byteLength,
		sha256: sha256(artifactBytes),
		verifiedBuildInput: false,
		evidence: 'fixture receipt'
	};
	const components = { fixture: { version: '1.0.0' } };
	const transformations: unknown[] = [];
	const legalInputs = { fixture: { spdx: 'BSD-3-Clause' } };
	await writeFixtureFile(
		sourceDir,
		'runtime-build.json',
		`${JSON.stringify(
			{
				format: 'wasm-lisp-runtime-build-v2',
				runtime: 'puppy-scheme',
				profileId,
				provenanceLevel,
				licenseExpression,
				artifact,
				components,
				transformations,
				legalInputs
			},
			null,
			2
		)}\n`
	);

	const license = await receipt(sourceDir, 'LICENSE');
	const notices = await receipt(sourceDir, 'THIRD_PARTY_NOTICES.md');
	const metadata = await receipt(sourceDir, 'runtime-build.json');
	const declaration = await receipt(sourceDir, 'index.d.ts');
	const assets = await Promise.all(
		['index.js', 'puppyc.core.wasm', 'puppyc.core2.wasm', 'puppyc.js'].map(
			async (assetPath) => ({
				...(await receipt(sourceDir, assetPath)),
				mediaType: assetPath.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
			})
		)
	);
	await writeFile(
		lockFilePath,
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId,
				provenanceLevel,
				licenseExpression,
				artifact,
				components,
				transformations,
				legalInputs,
				license: { ...license, spdx: 'BSD-3-Clause' },
				notices: { ...notices, mediaType: 'text/markdown' },
				metadata: { ...metadata, mediaType: 'application/json' },
				declaration: { ...declaration, mediaType: 'text/typescript' },
				assets
			},
			null,
			2
		)}\n`
	);
	return { root, sourceDir, compilerInputPath, lockFilePath };
}

async function syncFixture() {
	const fixture = await createFixture();
	const targetDir = path.join(fixture.root, 'static');
	const versionModulePath = path.join(fixture.root, 'app-version.ts');
	const lspVersionModulePath = path.join(fixture.root, 'lsp-version.ts');
	const result = await syncWasmLispDist({
		...fixture,
		targetDir,
		versionModulePath,
		lspVersionModulePath
	});
	return { ...fixture, targetDir, versionModulePath, lspVersionModulePath, result };
}

describe('syncWasmLispDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('publishes only the receipt-backed runtime graph and both fingerprint pins', async () => {
		const fixture = await syncFixture();
		const installedFiles = (await readdir(fixture.targetDir)).sort();
		expect(installedFiles).toEqual(
			[
				'LICENSE',
				'THIRD_PARTY_NOTICES.md',
				'index.js.gz',
				'puppyc.core.wasm',
				'puppyc.core2.wasm.gz',
				'puppyc.js',
				'runtime-build.json',
				'runtime-manifest.v1.json',
				'runtime-manifest.v2.json'
			].sort()
		);
		expect(
			gunzipSync(await readFile(path.join(fixture.targetDir, 'index.js.gz'))).toString('utf8')
		).toContain('createLispCompiler');
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest.fingerprint).toBe(fixture.result.fingerprint);
		expect(manifest.assets.map((asset: { path: string }) => asset.path).sort()).toEqual(
			['index.js', 'puppyc.core.wasm', 'puppyc.core2.wasm', 'puppyc.js'].sort()
		);
		await expect(readFile(path.join(fixture.targetDir, 'index.d.ts'))).rejects.toThrow();
		await expect(readFile(fixture.versionModulePath, 'utf8')).resolves.toContain(
			fixture.result.fingerprint
		);
		await expect(readFile(fixture.lspVersionModulePath, 'utf8')).resolves.toContain(
			fixture.result.fingerprint
		);
	});

	it('produces deterministic bytes for the same locked inputs', async () => {
		const fixture = await createFixture();
		const firstDir = path.join(fixture.root, 'first');
		const secondDir = path.join(fixture.root, 'second');
		await syncWasmLispDist({
			...fixture,
			targetDir: firstDir,
			versionModulePath: path.join(fixture.root, 'first-app.ts'),
			lspVersionModulePath: path.join(fixture.root, 'first-lsp.ts')
		});
		await syncWasmLispDist({
			...fixture,
			targetDir: secondDir,
			versionModulePath: path.join(fixture.root, 'second-app.ts'),
			lspVersionModulePath: path.join(fixture.root, 'second-lsp.ts')
		});
		for (const file of await readdir(firstDir)) {
			await expect(readFile(path.join(secondDir, file))).resolves.toEqual(
				await readFile(path.join(firstDir, file))
			);
		}
	});

	it('removes stale files from the previous publication', async () => {
		const fixture = await createFixture();
		const targetDir = path.join(fixture.root, 'static');
		await writeFixtureFile(targetDir, 'stale.txt', 'remove me');
		await syncWasmLispDist({
			...fixture,
			targetDir,
			versionModulePath: path.join(fixture.root, 'app.ts'),
			lspVersionModulePath: path.join(fixture.root, 'lsp.ts')
		});
		await expect(readFile(path.join(targetDir, 'stale.txt'))).rejects.toThrow();
	});

	it('rejects a dist asset that no longer matches its input lock', async () => {
		const fixture = await createFixture();
		await writeFixtureFile(fixture.sourceDir, 'puppyc.js', 'corrupted\n');
		await expect(
			syncWasmLispDist({
				...fixture,
				targetDir: path.join(fixture.root, 'target')
			})
		).rejects.toThrow('does not match the input lock');
	});

	it('rejects a compiler input that no longer matches the release receipt', async () => {
		const fixture = await createFixture();
		await writeFixtureFile(
			path.dirname(fixture.compilerInputPath),
			'puppyc.wasm',
			Uint8Array.of(...wasmHeader, 1)
		);
		await expect(
			syncWasmLispDist({
				...fixture,
				targetDir: path.join(fixture.root, 'target')
			})
		).rejects.toThrow('does not match the pinned release receipt');
	});

	it('rolls back all three outputs when publication fails', async () => {
		const fixture = await createFixture();
		const targetDir = path.join(fixture.root, 'static');
		const versionModulePath = path.join(fixture.root, 'app.ts');
		const lspVersionModulePath = path.join(fixture.root, 'lsp.ts');
		await writeFixtureFile(targetDir, 'sentinel.txt', 'old static');
		await writeFile(versionModulePath, 'old app');
		await writeFile(lspVersionModulePath, 'old lsp');
		let renameCalls = 0;

		await expect(
			syncWasmLispDist({
				...fixture,
				targetDir,
				versionModulePath,
				lspVersionModulePath,
				renamePath: async (source, target) => {
					renameCalls += 1;
					if (renameCalls === 6) throw new Error('injected publication failure');
					await rename(source, target);
				}
			})
		).rejects.toThrow('injected publication failure');
		await expect(readFile(path.join(targetDir, 'sentinel.txt'), 'utf8')).resolves.toBe(
			'old static'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('old app');
		await expect(readFile(lspVersionModulePath, 'utf8')).resolves.toBe('old lsp');
	});
});
