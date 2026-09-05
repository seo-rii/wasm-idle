import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmRubyAssets } from '../../scripts/sync-wasm-ruby.mjs';

const tempDirs: string[] = [];
const wasmPath = 'assets/ruby_stdlib-C40Yu-vu.wasm';
const wasmHeader = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const revision = '1'.repeat(40);
const provenanceLevel = 'npm-attested-source-and-receipted-derived-output';
const licenseExpression =
	'MIT AND (Ruby OR BSD-2-Clause) AND (MIT OR Apache-2.0) AND LicenseRef-Ruby-Wasm-Third-Party-Notices';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const lexicalCompare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-ruby-'));
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

async function listFixtureFiles(rootDir: string, currentDir = rootDir): Promise<string[]> {
	const files: string[] = [];
	for (const entry of await readdir(currentDir, { withFileTypes: true })) {
		const entryPath = path.join(currentDir, entry.name);
		if (entry.isDirectory()) files.push(...(await listFixtureFiles(rootDir, entryPath)));
		else if (entry.isFile()) {
			files.push(path.relative(rootDir, entryPath).split(path.sep).join('/'));
		}
	}
	return files.sort(lexicalCompare);
}

async function treeReceipt(rootDir: string) {
	const entries = await Promise.all(
		(await listFixtureFiles(rootDir)).map(async (relativePath) => {
			const bytes = await readFile(path.join(rootDir, relativePath));
			return {
				path: relativePath,
				bytes: bytes.byteLength,
				sha256: sha256(bytes)
			};
		})
	);
	return {
		files: entries.length,
		bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
		treeSha256: sha256(JSON.stringify(entries))
	};
}

async function fileReceipt(rootDir: string, relativePath: string) {
	const bytes = await readFile(path.join(rootDir, relativePath));
	return { bytes: bytes.byteLength, sha256: sha256(bytes) };
}

async function createFixture() {
	const repoRoot = await makeTempDir();
	const nodeModulesDir = path.join(repoRoot, 'node_modules');
	const lockFilePath = path.join(repoRoot, 'scripts', 'wasm-ruby-assets.lock.json');
	const packageJsonPath = path.join(repoRoot, 'package.json');
	const pnpmLockPath = path.join(repoRoot, 'pnpm-lock.yaml');
	const targetDir = path.join(repoRoot, 'static', 'wasm-ruby');
	const generatedModulePath = path.join(
		repoRoot,
		'packages',
		'core',
		'src',
		'ruby-runtime.generated.ts'
	);
	const moduleBytes = Buffer.from(
		`export const rubyStdlibWasmUrl=new URL(${JSON.stringify(wasmPath)},import.meta.url).href;\n`
	);

	await writeFixtureFile(
		repoRoot,
		'scripts/runtime-modules/ruby.ts',
		'export const fixture = true;\n'
	);
	await writeFixtureFile(
		repoRoot,
		'scripts/sync-wasm-ruby.mjs',
		'export const fixtureProducer = true;\n'
	);
	await writeFixtureFile(
		repoRoot,
		'scripts/wasm-ruby-third-party-notices.md',
		'# Fixture notices\n'
	);
	await writeFixtureFile(
		nodeModulesDir,
		'@ruby/3.4-wasm-wasi/package.json',
		`${JSON.stringify({ name: '@ruby/3.4-wasm-wasi', version: '1.0.0', license: 'MIT' })}\n`
	);
	await writeFixtureFile(nodeModulesDir, '@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm', wasmHeader);
	await writeFixtureFile(nodeModulesDir, '@ruby/3.4-wasm-wasi/dist/LICENSE', 'MIT fixture\n');
	await writeFixtureFile(nodeModulesDir, '@ruby/3.4-wasm-wasi/dist/NOTICE', 'Ruby notice\n');
	await writeFixtureFile(
		nodeModulesDir,
		'@ruby/wasm-wasi/package.json',
		`${JSON.stringify({ name: '@ruby/wasm-wasi', version: '1.0.0', license: 'MIT' })}\n`
	);
	await writeFixtureFile(
		nodeModulesDir,
		'@ruby/wasm-wasi/index.js',
		'export const RubyVM = {};\n'
	);
	await writeFixtureFile(
		nodeModulesDir,
		'@bjorn3/browser_wasi_shim/package.json',
		`${JSON.stringify({ name: '@bjorn3/browser_wasi_shim', version: '1.0.0', license: 'MIT OR Apache-2.0' })}\n`
	);
	await writeFixtureFile(
		nodeModulesDir,
		'@bjorn3/browser_wasi_shim/index.js',
		'export const WASI = {};\n'
	);
	await writeFixtureFile(
		nodeModulesDir,
		'@bjorn3/browser_wasi_shim/LICENSE-MIT',
		'MIT shim fixture\n'
	);
	await writeFixtureFile(
		nodeModulesDir,
		'@bjorn3/browser_wasi_shim/LICENSE-APACHE',
		'Apache shim fixture\n'
	);
	await writeFixtureFile(
		nodeModulesDir,
		'vite/package.json',
		`${JSON.stringify({ name: 'vite', version: '8.0.8', license: 'MIT' })}\n`
	);
	await writeFixtureFile(nodeModulesDir, 'vite/index.js', 'export const build = {};\n');

	const packageSpecs = [
		{
			name: '@ruby/3.4-wasm-wasi',
			version: '1.0.0',
			requestedRange: '1.0.0',
			license: 'MIT',
			attestationUrl: 'https://registry.npmjs.org/-/npm/v1/attestations/ruby-fixture'
		},
		{
			name: '@ruby/wasm-wasi',
			version: '1.0.0',
			requestedRange: '1.0.0',
			license: 'MIT',
			attestationUrl: 'https://registry.npmjs.org/-/npm/v1/attestations/ruby-host-fixture'
		},
		{
			name: '@bjorn3/browser_wasi_shim',
			version: '1.0.0',
			requestedRange: '^1.0.0',
			license: 'MIT OR Apache-2.0',
			attestationUrl: null
		}
	];
	const packages = await Promise.all(
		packageSpecs.map(async (candidate, index) => ({
			...candidate,
			tarballUrl: `https://registry.npmjs.org/${candidate.name}/-/${candidate.name.split('/').at(-1)}-${candidate.version}.tgz`,
			tarballBytes: 100 + index,
			tarballSha256: String(index + 1).repeat(64),
			integrity: `sha512-${Buffer.alloc(64, index + 1).toString('base64')}`,
			repository: candidate.name.startsWith('@ruby/')
				? 'https://github.com/ruby/ruby.wasm'
				: 'https://github.com/bjorn3/browser_wasi_shim',
			revision,
			...(await treeReceipt(path.join(nodeModulesDir, ...candidate.name.split('/'))))
		}))
	);
	const tool = {
		name: 'vite',
		version: '8.0.8',
		requestedRange: '^8.0.8',
		tarballUrl: 'https://registry.npmjs.org/vite/-/vite-8.0.8.tgz',
		integrity: `sha512-${Buffer.alloc(64, 9).toString('base64')}`,
		license: 'MIT',
		...(await treeReceipt(path.join(nodeModulesDir, 'vite')))
	};
	await writeFile(
		packageJsonPath,
		`${JSON.stringify(
			{
				dependencies: { '@bjorn3/browser_wasi_shim': '^1.0.0' },
				devDependencies: {
					'@ruby/3.4-wasm-wasi': '1.0.0',
					'@ruby/wasm-wasi': '1.0.0',
					vite: '^8.0.8'
				}
			},
			null,
			2
		)}\n`
	);
	await writeFile(
		pnpmLockPath,
		[
			"lockfileVersion: '9.0'",
			'packages:',
			...[...packages, tool].flatMap((candidate) => [
				`  '${candidate.name}@${candidate.version}':`,
				`    resolution: {integrity: ${candidate.integrity}}`
			]),
			''
		].join('\n')
	);

	const legalSources = [
		{
			sourcePath: 'node_modules/@ruby/3.4-wasm-wasi/dist/LICENSE',
			targetPath: 'LICENSE',
			mediaType: 'text/plain',
			spdx: 'MIT'
		},
		{
			sourcePath: 'node_modules/@ruby/3.4-wasm-wasi/dist/NOTICE',
			targetPath: 'NOTICE',
			mediaType: 'text/markdown',
			spdx: 'LicenseRef-Ruby-Wasm-Third-Party-Notices'
		},
		{
			sourcePath: 'scripts/wasm-ruby-third-party-notices.md',
			targetPath: 'THIRD_PARTY_NOTICES.md',
			mediaType: 'text/markdown',
			spdx: 'LicenseRef-Provenance-Notice'
		},
		{
			sourcePath: 'node_modules/@bjorn3/browser_wasi_shim/LICENSE-MIT',
			targetPath: 'licenses/browser-wasi-shim/LICENSE-MIT',
			mediaType: 'text/plain',
			spdx: 'MIT'
		},
		{
			sourcePath: 'node_modules/@bjorn3/browser_wasi_shim/LICENSE-APACHE',
			targetPath: 'licenses/browser-wasi-shim/LICENSE-APACHE',
			mediaType: 'text/plain',
			spdx: 'Apache-2.0'
		}
	];
	const legalFiles = await Promise.all(
		legalSources.map(async (legal) => ({
			...legal,
			...(await fileReceipt(repoRoot, legal.sourcePath))
		}))
	);
	const outputs = [
		{
			path: 'runtime.mjs',
			mediaType: 'text/javascript',
			bytes: moduleBytes.byteLength,
			sha256: sha256(moduleBytes)
		},
		{
			path: wasmPath,
			mediaType: 'application/wasm',
			bytes: wasmHeader.byteLength,
			sha256: sha256(wasmHeader)
		}
	];
	const entry = {
		path: 'scripts/runtime-modules/ruby.ts',
		...(await fileReceipt(repoRoot, 'scripts/runtime-modules/ruby.ts'))
	};
	const script = {
		path: 'scripts/sync-wasm-ruby.mjs',
		...(await fileReceipt(repoRoot, 'scripts/sync-wasm-ruby.mjs'))
	};
	await writeFixtureFile(
		repoRoot,
		'scripts/wasm-ruby-assets.lock.json',
		`${JSON.stringify(
			{
				schemaVersion: 1,
				profileId: 'ruby-fixture-ruby-wasm-1.0.0',
				provenanceLevel,
				licenseExpression,
				artifact: {
					kind: 'npm-provenance-attested-package-set',
					repository: 'https://github.com/ruby/ruby.wasm',
					revision,
					workflow: '.github/workflows/release.yml',
					workflowRun: 'https://github.com/ruby/ruby.wasm/actions/runs/1/attempts/1',
					verifiedBuildInput: false,
					evidence: 'fixture evidence'
				},
				components: {
					ruby: {
						version: 'fixture',
						repository: 'https://github.com/ruby/ruby',
						revision,
						verifiedBuildInput: false,
						evidence: 'fixture Ruby evidence'
					},
					rubyWasm: {
						version: '1.0.0',
						repository: 'https://github.com/ruby/ruby.wasm',
						revision,
						verifiedBuildInput: false,
						evidence: 'fixture ruby.wasm evidence'
					},
					wasiSdk: {
						version: '22.0',
						repository: 'https://github.com/WebAssembly/wasi-sdk',
						revision: 'unrecorded',
						verifiedBuildInput: false,
						evidence: 'fixture wasi-sdk evidence'
					}
				},
				packages,
				producer: { entry, script, tool },
				transformations: [
					{
						id: 'vite-8-es2022-single-module-bundle',
						input: 'scripts/runtime-modules/ruby.ts',
						output: 'runtime.mjs'
					},
					{
						id: 'node-zlib-gzip-level-9',
						input: wasmPath,
						output: `${wasmPath}.gz.bin`
					}
				],
				outputs,
				legalFiles
			},
			null,
			2
		)}\n`
	);

	const buildRuntime = async ({ outDir }: { outDir: string }) => {
		await writeFixtureFile(outDir, 'runtime.mjs', moduleBytes);
		await writeFixtureFile(outDir, wasmPath, wasmHeader);
	};
	return {
		repoRoot,
		nodeModulesDir,
		lockFilePath,
		packageJsonPath,
		pnpmLockPath,
		targetDir,
		generatedModulePath,
		moduleBytes,
		buildRuntime
	};
}

describe('syncWasmRubyAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('publishes only the locked executable, provenance, and legal graph with its Core pin', async () => {
		const fixture = await createFixture();
		const result = await syncWasmRubyAssets(fixture);
		expect(await listFixtureFiles(fixture.targetDir)).toEqual([
			'LICENSE',
			'NOTICE',
			'THIRD_PARTY_NOTICES.md',
			`${wasmPath}.gz`,
			`${wasmPath}.gz.bin`,
			'licenses/browser-wasi-shim/LICENSE-APACHE',
			'licenses/browser-wasi-shim/LICENSE-MIT',
			'runtime-build.json',
			'runtime-manifest.v1.json',
			'runtime-manifest.v2.json',
			'runtime.mjs',
			'runtime.mjs.bin'
		]);
		await expect(readFile(path.join(fixture.targetDir, wasmPath))).rejects.toThrow();
		const canonicalModule = await readFile(path.join(fixture.targetDir, 'runtime.mjs.bin'));
		const legacyModule = await readFile(path.join(fixture.targetDir, 'runtime.mjs'));
		const canonicalWasm = await readFile(path.join(fixture.targetDir, `${wasmPath}.gz.bin`));
		const legacyWasm = await readFile(path.join(fixture.targetDir, `${wasmPath}.gz`));
		expect(legacyModule).toEqual(canonicalModule);
		expect(legacyWasm).toEqual(canonicalWasm);
		expect(gunzipSync(canonicalWasm)).toEqual(Buffer.from(wasmHeader));
		const manifest = JSON.parse(
			await readFile(path.join(fixture.targetDir, 'runtime-manifest.v2.json'), 'utf8')
		);
		expect(manifest.fingerprint).toBe(result.fingerprint);
		expect(manifest.assets.map((asset: { path: string }) => asset.path)).toEqual([
			wasmPath,
			'runtime.mjs'
		]);
		expect(manifest.packages.map((pkg: { name: string }) => pkg.name)).toEqual([
			'@bjorn3/browser_wasi_shim',
			'@ruby/3.4-wasm-wasi',
			'@ruby/wasm-wasi'
		]);
		expect(manifest.storage).toEqual([
			expect.objectContaining({
				path: `${wasmPath}.gz.bin`,
				logicalPath: wasmPath,
				encoding: 'gzip'
			}),
			expect.objectContaining({
				path: 'runtime.mjs.bin',
				logicalPath: 'runtime.mjs',
				encoding: 'identity'
			})
		]);
		const generated = await readFile(fixture.generatedModulePath, 'utf8');
		expect(generated).toContain('export const RUBY_RUNTIME_GENERATED_PROFILE');
		expect(generated).toContain('export const RUBY_RUNTIME_GENERATED_BUNDLE');
		expect(generated).toContain('manifestFingerprint:');
		expect(generated).toContain(`'${result.fingerprint}' as const`);
		expect(generated).toContain('manifestReceipt: Object.freeze({');
		expect(generated).toContain('moduleJavaScriptReceipt: Object.freeze({');
		expect(generated).toContain('wasmReceipt: Object.freeze({');
		expect(generated).toContain('profile: RUBY_RUNTIME_GENERATED_PROFILE');
		expect(generated).toContain(
			'RUBY_RUNTIME_GENERATED_ASSET_VERSION =\n\tRUBY_RUNTIME_GENERATED_PROFILE.manifestFingerprint;'
		);
	});

	it('produces deterministic bytes for the same locked inputs', async () => {
		const fixture = await createFixture();
		const firstTarget = path.join(fixture.repoRoot, 'first');
		const secondTarget = path.join(fixture.repoRoot, 'second');
		await syncWasmRubyAssets({
			...fixture,
			targetDir: firstTarget,
			generatedModulePath: path.join(fixture.repoRoot, 'first.ts')
		});
		await syncWasmRubyAssets({
			...fixture,
			targetDir: secondTarget,
			generatedModulePath: path.join(fixture.repoRoot, 'second.ts')
		});
		for (const relativePath of await listFixtureFiles(firstTarget)) {
			await expect(readFile(path.join(secondTarget, relativePath))).resolves.toEqual(
				await readFile(path.join(firstTarget, relativePath))
			);
		}
	});

	it('rejects an installed package tree that no longer matches the lock', async () => {
		const fixture = await createFixture();
		await writeFixtureFile(
			fixture.nodeModulesDir,
			'@bjorn3/browser_wasi_shim/index.js',
			'corrupted\n'
		);
		await expect(syncWasmRubyAssets(fixture)).rejects.toThrow(
			'installed package tree does not match the input lock'
		);
	});

	it('ignores pnpm-generated Vite shims while validating package-owned files', async () => {
		const fixture = await createFixture();
		await writeFixtureFile(
			fixture.nodeModulesDir,
			'vite/node_modules/.bin/esbuild',
			'#!/bin/sh\nexec ../esbuild/bin/esbuild "$@"\n'
		);
		await expect(syncWasmRubyAssets(fixture)).resolves.toBeDefined();

		await writeFixtureFile(
			fixture.nodeModulesDir,
			'vite/node_modules/.bin/esbuild',
			'#!/bin/sh\nexec /different/store/esbuild "$@"\n'
		);
		await expect(syncWasmRubyAssets(fixture)).resolves.toBeDefined();

		await writeFixtureFile(fixture.nodeModulesDir, 'vite/index.js', 'corrupted\n');
		await expect(syncWasmRubyAssets(fixture)).rejects.toThrow(
			'installed package tree does not match the input lock'
		);
	});

	it('rejects a package-manager integrity mismatch', async () => {
		const fixture = await createFixture();
		const lock = await readFile(fixture.pnpmLockPath, 'utf8');
		await writeFile(
			fixture.pnpmLockPath,
			lock.replace(
				/sha512-[A-Za-z0-9+/=]+/u,
				`sha512-${Buffer.alloc(64, 8).toString('base64')}`
			)
		);
		await expect(syncWasmRubyAssets(fixture)).rejects.toThrow(
			'pnpm integrity does not match the input lock'
		);
	});

	it('rejects component identity drift and legacy-only transformation outputs', async () => {
		const componentDrift = await createFixture();
		const componentLock = JSON.parse(await readFile(componentDrift.lockFilePath, 'utf8'));
		componentLock.components.rubyWasm.revision = '2'.repeat(40);
		await writeFile(componentDrift.lockFilePath, `${JSON.stringify(componentLock, null, 2)}\n`);
		await expect(syncWasmRubyAssets(componentDrift)).rejects.toThrow(
			'invalid rubyWasm provenance'
		);

		const transformationDrift = await createFixture();
		const transformationLock = JSON.parse(
			await readFile(transformationDrift.lockFilePath, 'utf8')
		);
		transformationLock.transformations[1].output = `${wasmPath}.gz`;
		await writeFile(
			transformationDrift.lockFilePath,
			`${JSON.stringify(transformationLock, null, 2)}\n`
		);
		await expect(syncWasmRubyAssets(transformationDrift)).rejects.toThrow(
			'invalid profile or transformation graph'
		);
	});

	it('rejects derived output drift and an expanded output graph', async () => {
		const drift = await createFixture();
		await expect(
			syncWasmRubyAssets({
				...drift,
				buildRuntime: async ({ outDir }) => {
					await drift.buildRuntime({ outDir });
					await writeFixtureFile(outDir, 'runtime.mjs', 'corrupted\n');
				}
			})
		).rejects.toThrow('derived output does not match the input lock');

		const expanded = await createFixture();
		await expect(
			syncWasmRubyAssets({
				...expanded,
				buildRuntime: async ({ outDir }) => {
					await expanded.buildRuntime({ outDir });
					await writeFixtureFile(outDir, 'chunks/extra.mjs', 'export {};\n');
				}
			})
		).rejects.toThrow('unexpected output graph');
	});

	it('detects producer input replacement during the build', async () => {
		const fixture = await createFixture();
		await expect(
			syncWasmRubyAssets({
				...fixture,
				buildRuntime: async ({ outDir }) => {
					await fixture.buildRuntime({ outDir });
					await writeFixtureFile(
						fixture.repoRoot,
						'scripts/runtime-modules/ruby.ts',
						'export const replaced = true;\n'
					);
				}
			})
		).rejects.toThrow('producer entry does not match the input lock');
	});

	it('rolls back the static tree and Core pin together when publication fails', async () => {
		const fixture = await createFixture();
		await writeFixtureFile(fixture.targetDir, 'sentinel.txt', 'old static');
		await writeFixtureFile(
			path.dirname(fixture.generatedModulePath),
			path.basename(fixture.generatedModulePath),
			'old Core pin'
		);
		let renameCalls = 0;
		await expect(
			syncWasmRubyAssets({
				...fixture,
				renamePath: async (source, target) => {
					renameCalls += 1;
					if (renameCalls === 4) throw new Error('injected publication failure');
					await rename(source, target);
				}
			})
		).rejects.toThrow('injected publication failure');
		await expect(readFile(path.join(fixture.targetDir, 'sentinel.txt'), 'utf8')).resolves.toBe(
			'old static'
		);
		await expect(readFile(fixture.generatedModulePath, 'utf8')).resolves.toBe('old Core pin');
	});
});
