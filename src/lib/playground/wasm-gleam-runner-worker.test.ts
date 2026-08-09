// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Worker as NodeWorker } from 'node:worker_threads';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost } from './staticStdinRing';
import { WASM_GLEAM_ASSET_VERSION } from './wasmGleamVersion';

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
buildModuleSources = async (_compiler, projectId, _baseUrl, _manifest, code) => {
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

describe('Gleam runner worker', () => {
	it('keeps the synced worker and cache-busting fingerprint current', async () => {
		const source = await readWorkerSource();
		expect(await readFile(staticWorkerUrl, 'utf8')).toBe(source);

		const manifest = JSON.parse(
			await readFile(new URL('source-manifest.v1.json', staticRuntimeUrl), 'utf8')
		);
		const logicalFiles = [
			'compiler/gleam_wasm.js',
			'compiler/gleam_wasm_bg.wasm',
			...manifest.files.map((entry: { path: string }) => `src/${entry.path}`),
			...manifest.javascriptFiles.map((path: string) => `javascript/${path}`),
			'runner-worker.js'
		].sort();
		const hash = createHash('sha256');
		for (const fileName of logicalFiles) {
			hash.update(fileName);
			hash.update('\0');
			hash.update(await readLogicalAsset(fileName));
			hash.update('\n');
		}
		expect(hash.digest('hex').slice(0, 16)).toBe(WASM_GLEAM_ASSET_VERSION);
		expect(manifest.fingerprint).toBe(WASM_GLEAM_ASSET_VERSION);
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
