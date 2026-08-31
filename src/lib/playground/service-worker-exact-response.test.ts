import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { WASM_RUST_EXECUTABLE_GRAPH_PROFILE } from './wasmRustVersion';

const serviceWorkerSource = await readFile(path.resolve('static/worker.js'), 'utf8');
const scope = 'https://example.com/wasm-idle/';
const receipt = 'a'.repeat(64);

type ExactResponseRuntimeContract = {
	runtime: string;
	assetPaths: readonly string[];
	assetReceipts?: Readonly<Record<string, string>>;
};

// Keep the runtime grouping data-driven so receipt-backed Rust graph deliveries can be
// added as another contract once their generated profile is available.
const exactResponseRuntimeContracts: readonly ExactResponseRuntimeContract[] = [
	{
		runtime: 'AWK',
		assetPaths: [
			'wasm-awk/goawk.wasm.gz.bin',
			'wasm-awk/runner-worker.v2.js',
			'wasm-awk/runtime-manifest.v2.json',
			'wasm-awk/wasm_exec.js'
		]
	},
	{
		runtime: 'TinyGo',
		assetPaths: [
			'wasm-tinygo/upstream.js',
			'wasm-tinygo/assets/upstream-compile-worker-CFw6Ych6.js',
			'wasm-tinygo/assets/upstream-compile-worker-Dat9LBTc.js',
			'wasm-tinygo/assets/upstream-compile-worker-NPJcbr3r.js',
			'wasm-tinygo/assets/upstream-compile-worker-R7P8Uy5f.js'
		]
	},
	{
		runtime: 'Rust',
		assetPaths: Object.values(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules).map(
			(module) => `wasm-rust/${module.delivery.storagePath}`
		),
		assetReceipts: Object.fromEntries(
			Object.values(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules).map((module) => [
				`wasm-rust/${module.delivery.storagePath}`,
				module.storage.sha256
			])
		)
	}
];

type FetchListener = (event: {
	request: Request;
	respondWith(response: Promise<Response | undefined>): void;
}) => void;

function createServiceWorkerHarness() {
	const listeners = new Map<string, FetchListener[]>();
	const fetchedResponses = new Map<string, Response>();
	const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.href === `${scope}compressed-runtime-assets.v1.json`) {
			return new Response(JSON.stringify({ assets: [], sizes: {} }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (url.href === `${scope}layered-runtime-assets.v1.json`) {
			return new Response(JSON.stringify({ schemaVersion: 1, assets: {}, layers: {} }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}

		const response = new Response('network response', {
			status: 200,
			headers: { 'x-network-response': 'true' }
		});
		Object.defineProperty(response, 'url', { value: url.href });
		fetchedResponses.set(url.href, response);
		return response;
	});
	const workerSelf = {
		addEventListener(type: string, listener: FetchListener) {
			const registered = listeners.get(type) ?? [];
			registered.push(listener);
			listeners.set(type, registered);
		},
		clients: { claim: vi.fn() },
		registration: { scope },
		skipWaiting: vi.fn()
	};

	runInNewContext(serviceWorkerSource, {
		Date,
		DecompressionStream,
		Headers,
		Request,
		Response,
		URL,
		caches: { open: vi.fn() },
		console,
		fetch: fetchMock,
		self: workerSelf
	});

	const fetchListener = listeners.get('fetch')?.[0];
	if (!fetchListener) throw new Error('service worker did not register a fetch listener');

	return {
		async request(input: string, init?: RequestInit, destination = '') {
			const request = new Request(new URL(input, scope), {
				credentials: 'omit',
				...init
			});
			Object.defineProperty(request, 'destination', { value: destination });
			let responsePromise: Promise<Response | undefined> | undefined;
			fetchListener({
				request,
				respondWith(response) {
					responsePromise = Promise.resolve(response);
				}
			});
			if (!responsePromise) throw new Error('service worker did not respond to the request');
			const response = await responsePromise;
			if (!response) throw new Error('service worker response failed');
			const fetchedResponse = fetchedResponses.get(request.url);
			if (!fetchedResponse)
				throw new Error(`network response was not fetched for ${request.url}`);
			return { fetchedResponse, response };
		}
	};
}

describe('service worker exact network responses', () => {
	it.each(
		exactResponseRuntimeContracts.flatMap(({ runtime, assetPaths, assetReceipts }) =>
			assetPaths.map((assetPath) => ({
				assetPath,
				assetReceipt: assetReceipts?.[assetPath] ?? receipt,
				runtime
			}))
		)
	)(
		'preserves the fetched $runtime response object for $assetPath',
		async ({ assetPath, assetReceipt }) => {
			const harness = createServiceWorkerHarness();
			const { fetchedResponse, response } = await harness.request(
				`${assetPath}?v=${assetReceipt}`
			);

			expect(response).toBe(fetchedResponse);
			expect(response.headers.get('cross-origin-embedder-policy')).toBeNull();
			expect(response.headers.get('cross-origin-opener-policy')).toBeNull();
		}
	);

	it('clones a Rust graph response whose receipt does not match its exact storage path', async () => {
		const [module] = Object.values(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules);
		if (!module) throw new Error('Rust executable graph fixture is empty');
		const assetPath = `wasm-rust/${module.delivery.storagePath}`;
		const wrongReceipt = module.storage.sha256 === receipt ? 'b'.repeat(64) : receipt;
		const harness = createServiceWorkerHarness();
		const { fetchedResponse, response } = await harness.request(
			`${assetPath}?v=${wrongReceipt}`
		);

		expect(response).not.toBe(fetchedResponse);
		expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
		expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
	});

	it('clones an obsolete Rust executable URL even when its receipt matches', async () => {
		const entry = Object.entries(WASM_RUST_EXECUTABLE_GRAPH_PROFILE.modules).find(
			([modulePath, module]) => module.delivery.storagePath === `${modulePath}.bin`
		);
		if (!entry) throw new Error('Rust executable graph has no identity fixture');
		const [modulePath, module] = entry;
		const harness = createServiceWorkerHarness();
		const { fetchedResponse, response } = await harness.request(
			`wasm-rust/${modulePath}?v=${module.storage.sha256}`
		);

		expect(response).not.toBe(fetchedResponse);
		expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
		expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
	});

	it.each([
		{
			case: 'POST',
			input: `wasm-awk/wasm_exec.js?v=${receipt}`,
			init: { method: 'POST' }
		},
		{
			case: 'an extra query parameter',
			input: `wasm-awk/wasm_exec.js?v=${receipt}&extra=1`
		},
		{
			case: 'a duplicate receipt query parameter',
			input: `wasm-awk/wasm_exec.js?v=${receipt}&v=${receipt}`
		},
		{
			case: 'an uppercase receipt',
			input: `wasm-awk/wasm_exec.js?v=${receipt.toUpperCase()}`
		},
		{
			case: 'a matching basename outside the service worker scope',
			input: `https://example.com/wasm-awk/wasm_exec.js?v=${receipt}`
		},
		{
			case: 'an otherwise matching cross-origin path',
			input: `https://cdn.example.com/wasm-idle/wasm-awk/wasm_exec.js?v=${receipt}`
		},
		{
			case: 'an unlisted in-scope path',
			input: `wasm-awk/unlisted.js?v=${receipt}`
		},
		{
			case: 'a range request',
			input: `wasm-awk/wasm_exec.js?v=${receipt}`,
			init: { headers: { range: 'bytes=0-10' } }
		},
		{
			case: 'an authenticated request',
			input: `wasm-awk/wasm_exec.js?v=${receipt}`,
			init: { credentials: 'same-origin' }
		},
		{
			case: 'a script destination',
			input: `wasm-awk/wasm_exec.js?v=${receipt}`,
			destination: 'script'
		}
	])('clones the network response for $case', async ({ input, init, destination }) => {
		const harness = createServiceWorkerHarness();
		const { fetchedResponse, response } = await harness.request(
			input,
			init as RequestInit | undefined,
			destination
		);

		expect(response).not.toBe(fetchedResponse);
		expect(response.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
		expect(response.headers.get('cross-origin-opener-policy')).toBe('same-origin');
	});
});
