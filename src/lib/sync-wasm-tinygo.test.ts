import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmTinyGoDist } from '../../scripts/sync-wasm-tinygo.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-tinygo-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
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
			sha256: createHash('sha256').update(bytes).digest('hex')
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

describe('syncWasmTinyGoDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies the built wasm-tinygo bundle into the target directory', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await writeFixtureFile(sourceDir, 'upstream.js', 'export const upstream = true;\n');
		await writeFixtureFile(
			sourceDir,
			'assets/upstream-entry-test.js',
			'console.log("stale split entry");\n'
		);
		await writeFixtureFile(
			sourceDir,
			'assets/upstream-compile-worker-test.js',
			'console.log("upstream worker");\n'
		);
		await writeFixtureFile(sourceDir, 'runtime.js', 'export const legacy = true;\n');
		await writeFixtureFile(sourceDir, 'assets/runtime-test.js', 'console.log("legacy");\n');
		await writeFixtureFile(sourceDir, 'tools/tinygo-compiler.wasm', 'legacy compiler');
		await writeUpstreamToolchainFixture(sourceDir);
		await writeFixtureFile(
			sourceDir,
			'vendor/wasm-rust-runtime/runtime-manifest.v3.json',
			'{"manifestVersion":3}\n'
		);
		await writeFixtureFile(sourceDir, 'types.d.ts', 'export type Ignored = true;\n');

		const result = await syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath });

		await expect(readFile(path.join(targetDir, 'runtime.js'), 'utf8')).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'assets/runtime-test.js'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'upstream.js'), 'utf8')).resolves.toContain(
			'upstream = true'
		);
		await expect(
			readFile(path.join(targetDir, 'assets/upstream-entry-test.js'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetDir, 'assets/upstream-compile-worker-test.js'), 'utf8')
		).resolves.toContain('upstream worker');
		await expect(
			readFile(path.join(targetDir, 'tools/upstream/upstream-toolchain.v2.json'), 'utf8')
		).resolves.toContain('wasm-idle-tinygo-upstream-assets-v2');
		await expect(
			readFile(path.join(targetDir, 'tools/tinygo-compiler.wasm'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'index.html'), 'utf8')).rejects.toThrow();
		await expect(
			readFile(
				path.join(targetDir, 'vendor/wasm-rust-runtime/runtime-manifest.v3.json'),
				'utf8'
			)
		).rejects.toThrow();
		await expect(readFile(path.join(targetDir, 'types.d.ts'), 'utf8')).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`'${result.fingerprint}';`
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			'WASM_TINYGO_RUNTIME_PROFILE'
		);
		expect(result.fingerprint).toMatch(/^[0-9a-f]{64}$/u);
		expect(result.profile.manifestFingerprint).toMatch(/^[0-9a-f]{64}$/u);
	});

	it('fails with a build hint when the wasm-tinygo dist directory does not exist', async () => {
		const targetDir = await makeTempDir();
		const sourceDir = path.join(await makeTempDir(), 'missing-dist');
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await expect(
			syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('build:upstream');
	});

	it('fails when the wasm-tinygo upstream module entry is missing from the dist bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await expect(
			syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('wasm-tinygo upstream module was not found');
	});

	it('validates the receipt graph before replacing an existing published bundle', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');
		await writeFixtureFile(sourceDir, 'upstream.js', 'export const upstream = true;\n');
		await writeFixtureFile(
			sourceDir,
			'tools/upstream/upstream-toolchain.v2.json',
			'{"schemaVersion":2,"format":"wasm-idle-tinygo-upstream-assets-v2"}\n'
		);
		await writeFixtureFile(targetDir, 'last-good.txt', 'last good bundle\n');
		await writeFile(versionModulePath, 'last good profile\n', 'utf8');

		await expect(
			syncWasmTinyGoDist({ sourceDir, targetDir, versionModulePath })
		).rejects.toThrow('manifest.assets must be an object');
		await expect(readFile(path.join(targetDir, 'last-good.txt'), 'utf8')).resolves.toBe(
			'last good bundle\n'
		);
		await expect(readFile(versionModulePath, 'utf8')).resolves.toBe('last good profile\n');
	});

	it('keeps the same fingerprint when bundle contents are unchanged but mtimes move', async () => {
		const sourceDir = await makeTempDir();
		const firstTargetDir = await makeTempDir();
		const secondTargetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmTinyGoVersion.ts');

		await writeFixtureFile(sourceDir, 'upstream.js', 'export const upstream = true;\n');
		await writeFixtureFile(
			sourceDir,
			'assets/upstream-compile-worker-test.js',
			'console.log("worker");\n'
		);
		await writeUpstreamToolchainFixture(sourceDir);

		const first = await syncWasmTinyGoDist({
			sourceDir,
			targetDir: firstTargetDir,
			versionModulePath
		});
		const shiftedTime = new Date(Date.now() + 60_000);
		await utimes(path.join(sourceDir, 'upstream.js'), shiftedTime, shiftedTime);
		await utimes(
			path.join(sourceDir, 'assets/upstream-compile-worker-test.js'),
			shiftedTime,
			shiftedTime
		);
		const second = await syncWasmTinyGoDist({
			sourceDir,
			targetDir: secondTargetDir,
			versionModulePath
		});

		expect(second.fingerprint).toBe(first.fingerprint);
	});
});
