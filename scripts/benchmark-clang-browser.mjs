#!/usr/bin/env node
// Browser timings are promotion evidence; Node benchmark results are reference data.
import { chromium } from 'playwright-core';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
if (!args.has('--fixtures') || !args.has('--json'))
	throw new Error('--fixtures and --json are required');
const runs = Number(args.get('--runs') || 3);
if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
const fixtures = JSON.parse(await readFile(args.get('--fixtures'), 'utf8'));
const pageUrl = new URL(
	'scripts/performance-browser.html',
	args.get('--base-url') || 'http://127.0.0.1:5192/wasm-idle/'
).href;
const profiles = (args.get('--profiles') || 'unconstrained,constrained').split(',');
const families = (args.get('--only') || 'compiler,clangd').split(',');
const payloads = new Map(
	await Promise.all(
		Object.entries(fixtures.files).map(async ([name, filename]) => [
			name,
			await readFile(filename)
		])
	)
);
const waiting = new Set();
let throughput = Infinity;
let latency = 0;
let sentBytes = 0;
let sentRequests = 0;
// Shape a shared link at the origin, including pthread/worker fetches. CDP target
// throttling alone does not establish an aggregate budget across all workers.
const ticker = setInterval(() => {
	let budget = Math.floor(throughput / 50);
	while (budget > 0 && waiting.size) {
		for (const entry of waiting) {
			if (entry.response.destroyed) {
				waiting.delete(entry);
				continue;
			}
			const length = Math.min(16 * 1024, budget, entry.bytes.length - entry.offset);
			entry.response.write(entry.bytes.subarray(entry.offset, entry.offset + length));
			entry.offset += length;
			budget -= length;
			sentBytes += length;
			if (entry.offset === entry.bytes.length) {
				entry.response.end();
				waiting.delete(entry);
			}
			if (!budget) break;
		}
	}
}, 20);
const server = http.createServer((request, response) => {
	const key = new URL(request.url, 'http://localhost').pathname.slice(1);
	const bytes = payloads.get(key);
	if (!bytes) {
		response.writeHead(404);
		response.end();
		return;
	}
	setTimeout(() => {
		if (response.destroyed) return;
		sentRequests++;
		response.writeHead(200, {
			'Content-Length': bytes.length,
			'Content-Type': key.endsWith('.js')
				? 'text/javascript'
				: key.endsWith('.gz')
					? 'application/gzip'
					: 'application/octet-stream',
			'Access-Control-Allow-Origin': '*',
			'Cross-Origin-Resource-Policy': 'cross-origin',
			'Timing-Allow-Origin': '*',
			'Cache-Control': 'no-store'
		});
		if (Number.isFinite(throughput)) waiting.add({ response, bytes, offset: 0 });
		else {
			sentBytes += bytes.length;
			response.end(bytes);
		}
	}, latency);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const snapshots = ['server', 'worker'].map((name) =>
	path.join(repo, `packages/lsp/src/clangd/.performance-baseline-${name}.ts`)
);
for (const [index, name] of ['server', 'worker'].entries()) {
	await writeFile(
		snapshots[index],
		execFileSync(
			'git',
			['show', `${args.get('--baseline-ref') || 'HEAD'}:packages/lsp/src/clangd/${name}.ts`],
			{ cwd: repo }
		)
	);
}
const report = {
	chromium: null,
	host: { cpus: (await import('node:os')).cpus().length, node: process.version },
	runs,
	shaping: { constrained: { aggregateBytesPerSecond: 1_250_000, requestLatencyMs: 50 } },
	samples: []
};
async function boot(page) {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
			await page.waitForFunction(() => !!globalThis.performanceProbe, undefined, {
				timeout: 120_000
			});
			return;
		} catch (error) {
			if (attempt === 3) throw error;
		}
	}
}
try {
	for (const profile of profiles) {
		if (!['unconstrained', 'constrained'].includes(profile))
			throw new Error('Invalid network profile');
		throughput = profile === 'constrained' ? 1_250_000 : Infinity;
		latency = profile === 'constrained' ? 50 : 0;
		for (let run = 0; run < runs; run++) {
			for (const family of families) {
				// Rotate order across repeats to spread load/tiering drift among variants.
				const variants = Object.entries(fixtures[family]).filter(
					([name]) =>
						!args.has('--variants') || args.get('--variants').split(',').includes(name)
				);
				for (const [name, fixture] of [
					...variants.slice(run % variants.length),
					...variants.slice(0, run % variants.length)
				]) {
					const browser = await chromium.launch({
						headless: true,
						executablePath: await resolveChromiumExecutable(
							process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
						),
						args: ['--no-sandbox']
					});
					report.chromium ??= browser.version();
					try {
						const context = await browser.newContext();
						await addBrowserTestCookies(context, pageUrl);
						const page = await context.newPage();
						page.on('pageerror', (error) =>
							console.error(`Browser error: ${error.message}`)
						);
						const cdp = await context.newCDPSession(page);
						await cdp.send('Network.enable');
						await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
						await boot(page);
						report.browserEnvironment ??= await page.evaluate(() => ({
							hardwareConcurrency: navigator.hardwareConcurrency,
							crossOriginIsolated
						}));
						const spec = {
							...fixture,
							baseUrl: origin + fixture.basePath,
							namespace: `perf-${family}-${name}-${profile}-${run}`
						};
						if (family === 'compiler')
							spec.receipts = Object.fromEntries(
								Object.entries(fixture.receipts).map(([asset, receipt]) => [
									spec.baseUrl + asset,
									receipt
								])
							);
						for (const phase of ['empty-cache', 'persistent-reload', 'warm']) {
							if (phase === 'persistent-reload') await boot(page);
							const before = { bytes: sentBytes, requests: sentRequests };
							const result = await page.evaluate(
								async ({ family, spec, phase }) => {
									const timeout = new Promise((_, reject) =>
										setTimeout(
											() => reject(new Error(`${family} ${phase} timed out`)),
											300_000
										)
									);
									return Promise.race([
										family === 'compiler'
											? globalThis.performanceProbe.runCompiler(
													spec,
													phase === 'warm'
												)
											: globalThis.performanceProbe.runClangd(
													spec,
													phase === 'warm'
												),
										timeout
									]);
								},
								{ family, spec, phase }
							);
							report.samples.push({
								family,
								name,
								profile,
								run,
								phase,
								transferPayloadBytes: sentBytes - before.bytes,
								requests: sentRequests - before.requests,
								result
							});
							await writeFile(
								args.get('--json'),
								JSON.stringify(report, null, 2) + '\n'
							);
							console.log(
								`${family} ${name} ${profile} #${run + 1} ${phase}: ${Math.round(result.totalMs ?? result.readyMs)} ms, ${sentBytes - before.bytes} payload bytes`
							);
						}
						await page.evaluate(() => globalThis.performanceProbe.dispose());
					} finally {
						await browser.close();
					}
				}
			}
		}
	}
} finally {
	clearInterval(ticker);
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	for (const snapshot of snapshots) await unlink(snapshot).catch(() => {});
}
