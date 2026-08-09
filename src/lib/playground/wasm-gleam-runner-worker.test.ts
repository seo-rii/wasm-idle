// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_GLEAM_ASSET_VERSION, WASM_GLEAM_RUNNER_RECEIPT } from './wasmGleamVersion';

const workerSourceUrl = new URL(
	'../../../scripts/runtime-workers/wasm-gleam-runner-worker.js',
	import.meta.url
);
const staticWorkerUrl = new URL('../../../static/wasm-gleam/runner-worker.js', import.meta.url);
const staticRuntimeUrl = new URL('../../../static/wasm-gleam/', import.meta.url);

async function readWorkerSource() {
	return readFile(workerSourceUrl, 'utf8');
}

async function createHarnessWorker() {
	const workerSource = await readWorkerSource();
	const harnessHandler = `
self.onmessage = (event) => {
  try {
    const readLine = createLineReader(event.data?.stdin, event.data?.stdinChannel);
    self.postMessage({ output: 'value?\\n' });
    self.postMessage({ output: 'main=' + readLine() + '\\n' });
    self.postMessage({ results: true });
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
(0, eval)(${JSON.stringify(workerSource)} + ${JSON.stringify(harnessHandler)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	return new NodeWorker(harness, { eval: true });
}

async function runHarness(request: Record<string, unknown>, onMessage?: (message: any) => void) {
	const worker = await createHarnessWorker();
	const messages: any[] = [];
	try {
		await new Promise<void>((resolve, reject) => {
			worker.on('message', (message) => {
				messages.push(message);
				try {
					onMessage?.(message);
				} catch (error) {
					reject(error);
					return;
				}
				if (message?.results !== undefined || message?.error !== undefined) resolve();
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0) reject(new Error(`Gleam harness exited with code ${code}`));
			});
			worker.postMessage(request);
		});
		return messages;
	} finally {
		await worker.terminate();
	}
}

async function runCompilerLifecycleHarness({
	requests,
	deleteFailureProjectId = null
}: {
	requests: Array<Record<string, unknown>>;
	deleteFailureProjectId?: number | null;
}) {
	const workerSource = await readWorkerSource();
	const lifecycleOverrides = `
const __lifecycleEvents = [];
const __compiler = {
  reset_filesystem(projectId) {
    __lifecycleEvents.push({ event: 'reset', projectId, projectType: typeof projectId });
  },
  delete_project(projectId) {
    __lifecycleEvents.push({ event: 'delete', projectId, projectType: typeof projectId });
    if (projectId === ${JSON.stringify(deleteFailureProjectId)}) {
      throw new Error('synthetic project cleanup failure');
    }
  }
};
loadCompiler = async () => __compiler;
loadManifest = async () => ({ files: [], javascriptFiles: [] });
buildModuleSources = async (_compiler, projectId, _manifest, code) => {
  __lifecycleEvents.push({ event: 'build', projectId, projectType: typeof projectId });
  if (code === 'compile-fail') throw new Error('synthetic compile failure');
  return { moduleSources: new Map() };
};
executeMain = async (_moduleSources, _baseUrl, executionId) => {
  __lifecycleEvents.push({
    event: 'execute',
    executionId,
    executionType: typeof executionId
  });
};
const __productionOnMessage = self.onmessage;
const __nativePostMessage = self.postMessage;
self.postMessage = (message) => {
  if (message?.results !== undefined || message?.error !== undefined) {
    __lifecycleEvents.push({
      event: 'terminal',
      kind: message?.error !== undefined ? 'error' : 'results',
      message: message?.error
    });
  }
  __nativePostMessage(message);
};
self.onmessage = async (event) => {
  await __productionOnMessage(event);
  __nativePostMessage({ lifecycle: [...__lifecycleEvents] });
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
self.postMessage = (message) => parentPort.postMessage(message);
(0, eval)(${JSON.stringify(workerSource)} + ${JSON.stringify(lifecycleOverrides)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	const worker = new NodeWorker(harness, { eval: true });
	try {
		return await new Promise<any[]>((resolve, reject) => {
			let completed = 0;
			worker.on('message', (message) => {
				if (!Array.isArray(message?.lifecycle)) return;
				completed += 1;
				if (completed < requests.length) {
					worker.postMessage(requests[completed]);
					return;
				}
				resolve(message.lifecycle);
			});
			worker.once('error', reject);
			worker.once('exit', (code) => {
				if (code !== 0)
					reject(new Error(`Gleam lifecycle harness exited with code ${code}`));
			});
			worker.postMessage(requests[0]);
		});
	} finally {
		await worker.terminate();
	}
}

async function readLogicalAsset(fileName: string) {
	try {
		return await readFile(new URL(fileName, staticRuntimeUrl));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return gunzipSync(await readFile(new URL(`${fileName}.gz`, staticRuntimeUrl)));
	}
}

type GleamAssetReceipt = { path: string; size: number; sha256: string };

function compareCodeUnits(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes: Uint8Array | string) {
	return createHash('sha256').update(bytes).digest('hex');
}

function computeRuntimeFingerprint(receipts: GleamAssetReceipt[], compilerVersion: string) {
	const hash = createHash('sha256');
	hash.update('wasm-idle:gleam-runtime-manifest:v2\n');
	hash.update('format\0wasm-gleam-runtime-manifest-v2\n');
	hash.update(`compilerVersion\0${compilerVersion}\n`);
	for (const receipt of [...receipts].sort((left, right) =>
		compareCodeUnits(left.path, right.path)
	)) {
		hash.update(receipt.path);
		hash.update('\0');
		hash.update(String(receipt.size));
		hash.update('\0');
		hash.update(receipt.sha256);
		hash.update('\n');
	}
	return hash.digest('hex');
}

function createRuntimePackFixture() {
	const baseUrl = 'https://runtime.example.test/wasm-gleam/';
	const compilerVersion = 'v-test';
	const assetBytes = new Map<string, Uint8Array>([
		[
			'compiler/gleam_wasm.js',
			new TextEncoder().encode('export default async function init(_bytes) {}\n')
		],
		['compiler/gleam_wasm_bg.wasm', Uint8Array.from([0, 97, 115, 109])],
		['javascript/gleam.mjs', new TextEncoder().encode('export const Nil = undefined;\n')],
		['src/gleam.gleam', new TextEncoder().encode('pub type Nil { Nil }\n')]
	]);
	const assets = [...assetBytes]
		.map(([path, bytes]) => ({ path, size: bytes.byteLength, sha256: sha256(bytes) }))
		.sort((left, right) => compareCodeUnits(left.path, right.path));
	const fingerprint = computeRuntimeFingerprint(assets, compilerVersion);
	const sourceReceipt = assets.find((receipt) => receipt.path === 'src/gleam.gleam')!;
	const manifest = {
		format: 'wasm-gleam-runtime-manifest-v2',
		compilerVersion,
		fingerprint,
		assets,
		files: [
			{
				path: 'gleam.gleam',
				size: sourceReceipt.size,
				sha256: sourceReceipt.sha256
			}
		],
		javascriptFiles: ['gleam.mjs']
	};
	return {
		assetBytes,
		baseUrl,
		fingerprint,
		manifest,
		manifestUrl: `${baseUrl}source-manifest.v2.json?v=${fingerprint}`
	};
}

async function runRuntimePackHarness({
	assetOverrides = new Map<string, Uint8Array>(),
	expectedFingerprint,
	manifest
}: {
	assetOverrides?: Map<string, Uint8Array>;
	expectedFingerprint?: string;
	manifest?: Record<string, unknown>;
} = {}) {
	const fixture = createRuntimePackFixture();
	const effectiveManifest = manifest ?? fixture.manifest;
	const responses = new Map<string, Uint8Array>([
		[fixture.manifestUrl, new TextEncoder().encode(`${JSON.stringify(effectiveManifest)}\n`)]
	]);
	for (const [path, bytes] of fixture.assetBytes) {
		const url = new URL(path, fixture.baseUrl);
		url.searchParams.set('v', fixture.fingerprint);
		responses.set(url.href, assetOverrides.get(path) ?? bytes);
	}
	const serializedResponses = Object.fromEntries(
		[...responses].map(([url, bytes]) => [url, Buffer.from(bytes).toString('base64')])
	);
	const workerSource = await readWorkerSource();
	const harnessHandler = `
self.onmessage = async () => {
  try {
    const pack = await loadManifest(
      ${JSON.stringify(fixture.manifestUrl)},
      ${JSON.stringify(fixture.baseUrl)},
      ${JSON.stringify(expectedFingerprint ?? fixture.fingerprint)}
    );
    self.postMessage({
      ok: true,
      paths: [...pack.assetBytes.keys()],
      requests: globalThis.__wasmIdleRequests
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error?.message || String(error),
      requests: globalThis.__wasmIdleRequests
    });
  }
};
`;
	const harness = `
const { parentPort } = require('node:worker_threads');
const { webcrypto } = require('node:crypto');
globalThis.self = globalThis;
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
const __responses = new Map(Object.entries(${JSON.stringify(serializedResponses)}).map(
  ([url, bytes]) => [url, Buffer.from(bytes, 'base64')]
));
globalThis.__wasmIdleRequests = [];
globalThis.fetch = async (url, options) => {
  const href = String(url);
  globalThis.__wasmIdleRequests.push({
    url: href,
    cache: options?.cache,
    credentials: options?.credentials,
    redirect: options?.redirect,
    referrerPolicy: options?.referrerPolicy
  });
  const bytes = __responses.get(href);
  if (!bytes) return new Response('missing', { status: 404 });
  return new Response(bytes, {
    status: 200,
    headers: { 'content-length': String(bytes.byteLength) }
  });
};
self.postMessage = (message) => parentPort.postMessage(message);
(0, eval)(${JSON.stringify(workerSource)} + ${JSON.stringify(harnessHandler)});
parentPort.on('message', (data) => self.onmessage({ data }));
`;
	const worker = new NodeWorker(harness, { eval: true });
	try {
		return await new Promise<any>((resolve, reject) => {
			worker.once('message', resolve);
			worker.once('error', reject);
			worker.postMessage({});
		});
	} finally {
		await worker.terminate();
	}
}

describe('Gleam runner worker', () => {
	it('keeps the synced worker and cache-busting fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);

		const manifest = JSON.parse(
			await readFile(new URL('source-manifest.v2.json', staticRuntimeUrl), 'utf8')
		);
		expect(manifest.format).toBe('wasm-gleam-runtime-manifest-v2');
		expect(manifest.assets).toHaveLength(50);
		expect(manifest.assets.map((entry: GleamAssetReceipt) => entry.path)).toEqual(
			manifest.assets.map((entry: GleamAssetReceipt) => entry.path).sort(compareCodeUnits)
		);
		for (const receipt of manifest.assets as GleamAssetReceipt[]) {
			const bytes = await readLogicalAsset(receipt.path);
			expect(bytes.byteLength, receipt.path).toBe(receipt.size);
			expect(sha256(bytes), receipt.path).toBe(receipt.sha256);
		}
		expect(computeRuntimeFingerprint(manifest.assets, manifest.compilerVersion)).toBe(
			WASM_GLEAM_ASSET_VERSION
		);
		expect(manifest.fingerprint).toBe(WASM_GLEAM_ASSET_VERSION);
		expect(WASM_GLEAM_ASSET_VERSION).toMatch(/^[a-f0-9]{64}$/u);

		const runnerBytes = await readLogicalAsset('runner-worker.js');
		expect(WASM_GLEAM_RUNNER_RECEIPT).toEqual({
			bytes: runnerBytes.byteLength,
			sha256: sha256(runnerBytes)
		});
		expect(
			manifest.assets.some((entry: GleamAssetReceipt) => entry.path === 'runner-worker.js')
		).toBe(false);

		const compilerModule = new TextDecoder().decode(
			await readLogicalAsset('compiler/gleam_wasm.js')
		);
		expect(compilerModule).not.toMatch(/^\s*(?:import\s|export\s+.+\s+from\s)/mu);
		expect(compilerModule).not.toMatch(/\bimport\s*\(/u);
		expect(compilerModule).toContain("if (typeof input === 'undefined')");
	});

	it('loads only the exact receipt allowlist after verifying the full pack', async () => {
		const fixture = createRuntimePackFixture();
		const result = await runRuntimePackHarness();

		expect(result).toMatchObject({
			ok: true,
			paths: fixture.manifest.assets.map((receipt) => receipt.path)
		});
		expect(result.requests).toEqual([
			{
				url: fixture.manifestUrl,
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			},
			...fixture.manifest.assets.map((receipt) => {
				const url = new URL(receipt.path, fixture.baseUrl);
				url.searchParams.set('v', fixture.fingerprint);
				return {
					url: url.href,
					cache: undefined,
					credentials: 'omit',
					redirect: 'error',
					referrerPolicy: 'no-referrer'
				};
			})
		]);
	});

	it('fails closed when a declared runtime asset is modified', async () => {
		const fixture = createRuntimePackFixture();
		const modifiedBytes = fixture.assetBytes.get('javascript/gleam.mjs')!.slice();
		modifiedBytes[0] ^= 1;
		const result = await runRuntimePackHarness({
			assetOverrides: new Map([['javascript/gleam.mjs', modifiedBytes]])
		});

		expect(result).toMatchObject({
			ok: false,
			error: 'Gleam runtime asset javascript/gleam.mjs failed SHA-256 verification.'
		});
	});

	it('rejects a manifest that does not match the host-pinned fingerprint', async () => {
		const result = await runRuntimePackHarness({
			expectedFingerprint: '0'.repeat(64)
		});

		expect(result).toMatchObject({
			ok: false,
			error: 'Gleam runtime manifest fingerprint does not match the pinned runtime.'
		});
		expect(result.requests).toHaveLength(1);
	});

	it('rejects a modified receipt graph before issuing asset requests', async () => {
		const fixture = createRuntimePackFixture();
		const manifest = structuredClone(fixture.manifest);
		manifest.assets[0].size += 1;
		const result = await runRuntimePackHarness({ manifest });

		expect(result).toMatchObject({
			ok: false,
			error: 'Gleam runtime receipt graph failed fingerprint verification.'
		});
		expect(result.requests).toHaveLength(1);
	});

	it('rejects encoded traversal paths before issuing asset requests', async () => {
		const fixture = createRuntimePackFixture();
		const manifest = structuredClone(fixture.manifest) as typeof fixture.manifest;
		manifest.assets[0].path = '%2e%2e/escape';
		const result = await runRuntimePackHarness({ manifest });

		expect(result).toMatchObject({
			ok: false,
			error: 'Gleam runtime asset 0 path is invalid.'
		});
		expect(result.requests).toHaveLength(1);
	});

	it('prints a prompt before reading a UTF-8 line from the shared ring', async () => {
		const stdin = new StaticStdinRingHost({ capacity: 16, maxBufferedBytes: 32 });
		let suppliedInput = false;
		const messages = await runHarness({ stdinChannel: stdin.descriptor }, (message) => {
			if (message?.output?.includes('value?') && !suppliedInput) {
				suppliedInput = true;
				setTimeout(() => {
					stdin.enqueue('안녕\r\n');
					stdin.close();
				}, 10);
			}
		});

		expect(messages.findIndex((message) => message?.output?.includes('value?'))).toBeLessThan(
			messages.findIndex((message) => message?.output?.includes('main=안녕'))
		);
		expect(messages.some((message) => message?.output?.includes('main=안녕'))).toBe(true);
		expect(messages.at(-1)).toEqual({ results: true });
	});

	it('uses numeric compiler projects and deletes them before terminal settlement', async () => {
		const lifecycle = await runCompilerLifecycleHarness({
			requests: [
				{ baseUrl: 'https://example.test/wasm-gleam/', code: 'ok' },
				{ baseUrl: 'https://example.test/wasm-gleam/', code: 'compile-fail' }
			]
		});

		expect(lifecycle).toEqual([
			{ event: 'reset', projectId: 1, projectType: 'number' },
			{ event: 'build', projectId: 1, projectType: 'number' },
			{
				event: 'execute',
				executionId: expect.stringMatching(/^wasm_idle_\d+_1$/),
				executionType: 'string'
			},
			{ event: 'delete', projectId: 1, projectType: 'number' },
			{ event: 'terminal', kind: 'results', message: undefined },
			{ event: 'reset', projectId: 2, projectType: 'number' },
			{ event: 'build', projectId: 2, projectType: 'number' },
			{ event: 'delete', projectId: 2, projectType: 'number' },
			{ event: 'terminal', kind: 'error', message: 'synthetic compile failure' }
		]);
	});

	it('reports project cleanup failure instead of reusing the worker', async () => {
		const lifecycle = await runCompilerLifecycleHarness({
			deleteFailureProjectId: 1,
			requests: [{ baseUrl: 'https://example.test/wasm-gleam/', code: 'ok' }]
		});

		expect(lifecycle.at(-2)).toEqual({
			event: 'delete',
			projectId: 1,
			projectType: 'number'
		});
		expect(lifecycle.at(-1)).toEqual({
			event: 'terminal',
			kind: 'error',
			message: 'synthetic project cleanup failure'
		});
	});

	it('fails closed on a malformed shared stdin descriptor', async () => {
		const messages = await runHarness({
			stdinChannel: {
				protocol: 'wasm-idle-static-stdin-ring',
				protocolVersion: 1,
				buffer: new SharedArrayBuffer(32),
				capacity: 16,
				controlBytes: 8
			}
		});

		expect(messages).toEqual([{ error: 'Invalid Gleam streaming stdin channel.' }]);
	});
});
