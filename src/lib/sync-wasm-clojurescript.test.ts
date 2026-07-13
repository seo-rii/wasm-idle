import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmClojureScriptAssets } from '../../scripts/sync-wasm-clojurescript.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const directory = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-clojurescript-'));
	tempDirs.push(directory);
	return directory;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, 'utf8');
	return targetPath;
}

describe('syncWasmClojureScriptAssets', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
		);
	});

	it('copies the self-hosted compiler, worker, metadata, and license', async () => {
		const sourceDir = await makeTempDir();
		const targetDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmClojureScriptVersion.ts');
		const workerSourcePath = await writeFixtureFile(
			await makeTempDir(),
			'runner-worker.js',
			'self.onmessage = () => self.postMessage({ results: true });\n'
		);
		await writeFixtureFile(
			sourceDir,
			'compiler.js',
			'globalThis.wasm_idle = { runner: { execute() {} } }; // wasm_idle.runner.execute\n'
		);
		await writeFixtureFile(sourceDir, 'LICENSE.txt', 'Eclipse Public License 1.0\n');
		await writeFixtureFile(
			sourceDir,
			'runtime-build.json',
			`${JSON.stringify({
				format: 'wasm-clojurescript-runtime-build-v1',
				clojureScriptVersion: '1.12.134',
				compilerSha256: 'fixture-sha'
			})}\n`
		);

		const result = await syncWasmClojureScriptAssets({
			sourceDir,
			targetDir,
			workerSourcePath,
			versionModulePath
		});

		await expect(readFile(path.join(targetDir, 'compiler.js'), 'utf8')).resolves.toContain(
			'wasm_idle.runner.execute'
		);
		await expect(readFile(path.join(targetDir, 'runner-worker.js'), 'utf8')).resolves.toContain(
			'postMessage'
		);
		await expect(readFile(path.join(targetDir, 'LICENSE.txt'), 'utf8')).resolves.toContain(
			'Eclipse Public License'
		);
		const manifest = JSON.parse(
			await readFile(path.join(targetDir, 'runtime-manifest.v1.json'), 'utf8')
		) as { format: string; clojureScriptVersion: string; fingerprint: string; files: string[] };
		expect(manifest).toMatchObject({
			format: 'wasm-clojurescript-runtime-manifest-v1',
			clojureScriptVersion: '1.12.134',
			fingerprint: result.fingerprint,
			files: ['LICENSE.txt', 'compiler.js', 'runner-worker.js', 'runtime-build.json']
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_CLOJURESCRIPT_ASSET_VERSION = '${result.fingerprint}';`
		);
	});

	it('rejects compiler bundles that include the browser REPL preload', async () => {
		const sourceDir = await makeTempDir();
		await writeFixtureFile(
			sourceDir,
			'compiler.js',
			'wasm_idle.runner.execute = function() {}; clojure.browser.repl.connect();\n'
		);
		await writeFixtureFile(sourceDir, 'LICENSE.txt', 'license\n');
		await writeFixtureFile(sourceDir, 'runtime-build.json', '{}\n');

		await expect(
			syncWasmClojureScriptAssets({
				sourceDir,
				targetDir: await makeTempDir(),
				workerSourcePath: await writeFixtureFile(
					await makeTempDir(),
					'runner-worker.js',
					'worker\n'
				),
				versionModulePath: path.join(await makeTempDir(), 'version.ts')
			})
		).rejects.toThrow(/browser REPL preload/u);
	});
});
