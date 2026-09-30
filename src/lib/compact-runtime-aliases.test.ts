import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compactRuntimeAliases } from '../../scripts/compact-runtime-aliases.mjs';

const roots: string[] = [];
const scope = 'https://example.com/wasm-idle/';
const logical = 'wasm-awk/goawk.wasm';
const payload = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]);
const compressed = gzipSync(payload);

async function fixture() {
	const root = await mkdtemp(path.join(os.tmpdir(), 'wasm-idle-compact-'));
	roots.push(root);
	await mkdir(path.join(root, '_app'));
	await mkdir(path.join(root, 'wasm-awk'));
	const worker = await readFile('static/worker.js', 'utf8');
	await writeFile(path.join(root, 'worker.js'), worker);
	await writeFile(path.join(root, `${logical}.gz`), compressed);
	await writeFile(path.join(root, `${logical}.gz.bin`), compressed);
	return { root, worker };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function harness(root: string, contentDecoded = false) {
	let listener!: (event: {
		request: Request;
		respondWith: (response: Promise<Response>) => void;
	}) => void;
	const networkResponses = new Map<string, Response>();
	const fetchMock = vi.fn(async (input: Request | URL | string, init: RequestInit = {}) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const relative = url.pathname.slice(new URL(scope).pathname.length);
		const method = init.method ?? (input instanceof Request ? input.method : 'GET');
		const requestHeaders = new Headers(
			init.headers ?? (input instanceof Request ? input.headers : {})
		);
		if (relative === 'compressed-runtime-assets.v1.json') {
			return Response.json({ assets: [logical], sizes: { [logical]: payload.length } });
		}
		if (relative === 'layered-runtime-assets.v1.json') {
			return Response.json({ schemaVersion: 1, assets: {}, layers: {} });
		}
		const bytes = await readFile(path.join(root, relative)).catch(() => null);
		if (!bytes) return new Response(null, { status: 404 });
		const range = requestHeaders.get('range');
		const body = contentDecoded ? payload : range ? bytes.subarray(0, 8) : bytes;
		const headers = new Headers({
			'content-type': 'application/octet-stream',
			'content-length': String(body.length)
		});
		if (contentDecoded) headers.set('content-encoding', 'gzip');
		if (range) headers.set('content-range', `bytes 0-7/${bytes.length}`);
		const response = new Response(method === 'HEAD' ? null : Uint8Array.from(body), {
			status: range ? 206 : 200,
			headers
		});
		Object.defineProperty(response, 'url', { value: url.href });
		networkResponses.set(url.href, response);
		return response;
	});
	const source = await readFile(path.join(root, 'worker.js'), 'utf8');
	runInNewContext(source, {
		self: {
			registration: { scope },
			clients: { claim() {} },
			skipWaiting() {},
			addEventListener(type: string, callback: typeof listener) {
				if (type === 'fetch') listener = callback;
			}
		},
		fetch: fetchMock,
		URL,
		Headers,
		Request,
		Response,
		DecompressionStream,
		AbortController,
		Uint8Array,
		setTimeout,
		clearTimeout,
		console
	});
	return {
		fetchMock,
		networkResponses,
		request(relative: string, init?: RequestInit): Promise<Response> {
			return new Promise((resolve, reject) => {
				listener({
					request: new Request(new URL(relative, scope), init),
					respondWith: (response) => response.then(resolve, reject)
				});
			});
		}
	};
}

describe('opt-in generated runtime alias compaction', () => {
	it('only reports verified duplicates by default, preserving both public URLs', async () => {
		const { root, worker } = await fixture();
		const report = await compactRuntimeAliases(root);
		expect(report).toMatchObject({ compacted: false, removedBytes: compressed.length });
		expect(await readFile(path.join(root, `${logical}.gz`))).toEqual(compressed);
		expect(await readFile(path.join(root, 'worker.js'), 'utf8')).toBe(worker);
		await expect(
			readFile(path.join(root, 'compact-runtime-aliases.v1.json'))
		).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('removes only identical legacy gzip files and preserves a repeatable receipt', async () => {
		const { root } = await fixture();
		const report = await compactRuntimeAliases(root, { dropLegacyAliases: true });
		expect(report).toMatchObject({ compacted: true, removedBytes: compressed.length });
		expect(report.aliases).toEqual([
			{
				from: `${logical}.gz`,
				to: `${logical}.gz.bin`,
				bytes: compressed.length,
				sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
			}
		]);
		await expect(readFile(path.join(root, `${logical}.gz`))).rejects.toMatchObject({
			code: 'ENOENT'
		});
		expect(await readFile(path.join(root, `${logical}.gz.bin`))).toEqual(compressed);
		expect(await compactRuntimeAliases(root, { dropLegacyAliases: true })).toEqual(report);
	});

	it('resumes interrupted deletion only with the explicit flag', async () => {
		const { root } = await fixture();
		const report = await compactRuntimeAliases(root, { dropLegacyAliases: true });
		// Recreate the state after writing the worker and receipt but before deletion.
		await writeFile(path.join(root, `${logical}.gz`), compressed);
		await expect(compactRuntimeAliases(root)).rejects.toThrow(
			'Compact deletion is incomplete; rerun with --drop-legacy-aliases'
		);
		expect(await readFile(path.join(root, `${logical}.gz`))).toEqual(compressed);
		expect(await compactRuntimeAliases(root, { dropLegacyAliases: true })).toEqual(report);
		await expect(readFile(path.join(root, `${logical}.gz`))).rejects.toMatchObject({
			code: 'ENOENT'
		});
		expect(await readFile(path.join(root, `${logical}.gz.bin`))).toEqual(compressed);
	});

	it('verifies every remaining alias before resuming an interrupted deletion', async () => {
		const { root } = await fixture();
		const other = 'wasm-awk/other.gz';
		await writeFile(path.join(root, other), compressed);
		await writeFile(path.join(root, `${other}.bin`), compressed);
		await compactRuntimeAliases(root, { dropLegacyAliases: true });
		await writeFile(path.join(root, `${logical}.gz`), compressed);
		await writeFile(path.join(root, other), gzipSync('changed after receipt'));
		await expect(compactRuntimeAliases(root, { dropLegacyAliases: true })).rejects.toThrow(
			`Compact legacy asset changed: ${other}`
		);
		expect(await readFile(path.join(root, `${logical}.gz`))).toEqual(compressed);
		expect(await readFile(path.join(root, other))).toEqual(gzipSync('changed after receipt'));
	});

	it('rejects any byte mismatch before removing a different valid duplicate', async () => {
		const { root, worker } = await fixture();
		await writeFile(path.join(root, 'wasm-awk/other.gz'), compressed);
		await writeFile(path.join(root, 'wasm-awk/other.gz.bin'), gzipSync('different'));
		await expect(compactRuntimeAliases(root, { dropLegacyAliases: true })).rejects.toThrow(
			'bytes differ'
		);
		expect(await readFile(path.join(root, `${logical}.gz`))).toEqual(compressed);
		expect(await readFile(path.join(root, 'worker.js'), 'utf8')).toBe(worker);
	});

	it('rejects changed worker anchors, producer static inputs, and symlink aliases', async () => {
		const { root, worker } = await fixture();
		await writeFile(
			path.join(root, 'worker.js'),
			worker.replace('fetch(compressedUrl, {', 'fetch(otherUrl, {')
		);
		await expect(compactRuntimeAliases(root, { dropLegacyAliases: true })).rejects.toThrow(
			'Unsupported generated service worker'
		);
		expect(await readFile(path.join(root, `${logical}.gz`))).toEqual(compressed);
		await expect(
			compactRuntimeAliases(path.resolve('static'), { dropLegacyAliases: true })
		).rejects.toThrow('producer inputs');
		await writeFile(path.join(root, 'worker.js'), worker);
		await rm(path.join(root, `${logical}.gz`));
		await symlink(`${path.basename(logical)}.gz.bin`, path.join(root, `${logical}.gz`));
		await expect(compactRuntimeAliases(root, { dropLegacyAliases: true })).rejects.toThrow(
			'non-regular'
		);
		expect(await readFile(path.join(root, `${logical}.gz.bin`))).toEqual(compressed);
	});

	it('rejects canonical bytes changed after compaction', async () => {
		const { root } = await fixture();
		await compactRuntimeAliases(root, { dropLegacyAliases: true });
		await writeFile(path.join(root, `${logical}.gz.bin`), gzipSync('changed'));
		await expect(compactRuntimeAliases(root, { dropLegacyAliases: true })).rejects.toThrow(
			'canonical asset changed'
		);
	});

	it('serves controlled legacy gzip URLs with query, MIME, HEAD, and range semantics', async () => {
		const { root } = await fixture();
		await compactRuntimeAliases(root, { dropLegacyAliases: true });
		const server = await harness(root);
		const response = await server.request(`${logical}.gz?v=legacy`);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(compressed));
		expect(response.headers.get('content-type')).toBe('application/gzip');
		expect(server.networkResponses.has(`${scope}${logical}.gz.bin?v=legacy`)).toBe(true);
		const head = await server.request(`${logical}.gz`, { method: 'HEAD' });
		expect(head.body).toBeNull();
		expect(head.headers.get('content-length')).toBe(String(compressed.length));
		expect(server.fetchMock.mock.calls.at(-1)?.[1]?.method).toBe('HEAD');
		const range = await server.request(`${logical}.gz`, { headers: { range: 'bytes=0-7' } });
		expect(range.status).toBe(206);
		expect(range.headers.get('content-range')).toBe(`bytes 0-7/${compressed.length}`);
		expect(new Uint8Array(await range.arrayBuffer())).toEqual(
			new Uint8Array(compressed.subarray(0, 8))
		);
		// Static hosts cannot serve removed direct URLs before their worker takes control.
		expect((await server.fetchMock(`${scope}${logical}.gz`)).status).toBe(404);
	});

	it.each([false, true])(
		'keeps logical Wasm decompression working (HTTP content decoding: %s)',
		async (decoded) => {
			const { root } = await fixture();
			await compactRuntimeAliases(root, { dropLegacyAliases: true });
			const server = await harness(root, decoded);
			const response = await server.request(`${logical}?v=logical`);
			expect(new Uint8Array(await response.arrayBuffer())).toEqual(payload);
			expect(response.headers.get('content-type')).toBe('application/wasm');
			expect(response.headers.get('content-encoding')).toBeNull();
			expect(response.headers.get('content-length')).toBe(String(payload.length));
			expect(server.networkResponses.has(`${scope}${logical}.gz.bin?v=logical`)).toBe(true);
		}
	);

	it('preserves receipt-verified canonical Response identity and URL', async () => {
		const { root } = await fixture();
		await compactRuntimeAliases(root, { dropLegacyAliases: true });
		const server = await harness(root);
		const target = `${logical}.gz.bin?v=${'a'.repeat(64)}`;
		const response = await server.request(target, { credentials: 'omit' });
		expect(response).toBe(server.networkResponses.get(`${scope}${target}`));
		expect(response.url).toBe(`${scope}${target}`);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(compressed));
	});
});
