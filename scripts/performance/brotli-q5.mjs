#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, brotliDecompressSync, constants, gunzipSync } from 'node:zlib';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const DEFAULT_ASSETS = [
	'clang/bin/clang.wasm.gz',
	'clang/bin/lld.wasm.gz',
	'clangd/clangd.wasm.gz',
	'wasm-debug/debug/lldb-web-dap.wasm.gz',
	'pyodide/pyodide.asm.wasm.gz',
	'teavm/compiler.wasm.gz',
	'wasm-rust/runtime/rustc/rustc.wasm.gz',
	'wasm-rust/runtime/packs/sysroot/wasm32-wasip1.pack.gz'
];

/** Reject stale local build outputs before producing any comparison. */
export function prepareAsset(name, gzip, receipt) {
	assert(receipt?.encoding === 'gzip', `Missing gzip receipt: ${name}`);
	assert.equal(gzip.length, receipt.bytes, `Encoded size: ${name}`);
	assert.equal(sha(gzip), receipt.sha256, `Encoded SHA-256: ${name}`);
	assert(
		Number.isSafeInteger(receipt.uncompressedBytes) &&
			receipt.uncompressedBytes > 0 &&
			receipt.uncompressedBytes <= 256 * 1024 ** 2,
		'Invalid decoded size'
	);
	const raw = gunzipSync(gzip, { maxOutputLength: receipt.uncompressedBytes });
	assert.equal(raw.length, receipt.uncompressedBytes, `Decoded size: ${name}`);
	assert.equal(sha(raw), receipt.uncompressedSha256, `Decoded SHA-256: ${name}`);
	const start = performance.now();
	const brotli = brotliCompressSync(raw, {
		params: {
			[constants.BROTLI_PARAM_QUALITY]: 5,
			[constants.BROTLI_PARAM_SIZE_HINT]: raw.length
		}
	});
	const encodeMs = performance.now() - start;
	assert.deepEqual(brotliDecompressSync(brotli, { maxOutputLength: raw.length }), raw);
	return {
		gzip,
		brotli,
		metadata: {
			name,
			receipt,
			brotliBytes: brotli.length,
			brotliSha256: sha(brotli),
			encodeMs,
			roundtripVerified: true,
			wasm: raw.subarray(0, 4).equals(Buffer.from([0, 97, 115, 109]))
		}
	};
}

export function summarize(samples) {
	const groups = new Map();
	for (const sample of samples) {
		const key = JSON.stringify([
			sample.asset,
			sample.network,
			sample.transport,
			sample.encoding,
			sample.phase
		]);
		const values = groups.get(key) || [];
		values.push(sample);
		groups.set(key, values);
	}
	return [...groups].map(([key, values]) => {
		const [asset, network, transport, encoding, phase] = JSON.parse(key);
		const metrics = {};
		for (const metric of ['fetchMs', 'decodeMs', 'hashMs', 'compileMs', 'totalMs']) {
			const sorted = values
				.filter((x) => x.ok && Number.isFinite(x[metric]))
				.map((x) => x[metric])
				.sort((a, b) => a - b);
			const mid = Math.floor(sorted.length / 2);
			metrics[metric] = {
				count: sorted.length,
				median: sorted.length
					? sorted.length % 2
						? sorted[mid]
						: (sorted[mid - 1] + sorted[mid]) / 2
					: null,
				min: sorted[0] ?? null,
				max: sorted.at(-1) ?? null
			};
		}
		return {
			asset,
			network,
			transport,
			encoding,
			phase,
			count: values.length,
			failures: values.filter((x) => !x.ok && !x.skipped).length,
			skipped: values.filter((x) => x.skipped).length,
			metrics
		};
	});
}

// This function is serialized into the browser. No Node closure dependencies.
async function measureInBrowser(spec) {
	const hash = async (buffer) =>
		Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (x) =>
			x.toString(16).padStart(2, '0')
		).join('');
	if (spec.transport === 'explicit') {
		try {
			new DecompressionStream(spec.encoding === 'gzip' ? 'gzip' : 'brotli');
		} catch {
			return [
				{ phase: 'cold-fetch', ok: false, skipped: 'unsupported-decompression-format' }
			];
		}
	}
	const results = [];
	let cached;
	for (const phase of ['cold-fetch', 'warm-buffer']) {
		const start = performance.now();
		const response =
			phase === 'cold-fetch' ? await fetch(spec.url, { cache: 'no-store' }) : null;
		if (response && !response.ok) throw new Error(`HTTP ${response.status}`);
		const bytes = response ? await response.arrayBuffer() : cached;
		if (phase === 'cold-fetch') cached = bytes;
		const fetched = performance.now();
		let decoded = bytes;
		if (spec.transport === 'explicit') {
			if (
				bytes.byteLength !== spec.encodedBytes ||
				(await hash(bytes)) !== spec.encodedSha256
			)
				throw new Error('Encoded receipt mismatch');
		}
		const encodedVerified = performance.now();
		if (spec.transport === 'explicit')
			decoded = await new Response(
				new Blob([bytes])
					.stream()
					.pipeThrough(
						new DecompressionStream(spec.encoding === 'gzip' ? 'gzip' : 'brotli')
					)
			).arrayBuffer();
		const decompressed = performance.now();
		if (decoded.byteLength !== spec.rawBytes || (await hash(decoded)) !== spec.rawSha256)
			throw new Error('Decoded receipt mismatch');
		const verified = performance.now();
		if (spec.wasm) await WebAssembly.compile(decoded, spec.compileOptions);
		const finished = performance.now();
		results.push({
			phase,
			ok: true,
			rawSha256: spec.rawSha256,
			fetchMs: fetched - start,
			decodeMs: spec.transport === 'explicit' ? decompressed - encodedVerified : null,
			hashMs: encodedVerified - fetched + verified - decompressed,
			compileMs: spec.wasm ? finished - verified : null,
			totalMs: finished - start
		});
	}
	return results;
}

export async function main(argv) {
	const args = new Map();
	for (let i = 0; i < argv.length; i += 2) {
		assert(
			[
				'--asset-root',
				'--fallback-root',
				'--json',
				'--runs',
				'--assets',
				'--networks',
				'--transports',
				'--chromium'
			].includes(argv[i]) && argv[i + 1],
			`Invalid option: ${argv[i]}`
		);
		args.set(argv[i], argv[i + 1]);
	}
	assert(args.has('--json'), '--json is required');
	const runs = Number(args.get('--runs') || 3);
	assert(Number.isInteger(runs) && runs > 0 && runs <= 30, '--runs must be 1..30');
	const networks = (args.get('--networks') || 'loopback,10mbps').split(',');
	const transports = (args.get('--transports') || 'explicit,http').split(',');
	assert(
		networks.every((x) => ['loopback', '10mbps'].includes(x)) &&
			transports.every((x) => ['explicit', 'http'].includes(x)),
		'Invalid profile'
	);
	const names = args.get('--assets')?.split(',') || DEFAULT_ASSETS;
	assert(
		names.length &&
			new Set(names).size === names.length &&
			names.every((x) => DEFAULT_ASSETS.includes(x)),
		'Invalid/duplicate assets'
	);
	const { RUNTIME_ASSET_LOCK } =
		await import('../../packages/core/src/runtime-asset-lock.generated.ts');
	const roots = [
		args.get('--asset-root') || path.join(repo, 'static'),
		args.get('--fallback-root')
	].filter(Boolean);
	const assets = [];
	for (const name of names) {
		let selected;
		for (const root of roots) {
			const bytes = await readFile(path.join(root, name)).catch((error) => {
				if (error.code === 'ENOENT') return null;
				throw error;
			});
			if (bytes && sha(bytes) === RUNTIME_ASSET_LOCK.assets[name]?.sha256) {
				selected = bytes;
				break;
			}
		}
		assert(selected, `Missing receipt-matched asset: ${name}`);
		assets.push(prepareAsset(name, selected, RUNTIME_ASSET_LOCK.assets[name]));
	}
	const { chromium } = await import('playwright-core');
	const { resolveChromiumExecutable } = await import('../rust-browser-probe-lib.mjs');
	const report = {
		schemaVersion: 1,
		measurementKind: 'browser-artifact-preparation',
		generatedAt: new Date().toISOString(),
		assetLockVersion: RUNTIME_ASSET_LOCK.version,
		host: {
			platform: os.platform(),
			arch: os.arch(),
			cpus: os.cpus().length,
			cpu: os.cpus()[0]?.model,
			node: process.version
		},
		runs,
		shaping: { '10mbps': { bytesPerSecond: 1_250_000, latencyMs: 50 } },
		method: {
			baseline: 'receipt-pinned shipped gzip (not recompressed)',
			candidate: 'Brotli quality 5, size hint',
			cold: 'new Chromium process per artifact/codec/transport/network/repeat; HTTP cache disabled',
			warm: 'same process, retained encoded buffer (explicit) or decoded buffer (HTTP); includes engine module cache effects',
			endpoint:
				'decoded SHA-256 verified and WebAssembly.compile resolved; no runtime instantiation or user first output',
			http: 'native Content-Encoding decoding is included in fetchMs; cannot separate decoder CPU time',
			memory: 'not measured',
			scheduling: 'serial samples; rotate codec and transport order across repetitions'
		},
		assets: assets.map((x) => x.metadata),
		samples: []
	};
	let active;
	let sent = 0;
	const pending = new Set();
	const server = http.createServer((request, response) => {
		const pathname = new URL(request.url, 'http://localhost').pathname;
		const headers = {
			'Cache-Control': 'no-store',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp'
		};
		if (pathname === '/') {
			response.writeHead(200, { ...headers, 'Content-Type': 'text/html' });
			response.end('<!doctype html><title>Brotli Q5 benchmark</title>');
			return;
		}
		if (pathname !== '/asset' || !active) {
			response.writeHead(404);
			response.end();
			return;
		}
		const { bytes, encoding, transport, network } = active;
		const timer = setTimeout(
			() => {
				if (response.destroyed) return;
				response.writeHead(200, {
					...headers,
					'Content-Type': 'application/octet-stream',
					'Content-Length': bytes.length,
					...(transport === 'http'
						? { 'Content-Encoding': encoding === 'gzip' ? 'gzip' : 'br' }
						: {})
				});
				if (network === 'loopback') {
					sent += bytes.length;
					response.end(bytes);
					return;
				}
				let offset = 0;
				const ticker = setInterval(() => {
					const length = Math.min(25_000, bytes.length - offset);
					response.write(bytes.subarray(offset, offset + length));
					offset += length;
					sent += length;
					if (offset === bytes.length) {
						clearInterval(ticker);
						pending.delete(ticker);
						response.end();
					}
				}, 20);
				pending.add(ticker);
				response.on('close', () => {
					clearInterval(ticker);
					pending.delete(ticker);
				});
			},
			network === 'loopback' ? 0 : 50
		);
		response.on('close', () => clearTimeout(timer));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const save = async () => {
		report.summary = summarize(report.samples);
		await mkdir(path.dirname(path.resolve(args.get('--json'))), { recursive: true });
		await writeFile(args.get('--json'), JSON.stringify(report, null, 2) + '\n');
	};
	try {
		for (let repeat = 0; repeat < runs; repeat++)
			for (const network of networks)
				for (const asset of assets) {
					const combinations = transports.flatMap((transport) =>
						['gzip', 'brotli'].map((encoding) => ({ transport, encoding }))
					);
					const rotate = repeat % combinations.length;
					for (const { transport, encoding } of [
						...combinations.slice(rotate),
						...combinations.slice(0, rotate)
					]) {
						active = { bytes: asset[encoding], encoding, transport, network };
						const before = sent;
						const browser = await chromium.launch({
							headless: true,
							executablePath: await resolveChromiumExecutable(
								args.get('--chromium') ||
									process.env.WASM_IDLE_CHROMIUM_EXECUTABLE ||
									''
							),
							args: ['--no-sandbox']
						});
						report.chromium ??= browser.version();
						try {
							const context = await browser.newContext();
							const page = await context.newPage();
							const cdp = await context.newCDPSession(page);
							await cdp.send('Network.enable');
							await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
							await page.goto(origin);
							const spec = {
								url: origin + '/asset',
								transport,
								encoding,
								encodedBytes: active.bytes.length,
								encodedSha256: sha(active.bytes),
								rawBytes: asset.metadata.receipt.uncompressedBytes,
								rawSha256: asset.metadata.receipt.uncompressedSha256,
								wasm: asset.metadata.wasm,
								compileOptions: asset.metadata.name.startsWith('teavm/')
									? { builtins: ['js-string'] }
									: undefined
							};
							let timeout;
							const results = await Promise.race([
								page.evaluate(measureInBrowser, spec),
								new Promise((_, reject) => {
									timeout = setTimeout(
										() => reject(new Error('Sample timeout')),
										180_000
									);
								})
							]).finally(() => clearTimeout(timeout));
							for (const result of results)
								report.samples.push({
									asset: asset.metadata.name,
									network,
									transport,
									encoding,
									repeat,
									...result,
									transferPayloadBytes:
										result.phase === 'cold-fetch' ? sent - before : 0
								});
						} catch (error) {
							report.samples.push({
								asset: asset.metadata.name,
								network,
								transport,
								encoding,
								repeat,
								phase: 'cold-fetch',
								ok: false,
								error: error.message,
								transferPayloadBytes: sent - before
							});
						} finally {
							await browser.close();
							await save();
						}
						console.log(
							`${network} ${asset.metadata.name} ${transport}/${encoding} repeat ${repeat + 1}`
						);
					}
				}
	} finally {
		for (const timer of pending) clearInterval(timer);
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
	if (report.samples.some((x) => !x.ok && !x.skipped)) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
	main(process.argv.slice(2)).catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
