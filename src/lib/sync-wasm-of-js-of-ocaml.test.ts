import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncWasmOfJsOfOcamlDist } from '../../scripts/sync-wasm-of-js-of-ocaml.mjs';

const tempDirs: string[] = [];

async function makeTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-wasm-ocaml-'));
	tempDirs.push(dir);
	return dir;
}

async function writeFixtureFile(baseDir: string, relativePath: string, contents: string) {
	const targetPath = path.join(baseDir, relativePath);
	await mkdir(path.dirname(targetPath), { recursive: true });
	await writeFile(targetPath, contents, { encoding: 'utf8', flag: 'w' });
}

const staticBinaryenWorkerSource = `
function runBinaryenTool(runtimeGlobal, command, toolUrls) {
	return toolUrls && command ? 0 : 1;
}
self.onmessage = (event) => {
	const request = event?.data?.request || { binaryenTools: true };
	void request.binaryenTools;
};
`;

describe('syncWasmOfJsOfOcamlDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies the built wasm-of-js-of-ocaml browser bundle and bundled static Binaryen tools', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export const compiler = true;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			staticBinaryenWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1,"findlibConf":"/.cache/browser-native-bundle/findlib.conf","tools":{"ocamlc":"/.cache/browser-native-bundle/tools/ocamlc.byte.browser.js"},"binaryenTools":{"wasm_opt":"/.cache/browser-native-bundle/tools/wasm-opt.browser.js","wasm_merge":"/.cache/browser-native-bundle/tools/wasm-merge.browser.js","wasm_metadce":"/.cache/browser-native-bundle/tools/wasm-metadce.browser.js"},"runtimePack":{"format":"wasm-of-js-of-ocaml-browser-native-runtime-pack-v1","asset":"/.cache/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz","index":"/.cache/browser-native-bundle/browser-native-runtime-pack.v1.index.json","fileCount":1,"totalBytes":6}}\n'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'tools/ocamlc.byte.browser.js',
			'console.log("ocaml");\n'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'tools/wasm-opt.browser.js',
			'console.log("wasm-opt");\n'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'tools/wasm-merge.browser.js',
			'console.log("wasm-merge");\n'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'tools/wasm-metadce.browser.js',
			'console.log("wasm-metadce");\n'
		);
		await writeFixtureFile(sourceBundleDir, 'browser-native-runtime-pack.v1.bin.gz', 'packed-bytes');
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-runtime-pack.v1.index.json',
			'{"format":"wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1","fileCount":1,"totalBytes":6,"entries":[{"runtimePath":"/static/toolchain/lib/ocaml/stdlib.cma","offset":0,"length":6}]}\n'
		);

		const result = await syncWasmOfJsOfOcamlDist({
			sourceBrowserDistDir,
			sourceBundleDir,
			targetBrowserDistDir,
			targetBundleDir,
			versionModulePath
		});

		await expect(readFile(path.join(targetBrowserDistDir, 'src/index.js'), 'utf8')).resolves.toContain(
			'compiler = true'
		);
		await expect(
			readFile(path.join(targetBundleDir, 'tools/wasm-opt.browser.js'), 'utf8')
		).resolves.toContain('wasm-opt');
		await expect(
			readFile(path.join(targetBundleDir, 'tools/wasm-merge.browser.js'), 'utf8')
		).resolves.toContain('wasm-merge');
		await expect(
			readFile(path.join(targetBundleDir, 'tools/wasm-metadce.browser.js'), 'utf8')
		).resolves.toContain('wasm-metadce');
		await expect(
			readFile(path.join(targetBundleDir, 'browser-native-manifest.v1.json'), 'utf8')
		).resolves.toContain('/wasm-of-js-of-ocaml/browser-native-bundle/tools/wasm-merge.browser.js');
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_OCAML_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('clears stale files from previous synced outputs', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			staticBinaryenWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1,"binaryenTools":{"wasm_opt":"/.cache/browser-native-bundle/tools/wasm-opt.browser.js","wasm_merge":"/.cache/browser-native-bundle/tools/wasm-merge.browser.js","wasm_metadce":"/.cache/browser-native-bundle/tools/wasm-metadce.browser.js"}}\n'
		);
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-opt.browser.js', 'opt');
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-merge.browser.js', 'merge');
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-metadce.browser.js', 'metadce');
		await writeFixtureFile(targetBrowserDistDir, 'stale.txt', 'remove me');
		await writeFixtureFile(targetBundleDir, 'stale.txt', 'remove me');

		await syncWasmOfJsOfOcamlDist({
			sourceBrowserDistDir,
			sourceBundleDir,
			targetBrowserDistDir,
			targetBundleDir,
			versionModulePath
		});

		await expect(readFile(path.join(targetBrowserDistDir, 'stale.txt'), 'utf8')).rejects.toThrow();
		await expect(readFile(path.join(targetBundleDir, 'stale.txt'), 'utf8')).rejects.toThrow();
	});

	it('fails with a build hint when the browser dist directory is missing', async () => {
		const sourceBrowserDistDir = path.join(await makeTempDir(), 'missing-dist');
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await expect(
			syncWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir,
				targetBrowserDistDir,
				targetBundleDir,
				versionModulePath
			})
		).rejects.toThrow('Build wasm-of-js-of-ocaml first');
	});

	it('fails when the static Binaryen tool bundle is incomplete', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			staticBinaryenWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1,"binaryenTools":{"wasm_opt":"/.cache/browser-native-bundle/tools/wasm-opt.browser.js","wasm_merge":"/.cache/browser-native-bundle/tools/wasm-merge.browser.js","wasm_metadce":"/.cache/browser-native-bundle/tools/wasm-metadce.browser.js"}}\n'
		);
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-opt.browser.js', 'opt');
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-merge.browser.js', 'merge');

		await expect(
			syncWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir,
				targetBrowserDistDir,
				targetBundleDir,
				versionModulePath
			})
		).rejects.toThrow('static Binaryen tool was not found');
	});

	it('fails when the browser-native worker still references the Binaryen API bridge', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			`
			function runBinaryenTool(runtimeGlobal, command, binaryenTools) {
				return runtimeGlobal && command && binaryenTools ? 0 : 1;
			}
			self.onmessage = (request) => {
				request.binaryenTools;
				return '/api/binaryen-command';
			};
			`
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1,"binaryenTools":{"wasm_opt":"/.cache/browser-native-bundle/tools/wasm-opt.browser.js","wasm_merge":"/.cache/browser-native-bundle/tools/wasm-merge.browser.js","wasm_metadce":"/.cache/browser-native-bundle/tools/wasm-metadce.browser.js"}}\n'
		);
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-opt.browser.js', 'opt');
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-merge.browser.js', 'merge');
		await writeFixtureFile(sourceBundleDir, 'tools/wasm-metadce.browser.js', 'metadce');

		await expect(
			syncWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir,
				targetBrowserDistDir,
				targetBundleDir,
				versionModulePath
			})
		).rejects.toThrow('still references the Binaryen API bridge');
	});
});
