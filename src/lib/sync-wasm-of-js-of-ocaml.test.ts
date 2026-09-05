import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
	computeBundleFingerprint,
	syncWasmOfJsOfOcamlDist,
	verifyWasmOfJsOfOcamlDist,
	verifyWasmOfJsOfOcamlWrapper
} from '../../scripts/sync-wasm-of-js-of-ocaml.mjs';

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

const sourceBundleRoot = '/.cache/browser-native-bundle';
const publicBundleRoot = '/wasm-of-js-of-ocaml/browser-native-bundle';

function createAssetDescriptor(relativePath: string, bytes: number, sha256: string) {
	return {
		url: `${sourceBundleRoot}/${relativePath}`,
		bytes,
		sha256
	};
}

function createBinaryenToolDescriptors() {
	return {
		wasm_opt: createAssetDescriptor('tools/wasm-opt.browser.js', 101, '1'.repeat(64)),
		wasm_merge: createAssetDescriptor('tools/wasm-merge.browser.js', 102, '2'.repeat(64)),
		wasm_metadce: createAssetDescriptor('tools/wasm-metadce.browser.js', 103, '3'.repeat(64))
	};
}

function expectedPublicDescriptor<T extends { url: string }>(descriptor: T): T {
	return {
		...descriptor,
		url: descriptor.url.replace(sourceBundleRoot, publicBundleRoot)
	};
}

describe('syncWasmOfJsOfOcamlDist', () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
		);
	});

	it('syncs gzip-only pinned tools after verifying their expanded receipts and preserves the last output on failure', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'profile.ts');
		await writeFixtureFile(
			sourceBrowserDistDir,
			'src/index.js',
			'export const compiler = true;'
		);
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			staticBinaryenWorkerSource
		);
		const payload = Buffer.from('console.log("tool");');
		const tools = Object.fromEntries(
			['wasm-opt', 'wasm-merge', 'wasm-metadce'].map((tool) => [
				tool.replaceAll('-', '_'),
				createAssetDescriptor(
					`tools/${tool}.browser.js`,
					payload.length,
					createHash('sha256').update(payload).digest('hex')
				)
			])
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			JSON.stringify({ binaryenTools: tools })
		);
		await mkdir(path.join(sourceBundleDir, 'tools'));
		for (const tool of ['wasm-opt', 'wasm-merge', 'wasm-metadce']) {
			await writeFile(
				path.join(sourceBundleDir, `tools/${tool}.browser.js.gz`),
				gzipSync(payload)
			);
		}
		const options = {
			sourceBrowserDistDir,
			sourceBundleDir,
			targetBrowserDistDir,
			targetBundleDir,
			versionModulePath
		};
		await syncWasmOfJsOfOcamlDist(options);
		const profile = await readFile(versionModulePath, 'utf8');
		expect(await readFile(path.join(targetBundleDir, 'tools/wasm-opt.browser.js.gz'))).toEqual(
			gzipSync(payload)
		);
		await writeFile(
			path.join(sourceBundleDir, 'tools/wasm-opt.browser.js.gz'),
			gzipSync(Buffer.from('CONSOLE.LOG("tool");'))
		);
		await expect(syncWasmOfJsOfOcamlDist(options)).rejects.toThrow(
			'compressed Binaryen tool failed receipt validation'
		);
		expect(await readFile(versionModulePath, 'utf8')).toBe(profile);
		expect(await readFile(path.join(targetBundleDir, 'tools/wasm-opt.browser.js.gz'))).toEqual(
			gzipSync(payload)
		);
	});

	it('fingerprints bundle contents independently of file timestamps', async () => {
		const browserDistDir = await makeTempDir();
		const bundleDir = await makeTempDir();
		const browserEntryPath = path.join(browserDistDir, 'src/index.js');
		await writeFixtureFile(browserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(bundleDir, 'manifest.json', '{"version":1}\n');

		const first = await computeBundleFingerprint([browserDistDir, bundleDir]);
		const future = new Date(Date.now() + 60_000);
		await utimes(browserEntryPath, future, future);
		const second = await computeBundleFingerprint([browserDistDir, bundleDir]);

		expect(second).toBe(first);
		expect(first).toMatch(/^[a-f0-9]{64}$/u);
	});

	it('changes the fingerprint when same-sized contents change with the same timestamp', async () => {
		const browserDistDir = await makeTempDir();
		const bundleDir = await makeTempDir();
		const browserEntryPath = path.join(browserDistDir, 'src/index.js');
		await writeFixtureFile(browserDistDir, 'src/index.js', 'export default 1;\n');
		await writeFixtureFile(bundleDir, 'manifest.json', '{"version":1}\n');
		const originalTimes = await stat(browserEntryPath);

		const first = await computeBundleFingerprint([browserDistDir, bundleDir]);
		await writeFile(browserEntryPath, 'export default 2;\n', 'utf8');
		await utimes(browserEntryPath, originalTimes.atime, originalTimes.mtime);
		const second = await computeBundleFingerprint([browserDistDir, bundleDir]);

		expect(second).not.toBe(first);
	});

	it('copies the built wasm-of-js-of-ocaml browser bundle and bundled static Binaryen tools', async () => {
		const sourceBrowserDistDir = await makeTempDir();
		const sourceBundleDir = await makeTempDir();
		const targetBrowserDistDir = await makeTempDir();
		const targetBundleDir = await makeTempDir();
		const versionModulePath = path.join(await makeTempDir(), 'wasmOcamlVersion.ts');
		const sourceManifest = {
			version: 1,
			findlibConf: createAssetDescriptor('findlib.conf', 181, '4'.repeat(64)),
			tools: {
				ocamlc: createAssetDescriptor(
					'tools/ocamlc.byte.browser.js',
					2_328_856,
					'5'.repeat(64)
				)
			},
			binaryenTools: createBinaryenToolDescriptors(),
			runtimePack: {
				format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1',
				asset: `${sourceBundleRoot}/browser-native-runtime-pack.v1.bin.gz`,
				index: `${sourceBundleRoot}/browser-native-runtime-pack.v1.index.json`,
				fileCount: 1,
				totalBytes: 6
			}
		};

		await writeFixtureFile(
			sourceBrowserDistDir,
			'src/index.js',
			'export const compiler = true;\n'
		);
		await writeFixtureFile(
			sourceBrowserDistDir,
			'browser-harness/native-tool-worker.js',
			staticBinaryenWorkerSource
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			`${JSON.stringify(sourceManifest)}\n`
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

		const result = await syncWasmOfJsOfOcamlDist({
			sourceBrowserDistDir,
			sourceBundleDir,
			targetBrowserDistDir,
			targetBundleDir,
			versionModulePath
		});

		await expect(
			readFile(path.join(targetBrowserDistDir, 'src/index.js'), 'utf8')
		).resolves.toContain('compiler = true');
		await expect(
			readFile(path.join(targetBundleDir, 'tools/wasm-opt.browser.js'), 'utf8')
		).resolves.toContain('wasm-opt');
		await expect(
			readFile(path.join(targetBundleDir, 'tools/wasm-merge.browser.js'), 'utf8')
		).resolves.toContain('wasm-merge');
		await expect(
			readFile(path.join(targetBundleDir, 'tools/wasm-metadce.browser.js'), 'utf8')
		).resolves.toContain('wasm-metadce');
		const syncedManifest = JSON.parse(
			await readFile(path.join(targetBundleDir, 'browser-native-manifest.v1.json'), 'utf8')
		) as typeof sourceManifest;
		expect(syncedManifest.findlibConf).toEqual(
			expectedPublicDescriptor(sourceManifest.findlibConf)
		);
		expect(syncedManifest.tools.ocamlc).toEqual(
			expectedPublicDescriptor(sourceManifest.tools.ocamlc)
		);
		expect(syncedManifest.binaryenTools).toEqual({
			wasm_opt: expectedPublicDescriptor(sourceManifest.binaryenTools.wasm_opt),
			wasm_merge: expectedPublicDescriptor(sourceManifest.binaryenTools.wasm_merge),
			wasm_metadce: expectedPublicDescriptor(sourceManifest.binaryenTools.wasm_metadce)
		});
		await expect(readFile(versionModulePath, 'utf8')).resolves.toContain(
			`'${result.fingerprint}';`
		);
		const moduleBytes = await readFile(path.join(targetBrowserDistDir, 'src/index.js'));
		const manifestBytes = await readFile(
			path.join(targetBundleDir, 'browser-native-manifest.v1.json')
		);
		const versionModule = await readFile(versionModulePath, 'utf8');
		expect(versionModule).toContain(
			'export const WASM_OCAML_RUNTIME_PROFILE = Object.freeze({'
		);
		expect(versionModule).toContain(`bytes: ${moduleBytes.byteLength}`);
		expect(versionModule).toContain(
			`sha256: '${createHash('sha256').update(moduleBytes).digest('hex')}'`
		);
		expect(versionModule).toContain(`bytes: ${manifestBytes.byteLength}`);
		expect(versionModule).toContain(
			`sha256: '${createHash('sha256').update(manifestBytes).digest('hex')}'`
		);
		expect(result).toMatchObject({
			moduleReceipt: {
				bytes: moduleBytes.byteLength,
				sha256: createHash('sha256').update(moduleBytes).digest('hex')
			},
			manifestReceipt: {
				bytes: manifestBytes.byteLength,
				sha256: createHash('sha256').update(manifestBytes).digest('hex')
			}
		});
		await expect(
			verifyWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir: targetBundleDir,
				targetBrowserDistDir,
				targetBundleDir,
				versionModulePath
			})
		).resolves.toMatchObject({ fingerprint: result.fingerprint });
		await expect(
			verifyWasmOfJsOfOcamlWrapper({ sourceBrowserDistDir, versionModulePath })
		).resolves.toMatchObject({ moduleReceipt: result.moduleReceipt });

		await writeFile(path.join(targetBrowserDistDir, 'src/index.js'), 'corrupt', 'utf8');
		await expect(
			verifyWasmOfJsOfOcamlDist({
				sourceBrowserDistDir,
				sourceBundleDir: targetBundleDir,
				targetBrowserDistDir,
				targetBundleDir,
				versionModulePath
			})
		).rejects.toThrow('does not match the current producer output');

		await writeFile(path.join(sourceBrowserDistDir, 'src/index.js'), 'corrupt', 'utf8');
		await expect(
			verifyWasmOfJsOfOcamlWrapper({ sourceBrowserDistDir, versionModulePath })
		).rejects.toThrow('browser wrapper does not match the generated runtime profile');
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
			`${JSON.stringify({ version: 1, binaryenTools: createBinaryenToolDescriptors() })}\n`
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

		await expect(
			readFile(path.join(targetBrowserDistDir, 'stale.txt'), 'utf8')
		).rejects.toThrow();
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
			`${JSON.stringify({ version: 1, binaryenTools: createBinaryenToolDescriptors() })}\n`
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
		const staleBinaryenBridgePath = '/' + 'api/binaryen-command';

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
				return ${JSON.stringify(staleBinaryenBridgePath)};
			};
			`
		);
		await writeFixtureFile(
			sourceBundleDir,
			'browser-native-manifest.v1.json',
			`${JSON.stringify({ version: 1, binaryenTools: createBinaryenToolDescriptors() })}\n`
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
