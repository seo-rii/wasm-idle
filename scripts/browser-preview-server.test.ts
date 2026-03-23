import { EventEmitter } from 'node:events';
import http from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from './browser-preview-server.mjs';

const servers: http.Server[] = [];

afterEach(async () => {
	delete process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
	vi.restoreAllMocks();
	await Promise.all(
		servers.splice(0).map(
			(server) =>
				new Promise((resolve) => {
					server.close(() => resolve(undefined));
				})
		)
	);
});

describe('startBrowserPreviewServer', () => {
	it('reuses an explicitly provided localhost browser url only when reuse mode is enabled', () => {
		expect(shouldReuseProvidedBrowserUrl('http://localhost:4173/absproxy/5173/')).toBe(false);
		process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = '1';
		expect(shouldReuseProvidedBrowserUrl('http://localhost:4173/absproxy/5173/')).toBe(true);
		expect(shouldReuseProvidedBrowserUrl('http://127.0.0.1:4173/absproxy/5173/')).toBe(true);
		expect(shouldReuseProvidedBrowserUrl('https://example.com/absproxy/5173/')).toBe(false);
	});

	it('reuses an already-running localhost preview without spawning a new vite server', async () => {
		const server = http.createServer((_request, response) => {
			response.writeHead(200, { 'content-type': 'text/html' });
			response.end('<!doctype html><title>ready</title>');
		});
		servers.push(server);
		await new Promise((resolve) => {
			server.listen(43173, 'localhost', () => resolve(undefined));
		});
		process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = '1';

		const previewServer = await startBrowserPreviewServer({
			origin: 'http://localhost:43173',
			basePath: '/'
		});

		expect(previewServer.origin).toBe('http://localhost:43173');
		expect(previewServer.browserUrl).toBe('http://localhost:43173/');
		await expect(previewServer.close()).resolves.toBeUndefined();
	});

	it('falls back to curl when the local node http probe is denied with EPERM', async () => {
		const server = http.createServer((_request, response) => {
			response.writeHead(200, { 'content-type': 'text/html' });
			response.end('<!doctype html><title>ready</title>');
		});
		servers.push(server);
		await new Promise((resolve) => {
			server.listen(43174, '127.0.0.1', () => resolve(undefined));
		});
		process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = '1';
		vi.spyOn(http, 'request').mockImplementation(() => {
			const request = new EventEmitter() as EventEmitter & { end: () => void };
			request.end = () => {
				queueMicrotask(() => {
					request.emit('error', Object.assign(new Error('denied'), { code: 'EPERM' }));
				});
			};
			return request as any;
		});

		const previewServer = await startBrowserPreviewServer({
			origin: 'http://127.0.0.1:43174',
			basePath: '/'
		});

		expect(previewServer.origin).toBe('http://127.0.0.1:43174');
		expect(previewServer.browserUrl).toBe('http://127.0.0.1:43174/');
		await expect(previewServer.close()).resolves.toBeUndefined();
	});
});
