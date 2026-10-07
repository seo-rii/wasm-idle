// Run against an already prepared local Vite server; this probe never builds or publishes assets.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { DEFAULT_BROWSER_BASE_PATH } from './browser-preview-server.mjs';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';

const options = Object.fromEntries(
	process.argv.slice(2).map((argument) => {
		const [name, ...value] = argument.replace(/^--/u, '').split('=');
		return [name, value.join('=')];
	})
);
const baseUrl = new URL(
	options.url || `http://127.0.0.1:5191${DEFAULT_BROWSER_BASE_PATH}`
).href.replace(/\/?$/u, '/');
const modes = (options.modes || 'default,session').split(',');
const networks = (options.networks || 'local,constrained').split(',');
const timeoutMs = 180_000;
const report = {
	measuredAt: new Date().toISOString(),
	browser: 'Chromium',
	validationComplete: false,
	assetSource: 'shipped static/clang artifacts',
	baseUrl,
	workload: 'C++20 <bits/stdc++.h>, vector accumulation, stdout; changed source in every phase',
	transferMetric:
		'CDP encodedDataLength for /clang/ responses, including response headers; HTTP cache disabled',
	networkProfiles: {
		local: { latencyMs: 0, downloadBytesPerSecond: null },
		constrained: { latencyMs: 50, downloadBytesPerSecond: 1_250_000 }
	},
	measurements: []
};
const browser = await chromium.launch({
	headless: true,
	executablePath: await resolveChromiumExecutable(process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || '')
});
report.browserVersion = browser.version();
try {
	for (const mode of modes) {
		assert.ok(['default', 'session'].includes(mode), `unknown mode ${mode}`);
		for (const network of networks) {
			assert.ok(['local', 'constrained'].includes(network), `unknown network ${network}`);
			const context = await browser.newContext();
			try {
				await addBrowserTestCookies(context, baseUrl);
				await context.addInitScript(() => {
					window.__pchWorkerKeys = [];
					window.Worker = new Proxy(Worker, {
						construct(Target, args) {
							const worker = Reflect.construct(Target, args);
							worker.addEventListener('message', ({ data }) => {
								const key =
									data.precompiledHeaderKey ||
									data.precompiledHeader?.key ||
									data.header?.key;
								if (key)
									window.__pchWorkerKeys.push({
										kind: data.precompiledHeaderKey ? 'requested' : 'built',
										identity: JSON.parse(key)
									});
							});
							return worker;
						}
					});
				});
				const application = await context.request.get(baseUrl, { timeout: timeoutMs });
				assert.equal(application.status(), 200);
				const bootstrap = (await application.text()).match(
					/\b__sveltekit_[a-zA-Z0-9_]+\s*=\s*\{[\s\S]*?\n\s*\};/u
				)?.[0];
				assert.ok(bootstrap, 'SvelteKit public-env bootstrap missing');
				const harnessUrl = new URL('__persistent-pch-probe__', baseUrl).href;
				await context.route('**/*', async (route) => {
					if (route.request().url() !== harnessUrl) return route.continue();
					return route.fulfill({
						status: 200,
						headers: {
							'Content-Type': 'text/html',
							'Cache-Control': 'no-store',
							'Cross-Origin-Opener-Policy': 'same-origin',
							'Cross-Origin-Embedder-Policy': 'require-corp'
						},
						body: `<!doctype html><title>Persistent PCH Chromium probe</title><script>${bootstrap}</script>`
					});
				});
				const page = await context.newPage();
				const errors = [];
				page.on('pageerror', (error) => errors.push(error.message));
				const cdp = await context.newCDPSession(page);
				await cdp.send('Network.enable');
				await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
				if (network === 'constrained')
					await cdp.send('Network.emulateNetworkConditions', {
						offline: false,
						latency: 50,
						downloadThroughput: 1_250_000,
						uploadThroughput: 1_250_000,
						connectionType: 'cellular3g'
					});
				const requests = new Map();
				let transferBytes = 0;
				let assetResponses = [];
				cdp.on('Network.responseReceived', ({ requestId, response }) => {
					if (
						new URL(response.url).pathname.startsWith(
							`${new URL(baseUrl).pathname}clang/`
						)
					)
						requests.set(requestId, response.url);
				});
				cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
					const url = requests.get(requestId);
					if (!url) return;
					transferBytes += encodedDataLength;
					assetResponses.push({
						asset: new URL(url).pathname,
						encodedBytes: encodedDataLength
					});
					requests.delete(requestId);
				});
				const namespace = `pch-probe-${mode}-${network}-${Date.now()}`;
				await page.goto(harnessUrl);
				assert.equal(await page.evaluate(() => crossOriginIsolated), true);
				for (const phase of ['empty-cache', 'persistent-reload', 'warm', 'disabled']) {
					if (phase === 'persistent-reload' || phase === 'disabled') {
						await page.evaluate(async () => {
							await window.__pchProbe?.session?.dispose();
							await window.__pchProbe?.sandbox?.dispose?.();
						});
						await page.reload();
					}
					transferBytes = 0;
					assetResponses = [];
					const measured = await page.evaluate(
						async ({ mode, phase, namespace, baseUrl, timeoutMs }) => {
							const { createApplicationRuntimeAssets } = await import(
								new URL('src/lib/playground/applicationAssets.ts', baseUrl).href
							);
							const assets = createApplicationRuntimeAssets(
								new URL(baseUrl).pathname
							);
							assets.persistentCache = {
								enabled: phase !== 'disabled',
								namespace,
								storageReserveBytes: 0
							};
							const stages = [];
							const started = performance.now();
							const options = {
								cppVersion: 'CPP20',
								persistentCache: phase === 'disabled' ? false : undefined,
								limits: {
									assetTimeoutMs: timeoutMs,
									startupTimeoutMs: timeoutMs,
									compileTimeoutMs: timeoutMs,
									runTimeoutMs: timeoutMs,
									maxAssetBytes: 128 * 1024 * 1024
								}
							};
							const progress = {
								set(value, label) {
									if (label)
										stages.push({
											atMs: performance.now() - started,
											label,
											value
										});
								},
								report(event) {
									if (event.label)
										stages.push({
											atMs: performance.now() - started,
											label: event.label,
											kind: event.kind
										});
								}
							};
							if (phase !== 'warm') {
								if (mode === 'default') {
									const { default: Clang } = await import(
										new URL('src/lib/playground/clang.ts', baseUrl).href
									);
									window.__pchProbe = { sandbox: new Clang('CPP') };
								} else {
									const { createRuntimeSession } = await import(
										new URL('src/lib/playground/runtimeSession.ts', baseUrl)
											.href
									);
									const session = createRuntimeSession(assets);
									window.__pchProbe = {
										session,
										sandbox: await session.createBinding().load('CPP')
									};
								}
							}
							const sandbox = window.__pchProbe.sandbox;
							const output = [];
							let firstOutputMs;
							const marker = `persistent-pch-${phase}-42`;
							sandbox.output = (chunk) => {
								output.push(chunk);
								if (firstOutputMs === undefined && output.join('').includes(marker))
									firstOutputMs = performance.now() - started;
							};
							const source = `#include <bits/stdc++.h>\nint main(){std::vector<int> v={1,2,3,4};std::cout<<"${marker} "<<std::accumulate(v.begin(),v.end(),0)<<"\\n";}`;
							if (phase !== 'warm') {
								if (mode === 'default')
									await sandbox.load(assets, '', false, [], options, progress);
								else await sandbox.load('', false, [], options, progress);
							}
							const readyMs = performance.now() - started;
							// prepare() reports PCH usage in the default worker. Execute its artifact
							// afterward so first stdout includes the complete preparation cost.
							const prepared = await sandbox.run(
								source,
								true,
								false,
								progress,
								[],
								options
							);
							if (prepared !== true)
								throw new Error(`C++ preparation failed: ${String(prepared)}`);
							const compiledMs = performance.now() - started;
							const result = await sandbox.run(
								source,
								false,
								false,
								progress,
								[],
								options
							);
							return {
								readyMs,
								compiledMs,
								firstOutputMs,
								completedMs: performance.now() - started,
								result,
								output: output.join(''),
								usedPch: stages.some(({ label }) =>
									label.includes('Compiled with precompiled')
								),
								pchRequests: window.__pchWorkerKeys,
								stages
							};
						},
						{ mode, phase, namespace, baseUrl, timeoutMs }
					);
					assert.equal(
						measured.result,
						true,
						`${mode}/${network}/${phase} execution failed`
					);
					assert.ok(
						measured.output.includes(`persistent-pch-${phase}-42 10`),
						measured.output
					);
					const summary = {
						mode,
						network,
						phase,
						...measured,
						transferBytes,
						assetResponses
					};
					report.measurements.push(summary);
					const stageSummary = new Map();
					for (const stage of measured.stages) {
						const entry = stageSummary.get(stage.label);
						if (entry) {
							entry.lastAtMs = stage.atMs;
							entry.events++;
						} else {
							stageSummary.set(stage.label, {
								label: stage.label,
								firstAtMs: stage.atMs,
								lastAtMs: stage.atMs,
								events: 1
							});
						}
					}
					console.log(
						JSON.stringify({
							...summary,
							stages: [...stageSummary.values()]
						})
					);
					assert.equal(
						measured.usedPch,
						phase === 'persistent-reload' || phase === 'warm',
						`${mode}/${network}/${phase}: incorrect PCH reuse`
					);
					if (phase === 'empty-cache') {
						const persistenceStarted = Date.now();
						for (;;) {
							const persisted = await page.evaluate(async (namespace) => {
								const request = indexedDB.open(
									`wasm-idle-assets-v1:${namespace}`,
									1
								);
								const db = await new Promise((resolve, reject) => {
									request.onsuccess = () => resolve(request.result);
									request.onerror = () => reject(request.error);
								});
								try {
									const records = db
										.transaction('assets', 'readonly')
										.objectStore('assets')
										.getAll();
									const entries = await new Promise((resolve, reject) => {
										records.onsuccess = () => resolve(records.result);
										records.onerror = () => reject(records.error);
									});
									return entries.some((record) =>
										record.references.some((reference) =>
											reference.validationKey?.startsWith('generated-v1:')
										)
									);
								} finally {
									db.close();
								}
							}, namespace);
							if (persisted) break;
							assert.ok(
								Date.now() - persistenceStarted < 60_000,
								'Generated PCH did not reach persistent storage'
							);
							await new Promise((resolve) => setTimeout(resolve, 100));
						}
						const persistedCheck = await page.evaluate(
							async ({ namespace, baseUrl }) => {
								const { createRuntimeGeneratedAssetCacheBackend } = await import(
									new URL('packages/core/src/persistent-asset-cache.ts', baseUrl)
										.href
								);
								const requested = window.__pchWorkerKeys.find(
									(entry) => entry.kind === 'requested'
								)?.identity;
								const built = window.__pchWorkerKeys.find(
									(entry) => entry.kind === 'built'
								)?.identity;
								const identity = requested || built;
								const bytes =
									identity &&
									(await createRuntimeGeneratedAssetCacheBackend({
										namespace,
										storageReserveBytes: 0
									}).read(JSON.stringify(identity)));
								return { bytes: bytes?.byteLength, built, requested };
							},
							{ namespace, baseUrl }
						);
						console.log(JSON.stringify({ persistedCheck }));
						assert.ok(
							persistedCheck.bytes > 0,
							'Stored generated PCH did not match the exact requested identity'
						);
						summary.persistedPchBytes = persistedCheck.bytes;
					}
					if (options.report)
						await writeFile(options.report, JSON.stringify(report, null, 2) + '\n', {
							mode: 0o600
						});
				}
				assert.deepEqual(errors, [], 'page errors during real compiler probe');
			} finally {
				await context.close();
			}
		}
	}
	report.validationComplete = true;
	if (options.report)
		await writeFile(options.report, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
} finally {
	await browser.close();
}
