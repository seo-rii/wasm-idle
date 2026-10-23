#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function runLean4LspBrowserProbe() {
	const bundles = await build({
		absWorkingDir: root,
		entryPoints: {
			client: 'scripts/lean4-lsp-browser-client.js',
			worker: 'packages/lsp/dist/lean4/worker.js'
		},
		nodePaths: [path.join(root, 'packages/lsp/node_modules')],
		outdir: 'browser',
		bundle: true,
		write: false,
		platform: 'browser',
		format: 'esm',
		target: 'es2022',
		tsconfigRaw: { compilerOptions: { target: 'ES2022' } }
	});
	const scripts = new Map(
		bundles.outputFiles.map((file) => ['/' + path.basename(file.path), file.contents])
	);
	scripts.set(
		'/runtime-worker.js',
		await readFile(path.join(root, 'packages/lsp/dist/lean4/runtime-worker.js'))
	);
	const requests = [];
	const server = createServer(async (req, res) => {
		res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
		res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
		res.setHeader(
			'Content-Security-Policy',
			"default-src 'none'; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; connect-src 'self'"
		);
		try {
			const url = new URL(req.url, 'http://localhost');
			if (url.pathname === '/') {
				res.setHeader('Content-Type', 'text/html');
				res.end('<!doctype html>Lean 4 SDK probe');
				return;
			}
			if (scripts.has(url.pathname)) {
				res.setHeader('Content-Type', 'text/javascript');
				res.end(scripts.get(url.pathname));
				return;
			}
			if (!/^\/wasm-lean4\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
				res.writeHead(404);
				res.end();
				return;
			}
			requests.push(url.pathname + url.search);
			res.setHeader(
				'Content-Type',
				url.pathname.endsWith('.json')
					? 'application/json'
					: url.pathname.endsWith('.mjs')
						? 'text/javascript'
						: 'application/octet-stream'
			);
			res.end(await readFile(path.join(root, 'static', url.pathname)));
		} catch {
			res.writeHead(404);
			res.end();
		}
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = 'http://127.0.0.1:' + server.address().port;
	let browser, timer;
	try {
		browser = await chromium.launch({
			headless: true,
			executablePath: await resolveChromiumExecutable('')
		});
		const context = await browser.newContext();
		await addBrowserTestCookies(context, origin);
		await context.addInitScript(() => {
			globalThis.__leanWorkerOwnership = [];
			const OriginalWorker = globalThis.Worker;
			globalThis.Worker = class extends OriginalWorker {
				constructor(url, options) {
					super(url, options);
					this.traceId = globalThis.__leanWorkerOwnership.length;
					globalThis.__leanWorkerOwnership.push({
						id: this.traceId,
						url: String(url),
						name: options?.name
					});
				}
				terminate() {
					globalThis.__leanWorkerOwnership[this.traceId].terminated = true;
					return super.terminate();
				}
			};
		});
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(e.stack));
		page.on('console', (m) => {
			if (
				m.type() === 'error' ||
				m.type() === 'warning' ||
				m.text().startsWith('lean-probe-phase')
			)
				console.log('browser', m.text().slice(0, 1000));
		});
		await page.goto(origin);
		const cdp = await context.newCDPSession(page);
		const workers = async () =>
			(await cdp.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'worker');
		const result = await Promise.race([
			page.evaluate(async () => {
				const probe = await import('/client.js');
				return {
					sdk: await probe.runLean4SdkBrowserProbe(),
					lifecycle: await probe.runLean4LifecycleProbe()
				};
			}),
			new Promise(
				(_, reject) =>
					(timer = setTimeout(
						() => reject(Error('Lean SDK browser deadline exceeded.')),
						300000
					))
			)
		]);
		await page.waitForTimeout(5000);
		result.workerOwnership = await page.evaluate(() => globalThis.__leanWorkerOwnership);
		result.remainingWorkerTargets = await workers();
		result.workersAfterDispose = result.remainingWorkerTargets.length;
		result.requests = requests;
		result.pageErrors = errors;
		const lock = JSON.parse(
			await readFile(path.join(root, 'scripts/wasm-lean4-assets.lock.json'), 'utf8')
		);
		if (requests.length !== Object.keys(lock.assets).length)
			throw Error('Verified Lean assets were fetched again instead of reused.');
		for (const request of requests) {
			const url = new URL(request, origin);
			if (url.search !== '?v=' + lock.assets[path.basename(url.pathname)].sha256)
				throw Error('Lean browser asset request was not bound to the reviewed receipt.');
		}
		const evidence =
			process.env.LEAN4_LSP_BROWSER_EVIDENCE ||
			path.join(root, '.cache/lean4-lsp-sdk-evidence.json');
		await mkdir(path.dirname(evidence), { recursive: true });
		await writeFile(evidence, JSON.stringify(result, null, 2));
		if (result.workersAfterDispose || errors.length)
			throw Error(
				'Lean worker cleanup or page errors: ' +
					JSON.stringify({
						workersAfterDispose: result.workersAfterDispose,
						errors,
						evidence
					})
			);
		console.log(
			JSON.stringify({
				elapsedMs: result.sdk.elapsedMs,
				requests: requests.length,
				workersAfterDispose: result.workersAfterDispose,
				lifecycle: result.lifecycle,
				evidence
			})
		);
		return result;
	} finally {
		clearTimeout(timer);
		await browser?.close();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
	await runLean4LspBrowserProbe();
