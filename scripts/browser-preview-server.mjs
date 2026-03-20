import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const REPO_ROOT = path.resolve(THIS_DIR, '..');

/**
 * @param {string} hostname
 */
function isLocalHost(hostname) {
	return hostname === 'localhost' || hostname === '127.0.0.1';
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
			const response = await fetch(url, {
				redirect: 'manual'
			});
			if (response.ok || response.status === 304) {
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
 * @param {{ origin?: string; basePath?: string; timeoutMs?: number }} options
 */
export async function startBrowserPreviewServer({
	origin = 'http://localhost:4173',
	basePath = '/absproxy/5173/',
	timeoutMs = 120_000
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
			'dev',
			'--host',
			originUrl.hostname,
			'--port',
			String(previewPort),
			'--strictPort'
		],
		{
			cwd: REPO_ROOT,
			env: process.env,
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
