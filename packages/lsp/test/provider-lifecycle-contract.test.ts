import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => {
	const workers: FakeWorker[] = [];
	const readers: MockReader[] = [];
	const writers: MockWriter[] = [];
	const behavior = { respondToInit: true };

	class FakeWorker {
		listeners = {
			message: new Set<(event: MessageEvent<unknown>) => void>(),
			error: new Set<(event: ErrorEvent) => void>()
		};
		messages: unknown[] = [];
		terminateCalls = 0;

		constructor() {
			workers.push(this);
		}

		addEventListener(
			type: 'message' | 'error',
			handler: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
		) {
			if (type === 'message') {
				this.listeners.message.add(handler as (event: MessageEvent<unknown>) => void);
			} else {
				this.listeners.error.add(handler as (event: ErrorEvent) => void);
			}
		}

		removeEventListener(
			type: 'message' | 'error',
			handler: ((event: MessageEvent<unknown>) => void) | ((event: ErrorEvent) => void)
		) {
			if (type === 'message') {
				this.listeners.message.delete(handler as (event: MessageEvent<unknown>) => void);
			} else {
				this.listeners.error.delete(handler as (event: ErrorEvent) => void);
			}
		}

		postMessage(message: { type?: string }) {
			this.messages.push(message);
			if (message.type !== 'init' || !behavior.respondToInit) return;
			for (const handler of this.listeners.message) {
				handler({ data: { type: 'ready' } } as MessageEvent<unknown>);
			}
		}

		terminate() {
			this.terminateCalls += 1;
		}
	}

	class MockReader {
		onError = undefined;
		onClose = undefined;
		onPartialMessage = undefined;
		disposeCalls = 0;

		constructor(public worker: unknown) {
			readers.push(this);
		}

		listen() {
			return { dispose() {} };
		}

		dispose() {
			this.disposeCalls += 1;
		}
	}

	class MockWriter {
		disposeCalls = 0;

		constructor(public worker: unknown) {
			writers.push(this);
		}

		dispose() {
			this.disposeCalls += 1;
		}
	}

	return { workers, readers, writers, behavior, FakeWorker, MockReader, MockWriter };
});

vi.mock('../src/jsonrpc.js', () => ({
	BrowserMessageReader: mockState.MockReader,
	BrowserMessageWriter: mockState.MockWriter
}));

import { editorLanguageServerProviders } from '../src/registry.js';
import type { DOuterAssetReceipts } from '../src/d/assets.js';
import type { EditorLanguageServerRuntimeOptions } from '../src/types.js';

const applicationOrigin = 'https://app.example.com';
const dAssetBytes = {
	'index.js': new TextEncoder().encode('export const createDCompiler = () => undefined;'),
	'runtime/runtime-manifest.v1.json': new TextEncoder().encode('{}')
} as const;
const createDReceipt = (bytes: Uint8Array) => {
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	return {
		bytes: bytes.byteLength,
		sha256,
		uncompressedBytes: bytes.byteLength,
		uncompressedSha256: sha256
	};
};
const dAssetIntegrity = {
	'index.js': createDReceipt(dAssetBytes['index.js']),
	'runtime/runtime-manifest.v1.json': createDReceipt(
		dAssetBytes['runtime/runtime-manifest.v1.json']
	)
} satisfies DOuterAssetReceipts;
const deploymentBases = [
	{ label: 'root', rootUrl: '/', currentUrl: `${applicationOrigin}/` },
	{
		label: 'one-segment',
		rootUrl: '/wasm-idle/',
		currentUrl: `${applicationOrigin}/wasm-idle/`
	},
	{
		label: 'nested',
		rootUrl: '/foo/bar/',
		currentUrl: `${applicationOrigin}/foo/bar/`
	}
] as const;

const createProviderOptions = (
	deployment = deploymentBases[1]
): EditorLanguageServerRuntimeOptions => ({
	rootUrl: deployment.rootUrl,
	currentUrl: deployment.currentUrl,
	createWorker: () => new mockState.FakeWorker() as unknown as Worker,
	cpp: {
		loader: async () => Uint8Array.of(0)
	},
	typescript: {
		libUrl: `${deployment.rootUrl}typescript-libs.json.gz`
	},
	javascript: {
		libUrl: `${deployment.rootUrl}typescript-libs.json.gz`
	},
	gleam: {
		manifestFingerprint: 'a'.repeat(64)
	},
	d: {
		integrity: dAssetIntegrity
	}
});

const collectUrls = (value: unknown, urls: URL[] = []): URL[] => {
	if (typeof value === 'string') {
		if (!value.startsWith('/') && !/^https?:\/\//u.test(value)) return urls;
		try {
			urls.push(new URL(value, applicationOrigin));
		} catch {
			// Non-URL initialization values are outside this deployment contract.
		}
		return urls;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectUrls(item, urls);
		return urls;
	}
	if (value && typeof value === 'object') {
		for (const item of Object.values(value)) collectUrls(item, urls);
	}
	return urls;
};

const providerDeploymentCases = deploymentBases.flatMap((deployment) =>
	editorLanguageServerProviders.map((provider) => ({
		title: `${provider.id} at ${deployment.label}`,
		deployment,
		provider
	}))
);

describe('registered LSP provider lifecycle contract', () => {
	beforeEach(() => {
		mockState.workers.splice(0, mockState.workers.length);
		mockState.readers.splice(0, mockState.readers.length);
		mockState.writers.splice(0, mockState.writers.length);
		mockState.behavior.respondToInit = true;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: string | URL | Request) => {
				const requestUrl = new URL(
					typeof input === 'string' || input instanceof URL ? input : input.url
				);
				const asset = requestUrl.pathname.endsWith('/runtime/runtime-manifest.v1.json')
					? 'runtime/runtime-manifest.v1.json'
					: requestUrl.pathname.endsWith('/index.js')
						? 'index.js'
						: undefined;
				if (!asset)
					throw new Error(`Unexpected lifecycle asset request: ${requestUrl.href}`);
				const bytes = dAssetBytes[asset];
				const response = new Response(bytes, {
					headers: { 'content-length': String(bytes.byteLength) }
				});
				Object.defineProperty(response, 'url', { value: requestUrl.href });
				return response;
			})
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each(editorLanguageServerProviders)(
		'$id initializes and disposes idempotently',
		async (provider) => {
			const handle = await provider.create(createProviderOptions());
			const worker = mockState.workers[0];

			expect(worker, provider.id).toBeDefined();
			expect(worker?.messages[0], provider.id).toMatchObject({ type: 'init' });
			expect(handle.transport.reader, provider.id).toBeDefined();
			expect(handle.transport.writer, provider.id).toBeDefined();

			handle.dispose();
			handle.dispose();

			expect(worker?.terminateCalls, provider.id).toBe(1);
			expect(mockState.readers[0]?.disposeCalls, provider.id).toBe(1);
			expect(mockState.writers[0]?.disposeCalls, provider.id).toBe(1);
		}
	);

	it.each(providerDeploymentCases)(
		'$title keeps application assets under the deployment base',
		async ({ deployment, provider }) => {
			const handle = await provider.create(createProviderOptions(deployment));
			const initMessage = mockState.workers[0]?.messages[0];
			const expectedPath = new URL(deployment.rootUrl, deployment.currentUrl).pathname;

			for (const url of collectUrls(initMessage)) {
				expect(url.origin, `${provider.id} escaped ${applicationOrigin}: ${url.href}`).toBe(
					applicationOrigin
				);
				expect(
					url.pathname === expectedPath || url.pathname.startsWith(expectedPath),
					`${provider.id} escaped ${expectedPath}: ${url.href}`
				).toBe(true);
			}

			handle.dispose();
		}
	);

	it.each(editorLanguageServerProviders)(
		'$id terminates a worker that exceeds the startup timeout',
		async (provider) => {
			mockState.behavior.respondToInit = false;

			await expect(
				provider.create({ ...createProviderOptions(), startupTimeoutMs: 1 })
			).rejects.toMatchObject({ name: 'LanguageServerStartupTimeoutError' });

			expect(mockState.workers, provider.id).toHaveLength(1);
			expect(mockState.workers[0]?.terminateCalls, provider.id).toBe(1);
			expect(mockState.readers, provider.id).toHaveLength(0);
			expect(mockState.writers, provider.id).toHaveLength(0);
		}
	);

	it.each(editorLanguageServerProviders)(
		'$id does not create a worker for an already-aborted startup',
		async (provider) => {
			const controller = new AbortController();
			const reason = new DOMException(`${provider.id} startup cancelled`, 'AbortError');
			controller.abort(reason);

			await expect(
				provider.create({ ...createProviderOptions(), signal: controller.signal })
			).rejects.toBe(reason);
			expect(mockState.workers, provider.id).toHaveLength(0);
			expect(mockState.readers, provider.id).toHaveLength(0);
			expect(mockState.writers, provider.id).toHaveLength(0);
		}
	);
});
