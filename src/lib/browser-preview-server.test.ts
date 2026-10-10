// @vitest-environment node

import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	DEFAULT_BROWSER_BASE_PATH,
	runBrowserPreparationScripts,
	shouldReuseProvidedBrowserUrl,
	startBrowserPreviewServer
} from '../../scripts/browser-preview-server.mjs';

const servers: http.Server[] = [];

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return { ...actual, spawn: vi.fn(actual.spawn) };
});

beforeEach(() => {
	vi.mocked(childProcess.spawn).mockReset();
	vi.stubEnv('WASM_IDLE_REUSE_LOCAL_PREVIEW', '0');
});

afterEach(async () => {
	delete process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
	vi.useRealTimers();
	vi.unstubAllEnvs();
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

function mockPreviewProcess() {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill: vi.fn((_signal: NodeJS.Signals) => true)
	});
	vi.mocked(childProcess.spawn).mockReturnValue(child as any);
	vi.spyOn(http, 'request').mockImplementation(() => {
		const request = Object.assign(new EventEmitter(), {
			end() {
				queueMicrotask(() => request.emit('response', { statusCode: 200, resume() {} }));
			}
		});
		return request as any;
	});
	return child;
}

describe('startBrowserPreviewServer', () => {
	it.each(['dev', 'preview'] as const)(
		'owns the installed Vite CLI process in %s mode and preserves launch options',
		async (serverMode) => {
			const child = mockPreviewProcess();
			vi.stubEnv('WASM_IDLE_REUSE_LOCAL_PREVIEW', '0');
			vi.stubEnv('NODE_ENV', 'test');
			vi.stubEnv('VITEST_PREVIEW_TEST', 'removed');
			vi.stubEnv('WASM_IDLE_PREVIEW_LIFECYCLE_TEST', 'preserved');
			const server = await startBrowserPreviewServer({
				origin: 'http://127.0.0.1:43573',
				basePath: '/preview-fixture/',
				serverMode
			});
			const repoRoot = path.resolve('.');
			const viteCliPath = path.join(
				path.dirname(createRequire(import.meta.url).resolve('vite/package.json')),
				'bin/vite.js'
			);
			expect(childProcess.spawn).toHaveBeenCalledWith(
				process.execPath,
				[
					viteCliPath,
					serverMode,
					...(serverMode === 'preview'
						? ['--config', path.join(repoRoot, 'scripts/release-preview.config.mjs')]
						: []),
					'--host',
					'127.0.0.1',
					'--port',
					'43573',
					'--strictPort'
				],
				expect.objectContaining({ cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] })
			);
			const env = vi.mocked(childProcess.spawn).mock.calls[0][2]?.env;
			expect(env?.WASM_IDLE_PREVIEW_LIFECYCLE_TEST).toBe('preserved');
			expect(env?.NODE_ENV).toBeUndefined();
			expect(env?.VITEST_PREVIEW_TEST).toBeUndefined();
			expect(process.env.NODE_ENV).toBe('test');
			expect(server.browserUrl).toBe('http://127.0.0.1:43573/preview-fixture/');
			child.emit('close', 0);
			await server.close();
		}
	);

	it('waits for output close after exit and clears its shutdown timer', async () => {
		const child = mockPreviewProcess();
		const server = await startBrowserPreviewServer({ origin: 'http://127.0.0.1:43574' });
		vi.useFakeTimers();
		let closed = false;
		const closing = server.close().then(() => {
			closed = true;
		});
		expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
		child.exitCode = 0;
		child.emit('exit', 0);
		await Promise.resolve();
		expect(closed).toBe(false);
		child.stdout.end();
		child.stderr.end();
		child.emit('close', 0);
		await closing;
		expect(vi.getTimerCount()).toBe(0);
		await server.close();
		expect(child.kill).toHaveBeenCalledTimes(1);
	});

	it('forces a stalled owned process to close and releases its output streams', async () => {
		const child = mockPreviewProcess();
		const server = await startBrowserPreviewServer({ origin: 'http://127.0.0.1:43575' });
		vi.useFakeTimers();
		child.kill.mockImplementation((signal) => {
			if (signal === 'SIGKILL') {
				child.signalCode = signal;
				child.emit('exit', null, signal);
				child.emit('close', null, signal);
			}
			return true;
		});
		const closing = server.close();
		await vi.advanceTimersByTimeAsync(5_000);
		await closing;
		expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']]);
		expect(child.stdout.destroyed).toBe(true);
		expect(child.stderr.destroyed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('closes inherited output pipes when the owned process has already exited', async () => {
		const child = mockPreviewProcess();
		const server = await startBrowserPreviewServer({ origin: 'http://127.0.0.1:43576' });
		vi.useFakeTimers();
		child.exitCode = 0;
		child.emit('exit', 0);
		child.stderr.once('close', () => child.emit('close', 0));
		const closing = server.close();
		await vi.advanceTimersByTimeAsync(5_000);
		await closing;
		expect(child.kill).not.toHaveBeenCalled();
		expect(child.stdout.destroyed).toBe(true);
		expect(child.stderr.destroyed).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('terminates its owned process when readiness times out', async () => {
		const child = mockPreviewProcess();
		vi.mocked(http.request).mockImplementation(() => {
			const request = Object.assign(new EventEmitter(), {
				end() {
					queueMicrotask(() =>
						request.emit('response', { statusCode: 503, resume() {} })
					);
				}
			});
			return request as any;
		});
		child.kill.mockImplementation((signal) => {
			child.signalCode = signal;
			queueMicrotask(() => child.emit('close', null, signal));
			return true;
		});
		await expect(
			startBrowserPreviewServer({ origin: 'http://127.0.0.1:43577', timeoutMs: 1 })
		).rejects.toThrow('timed out waiting for preview server');
		expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
	});

	it('runs requested preparation scripts in order', async () => {
		const invocations: Array<{ command: string; args: string[]; cwd: string | undefined }> = [];
		vi.mocked(childProcess.spawn).mockImplementation((command, args, options) => {
			invocations.push({
				command,
				args: (args || []).map(String),
				cwd: typeof options?.cwd === 'string' ? options.cwd : undefined
			});
			const child = new EventEmitter() as EventEmitter & {
				stdout: EventEmitter;
				stderr: EventEmitter;
				exitCode: number | null;
			};
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			child.exitCode = null;
			queueMicrotask(() => {
				child.exitCode = 0;
				child.emit('exit', 0);
			});
			return child as any;
		});

		await expect(
			runBrowserPreparationScripts(['sync:wasm-rust', 'build:preview'])
		).resolves.toBeUndefined();
		expect(invocations).toEqual([
			{
				command: 'pnpm',
				args: ['run', 'sync:wasm-rust'],
				cwd: expect.stringContaining('/wasm-idle')
			},
			{
				command: 'pnpm',
				args: ['run', 'build:preview'],
				cwd: expect.stringContaining('/wasm-idle')
			}
		]);
	});

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

	it('uses the configured Svelte base path when no explicit browser base path is provided', async () => {
		const previewServer = await startBrowserPreviewServer({
			origin: 'https://example.com'
		});

		expect(previewServer.origin).toBe('https://example.com');
		expect(previewServer.browserUrl).toBe(`https://example.com${DEFAULT_BROWSER_BASE_PATH}`);
		await expect(previewServer.close()).resolves.toBeUndefined();
	});
});
