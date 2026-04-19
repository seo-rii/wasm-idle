import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');
export const DEFAULT_BROWSER_BASE_PATH = (() => {
	try {
		const source = readFileSync(path.join(REPO_ROOT, 'svelte.config.js'), 'utf8');
		const configuredBasePath = source.match(/base:\s*['"]([^'"]+)['"]/)?.[1];
		if (!configuredBasePath) {
			return '/absproxy/5173/';
		}
		const trimmedBasePath = configuredBasePath.replace(/^\/+|\/+$/g, '');
		return trimmedBasePath ? `/${trimmedBasePath}/` : '/';
	} catch {
		return '/absproxy/5173/';
	}
})();
const BROWSER_PREPARATION_LOCK_DIR = path.join(REPO_ROOT, '.svelte-kit', 'browser-preview-prep.lock');
const BROWSER_PROBE_SESSION_LOCK_DIR = path.join(
	REPO_ROOT,
	'.svelte-kit',
	'browser-probe-session.lock'
);
let browserPreparationQueue = Promise.resolve();
let browserProbeSessionQueue = Promise.resolve();

function createBrowserPreviewChildEnv() {
	const env = { ...process.env };
	delete env.NODE_ENV;
	for (const key of Object.keys(env)) {
		if (key.startsWith('VITEST')) delete env[key];
	}
	return env;
}

async function withFilesystemLock(lockDir, timeoutMs, action) {
	const lockStartedAt = Date.now();
	mkdirSync(path.dirname(lockDir), { recursive: true });
	while (true) {
		try {
			mkdirSync(lockDir, { recursive: false });
			break;
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!('code' in error) ||
				error.code !== 'EEXIST'
			) {
				throw error;
			}
			try {
				const lockStat = statSync(lockDir);
				if (Date.now() - lockStat.mtimeMs > timeoutMs) {
					rmSync(lockDir, { force: true, recursive: true });
					continue;
				}
			} catch {
				continue;
			}
			if (Date.now() - lockStartedAt > timeoutMs) {
				throw new Error(`timed out waiting for filesystem lock after ${timeoutMs}ms`);
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
	try {
		return await action();
	} finally {
		rmSync(lockDir, { force: true, recursive: true });
	}
}

/**
 * @param {string[]} scriptNames
 * @param {{ timeoutMs?: number }} options
 */
export async function runBrowserPreparationScripts(scriptNames, { timeoutMs = 300_000 } = {}) {
	const task = browserPreparationQueue.then(() =>
		withFilesystemLock(BROWSER_PREPARATION_LOCK_DIR, timeoutMs, async () => {
			for (const scriptName of scriptNames) {
				if (!scriptName) continue;
				const logs = [];
				const child = spawn('pnpm', ['run', scriptName], {
					cwd: REPO_ROOT,
					env: createBrowserPreviewChildEnv(),
					stdio: ['ignore', 'pipe', 'pipe']
				});
				child.stdout?.on('data', (chunk) => {
					logs.push(String(chunk).trimEnd());
				});
				child.stderr?.on('data', (chunk) => {
					logs.push(String(chunk).trimEnd());
				});
				await new Promise((resolve, reject) => {
					const timeout = setTimeout(() => {
						if (child.exitCode === null) child.kill('SIGTERM');
						reject(
							new Error(
								`pnpm run ${scriptName} timed out after ${timeoutMs}ms\n${logs.join('\n')}`
							)
						);
					}, timeoutMs);
					child.once('error', (error) => {
						clearTimeout(timeout);
						reject(error);
					});
					child.once('exit', (code) => {
						clearTimeout(timeout);
						if (code === 0) {
							resolve(undefined);
							return;
						}
						reject(
							new Error(
								`pnpm run ${scriptName} exited with code ${code ?? 'unknown'}\n${logs.join('\n')}`
							)
						);
					});
				});
			}
		})
	);
	browserPreparationQueue = task.catch(() => {});
	await task;
}

/**
 * @param {() => Promise<unknown>} action
 * @param {{ timeoutMs?: number }} options
 */
export async function runWithBrowserProbeSessionLock(action, { timeoutMs = 600_000 } = {}) {
	const task = browserProbeSessionQueue.then(() =>
		withFilesystemLock(BROWSER_PROBE_SESSION_LOCK_DIR, timeoutMs, action)
	);
	browserProbeSessionQueue = task.catch(() => {});
	return await task;
}

/**
 * @param {string} hostname
 */
function isLocalHost(hostname) {
	return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * @param {string} browserUrl
 */
export function shouldReuseProvidedBrowserUrl(browserUrl) {
	if (!browserUrl || process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW !== '1') {
		return false;
	}
	return isLocalHost(new URL(browserUrl).hostname);
}

/**
 * @param {string} url
 */
async function probeHttp(url) {
	return await new Promise((resolve, reject) => {
		const targetUrl = new URL(url);
		const request =
			targetUrl.protocol === 'https:' ? https.request(targetUrl) : http.request(targetUrl);
		request.once('response', (response) => {
			response.resume();
			resolve(response.statusCode || 0);
		});
		request.once('error', (error) => {
			if (!isLocalHost(targetUrl.hostname) || error?.code !== 'EPERM') {
				reject(error);
				return;
			}
			const curl = spawn('curl', ['-sS', '-o', '/dev/null', '-w', '%{http_code}', url], {
				stdio: ['ignore', 'pipe', 'pipe']
			});
			let stdout = '';
			let stderr = '';
			curl.stdout?.on('data', (chunk) => {
				stdout += String(chunk);
			});
			curl.stderr?.on('data', (chunk) => {
				stderr += String(chunk);
			});
			curl.once('exit', (code) => {
				if (code !== 0) {
					reject(
						new Error(
							stderr.trim() || `curl exited with code ${code ?? 'unknown'} while probing ${url}`
						)
					);
					return;
				}
				const statusCode = Number.parseInt(stdout.trim(), 10);
				if (!Number.isFinite(statusCode)) {
					reject(new Error(`failed to parse curl status while probing ${url}: ${stdout.trim()}`));
					return;
				}
				resolve(statusCode);
			});
		});
		request.end();
	});
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 * @param {import('node:child_process').ChildProcess | null} child
 * @param {string[]} logs
 */
async function waitForHttp(url, timeoutMs, child, logs) {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (child && child.exitCode !== null) {
			throw new Error(
				`preview server exited before becoming ready (exit=${child.exitCode})\n${logs.join('\n')}`
			);
		}
		try {
			const statusCode = await probeHttp(url);
			if (statusCode >= 200 && statusCode < 400) {
				return;
			}
		} catch {
			// Ignore connection errors until timeout.
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`timed out waiting for preview server at ${url}\n${logs.join('\n')}`);
}

/**
 * @param {{ origin?: string; basePath?: string; timeoutMs?: number; serverMode?: 'dev' | 'preview' }} options
 */
export async function startBrowserPreviewServer({
	origin = 'http://localhost:4173',
	basePath = DEFAULT_BROWSER_BASE_PATH,
	timeoutMs = 120_000,
	serverMode = 'dev'
} = {}) {
	const originUrl = new URL(origin);
	if (!isLocalHost(originUrl.hostname)) {
		return {
			origin: originUrl.origin,
			browserUrl: new URL(basePath, originUrl).toString(),
			close: async () => {}
		};
	}

	if (process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW === '1') {
		const reusedBrowserUrl = new URL(basePath, originUrl).toString();
		try {
			await waitForHttp(reusedBrowserUrl, 1_000, null, []);
			return {
				origin: originUrl.origin,
				browserUrl: reusedBrowserUrl,
				close: async () => {}
			};
		} catch {
			// Start a dedicated preview server below.
		}
	}

	const requestedPort = Number(originUrl.port || '4173');
	let previewPort = requestedPort;
	let foundPreviewPort = false;
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const candidatePort = requestedPort + attempt;
		const server = await new Promise((resolve) => {
			const probe = createServer();
			probe.unref();
			probe.once('error', () => resolve(null));
			probe.listen(candidatePort, originUrl.hostname, () => resolve(probe));
		});
		if (!server) continue;
		await new Promise((resolve) => server.close(() => resolve(undefined)));
		previewPort = candidatePort;
		foundPreviewPort = true;
		break;
	}
	if (!foundPreviewPort) {
		throw new Error(
			`failed to reserve a preview port starting at ${requestedPort} on ${originUrl.hostname}`
		);
	}
	const previewOrigin = `${originUrl.protocol}//${originUrl.hostname}:${previewPort}`;
	const browserUrl = new URL(basePath, previewOrigin).toString();

	/** @type {string[]} */
	const logs = [];
	const child = spawn(
		'pnpm',
		[
			'exec',
			'vite',
			serverMode,
			'--host',
			originUrl.hostname,
			'--port',
			String(previewPort),
			'--strictPort'
		],
		{
			cwd: REPO_ROOT,
			env: createBrowserPreviewChildEnv(),
			stdio: ['ignore', 'pipe', 'pipe']
		}
	);
	child.stdout?.on('data', (chunk) => {
		logs.push(String(chunk).trimEnd());
	});
	child.stderr?.on('data', (chunk) => {
		logs.push(String(chunk).trimEnd());
	});

	await waitForHttp(browserUrl, timeoutMs, child, logs);

	return {
		origin: previewOrigin,
		browserUrl,
		close: async () => {
			if (child.exitCode !== null) return;
			child.kill('SIGTERM');
			await new Promise((resolve) => {
				child.once('exit', () => resolve(undefined));
				setTimeout(() => {
					if (child.exitCode === null) child.kill('SIGKILL');
					resolve(undefined);
				}, 5_000);
			});
		}
	};
}
