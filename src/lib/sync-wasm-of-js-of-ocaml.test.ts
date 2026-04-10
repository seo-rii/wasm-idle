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
	await writeFile(targetPath, contents, 'utf8');
}

const bridgeCapableWorkerSource = `
const DEFAULT_BINARYEN_BRIDGE_ENDPOINT = '/api/binaryen-command';
function resolveBinaryenBridgeEndpoint(request) {
	return request.binaryenBridge?.endpointUrl || request.env.WASM_OF_JS_BINARYEN_BRIDGE_URL || DEFAULT_BINARYEN_BRIDGE_ENDPOINT;
}
self.onmessage = () => {};
`;

describe('syncWasmOfJsOfOcamlDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('copies the built wasm-of-js-of-ocaml browser bundle, toolchain bundle, and Binaryen tools', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const sourceBinaryenBinDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const targetBinaryenBinDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(
			sourceBrowserDistDir,
			'src/index.js',
			'export const compiler = true;\n'
		);
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			bridgeCapableWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1,"findlibConf":"/.cache/browser-native-bundle/findlib.conf","tools":{"ocamlc":"/.cache/browser-native-bundle/tools/ocamlc.byte.browser.js"},"runtimePack":{"format":"wasm-of-js-of-ocaml-browser-native-runtime-pack-v1","asset":"/.cache/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz","index":"/.cache/browser-native-bundle/browser-native-runtime-pack.v1.index.json","fileCount":1,"totalBytes":6}}\n'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'tools/ocamlc.byte.browser.js',
			'console.log("ocaml");\n'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-runtime-pack.v1.bin.gz',
			'packed-bytes'
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-runtime-pack.v1.index.json',
			'{"format":"wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1","fileCount":1,"totalBytes":6,"entries":[{"runtimePath":"/static/toolchain/lib/ocaml/stdlib.cma","offset":0,"length":6}]}\n'
		);
		await writeFixtureFile(sourceBinaryenBinDir, 'wasm-opt', '#!/bin/sh\nexit 0\n');
		await writeFixtureFile(sourceBinaryenBinDir, 'wasm-merge', '#!/bin/sh\nexit 0\n');
		await writeFixtureFile(sourceBinaryenBinDir, 'types.d.ts', 'ignored');

		const result = await syncWasmOfJsOfOcamlDist({
			sourceBrowserDistDir,
			sourceBundleDir,
			sourceBinaryenBinDir,
			targetBrowserDistDir,
			targetBundleDir,
			targetBinaryenBinDir,
			versionModulePath
		});

		await expect(
			readFile(path.join(targetBrowserDistDir, 'src/index.js'), 'utf8')
		).resolves.toContain('compiler = true');
		await expect(
			readFile(
				path.join(targetBrowserDistDir, 'browser-harness/native-tool-worker.js'),
				'utf8'
			)
		).resolves.toContain('self.onmessage');
		await expect(
			readFile(path.join(targetBundleDir, 'browser-native-manifest.v1.json'), 'utf8')
		).resolves.toContain(
			'/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.bin.gz'
		);
		await expect(
			readFile(path.join(targetBundleDir, 'tools/ocamlc.byte.browser.js'), 'utf8')
		).resolves.toContain('ocaml');
		await expect(
			readFile(path.join(targetBundleDir, 'browser-native-runtime-pack.v1.bin.gz'), 'utf8')
		).resolves.toBe('packed-bytes');
		await expect(
			readFile(
				path.join(targetBundleDir, 'browser-native-runtime-pack.v1.index.json'),
				'utf8'
			)
		).resolves.toContain('/static/toolchain/lib/ocaml/stdlib.cma');
		await expect(
			readFile(path.join(targetBundleDir, 'lib/ocaml/stdlib.cma'), 'utf8')
		).rejects.toThrow();
		await expect(
			readFile(path.join(targetBundleDir, 'browser-native-manifest.v1.json'), 'utf8')
		).resolves.toContain('/wasm-of-js-of-ocaml/browser-native-bundle/findlib.conf');
		await expect(
			readFile(path.join(targetBundleDir, 'browser-native-manifest.v1.json'), 'utf8')
		).resolves.toContain(
			'/wasm-of-js-of-ocaml/browser-native-bundle/browser-native-runtime-pack.v1.index.json'
		);
		await expect(
			readFile(path.join(targetBinaryenBinDir, 'wasm-opt'), 'utf8')
		).resolves.toContain('exit 0');
		await expect(
			readFile(path.join(targetBinaryenBinDir, 'types.d.ts'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`export const WASM_OCAML_ASSET_VERSION = ${JSON.stringify(result.fingerprint)};`
		);
	});

	it('clears stale files from previous synced outputs', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const sourceBinaryenBinDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const targetBinaryenBinDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			bridgeCapableWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1}\n'
		);
		await writeFixtureFile(sourceBinaryenBinDir, 'wasm-opt', '#!/bin/sh\nexit 0\n');
		await writeFixtureFile(targetBrowserDistDir, 'stale.txt', 'remove me');
		await writeFixtureFile(targetBundleDir, 'stale.txt', 'remove me');
		await writeFixtureFile(targetBinaryenBinDir, 'stale.txt', 'remove me');

		await syncWasmOfJsOfOcamlDist({
			sourceBrowserDistDir,
			sourceBundleDir,
			sourceBinaryenBinDir,
			targetBrowserDistDir,
			targetBundleDir,
			targetBinaryenBinDir,
			versionModulePath
		});

		await expect(
			readFile(path.join(targetBrowserDistDir, 'stale.txt'), 'utf8')
		).rejects.toThrow();
		await expect(readFile(path.join(targetBundleDir, 'stale.txt'), 'utf8')).rejects.toThrow();
		await expect(
			readFile(path.join(targetBinaryenBinDir, 'stale.txt'), 'utf8')
		).rejects.toThrow();
	});

	it('fails with a build hint when the browser dist directory is missing', async () => {
		const sourceBrowserDistDir = path.join(await makeTempDir(), 'missing-dist');
		const sourceBundleDir = await makeTempDir();
		const sourceBinaryenBinDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const targetBinaryenBinDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await expect(
			syncWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir,
				sourceBinaryenBinDir,
				targetBrowserDistDir,
				targetBundleDir,
				targetBinaryenBinDir,
				versionModulePath
			})
		).rejects.toThrow('Build wasm-of-js-of-ocaml first');
	});

	it('fails when the Binaryen tool bundle is incomplete', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const sourceBinaryenBinDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const targetBinaryenBinDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			bridgeCapableWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1}\n'
		);

		await expect(
			syncWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir,
				sourceBinaryenBinDir,
				targetBrowserDistDir,
				targetBundleDir,
				targetBinaryenBinDir,
				versionModulePath
			})
		).rejects.toThrow('Binaryen tool was not found');
	});

	it('fails when the browser-native worker hard-codes the root Binaryen bridge endpoint', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const sourceBinaryenBinDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const targetBinaryenBinDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');

		await writeFixtureFile(sourceBrowserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			`
			const bridge = { binaryenBridge: true, env: { WASM_OF_JS_BINARYEN_BRIDGE_URL: '' } };
			function runBinaryenBridge() {}
			function callBridge(runtimeGlobal, command) {
				void bridge;
				return runBinaryenBridge(runtimeGlobal, command, '/api/binaryen-command');
			}
			`
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			'{"version":1}\n'
		);
		await writeFixtureFile(sourceBinaryenBinDir, 'wasm-opt', '#!/bin/sh\nexit 0\n');

		await expect(
			syncWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir,
				sourceBinaryenBinDir,
				targetBrowserDistDir,
				targetBundleDir,
				targetBinaryenBinDir,
				versionModulePath
			})
		).rejects.toThrow('hard-codes the root Binaryen bridge endpoint');
	});
});
