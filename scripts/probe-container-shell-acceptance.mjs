// Opt-in shell acceptance: the development plan's script in actual Bash with actual BusyBox,
// Clang and the artifact it builds, in Chromium. --check validates pinned inputs and bundles only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { arch, platform, release, version } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { selectClangProfile } from '../examples/container/clang-profile.mjs';
import { BUSYBOX_COMMANDS, BUSYBOX_SHELL_COMMANDS } from '../runtimes/wasm-busybox/commands.mjs';
import {
	BASH_WASM_SHA256, BIN, BUSYBOX_PRODUCER_REVISION, CLANG_PROFILE, COMMAND_TIMEOUT_MS, INTERRUPTS, LLVM_EXECUTABLE, PROCESS_SYSROOT_RECEIPT_SHA256, MEMORY,
	PACKAGE_RECEIPT, READ_FILES, REDIRECTION_FILES, RUNS, RUN_SCRIPTS, RUN_TIMEOUT_MS, SCRIPT, SYNTAX_FILES, SYNTAX_SCRIPT, LIVE_CLANG_SCRIPT, LIVE_CLANG_FILES,
	digest, identity, judgeShellAcceptance, judgeLiveShellAcceptance, readPinnedProbeInputs
} from './probe-container-shell-acceptance-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const containerRoot = join(root, 'packages/container');
const csp = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'";

// Container, Core and LLVM tool-host source bundled into local modules, as the Clang browser
// qualification does, so module Workers need no import map.
async function bundles(inputs, clangProfile) {
	const sdkImport = `/sdk/${inputs.receipt.packageId}/index.mjs`;
	const sourceBytes = new Map();
	const result = await build({
		absWorkingDir: root,
		entryPoints: {
			owner: join(containerRoot, 'test/shell-acceptance/worker.mjs'),
			'clang-worker': join(root, clangProfile.workerPath),
			'live-worker': join(containerRoot, 'src/adapters/wasi-live/worker.ts')
		},
		alias: {
			'@wasm-idle/container': join(root, 'packages/container/src/index.ts'),
			'@wasm-idle/container/adapters/clang': join(root, 'packages/container/src/adapters/clang/index.ts'),
			'@wasm-idle/container/adapters/clang-live': join(root, 'packages/container/src/adapters/clang-live/index.ts'),
			'@wasm-idle/container/adapters/wasi-live': join(root, 'packages/container/src/adapters/wasi-live/index.ts'),
			'@wasm-idle/container/adapters/wasix': join(root, 'packages/container/src/adapters/wasix/index.ts'),
			'@wasm-idle/core': join(root, 'packages/core/src/index.ts'),
			'@wasm-idle/llvm-core/tool-host': join(root, 'packages/llvm-core/runtime/clang/src/tool-host.ts')
		},
		plugins: [{ name: 'pinned-sdk-module', setup(builder) {
			builder.onResolve({ filter: /^@wasm-idle\/pinned-wasix-sdk$/ }, () => ({ path: sdkImport, external: true }));
			builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => {
				const contents = await readFile(path), name = relative(root, path);
				assert(!sourceBytes.has(name) || sourceBytes.get(name).equals(contents), `Source changed between bundle entrypoints: ${name}`);
				sourceBytes.set(name, contents);
				return { contents, loader: path.endsWith('.ts') ? 'ts' : 'js' };
			});
		} }],
		bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
		outdir: '/bundle', write: false, metafile: true, logLevel: 'silent'
	});
	assert(Object.values(result.metafile.outputs).every((output) => output.imports.every((entry) => entry.external !== true || entry.kind === 'dynamic-import' || entry.path === sdkImport)),
		'only the exact pinned SDK may remain a static external import');
	const modules = new Map(result.outputFiles.map((file) => [file.path.split('/').at(-1), Buffer.from(file.contents)]));
	const sources = {};
	for (const input of Object.keys(result.metafile.inputs).sort()) {
		assert(sourceBytes.has(input), `Bundle input was not recorded: ${input}`);
		sources[input] = identity(sourceBytes.get(input));
	}
	return { modules, sources };
}

export async function checkProbe(configuration) {
	const clangProfile = selectClangProfile(configuration.clangFilesystem);
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
	const bytes = Buffer.from(manifest('http://127.0.0.1:1', inputs, 'busybox', clangProfile.filesystem));
	await validateDistribution({ bytes, expectedSha256: digest(bytes), adapterIds: ['wasi-preview1-live', clangProfile.adapterId],
		allowedAssetURLs: ['sdk', 'bash', 'busybox', 'clang', 'lld', 'sysroot'].map((name) => `http://127.0.0.1:1/assets/${name}`) });
	return { inputs, bundles: await bundles(inputs, clangProfile) };
}

// `busyboxAsset` names the served BusyBox body; the failure run points it at corrupted bytes
// while the manifest keeps the pinned digest.
export function manifest(origin, inputs, busyboxAsset = 'busybox', clangFilesystem) {
	const clangProfile = selectClangProfile(clangFilesystem);
	const busyboxIdentity = { ...identity(inputs.busybox), mediaType: 'application/wasm' };
	const producer = inputs.clang.producer.source;
	const llvmFiles = [
		{ path: 'bin/llvm', asset: 'clang', executable: true },
		{ path: 'bin/wasm-ld', asset: 'lld', executable: true },
		{ path: 'sysroot.tar', asset: 'sysroot', executable: false }
	];
	const index = {
		schemaVersion: 1,
		packages: [
			{
				id: 'shell', identity: `sha256:${digest(Buffer.from(JSON.stringify([inputs.receipt.packageId, digest(inputs.bash)])))}`,
				dependencies: [], mount: '/opt/toolchains/bash',
				producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: inputs.receipt.sourceCommit, receiptSha256: PACKAGE_RECEIPT.sha256 },
				capabilities: ['wasix'],
				assets: [['sdk', inputs.entries.get('wasmer_js_bg.wasm'), 'application/wasm'], ['bash', inputs.bash, 'application/octet-stream']].map(([id, bytes, mediaType]) => {
					const pinned = { ...identity(bytes), mediaType };
					return { id, url: `${origin}/assets/${id}`, encoding: 'identity', delivery: pinned, logical: pinned };
				}),
				files: [{ path: 'sdk.wasm', asset: 'sdk', executable: false }, { path: 'bash.webc', asset: 'bash', executable: false }]
			},
			{
				id: 'busybox', identity: `sha256:${busyboxIdentity.sha256}`, dependencies: [], mount: '/opt/toolchains/busybox',
				producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision: BUSYBOX_PRODUCER_REVISION, receiptSha256: inputs.busyboxReceiptSha256 },
				capabilities: ['wasi-preview1'],
				assets: [{ id: 'busybox', url: `${origin}/assets/${busyboxAsset}`, encoding: 'identity', delivery: busyboxIdentity, logical: busyboxIdentity }],
				files: [{ path: 'bin/busybox', asset: 'busybox', executable: true }]
			},
			{
				// Clang/LLD from their producer receipt, with the process-profile sysroot.
				id: 'llvm', identity: `sha256:${digest(Buffer.from(JSON.stringify([inputs.clang.producerSha256, PROCESS_SYSROOT_RECEIPT_SHA256, llvmFiles])))}`,
				dependencies: [], mount: '/opt/toolchains/llvm',
				producer: { repository: producer.repository, revision: producer.revision, receiptSha256: inputs.clang.producerSha256 },
				capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1'],
				assets: Object.entries(inputs.clang.assets).map(([name, asset]) => ({ ...asset.metadata, url: `${origin}/assets/${name}` })),
				files: llvmFiles
			}
		],
		commands: [
			...BUSYBOX_COMMANDS.map((name) => ({
				name, package: 'busybox', adapter: 'wasi-preview1-live', path: 'bin/busybox', argv0: name, prefixArgs: []
			})),
			// This producer emits an LLVM multicall executable. Its canonical basename must
			// remain llvm so the real driver can invoke [llvm, clang, -cc1, ...] unchanged.
			// The target profile follows that subcommand, before the user's arguments.
			{ name: 'clang', package: 'llvm', adapter: clangProfile.adapterId, path: 'bin/llvm', argv0: LLVM_EXECUTABLE, prefixArgs: ['clang', ...CLANG_PROFILE] }
		]
	};
	// The ID identifies this complete immutable policy and layout. It is not its
	// own trust root: consumers still require the independently pinned manifest hash.
	return JSON.stringify({ ...index, distributionId: `shell-acceptance-${digest(Buffer.from(JSON.stringify(index)))}` });
}

export async function runProbe(configuration, { syntaxOnly = false, liveOnly = false } = {}) {
	assert(typeof syntaxOnly === 'boolean' && typeof liveOnly === 'boolean' && !(syntaxOnly && liveOnly), 'Select one explicit acceptance scenario');
	const clangProfile = selectClangProfile(configuration.clangFilesystem);
	assert(!liveOnly || clangProfile.filesystem === 'live', '--run-live requires explicit clangFilesystem=live');
	assert(clangProfile.filesystem === 'snapshot' || liveOnly || syntaxOnly, 'Live Clang uses its separate --run-live gate, not snapshot interruption expectations');
	const prepared = await checkProbe(configuration);
	await mkdir(configuration.output, { mode: 0o700 });
	const receipt = {
		schemaVersion: 1, complete: false, shellAcceptancePassed: false, shellSyntaxPassed: false, liveShellAcceptancePassed: false,
		scenario: syntaxOnly ? 'syntax-only' : liveOnly ? 'live-only' : 'full', clangFilesystem: clangProfile.filesystem,
		startedAt: new Date().toISOString(),
		host: { node: process.version, platform: platform(), arch: arch(), kernelRelease: release(), osVersion: version() },
		applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
		script: syntaxOnly ? SYNTAX_SCRIPT : SCRIPT,
		syntaxScript: SYNTAX_SCRIPT,
		...(liveOnly ? { liveScript: LIVE_CLANG_SCRIPT } : {}),
		interruptScript: RUN_SCRIPTS.interrupt,
		interrupts: INTERRUPTS,
		packageReceipt: PACKAGE_RECEIPT,
		packageId: prepared.inputs.receipt.packageId,
		memory: MEMORY,
		diagnosticOptions: { sdkDiagnostics: configuration.sdkDiagnostics === true, omittedTmpMount: configuration.sdkDiagnostics === true && configuration.sdkDiagnosticsOmitTmp === true },
		bundles: Object.fromEntries([...prepared.bundles.modules].map(([name, bytes]) => [name, identity(bytes)])),
		bundleSources: prepared.bundles.sources,
		busybox: { receiptSha256: prepared.inputs.busyboxReceiptSha256, artifact: identity(prepared.inputs.busybox), shellCommands: BUSYBOX_SHELL_COMMANDS },
		processSysroot: prepared.inputs.processSysroot,
		clang: {
			producerReceiptSha256: prepared.inputs.clang.producerSha256, producerSmokeSha256: prepared.inputs.clang.producerSmokeSha256,
			assets: Object.fromEntries(Object.entries(prepared.inputs.clang.assets).map(([name, asset]) => [name, asset.metadata]))
		},
		runs: [],
		scope: liveOnly ? 'Real Bash, BusyBox, Clang and artifact share one live VFS; the live-only gate checks the unchanged script and streamed preprocessing while a concurrent utility reads an edited header; no snapshot cancellation or rollback claim'
			: clangProfile.filesystem === 'live' ? 'Syntax-only real Bash and BusyBox on the trusted live Clang application profile; Clang is not executed or qualified in this scenario'
			: 'One container Supervisor and filesystem; Bash /workspace is that filesystem; BusyBox and the artifact run live with delegated stdio; Clang runs on its snapshot adapter with forwarded output',
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
		served.set('/assets/sdk', { body: prepared.inputs.entries.get('wasmer_js_bg.wasm'), type: 'application/wasm' });
		served.set('/assets/bash', { body: prepared.inputs.bash, type: 'application/octet-stream' });
		served.set('/assets/busybox', { body: prepared.inputs.busybox, type: 'application/wasm' });
		// The same length with one flipped byte: only the pinned digest can reject it.
		const corrupted = Buffer.from(prepared.inputs.busybox);
		corrupted[corrupted.length >> 1] ^= 0xff;
		served.set('/assets/busybox-corrupt', { body: corrupted, type: 'application/wasm' });
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
		const distribution = manifest(origin, prepared.inputs, 'busybox', clangProfile.filesystem);
		receipt.distributionSha256 = digest(Buffer.from(distribution));
		const failureDistribution = manifest(origin, prepared.inputs, 'busybox-corrupt', clangProfile.filesystem);
		receipt.failureDistributionSha256 = digest(Buffer.from(failureDistribution));
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
		const consoleErrors = [], warnings = [], blockedRequests = [], sdkDiagnostics = [];
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
			if (configuration.sdkDiagnostics && sdkDiagnostics.length < 2000) sdkDiagnostics.push({ type: message.type(), text: message.text().slice(0, 4000) });
			if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000));
			if (message.type() === 'warning') warnings.push(message.text().slice(0, 2000));
		});
		await page.goto(origin, { timeout: 10000 });
			for (const run of syntaxOnly ? ['syntax'] : liveOnly ? ['cold', 'warm', 'live-io'] : RUNS) {
			const start = { ...downloads }, started = Date.now(), errorsBefore = consoleErrors.length;
			let result = {};
			try {
				result = await page.evaluate(({ sdkBase, memory, bashWasmSha256, timeout, payload }) => new Promise((done) => {
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
						worker = new Worker('/bundle/owner.js', { type: 'module' });
						worker.onmessage = ({ data }) => {
							events.push(data.type === 'result' ? { type: 'result' } : data);
							if (data.type === 'ownerCleanup') cleanupResolve?.(data);
							if (['result', 'failure'].includes(data.type)) finish(data);
						};
						worker.onerror = (event) => finish({ type: 'error', backendCompleted: false, error: event.message });
						worker.postMessage({ type: 'run', ...payload, memory, bashWasmSha256,
							sdkUrl: location.origin + sdkBase + '/index.mjs', sdkWorkerUrl: location.origin + sdkBase + '/worker.mjs',
							liveWorkerUrl: location.origin + '/bundle/live-worker.js', clangWorkerUrl: location.origin + '/bundle/clang-worker.js' });
					})().catch((error) => finish({ type: 'failure', backendCompleted: false, error: String(error) }));
				}), {
						sdkBase, memory: MEMORY, bashWasmSha256: BASH_WASM_SHA256, timeout: syntaxOnly ? 60000 : RUN_TIMEOUT_MS,
					payload: {
						sdkDiagnostics: configuration.sdkDiagnostics === true,
						sdkDiagnosticsOmitTmp: configuration.sdkDiagnostics === true && configuration.sdkDiagnosticsOmitTmp === true,
						script: run === 'live-io' ? LIVE_CLANG_SCRIPT : RUN_SCRIPTS[run], interrupts: run === 'interrupt' ? INTERRUPTS : [],
						clangFilesystem: clangProfile.filesystem, liveIo: run === 'live-io',
							recordSyntaxEnvironment: run === 'syntax',
						cwd: run === 'startup-failure' ? '/workspace/missing-initial-directory' : '/workspace',
						readFiles: run === 'live-io' ? LIVE_CLANG_FILES : run === 'interrupt' ? ['/workspace/demo/interrupted.wasm'] : run === 'failure' ? ['/workspace/bad.wasm']
								: run === 'pipeline' ? ['/workspace/group-file', '/workspace/sub-file', '/workspace/err-file'] : run === 'redirection' ? REDIRECTION_FILES : run === 'syntax' ? SYNTAX_FILES : READ_FILES,
						artifactPath: ['failure', 'redirection'].includes(run) ? '/workspace/hello.wasm' : '/workspace/demo/hello.wasm',
						...(run === 'failure'
							? { manifest: failureDistribution, manifestSha256: receipt.failureDistributionSha256, cacheNamespace: 'container-shell-acceptance-failure' }
							: { manifest: distribution, manifestSha256: receipt.distributionSha256, cacheNamespace: liveOnly ? 'container-shell-acceptance-live' : 'container-shell-acceptance' }),
						assetURLs: Object.keys(downloads).map((path) => origin + path),
						clangSha256: prepared.inputs.clang.assets.clang.metadata.logical.sha256,
						linkerSha256: prepared.inputs.clang.assets.lld.metadata.logical.sha256,
							commandTimeoutMs: syntaxOnly ? 30000 : COMMAND_TIMEOUT_MS
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
		if (configuration.sdkDiagnostics) receipt.sdkDiagnostics = sdkDiagnostics;
		await context.close();
		context = undefined;
		receipt.workersAfterContextClose = (await retire()).length;
		await readPinnedProbeInputs(configuration);
		assert.deepEqual((await bundles(prepared.inputs, clangProfile)).sources, prepared.bundles.sources, 'bundle sources changed during the probe');
		receipt.qualification = liveOnly ? judgeLiveShellAcceptance(receipt) : judgeShellAcceptance(receipt);
		receipt.shellAcceptancePassed = receipt.qualification.shellAcceptancePassed;
			receipt.shellSyntaxPassed = receipt.qualification.shellSyntaxPassed;
		receipt.liveShellAcceptancePassed = receipt.qualification.liveShellAcceptancePassed ?? false;
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
		shellAcceptancePassed: receipt.shellAcceptancePassed, shellSyntaxPassed: receipt.shellSyntaxPassed,
		liveShellAcceptancePassed: receipt.liveShellAcceptancePassed, clangFilesystem: clangProfile.filesystem, shellBackendReady: false };
}

const invoked = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (invoked === (await realpath(fileURLToPath(import.meta.url)))) {
	try {
		assert(process.argv.length === 4 && ['--check', '--run', '--run-syntax', '--run-live'].includes(process.argv[2]),
			'usage: probe-container-shell-acceptance.mjs --check|--run|--run-syntax|--run-live /absolute/config.json');
		assert(isAbsolute(process.argv[3]), 'absolute configuration path required');
		const configuration = JSON.parse(await readFile(process.argv[3]));
		if (process.argv[2] === '--check') {
			const checked = await checkProbe(configuration);
			console.log(JSON.stringify({ checked: true, browserLaunched: false, clangFilesystem: selectClangProfile(configuration.clangFilesystem).filesystem, packageId: checked.inputs.receipt.packageId,
				bundles: Object.fromEntries([...checked.bundles.modules].map(([name, bytes]) => [name, bytes.length])) }));
		} else {
			const syntaxOnly = process.argv[2] === '--run-syntax';
			const liveOnly = process.argv[2] === '--run-live';
			const result = await runProbe(configuration, { syntaxOnly, liveOnly });
			console.log(JSON.stringify(result));
			if (!result.complete || !(syntaxOnly ? result.shellSyntaxPassed : liveOnly ? result.liveShellAcceptancePassed : result.shellAcceptancePassed)) process.exitCode = 1;
		}
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
