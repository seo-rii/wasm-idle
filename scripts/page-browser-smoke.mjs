import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { disableBrowserPrewarm } from './browser-test-prewarm.mjs';
import { waitForEditorWorkspace } from './browser-editor-readiness.mjs';
import {
	runWithBrowserProbeSessionLock,
	startBrowserPreviewServer
} from './browser-preview-server.mjs';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Check delivery and rendering only; runtime qualification belongs to producer/change CI. */
export async function runPageBrowserSmoke() {
	const startedAt = Date.now();
	const deadline = startedAt + 45_000;
	const remaining = () => {
		assert(Date.now() < deadline, 'Page delivery smoke exceeded 45 seconds');
		return Math.max(1, Math.min(12_000, deadline - Date.now()));
	};
	const probes = [];
	for (const assetPath of ['worker.js', 'wasm-java-lsp/javacs-runtime.mjs']) {
		const bytes = await readFile(path.join(repoRoot, 'build', assetPath));
		assert(bytes.length <= 128 * 1024, 'Delivery smoke expects small assets: ' + assetPath);
		probes.push({ path: assetPath, bytes: bytes.length, sha256: sha256(bytes) });
	}
	const compact = await readFile(
		path.join(repoRoot, 'build/compact-runtime-aliases.v1.json'),
		'utf8'
	)
		.then(JSON.parse)
		.catch((error) => {
			if (error.code === 'ENOENT') return null;
			throw error;
		});
	if (compact?.compacted && compact.aliases.length) {
		const alias = [...compact.aliases].sort((a, b) => a.bytes - b.bytes)[0];
		if (alias.bytes <= 128 * 1024)
			probes.push({ path: alias.from, bytes: alias.bytes, sha256: alias.sha256 });
	}

	return runWithBrowserProbeSessionLock(
		async () => {
			const previousReuse = process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
			process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = '0';
			let server;
			let browser;
			let context;
			try {
				server = await startBrowserPreviewServer({
					origin: 'http://127.0.0.1:4587',
					serverMode: 'preview',
					timeoutMs: remaining()
				});
				browser = await chromium.launch({
					headless: true,
					executablePath: await resolveChromiumExecutable(
						process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
					),
					timeout: remaining(),
					args: ['--no-sandbox', '--disable-dev-shm-usage']
				});
				context = await browser.newContext({ serviceWorkers: 'allow' });
				await addBrowserTestCookies(context, server.browserUrl);
				await disableBrowserPrewarm(context);
				await context.addInitScript(() => {
					if (!localStorage.getItem('wasm-idle:example-workspace:v3'))
						localStorage.setItem(
							'wasm-idle:example-workspace:v3',
							JSON.stringify({
								version: 6,
								language: 'C',
								activePath: 'main.c',
								lspEnabled: false,
								files: [{ path: 'main.c', content: 'int main(void) { return 0; }' }]
							})
						);
				});
				const page = await context.newPage();
				const pageErrors = [];
				page.on('pageerror', (error) => pageErrors.push(error.message));
				page.setDefaultTimeout(remaining());
				const url = new URL(server.browserUrl);
				url.searchParams.set('lsp-test', '1');
				await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: remaining() });
				await waitForEditorWorkspace(page);
				assert.equal(await page.locator('#lsp-toggle').isChecked(), false);
				await page.waitForFunction(
					() => globalThis.crossOriginIsolated && navigator.serviceWorker?.controller,
					undefined,
					{ timeout: remaining() }
				);
				const app = await page.evaluate(() => ({
					bodyCharacters: document.body.textContent.trim().length,
					workerUrl: navigator.serviceWorker.controller.scriptURL
				}));
				assert(app.bodyCharacters > 20, 'The built application did not render');
				const worker = new URL(app.workerUrl);
				const expectedWorker = new URL('worker.js', server.browserUrl);
				assert.equal(worker.origin, expectedWorker.origin);
				assert.equal(worker.pathname, expectedWorker.pathname);
				const delivered = await page.evaluate(
					async ({ base, assets }) => {
						const results = [];
						for (const asset of assets) {
							const response = await fetch(new URL(asset.path, base), {
								cache: 'no-store',
								signal: AbortSignal.timeout(4_000)
							});
							if (!response.ok)
								throw new Error(`Asset HTTP ${response.status}: ${asset.path}`);
							const bytes = await response.arrayBuffer();
							const digest = new Uint8Array(
								await crypto.subtle.digest('SHA-256', bytes)
							);
							results.push({
								path: asset.path,
								bytes: bytes.byteLength,
								sha256: [...digest]
									.map((value) => value.toString(16).padStart(2, '0'))
									.join('')
							});
						}
						return results;
					},
					{ base: server.browserUrl, assets: probes }
				);
				assert.deepEqual(delivered, probes, 'Browser asset size/SHA-256 mismatch');
				assert.deepEqual(pageErrors, [], 'The built application raised page errors');
				remaining();
				return {
					status: 'verified',
					elapsedMs: Date.now() - startedAt,
					workspaceReady: true,
					crossOriginIsolated: true,
					assets: probes.length
				};
			} finally {
				try {
					if (context) await context.close();
				} finally {
					try {
						if (browser) await browser.close();
					} finally {
						if (server) await server.close();
						if (previousReuse === undefined)
							delete process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW;
						else process.env.WASM_IDLE_REUSE_LOCAL_PREVIEW = previousReuse;
					}
				}
			}
		},
		{ timeoutMs: 5_000 }
	);
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
	try {
		if (process.argv.length > 2) throw new Error('Usage: node scripts/page-browser-smoke.mjs');
		console.log(JSON.stringify(await runPageBrowserSmoke()));
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
