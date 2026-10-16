// Protocol/packager unit tests. The tiny JS glue below is never SDK qualification evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { bundleLocalGraph, verifyBinaryInputs } from './package-container-shell-sdk.mjs';

const toolRoot = process.env.WASM_IDLE_SDK_ESBUILD_ROOT;
assert(
	toolRoot,
	'Provide an existing local WASM_IDLE_SDK_ESBUILD_ROOT; this test never installs it'
);
process.env.ESBUILD_BINARY_PATH = join(toolRoot, 'bin/esbuild');
process.env.ESBUILD_WORKER_THREADS = '0';
const imported = await import(pathToFileURL(join(toolRoot, 'lib/main.js')).href);
const esbuild = imported.default ?? imported;
after(() => esbuild.stop());
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const memoryProfile = { shared: true, minimumPages: 1, maximumPages: 2 };
// A minimal host initializer protocol, not a Wasmer implementation or guest result.
const unitIndex = Buffer.from(`
export * from '../pkg/wasmer_js';
import load, {setWorkerUrl,setSDKUrl} from '../pkg/wasmer_js';
export async function init(value) {
  const output = await load(value.module,value.memory);
  setWorkerUrl(value.workerUrl); setSDKUrl(value.sdkUrl);
  return output;
}
`);
const unitGlue = Buffer.from(`
import { marker } from './snippets/local/marker.js';
export function setWorkerUrl(value) { globalThis.__sdkPackageUnit.workerUrl = value; }
export function setSDKUrl(value) { globalThis.__sdkPackageUnit.sdkUrl = value; }
export default async function initialize(module,memory) {
  globalThis.__sdkPackageUnit.calls.push([module,memory]); return { marker };
}
`);
const unitFiles = () =>
	new Map([
		['sdk/src-js/index.ts', unitIndex],
		[
			'sdk/src-js/worker.js',
			Buffer.from(
				'globalThis.onmessage = async event => { const {sdkUrl} = event.data; await import(sdkUrl); };'
			)
		],
		['bindgen/wasmer_js.js', unitGlue],
		['bindgen/snippets/local/marker.js', Buffer.from('export const marker = 17;')]
	]);

test('wrong independent binary-receipt digest fails before artifacts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'sdk-package-pin-'));
	try {
		const path = join(root, 'receipt.json');
		await writeFile(path, '{}');
		await assert.rejects(
			verifyBinaryInputs({ binaryReceipt: path, binaryReceiptSha256: '0'.repeat(64) }),
			/Independent digest/
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('failed real binary gate cannot be replaced by source-check success', async () => {
	const root = await mkdtemp(join(tmpdir(), 'sdk-package-failure-'));
	try {
		const path = join(root, 'receipt.json');
		const bytes = Buffer.from(
			JSON.stringify({ complete: false, finalStatus: 101, readOnlyInputsUnchanged: true })
		);
		await writeFile(path, bytes);
		await assert.rejects(
			verifyBinaryInputs({ binaryReceipt: path, binaryReceiptSha256: sha(bytes) }),
			/successful SDK binary receipt/
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('actual local esbuild includes registered generated snippet imports deterministically', async () => {
	const first = await bundleLocalGraph(esbuild, unitFiles(), memoryProfile);
	const second = await bundleLocalGraph(esbuild, unitFiles(), memoryProfile);
	for (const name of ['index.mjs', 'worker.mjs'])
		assert.deepEqual(first.outputs.get(name), second.outputs.get(name));
	assert(first.outputs.get('index.mjs').toString().includes('marker = 17'));
});

test('a generated-glue remote static import is rejected', async () => {
	const files = unitFiles();
	files.set(
		'bindgen/snippets/local/marker.js',
		Buffer.from("import 'https://example.invalid/host.js'; export const marker = 17;")
	);
	await assert.rejects(
		bundleLocalGraph(esbuild, files, memoryProfile),
		/Unregistered SDK host import/
	);
});

test('a generated-glue unresolved dynamic host import is rejected', async () => {
	const files = unitFiles();
	files.set(
		'bindgen/snippets/local/marker.js',
		Buffer.from('export const marker = 17; export function load(url) { return import(url); }')
	);
	// Keep the exported dynamic function alive through the SDK export graph.
	files.set(
		'bindgen/wasmer_js.js',
		Buffer.concat([unitGlue, Buffer.from("export {load} from './snippets/local/marker.js';")])
	);
	await assert.rejects(bundleLocalGraph(esbuild, files, memoryProfile), /import|string literal/);
});

test('strict initializer rejects URL/bytes/unshared input and preserves Module/Memory arguments', async () => {
	const root = await mkdtemp(join(tmpdir(), 'sdk-package-initializer-'));
	try {
		const bundle = await bundleLocalGraph(esbuild, unitFiles(), memoryProfile);
		const path = join(root, 'index.mjs');
		await writeFile(path, bundle.outputs.get('index.mjs'));
		globalThis.__sdkPackageUnit = { calls: [] };
		const sdk = await import(pathToFileURL(path).href);
		const module = new WebAssembly.Module(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]));
		const memory = new WebAssembly.Memory({ shared: true, initial: 1, maximum: 2 });
		for (const value of [
			undefined,
			{ module: new URL('https://example.invalid/sdk.wasm'), memory },
			{ module: new Uint8Array(), memory },
			{ module, memory: new WebAssembly.Memory({ initial: 1 }) }
		]) {
			assert.throws(() => sdk.init(value), /MODULE_REQUIRED|SHARED_MEMORY_REQUIRED/);
		}
		assert.throws(
			() => sdk.init({ module, memory, sdkUrl: 'https://example.invalid/index.mjs' }),
			/FIXED_MODULE_URL/
		);
		assert.throws(
			() => sdk.init({ module, memory, workerUrl: 'blob:wrong' }),
			/FIXED_WORKER_URL/
		);
		assert.equal(globalThis.__sdkPackageUnit.calls.length, 0);
		assert.deepEqual(await sdk.init({ module, memory }), { marker: 17 });
		assert.equal(globalThis.__sdkPackageUnit.calls[0][0], module);
		assert.equal(globalThis.__sdkPackageUnit.calls[0][1], memory);
		assert.equal(globalThis.__sdkPackageUnit.sdkUrl, pathToFileURL(path).href);
		assert.equal(
			globalThis.__sdkPackageUnit.workerUrl,
			pathToFileURL(join(root, 'worker.mjs')).href
		);
		assert.throws(
			() =>
				sdk.init({
					module,
					memory: new WebAssembly.Memory({ shared: true, initial: 1, maximum: 2 })
				}),
			/BINDING_CHANGED/
		);
	} finally {
		delete globalThis.__sdkPackageUnit;
		await rm(root, { recursive: true, force: true });
	}
});

test('worker initialization requires the fixed SDK URL/id and rejects duplicate initialization', async () => {
	const root = await mkdtemp(join(tmpdir(), 'sdk-package-worker-'));
	const previous = globalThis.onmessage;
	try {
		const bundle = await bundleLocalGraph(esbuild, unitFiles(), memoryProfile);
		for (const [name, bytes] of bundle.outputs) await writeFile(join(root, name), bytes);
		await import(pathToFileURL(join(root, 'worker.mjs')).href);
		const module = new WebAssembly.Module(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]));
		const memory = new WebAssembly.Memory({ shared: true, initial: 1, maximum: 2 });
		const sdkUrl = pathToFileURL(join(root, 'index.mjs')).href;
		const data = { type: 'init', id: 1, module, memory, sdkUrl };
		assert.throws(
			() => globalThis.onmessage({ data: { ...data, sdkUrl: undefined } }),
			/FIXED_MODULE_URL/
		);
		assert.throws(
			() =>
				globalThis.onmessage({
					data: { ...data, sdkUrl: 'https://example.invalid/index.mjs' }
				}),
			/FIXED_MODULE_URL/
		);
		assert.throws(() => globalThis.onmessage({ data: { ...data, id: 1.5 } }), /WORKER_ID/);
		await globalThis.onmessage({ data });
		assert.throws(() => globalThis.onmessage({ data }), /DUPLICATE_WORKER_INIT/);
	} finally {
		globalThis.onmessage = previous;
		await rm(root, { recursive: true, force: true });
	}
});
