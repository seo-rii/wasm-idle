import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	TINYGO_EXECUTABLE_GRAPH_FORMAT,
	canonicalTinyGoExecutableGraphProfile,
	loadVerifiedTinyGoExecutableGraph,
	snapshotTinyGoExecutableGraphProfile,
	type TinyGoExecutableGraphImport,
	type TinyGoExecutableGraphProfile
} from './tinygoExecutableGraph';

const encoder = new TextEncoder();
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type MutableTinyGoExecutableGraphProfile = {
	schemaVersion: 1;
	format: typeof TINYGO_EXECUTABLE_GRAPH_FORMAT;
	entryPath: string;
	fingerprint: string;
	modules: Record<
		string,
		{
			bytes: number;
			sha256: string;
			imports: Array<{
				specifier: string;
				target: string;
				kind: TinyGoExecutableGraphImport['kind'];
			}>;
		}
	>;
};

const imports = {
	'upstream.js': [{ specifier: 'assets/worker.js', target: 'assets/worker.js', kind: 'worker' }],
	'assets/worker.js': [
		{ specifier: './compiler.js', target: 'assets/compiler.js', kind: 'dynamic' }
	],
	'assets/compiler.js': [
		{ specifier: './shared.js', target: 'assets/shared.js', kind: 'static' },
		{ specifier: './node.js', target: 'assets/node.js', kind: 'dynamic' }
	],
	'assets/node.js': [{ specifier: './shared.js', target: 'assets/shared.js', kind: 'static' }],
	'assets/shared.js': []
} as const satisfies Record<string, readonly TinyGoExecutableGraphImport[]>;

const sources: Record<keyof typeof imports, string> = {
	'upstream.js':
		'export const start=()=>new Worker(new URL("assets/worker.js",import.meta.url),{type:"module"});',
	'assets/worker.js': 'export const run=()=>import("./compiler.js");',
	'assets/compiler.js':
		'import shared from "./shared.js";export const load=()=>import("./node.js");export{shared};',
	'assets/node.js': 'import shared from "./shared.js";export default shared;',
	'assets/shared.js': 'export default 1;'
};

function createProfile(
	sourceOverrides: Partial<typeof sources> = {}
): TinyGoExecutableGraphProfile {
	const resolvedSources = { ...sources, ...sourceOverrides };
	const modules = Object.fromEntries(
		Object.keys(imports).map((modulePath) => {
			const bytes = encoder.encode(resolvedSources[modulePath as keyof typeof sources]);
			return [
				modulePath,
				{
					bytes: bytes.byteLength,
					sha256: sha256(bytes),
					imports: imports[modulePath as keyof typeof imports]
				}
			];
		})
	);
	const provisional: TinyGoExecutableGraphProfile = {
		schemaVersion: 1,
		format: TINYGO_EXECUTABLE_GRAPH_FORMAT,
		entryPath: 'upstream.js',
		fingerprint: '0'.repeat(64),
		modules
	};
	return {
		...provisional,
		fingerprint: sha256(canonicalTinyGoExecutableGraphProfile(provisional))
	};
}

function createFetch(
	profile: TinyGoExecutableGraphProfile,
	overrides: {
		body?: (modulePath: string) => Uint8Array;
		responseUrl?: (requestUrl: string) => string;
		contentLength?: (modulePath: string, bytes: Uint8Array) => string;
	} = {}
) {
	return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
		const requestUrl = String(input);
		const url = new URL(requestUrl);
		const modulePath = url.pathname.slice('/mirror/'.length);
		const bytes =
			overrides.body?.(modulePath) ??
			encoder.encode(sources[modulePath as keyof typeof sources]);
		const responseBody = new ArrayBuffer(bytes.byteLength);
		new Uint8Array(responseBody).set(bytes);
		const response = new Response(responseBody, {
			status: 200,
			headers: {
				'content-length':
					overrides.contentLength?.(modulePath, bytes) ?? String(bytes.byteLength),
				'content-type': 'text/javascript; charset=utf-8'
			}
		});
		Object.defineProperty(response, 'url', {
			value: overrides.responseUrl?.(requestUrl) ?? requestUrl
		});
		if (!profile.modules[modulePath]) throw new Error(`unexpected module ${modulePath}`);
		return response;
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('TinyGo executable graph', () => {
	it('verifies all receipts and rewrites the complete graph to owned Blob URLs', async () => {
		const profile = createProfile();
		const fetch = createFetch(profile);
		const blobs: Blob[] = [];
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (!(blob instanceof Blob)) throw new TypeError('expected a Blob module');
			blobs.push(blob);
			return `blob:https://app.test/${blobs.length}`;
		});
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

		const graph = await loadVerifiedTinyGoExecutableGraph({
			moduleUrl: 'https://cdn.test/mirror/upstream.js',
			profile,
			fetch
		});

		expect(fetch).toHaveBeenCalledTimes(5);
		for (const [input, init] of fetch.mock.calls) {
			const requestUrl = new URL(String(input));
			const modulePath = requestUrl.pathname.slice('/mirror/'.length);
			expect(requestUrl.search).toBe(`?v=${profile.modules[modulePath]!.sha256}`);
			expect(init).toMatchObject({
				cache: 'no-store',
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer'
			});
		}
		expect(createObjectURL).toHaveBeenCalledTimes(5);
		expect(graph.entryUrl).toBe('blob:https://app.test/5');
		expect(graph.assetBaseUrl).toBe('https://cdn.test/mirror/');
		expect(await blobs[1]!.text()).toContain('blob:https://app.test/1');
		expect(await blobs[2]!.text()).toContain('blob:https://app.test/1');
		expect(await blobs[2]!.text()).toContain('blob:https://app.test/2');
		expect(await blobs[3]!.text()).toContain('blob:https://app.test/3');
		expect(await blobs[4]!.text()).toContain('blob:https://app.test/4');

		graph.dispose();
		graph.dispose();
		expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([
			'blob:https://app.test/5',
			'blob:https://app.test/4',
			'blob:https://app.test/3',
			'blob:https://app.test/2',
			'blob:https://app.test/1'
		]);
	});

	it('rejects corrupt bytes before creating any Blob URL', async () => {
		const profile = createProfile();
		const createObjectURL = vi.spyOn(URL, 'createObjectURL');

		await expect(
			loadVerifiedTinyGoExecutableGraph({
				moduleUrl: 'https://cdn.test/mirror/upstream.js',
				profile,
				fetch: createFetch(profile, {
					body: (modulePath) =>
						modulePath === 'upstream.js'
							? encoder.encode('corrupt')
							: encoder.encode(sources[modulePath as keyof typeof sources])
				})
			})
		).rejects.toThrow(/size mismatch|SHA-256 mismatch/u);
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('requires exact non-empty final response URLs before creating Blob URLs', async () => {
		const profile = createProfile();
		const createObjectURL = vi.spyOn(URL, 'createObjectURL');

		await expect(
			loadVerifiedTinyGoExecutableGraph({
				moduleUrl: 'https://cdn.test/mirror/upstream.js',
				profile,
				fetch: createFetch(profile, { responseUrl: () => '' })
			})
		).rejects.toThrow('did not expose an exact final URL');
		expect(createObjectURL).not.toHaveBeenCalled();
	});

	it('cleans up leaf Blob URLs when a declared specifier is not present exactly once', async () => {
		const profile = createProfile({
			'upstream.js': 'export const start=()=>undefined;'
		});
		const blobs: Blob[] = [];
		vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
			if (!(blob instanceof Blob)) throw new TypeError('expected a Blob module');
			blobs.push(blob);
			return `blob:https://app.test/${blobs.length}`;
		});
		const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

		await expect(
			loadVerifiedTinyGoExecutableGraph({
				moduleUrl: 'https://cdn.test/mirror/upstream.js',
				profile,
				fetch: createFetch(profile, {
					body: (modulePath) =>
						encoder.encode(
							modulePath === 'upstream.js'
								? 'export const start=()=>undefined;'
								: sources[modulePath as keyof typeof sources]
						)
				})
			})
		).rejects.toThrow('must contain import assets/worker.js exactly once');
		expect(blobs).toHaveLength(4);
		expect(revokeObjectURL).toHaveBeenCalledTimes(4);
	});

	it('rejects incomplete, unreachable, cyclic, and duplicate-edge profiles', () => {
		const profile = createProfile();
		const withUnknownTarget = structuredClone(profile) as MutableTinyGoExecutableGraphProfile;
		withUnknownTarget.modules['assets/worker.js']!.imports[0]!.target = 'assets/missing.js';
		expect(() => snapshotTinyGoExecutableGraphProfile(withUnknownTarget)).toThrow(
			'does not resolve'
		);

		const withUnreachable = structuredClone(profile) as MutableTinyGoExecutableGraphProfile;
		withUnreachable.modules['assets/unreachable.js'] = {
			bytes: 1,
			sha256: 'a'.repeat(64),
			imports: []
		};
		expect(() => snapshotTinyGoExecutableGraphProfile(withUnreachable)).toThrow(
			'unreachable modules'
		);

		const withCycle = structuredClone(profile) as MutableTinyGoExecutableGraphProfile;
		withCycle.modules['assets/shared.js']!.imports.push({
			specifier: '../upstream.js',
			target: 'upstream.js',
			kind: 'dynamic'
		});
		expect(() => snapshotTinyGoExecutableGraphProfile(withCycle)).toThrow('contains a cycle');

		const withDuplicate = structuredClone(profile) as MutableTinyGoExecutableGraphProfile;
		withDuplicate.modules['assets/worker.js']!.imports.push({
			...withDuplicate.modules['assets/worker.js']!.imports[0]!
		});
		expect(() => snapshotTinyGoExecutableGraphProfile(withDuplicate)).toThrow(
			'duplicate import specifier'
		);
	});

	it('rejects a stale entry query pin before fetching', async () => {
		const profile = createProfile();
		const fetch = createFetch(profile);
		await expect(
			loadVerifiedTinyGoExecutableGraph({
				moduleUrl: `https://cdn.test/mirror/upstream.js?v=${'f'.repeat(64)}`,
				profile,
				fetch
			})
		).rejects.toThrow('must use its exact receipt query pin');
		expect(fetch).not.toHaveBeenCalled();
	});
});
