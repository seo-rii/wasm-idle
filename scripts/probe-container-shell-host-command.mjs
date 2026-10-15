// Opt-in actual Bash -> SDK host-command registry -> container Supervisor probe.
// --check validates pinned inputs and the built container only; it never launches.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { arch, platform, release, version } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import {
	BASH_WASM_SHA256, CASE_TIMEOUT_MS, MEMORY, PACKAGE_RECEIPT, digest, fixtures,
	identity, judgeHostCommandProbe, readPinnedProbeInputs
} from './probe-container-shell-host-command-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'packages/container/test');
const containerRoot = join(root, 'packages/container');
const sourceFiles = ['fixtures/live.c', 'fixtures/live.wasm', 'fixtures/command.c',
	'fixtures/command.wasm', 'host-command-shell/worker.mjs'];
async function files(directory) {
	const found = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		assert(!entry.isSymbolicLink(), `symlink rejected: ${path}`);
		if (entry.isDirectory()) found.push(...await files(path));
		else if (entry.isFile()) found.push(path);
	}
	return found.sort();
}
// The served container must be the build of this checkout's TypeScript source.
async function containerIdentity() {
	const sources = {}, modules = {};
	for (const path of await files(join(containerRoot, 'src')))
		sources[relative(containerRoot, path)] = identity(await readFile(path));
	for (const path of await files(join(containerRoot, 'dist')))
		if (path.endsWith('.js')) modules[relative(join(containerRoot, 'dist'), path)] = identity(await readFile(path));
	for (const name of ['container.js', 'shell/host-command.js', 'adapters/wasi-live/index.js', 'adapters/wasi-live/worker.js'])
		assert(modules[name], `built container module required: ${name}`);
	return { sources, modules };
}

export async function checkProbe(configuration) {
	assert(isAbsolute(configuration.output), 'absolute fresh output required');
	assert(configuration.output !== root && !configuration.output.startsWith(root + '/'),
		'output must be outside the checkout');
	assert.equal(await lstat(configuration.output).catch((error) => {
		if (error.code === 'ENOENT') return null;
		throw error;
	}), null, 'existing output is preserved and rejected');
	assert.equal(await realpath(dirname(configuration.output)), dirname(configuration.output),
		'output parent must exist without symlink ancestors');
	const inputs = await readPinnedProbeInputs(configuration);
	const sources = {};
	for (const name of sourceFiles)
		sources[name] = identity(await readFile(join(fixtureRoot, name)));
	return { inputs, sources, container: await containerIdentity() };
}

export async function runProbe(configuration, cases = fixtures) {
	const prepared = await checkProbe(configuration);
	await mkdir(configuration.output, { mode: 0o700 });
	const receipt = {
		schemaVersion: 1, complete: false, hostCommandDispatchPassed: false,
		startedAt: new Date().toISOString(),
		host: { node: process.version, platform: platform(), arch: arch(),
			kernelRelease: release(), osVersion: version() },
		applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: root, encoding: 'utf8'
		}).trim(),
		packageReceipt: PACKAGE_RECEIPT,
		fixtureSet: cases === fixtures ? 'host-command-contract' : 'diagnostic-only',
		packageId: prepared.inputs.receipt.packageId,
		memory: MEMORY,
		fixtureSources: prepared.sources,
		container: prepared.container,
		results: [],
		dispatchScope: 'Exact registered paths; prepared-child argv/env/cwd and delegated descriptors 0-2 reach container live guests directly',
		filesystemScope: 'Shell WASIX Directory and container VFS remain separate namespaces; common Container VFS not installed',
		networkScope: 'Trusted local bootstrap and origin/asset allowlist; no guest/network security qualification',
		workerObservationScope: 'All dedicated Workers in this exclusively owned Chromium browser',
		shellBackendReady: false, commonContainerFdVfsQualified: false
	};
	const receiptPath = join(configuration.output, 'receipt.json');
	const save = () => writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
	let browser, server, cdp;
	try {
		await save();
		const assets = new Map();
		const descriptions = [];
		// Committed real no-libc WASI guests; nothing is compiled by this probe.
		for (const [key, name] of [['liveWasm', 'live.wasm'], ['commandWasm', 'command.wasm']]) {
			const bytes = await readFile(join(fixtureRoot, 'fixtures', name));
			const url = `/fixtures/sha256-${digest(bytes)}/${name}`;
			assets.set(url, bytes);
			descriptions.push({ key, url, ...identity(bytes) });
		}
		for (const name of Object.keys(prepared.container.modules))
			assets.set('/container/' + name, await readFile(join(containerRoot, 'dist', name)));
		const sdkBase = '/sdk/' + prepared.inputs.receipt.packageId;
		for (const name of ['index.mjs', 'worker.mjs'])
			assets.set(sdkBase + '/' + name, prepared.inputs.entries.get(name));
		for (const [key, name, bytes] of [
			['sdkWasm', 'sdk.wasm', prepared.inputs.entries.get('wasmer_js_bg.wasm')],
			['bashWebc', 'bash.webc', prepared.inputs.bash]
		]) {
			const url = `/assets/sha256-${digest(bytes)}/${name}`;
			assets.set(url, bytes);
			descriptions.push({ key, url, ...identity(bytes) });
		}
		const workerBytes = await readFile(join(fixtureRoot, 'host-command-shell/worker.mjs'));
		const probeWorkerUrl = `/harness/sha256-${digest(workerBytes)}/worker.mjs`;
		assets.set(probeWorkerUrl, workerBytes);
		assets.set('/', Buffer.from('<!doctype html><title>Actual Bash host-command probe</title>'));
		receipt.assets = Object.fromEntries([...assets].map(([url, bytes]) => [url, identity(bytes)]));
		receipt.requests = [];
		server = createServer((request, response) => {
			const url = new URL(request.url, 'http://127.0.0.1');
			const body = request.method === 'GET' && !url.search ? assets.get(url.pathname) : undefined;
			receipt.requests.push({ method: request.method, path: url.pathname, accepted: Boolean(body) });
			response.writeHead(body ? 200 : 404, {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp',
				'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'",
				'Content-Type': /\.m?js$/.test(url.pathname) ? 'text/javascript' :
					url.pathname.endsWith('.wasm') ? 'application/wasm' :
					url.pathname === '/' ? 'text/html' : 'application/octet-stream',
				'Cache-Control': url.pathname === '/' ? 'no-store' : 'public, max-age=31536000, immutable'
			});
			response.end(body ?? 'Not found');
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const origin = `http://127.0.0.1:${server.address().port}`;
		const { chromium } = await import('playwright-core');
		const { resolveChromiumExecutable } = await import('./rust-browser-probe-lib.mjs');
		const executablePath = await resolveChromiumExecutable(configuration.chromium || '');
		receipt.chromiumExecutable = { path: executablePath,
			...identity(await readFile(executablePath)) };
		browser = await chromium.launch({
			executablePath,
			headless: true, args: ['--no-sandbox', '--disable-background-networking']
		});
		receipt.browser = browser.version();
		cdp = await browser.newBrowserCDPSession();
		let observation;
		const live = new Map();
		const isWorker = (info) => info.type === 'worker';
		cdp.on('Target.targetCreated', ({ targetInfo }) => {
			if (!isWorker(targetInfo)) return;
			live.set(targetInfo.targetId, targetInfo);
			if (observation) {
				observation.created.push(targetInfo);
				observation.peakLive = Math.max(observation.peakLive, live.size);
			}
		});
		cdp.on('Target.targetDestroyed', ({ targetId }) => live.delete(targetId));
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
		for (const fixture of cases) {
			const context = await browser.newContext({ serviceWorkers: 'block' });
			const consoleErrors = [], warnings = [], blockedRequests = [];
			let page, result = {}, hostContextClosed = false;
			const started = Date.now();
			observation = { created: [], peakLive: 0 };
			const initialWorkers = await workers();
			try {
				await context.route('**/*', (route) => {
					const url = new URL(route.request().url());
					if (url.origin === origin && !url.search && assets.has(url.pathname))
						return route.continue();
					blockedRequests.push(url.href);
					return route.abort('blockedbyclient');
				});
				await addBrowserTestCookies(context, origin);
				page = await context.newPage();
				page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 2000)));
				page.on('console', (message) => {
					if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000));
					if (message.type() === 'warning') warnings.push(message.text().slice(0, 2000));
				});
				await page.goto(origin, { timeout: 10000 });
				result = await page.evaluate(({ fixture, descriptions, sdkBase, probeWorkerUrl,
					memory, bashWasmSha256, timeout }) => new Promise((done) => {
					const events = [];
					let worker, settled = false, retired = false, cleanupResolve;
					const finish = (value) => {
						if (settled) return;
						settled = true;
						clearTimeout(timer);
						done({ ...value, events });
					};
					const timer = setTimeout(() => finish({ type: 'timeout', backendCompleted: false }), timeout);
					globalThis.cleanupProbeGroup = () => {
						retired = true;
						if (!worker) return Promise.resolve({ mode: 'no-worker-created' });
						return new Promise((resolve) => {
							const limit = setTimeout(() => {
								worker.terminate();
								resolve({ mode: 'forced-host-worker-termination' });
							}, 2000);
							cleanupResolve = (value) => {
								clearTimeout(limit);
								worker.terminate();
								resolve({ mode: 'worker-owner-cleanup-acknowledged', ...value });
							};
							worker.postMessage({ type: 'cleanup' });
						});
					};
					globalThis.probeEvents = events;
					(async () => {
						if (!crossOriginIsolated) throw new Error('Cross-origin isolation required');
						const inputs = {};
						for (const entry of descriptions) {
							const response = await fetch(entry.url, { credentials: 'same-origin', redirect: 'error' });
							if (!response.ok) throw new Error(`Input HTTP ${response.status}`);
							const bytes = await response.arrayBuffer();
							const observed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
								(byte) => byte.toString(16).padStart(2, '0')).join('');
							if (bytes.byteLength !== entry.bytes || observed !== entry.sha256)
								throw new Error(`Input identity mismatch: ${entry.key}`);
							inputs[entry.key] = bytes;
						}
						const sdkModule = await WebAssembly.compile(inputs.sdkWasm);
						if (retired) return;
						worker = new Worker(probeWorkerUrl, { type: 'module' });
						worker.onmessage = ({ data }) => {
							events.push(data);
							if (data.type === 'ownerCleanup') cleanupResolve?.(data);
							if (['result', 'failure'].includes(data.type)) finish(data);
						};
						worker.onerror = (event) => finish({ type: 'error', backendCompleted: false, error: event.message });
						worker.postMessage({ type: 'run', fixture, ...inputs, sdkModule,
							sdkMemory: new WebAssembly.Memory(memory), bashWasmSha256,
							sdkUrl: location.origin + sdkBase + '/index.mjs',
							sdkWorkerUrl: location.origin + sdkBase + '/worker.mjs',
							containerUrl: location.origin + '/container/container.js',
							hostCommandUrl: location.origin + '/container/shell/host-command.js',
							liveAdapterUrl: location.origin + '/container/adapters/wasi-live/index.js' });
					})().catch((error) => finish({ type: 'failure', backendCompleted: false, error: String(error) }));
				}), { fixture, descriptions, sdkBase, probeWorkerUrl, memory: MEMORY,
					bashWasmSha256: BASH_WASM_SHA256, timeout: CASE_TIMEOUT_MS });
				result.workersAtObservation = await workers();
				result.ownedCleanup = await page.evaluate(() => globalThis.cleanupProbeGroup());
				result.remainingWorkerTargets = (await retire()).length;
				result.events = await page.evaluate(() => globalThis.probeEvents);
			} catch (error) {
				result = { ...result, type: 'harness-error', error: String(error) };
				result.remainingWorkerTargets = (await workers()).length;
			} finally {
				await context.close();
				hostContextClosed = true;
			}
			const afterContext = await retire();
			const createdTargetIds = new Set(observation.created.map(({ targetId }) => targetId));
			receipt.results.push({ id: fixture.id, script: fixture.script, ...result,
				elapsedMs: Date.now() - started, consoleErrors, warnings, blockedRequests,
				initialWorkerTargets: initialWorkers.length,
				createdWorkerTargets: observation.created,
				// Creation events can have empty URLs; parent identity still distinguishes
				// SDK descendants from the probe Worker created by the page.
				createdNestedWorkerTargets: observation.created.filter(({ parentId }) =>
					createdTargetIds.has(parentId)).length,
				peakLiveWorkerTargets: observation.peakLive,
				hostContextClosed, workersAfterContextClose: afterContext.length,
				remainingTargetsAfterContextClose: afterContext });
			observation = undefined;
			await save();
			assert.equal(afterContext.length, 0, 'owned context did not retire all observed Workers');
		}
		for (const [name, expected] of Object.entries(prepared.sources))
			assert.deepEqual(identity(await readFile(join(fixtureRoot, name))), expected);
		assert.deepEqual(await containerIdentity(), prepared.container, 'container changed during the probe');
		await readPinnedProbeInputs(configuration);
		receipt.qualification = judgeHostCommandProbe(receipt.results);
		if (cases !== fixtures) receipt.qualification.hostCommandDispatchPassed = false;
		receipt.hostCommandDispatchPassed = receipt.qualification.hostCommandDispatchPassed;
		receipt.complete = true;
	} catch (error) {
		receipt.error = String(error);
	} finally {
		await browser?.close();
		server?.closeAllConnections();
		await new Promise((done) => server ? server.close(done) : done());
		receipt.finishedAt = new Date().toISOString();
		await save();
	}
	return { output: configuration.output, receipt: receiptPath, complete: receipt.complete,
		hostCommandDispatchPassed: receipt.hostCommandDispatchPassed, shellBackendReady: false };
}

const invoked = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (invoked === (await realpath(fileURLToPath(import.meta.url)))) {
	try {
		assert(process.argv.length === 4 && ['--check', '--run'].includes(process.argv[2]),
			'usage: probe-container-shell-host-command.mjs --check|--run /absolute/config.json');
		assert(isAbsolute(process.argv[3]), 'absolute configuration path required');
		const configuration = JSON.parse(await readFile(process.argv[3]));
		if (process.argv[2] === '--check') {
			const checked = await checkProbe(configuration);
			console.log(JSON.stringify({ checked: true, browserLaunched: false,
				packageId: checked.inputs.receipt.packageId,
				containerModules: Object.keys(checked.container.modules).length,
				cases: fixtures.length, caseTimeoutMs: CASE_TIMEOUT_MS }));
		} else {
			const result = await runProbe(configuration);
			console.log(JSON.stringify(result));
			if (!result.complete || !result.hostCommandDispatchPassed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
