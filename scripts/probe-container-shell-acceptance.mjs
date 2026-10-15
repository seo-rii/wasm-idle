// Opt-in shell acceptance: the development plan's script in actual Bash with actual BusyBox,
// Clang and the artifact it builds, in Chromium. --check validates pinned inputs and bundles only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { arch, platform, release, version } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import {
	BASH_WASM_SHA256, BIN, BUSYBOX_PRODUCER_REVISION, CLANG_PROFILE, COMMAND_TIMEOUT_MS, PROCESS_SYSROOT_RECEIPT_SHA256, MEMORY, PACKAGE_RECEIPT, READ_FILES, RUNS, RUN_TIMEOUT_MS, SCRIPT,
	digest, identity, judgeShellAcceptance, readPinnedProbeInputs
} from './probe-container-shell-acceptance-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const containerRoot = join(root, 'packages/container');
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'";

// Container, Core and LLVM tool-host source bundled into local modules, as the Clang browser
// qualification does, so module Workers need no import map.
async function bundles() {
	const result = await build({
		absWorkingDir: root,
		entryPoints: {
			owner: join(containerRoot, 'test/shell-acceptance/worker.mjs'),
			'clang-worker': join(containerRoot, 'src/adapters/clang/worker.ts'),
			'live-worker': join(containerRoot, 'src/adapters/wasi-live/worker.ts')
		},
		alias: {
			'@wasm-idle/core': join(root, 'packages/core/src/index.ts'),
			'@wasm-idle/llvm-core/tool-host': join(root, 'packages/llvm-core/runtime/clang/src/tool-host.ts')
		},
		bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
		outdir: '/bundle', write: false, metafile: true, logLevel: 'silent'
	});
	assert(Object.values(result.metafile.outputs).every((output) => output.imports.every((entry) => entry.external !== true || entry.kind === 'dynamic-import')),
		'bundles must not leave static external imports');
	const modules = new Map(result.outputFiles.map((file) => [file.path.split('/').at(-1), Buffer.from(file.contents)]));
	const sources = {};
	for (const input of Object.keys(result.metafile.inputs).sort()) sources[input] = identity(await readFile(join(root, input)));
	return { modules, sources };
}

export async function checkProbe(configuration) {
	assert(isAbsolute(configuration.output), 'absolute fresh output required');
	assert(!configuration.output.startsWith(root + '/'), 'output must be outside the checkout');
	assert.equal(await lstat(configuration.output).catch((error) => {
		if (error.code === 'ENOENT') return null;
		throw error;
	}), null, 'existing output is preserved and rejected');
	assert.equal(await realpath(dirname(configuration.output)), dirname(configuration.output),
		'output parent must exist without symlink ancestors');
	const inputs = await readPinnedProbeInputs(configuration);
	// The container's own validator must accept the distribution before Chromium starts.
	const { validateDistribution } = await import('../packages/container/dist/packages/distribution.js');
	const bytes = Buffer.from(manifest('http://127.0.0.1:1', inputs));
	await validateDistribution({ bytes, expectedSha256: digest(bytes), adapterIds: ['wasi-preview1-live', 'llvm-clang-tool-host-v1'],
		allowedAssetURLs: ['busybox', 'clang', 'lld', 'sysroot'].map((name) => `http://127.0.0.1:1/assets/${name}`) });
	return { inputs, bundles: await bundles() };
}

function manifest(origin, inputs) {
	const busyboxIdentity = { ...identity(inputs.busybox), mediaType: 'application/wasm' };
	const producer = inputs.clang.producer.source;
	return JSON.stringify({
		schemaVersion: 1,
		distributionId: `shell-acceptance-${digest(Buffer.from(JSON.stringify([digest(inputs.busybox), inputs.clang.producerSha256, PROCESS_SYSROOT_RECEIPT_SHA256])))}`,
		packages: [
			{
				id: 'busybox', identity: `sha256:${busyboxIdentity.sha256}`, dependencies: [], mount: '/opt/toolchains/busybox',
				producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: BUSYBOX_PRODUCER_REVISION, receiptSha256: inputs.busyboxReceiptSha256 },
				capabilities: ['wasi-preview1'],
				assets: [{ id: 'busybox', url: `${origin}/assets/busybox`, encoding: 'identity', delivery: busyboxIdentity, logical: busyboxIdentity }],
				files: [{ path: 'bin/busybox', asset: 'busybox', executable: true }]
			},
			{
				// Clang/LLD from their producer receipt, with the process-profile sysroot.
				id: 'llvm', identity: `sha256:${digest(Buffer.from(JSON.stringify([inputs.clang.producerSha256, PROCESS_SYSROOT_RECEIPT_SHA256])))}`,
				dependencies: [], mount: '/opt/toolchains/llvm',
				producer: { repository: producer.repository, revision: producer.revision, receiptSha256: inputs.clang.producerSha256 },
				capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1'],
				assets: Object.entries(inputs.clang.assets).map(([name, asset]) => ({ ...asset.metadata, url: `${origin}/assets/${name}` })),
				files: [
					{ path: 'bin/clang', asset: 'clang', executable: true },
					{ path: 'bin/wasm-ld', asset: 'lld', executable: true },
					{ path: 'sysroot.tar', asset: 'sysroot', executable: false }
				]
			}
		],
		commands: [
			...['cat', 'cp', 'grep', 'mkdir', 'mv', 'rm'].map((name) => ({
				name, package: 'busybox', adapter: 'wasi-preview1-live', path: 'bin/busybox', argv0: name, prefixArgs: []
			})),
			// The pinned profile: target, linker, process-profile sysroot and resource directory,
			// before the user's arguments, as a toolchain's configuration file would supply them.
			{ name: 'clang', package: 'llvm', adapter: 'llvm-clang-tool-host-v1', path: 'bin/clang', argv0: 'clang', prefixArgs: CLANG_PROFILE }
		]
	});
}

export async function runProbe(configuration) {
	const prepared = await checkProbe(configuration);
	await mkdir(configuration.output, { mode: 0o700 });
	const receipt = {
		schemaVersion: 1, complete: false, shellAcceptancePassed: false,
		startedAt: new Date().toISOString(),
		host: { node: process.version, platform: platform(), arch: arch(), kernelRelease: release(), osVersion: version() },
		applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		script: SCRIPT,
		packageReceipt: PACKAGE_RECEIPT,
		packageId: prepared.inputs.receipt.packageId,
		memory: MEMORY,
		bundles: Object.fromEntries([...prepared.bundles.modules].map(([name, bytes]) => [name, identity(bytes)])),
		bundleSources: prepared.bundles.sources,
		busybox: { receiptSha256: prepared.inputs.busyboxReceiptSha256, artifact: identity(prepared.inputs.busybox) },
		processSysroot: prepared.inputs.processSysroot,
		clang: {
			producerReceiptSha256: prepared.inputs.clang.producerSha256, producerSmokeSha256: prepared.inputs.clang.producerSmokeSha256,
			assets: Object.fromEntries(Object.entries(prepared.inputs.clang.assets).map(([name, asset]) => [name, asset.metadata]))
		},
		runs: [],
		scope: 'One container Supervisor and filesystem; Bash /workspace is that filesystem; BusyBox and the artifact run live with delegated stdio; Clang runs on its snapshot adapter with forwarded output',
		cacheScope: 'Asset responses are no-store; the warm run is a new owner Worker, container and package manager in the same browser profile',
		networkScope: 'Trusted local bootstrap and origin/asset allowlist; no guest/network security qualification',
		workerObservationScope: 'All dedicated Workers in this exclusively owned Chromium browser',
		shellBackendReady: false, commonContainerFdVfsQualified: false
	};
	const receiptPath = join(configuration.output, 'receipt.json');
	const save = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
	let browser, server, cdp, context;
	try {
		await save();
		const served = new Map(), downloads = {};
		for (const [name, bytes] of prepared.bundles.modules) served.set(`/bundle/${name}`, { body: bytes, type: 'text/javascript' });
		const sdkBase = '/sdk/' + prepared.inputs.receipt.packageId;
		for (const name of ['index.mjs', 'worker.mjs'])
			served.set(`${sdkBase}/${name}`, { body: prepared.inputs.entries.get(name), type: 'text/javascript' });
		const descriptions = [];
		for (const [key, name, bytes] of [
			['sdkWasm', 'sdk.wasm', prepared.inputs.entries.get('wasmer_js_bg.wasm')],
			['bashWebc', 'bash.webc', prepared.inputs.bash]
		]) {
			const url = `/inputs/sha256-${digest(bytes)}/${name}`;
			served.set(url, { body: bytes, type: 'application/octet-stream' });
			descriptions.push({ key, url, ...identity(bytes) });
		}
		served.set('/assets/busybox', { body: prepared.inputs.busybox, type: 'application/wasm' });
		for (const [name, asset] of Object.entries(prepared.inputs.clang.assets))
			served.set(`/assets/${name}`, { body: asset.delivery, type: asset.metadata.delivery.mediaType });
		for (const path of served.keys()) if (path.startsWith('/assets/')) downloads[path] = 0;
		served.set('/', { body: Buffer.from('<!doctype html><meta charset="utf-8"><title>Shell acceptance</title>'), type: 'text/html' });
		receipt.requests = [];
		server = createServer((request, response) => {
			const url = new URL(request.url, 'http://127.0.0.1');
			const file = request.method === 'GET' && !url.search ? served.get(url.pathname) : undefined;
			receipt.requests.push({ method: request.method, path: url.pathname, accepted: Boolean(file), atMs: Date.now() });
			if (file && url.pathname in downloads) downloads[url.pathname]++;
			response.writeHead(file ? 200 : 404, {
				'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
				'Cross-Origin-Resource-Policy': 'same-origin', 'Content-Security-Policy': csp,
				'X-Content-Type-Options': 'nosniff', 'Content-Type': file?.type ?? 'text/plain',
				// The warm run can only reuse an asset body from the verified persistent cache.
				'Cache-Control': 'no-store'
			});
			response.end(file?.body ?? 'Not found');
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const origin = `http://127.0.0.1:${server.address().port}`;
		const distribution = manifest(origin, prepared.inputs);
		receipt.distributionSha256 = digest(Buffer.from(distribution));
		const { chromium } = await import('playwright-core');
		const { resolveChromiumExecutable } = await import('./rust-browser-probe-lib.mjs');
		const executablePath = await resolveChromiumExecutable(configuration.chromium || '');
		receipt.chromiumExecutable = { path: executablePath, ...identity(await readFile(executablePath)) };
		browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
		receipt.browser = browser.version();
		cdp = await browser.newBrowserCDPSession();
		const isWorker = (info) => info.type === 'worker';
		await cdp.send('Target.setDiscoverTargets', { discover: true });
		const workers = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(isWorker);
		const retire = async () => {
			const deadline = Date.now() + 5000;
			let remaining;
			do {
				remaining = await workers();
				if (!remaining.length) break;
				await new Promise((done) => setTimeout(done, 100));
			} while (Date.now() < deadline);
			return remaining;
		};
		receipt.initialWorkerTargets = (await workers()).length;
		context = await browser.newContext({ serviceWorkers: 'block' });
		const consoleErrors = [], warnings = [], blockedRequests = [];
		await context.route('**/*', (route) => {
			const url = new URL(route.request().url());
			if (url.origin === origin && !url.search && served.has(url.pathname)) return route.continue();
			blockedRequests.push(url.href);
			return route.abort('blockedbyclient');
		});
		await addBrowserTestCookies(context, origin);
		const page = await context.newPage();
		page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 2000)));
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000));
			if (message.type() === 'warning') warnings.push(message.text().slice(0, 2000));
		});
		await page.goto(origin, { timeout: 10000 });
		for (const run of RUNS) {
			const start = { ...downloads }, started = Date.now(), errorsBefore = consoleErrors.length;
			let result = {};
			try {
				result = await page.evaluate(({ descriptions, sdkBase, memory, bashWasmSha256, timeout, payload }) => new Promise((done) => {
					const events = [];
					let worker, settled = false, cleanupResolve;
					const finish = (value) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						done({ ...value, events });
					};
					const timer = setTimeout(() => finish({ type: 'timeout', backendCompleted: false }), timeout);
					globalThis.cleanupOwner = () => !worker ? Promise.resolve({ mode: 'no-worker-created' }) : new Promise((resolve) => {
						const limit = setTimeout(() => { worker.terminate(); resolve({ mode: 'forced-host-worker-termination' }); }, 2000);
						cleanupResolve = (value) => { clearTimeout(limit); worker.terminate(); resolve({ mode: 'worker-owner-cleanup-acknowledged', ...value }); };
						worker.postMessage({ type: 'cleanup' });
					});
					globalThis.ownerEvents = events;
					(async () => {
						if (!crossOriginIsolated) throw new Error('Cross-origin isolation required');
						const inputs = {};
						for (const entry of descriptions) {
							const response = await fetch(entry.url, { credentials: 'same-origin', redirect: 'error' });
							if (!response.ok) throw new Error(`Input HTTP ${response.status}`);
							const bytes = await response.arrayBuffer();
							const observed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
								(byte) => byte.toString(16).padStart(2, '0')).join('');
							if (bytes.byteLength !== entry.bytes || observed !== entry.sha256) throw new Error(`Input identity mismatch: ${entry.key}`);
							inputs[entry.key] = bytes;
						}
						const sdkModule = await WebAssembly.compile(inputs.sdkWasm);
						worker = new Worker('/bundle/owner.js', { type: 'module' });
						worker.onmessage = ({ data }) => {
							events.push(data.type === 'result' ? { type: 'result' } : data);
							if (data.type === 'ownerCleanup') cleanupResolve?.(data);
							if (['result', 'failure'].includes(data.type)) finish(data);
						};
						worker.onerror = (event) => finish({ type: 'error', backendCompleted: false, error: event.message });
						worker.postMessage({ type: 'run', ...payload, bashWebc: inputs.bashWebc, sdkModule,
							sdkMemory: new WebAssembly.Memory(memory), bashWasmSha256,
							sdkUrl: location.origin + sdkBase + '/index.mjs', sdkWorkerUrl: location.origin + sdkBase + '/worker.mjs',
							liveWorkerUrl: location.origin + '/bundle/live-worker.js', clangWorkerUrl: location.origin + '/bundle/clang-worker.js' });
					})().catch((error) => finish({ type: 'failure', backendCompleted: false, error: String(error) }));
				}), {
					descriptions, sdkBase, memory: MEMORY, bashWasmSha256: BASH_WASM_SHA256, timeout: RUN_TIMEOUT_MS,
					payload: {
						script: SCRIPT, readFiles: READ_FILES, manifest: distribution, manifestSha256: receipt.distributionSha256,
						assetURLs: Object.keys(downloads).map((path) => origin + path), cacheNamespace: 'container-shell-acceptance',
						clangSha256: prepared.inputs.clang.assets.clang.metadata.logical.sha256,
						linkerSha256: prepared.inputs.clang.assets.lld.metadata.logical.sha256,
						commandTimeoutMs: COMMAND_TIMEOUT_MS
					}
				});
				result.workersAtObservation = (await workers()).length;
				result.ownedCleanup = await page.evaluate(() => globalThis.cleanupOwner());
				const remaining = await retire();
				result.remainingWorkerTargets = remaining.length;
				result.remainingWorkerTargetDetails = remaining.map(({ targetId, url, parentId }) => ({ targetId, url, parentId }));
			} catch (error) {
				result = { ...result, type: 'harness-error', error: String(error) };
				result.remainingWorkerTargets = (await workers()).length;
			}
			result.consoleErrors = consoleErrors.slice(errorsBefore);
			result.blockedRequests = [...blockedRequests];
			receipt.runs.push({ run, result, downloads: { start, end: { ...downloads } }, elapsedMs: Date.now() - started, bin: BIN });
			await save();
		}
		receipt.warnings = warnings;
		await context.close();
		context = undefined;
		receipt.workersAfterContextClose = (await retire()).length;
		await readPinnedProbeInputs(configuration);
		assert.deepEqual((await bundles()).sources, prepared.bundles.sources, 'bundle sources changed during the probe');
		receipt.qualification = judgeShellAcceptance(receipt);
		receipt.shellAcceptancePassed = receipt.qualification.shellAcceptancePassed;
		receipt.complete = true;
	} catch (error) {
		receipt.error = String(error);
	} finally {
		await context?.close().catch(() => {});
		await browser?.close();
		server?.closeAllConnections();
		await new Promise((done) => server ? server.close(done) : done());
		receipt.finishedAt = new Date().toISOString();
		await save();
	}
	return { output: configuration.output, receipt: receiptPath, complete: receipt.complete,
		shellAcceptancePassed: receipt.shellAcceptancePassed, shellBackendReady: false };
}

const invoked = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (invoked === (await realpath(fileURLToPath(import.meta.url)))) {
	try {
		assert(process.argv.length === 4 && ['--check', '--run'].includes(process.argv[2]),
			'usage: probe-container-shell-acceptance.mjs --check|--run /absolute/config.json');
		assert(isAbsolute(process.argv[3]), 'absolute configuration path required');
		const configuration = JSON.parse(await readFile(process.argv[3]));
		if (process.argv[2] === '--check') {
			const checked = await checkProbe(configuration);
			console.log(JSON.stringify({ checked: true, browserLaunched: false, packageId: checked.inputs.receipt.packageId,
				bundles: Object.fromEntries([...checked.bundles.modules].map(([name, bytes]) => [name, bytes.length])) }));
		} else {
			const result = await runProbe(configuration);
			console.log(JSON.stringify(result));
			if (!result.complete || !result.shellAcceptancePassed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
