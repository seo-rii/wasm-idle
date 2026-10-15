// Opt-in actual browser probe. The original 18-check shell suite is unchanged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { arch, platform, release } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProbe } from './probe-patched-container-shell.mjs';
import {
	BASH_WASM_SHA256,
	MEMORY,
	PACKAGE_RECEIPT,
	digest,
	identity,
	readPinnedProbeInputs
} from './probe-patched-container-shell-lib.mjs';
import {
	cancellationFixtures,
	judgeCancellationProbe
} from './probe-patched-container-shell-cancel-lib.mjs';
import { installCancellationSession } from '../packages/container/test/patched-shell/cancel-page.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'packages/container/test');
const sourceFiles = [
	'g0-shell/probe.c',
	'patched-shell/cancel-worker.mjs',
	'patched-shell/cancel-page.mjs'
];
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

export async function checkCancellationProbe(configuration) {
	const prepared = await checkProbe(configuration);
	const sources = {};
	for (const relative of sourceFiles)
		sources[relative] = identity(await readFile(join(fixtureRoot, relative)));
	return { ...prepared, sources };
}

export async function runCancellationProbe(configuration) {
	const prepared = await checkCancellationProbe(configuration);
	await mkdir(configuration.output, { mode: 0o700 });
	const receipt = {
		schemaVersion: 1,
		complete: false,
		forcedOwnerCancellationPassed: false,
		startedAt: new Date().toISOString(),
		applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			encoding: 'utf8'
		}).trim(),
		host: {
			node: process.version,
			platform: platform(),
			arch: arch(),
			kernelRelease: release()
		},
		packageReceipt: PACKAGE_RECEIPT,
		packageId: prepared.inputs.receipt.packageId,
		memory: MEMORY,
		sources: prepared.sources,
		commands: [],
		requests: [],
		results: [],
		cancellationScope:
			'Forced trusted host Worker-group cleanup; recovery uses a new owner and SDK memory in the same page',
		filesystemScope: 'Native WASIX Directory; no common Container fd/VFS installed',
		networkScope:
			'Approved local asset response only; not the Container asset-service cancellation contract',
		guestSignalQualified: false,
		survivingShellQualified: false,
		commonContainerFdVfsQualified: false,
		shellBackendReady: false
	};
	const receiptPath = join(configuration.output, 'receipt.json');
	const save = () =>
		writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
	let browser, server;
	try {
		await save();
		const compiled = join(configuration.output, 'probe.wasm');
		const args = [
			'--target=wasm32',
			'-nostdlib',
			'-O1',
			'-fno-builtin',
			`-fuse-ld=${prepared.inputs.linker}`,
			'-Wl,--entry=_start',
			'-Wl,--export-memory',
			'-Wl,--max-memory=16777216',
			'-Wl,-z,stack-size=65536',
			'-o',
			compiled,
			join(fixtureRoot, 'g0-shell/probe.c')
		];
		const command = { command: configuration.clang, args, exitCode: null };
		receipt.commands.push(command);
		execFileSync(configuration.clang, args, { timeout: 15000, maxBuffer: 65536 });
		command.exitCode = 0;
		const assets = new Map();
		const descriptions = [];
		for (const [key, name, bytes] of [
			['probeWasm', 'probe.wasm', await readFile(compiled)],
			['sdkWasm', 'sdk.wasm', prepared.inputs.entries.get('wasmer_js_bg.wasm')],
			['bashWebc', 'bash.webc', prepared.inputs.bash]
		]) {
			const url = `/assets/sha256-${digest(bytes)}/${name}`;
			assets.set(url, bytes);
			descriptions.push({ key, url, ...identity(bytes) });
		}
		const sdkBase = '/sdk/' + prepared.inputs.receipt.packageId;
		for (const name of ['index.mjs', 'worker.mjs'])
			assets.set(sdkBase + '/' + name, prepared.inputs.entries.get(name));
		const worker = await readFile(join(fixtureRoot, 'patched-shell/cancel-worker.mjs'));
		const workerUrl = `/harness/sha256-${digest(worker)}/cancel-worker.mjs`;
		assets.set(workerUrl, worker);
		assets.set(
			'/',
			Buffer.from('<!doctype html><title>Actual Bash forced owner cancellation</title>')
		);
		const slowUrl = `/pending/sha256-${digest(prepared.inputs.bash)}/bash.webc`;
		const slowBashAsset = { url: slowUrl, ...identity(prepared.inputs.bash) };
		let downloads = {
			active: 0,
			aborted: 0,
			completed: 0,
			sentBytes: 0,
			expectedBytes: prepared.inputs.bash.length
		};
		server = createServer((request, response) => {
			const url = new URL(request.url, 'http://127.0.0.1');
			const slow = url.pathname === slowUrl;
			const body =
				request.method === 'GET' && !url.search
					? slow
						? prepared.inputs.bash
						: assets.get(url.pathname)
					: undefined;
			receipt.requests.push({
				method: request.method,
				path: url.pathname,
				accepted: Boolean(body)
			});
			response.writeHead(body ? 200 : 404, {
				'Cross-Origin-Opener-Policy': 'same-origin',
				'Cross-Origin-Embedder-Policy': 'require-corp',
				'Content-Security-Policy':
					"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'",
				'Content-Type': url.pathname.endsWith('.mjs')
					? 'text/javascript'
					: url.pathname.endsWith('.wasm')
						? 'application/wasm'
						: url.pathname === '/'
							? 'text/html'
							: 'application/octet-stream',
				'Cache-Control':
					slow || url.pathname === '/'
						? 'no-store'
						: 'public, max-age=31536000, immutable',
				...(body ? { 'Content-Length': body.length } : {})
			});
			if (slow && body) {
				const observation = downloads;
				observation.active++;
				const prefix = body.subarray(0, 16384);
				response.write(prefix);
				observation.sentBytes += prefix.length;
				const limit = setTimeout(() => {
					observation.sentBytes += body.length - prefix.length;
					response.end(body.subarray(prefix.length));
				}, 30000);
				response.once('close', () => {
					clearTimeout(limit);
					observation.active--;
					observation[response.writableFinished ? 'completed' : 'aborted']++;
				});
			} else response.end(body ?? 'Not found');
		});
		await new Promise((done) => server.listen(0, '127.0.0.1', done));
		const origin = `http://127.0.0.1:${server.address().port}`;
		receipt.assets = Object.fromEntries(
			[...assets].map(([url, bytes]) => [url, identity(bytes)])
		);
		receipt.slowBashAsset = slowBashAsset;
		const { chromium } = await import('playwright-core');
		const { resolveChromiumExecutable } = await import('./rust-browser-probe-lib.mjs');
		const executablePath = await resolveChromiumExecutable(configuration.chromium || '');
		receipt.chromiumExecutable = {
			path: executablePath,
			...identity(await readFile(executablePath))
		};
		browser = await chromium.launch({
			executablePath,
			headless: true,
			args: ['--no-sandbox', '--disable-background-networking']
		});
		receipt.browser = browser.version();
		const cdp = await browser.newBrowserCDPSession();
		let created;
		cdp.on('Target.targetCreated', ({ targetInfo }) => {
			if (targetInfo.type === 'worker' && created) created.push(targetInfo);
		});
		await cdp.send('Target.setDiscoverTargets', { discover: true });
		const workers = async () =>
			(await cdp.send('Target.getTargets')).targetInfos.filter(
				({ type }) => type === 'worker'
			);
		const retire = async () => {
			const deadline = Date.now() + 5000;
			let remaining;
			do {
				remaining = await workers();
				if (!remaining.length) break;
				await delay(50);
			} while (Date.now() < deadline);
			return remaining.length;
		};
		for (const fixture of cancellationFixtures) {
			const context = await browser.newContext({ serviceWorkers: 'block' });
			const consoleErrors = [],
				warnings = [],
				blockedRequests = [];
			const value = {
				id: fixture.id,
				script: fixture.script,
				initialWorkers: (await workers()).length,
				consoleErrors,
				warnings,
				blockedRequests,
				samePageRecovery: false,
				hostContextClosed: false
			};
			created = [];
			const started = Date.now();
			downloads = {
				active: 0,
				aborted: 0,
				completed: 0,
				sentBytes: 0,
				expectedBytes: prepared.inputs.bash.length
			};
			try {
				await context.route('**/*', (route) => {
					const url = new URL(route.request().url());
					if (
						url.origin === origin &&
						!url.search &&
						(assets.has(url.pathname) || url.pathname === slowUrl)
					)
						return route.continue();
					blockedRequests.push(url.href);
					return route.abort('blockedbyclient');
				});
				await addBrowserTestCookies(context, origin);
				const page = await context.newPage();
				page.on('pageerror', (error) => consoleErrors.push(String(error).slice(0, 2000)));
				page.on('console', (message) => {
					if (message.type() === 'error')
						consoleErrors.push(message.text().slice(0, 2000));
					if (message.type() === 'warning') warnings.push(message.text().slice(0, 2000));
				});
				await page.goto(origin, { timeout: 10000 });
				await page.evaluate(installCancellationSession, {
					descriptions,
					sdkBase,
					workerUrl,
					memory: MEMORY,
					bashWasmSha256: BASH_WASM_SHA256,
					slowBashAsset
				});
				value.cancellation = await page.evaluate(
					(fixture) => globalThis.runCancellationSession(fixture),
					fixture
				);
				const cancelledAt = Date.now();
				value.workersBeforeRecovery = await retire();
				value.retirementAfterAcknowledgementMs = Date.now() - cancelledAt;
				if (fixture.slowDownload) {
					const deadline = Date.now() + 5000;
					while (downloads.active && Date.now() < deadline) await delay(50);
					value.download = { ...downloads };
				}
				value.recovery = await page.evaluate(() =>
					globalThis.runCancellationSession({
						id: 'RECOVERY',
						script: 'printf recovered',
						cancel: false
					})
				);
				value.samePageRecovery = true;
				value.workersAfterRecovery = await retire();
			} catch (error) {
				value.error = String(error);
			} finally {
				await context.close();
				value.hostContextClosed = true;
			}
			value.workersAfterContextClose = await retire();
			value.createdWorkerTargets = created;
			const ids = new Set(created.map(({ targetId }) => targetId));
			value.createdNestedWorkerTargets = created.filter(({ parentId }) =>
				ids.has(parentId)
			).length;
			value.elapsedMs = Date.now() - started;
			receipt.results.push(value);
			await save();
			assert.equal(value.workersAfterContextClose, 0, 'owned context leaked Workers');
			assert.equal(downloads.active, 0, 'owned pending download leaked');
		}
		for (const [relative, expected] of Object.entries(prepared.sources))
			assert.deepEqual(identity(await readFile(join(fixtureRoot, relative))), expected);
		await readPinnedProbeInputs(configuration);
		receipt.qualification = judgeCancellationProbe(receipt.results);
		receipt.forcedOwnerCancellationPassed = receipt.qualification.forcedOwnerCancellationPassed;
		receipt.complete = true;
	} catch (error) {
		receipt.error = String(error);
	} finally {
		await browser?.close();
		server?.closeAllConnections();
		await new Promise((done) => (server ? server.close(done) : done()));
		receipt.finishedAt = new Date().toISOString();
		await save();
	}
	return {
		receipt: receiptPath,
		complete: receipt.complete,
		forcedOwnerCancellationPassed: receipt.forcedOwnerCancellationPassed,
		shellBackendReady: false
	};
}

const invoked = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (invoked === (await realpath(fileURLToPath(import.meta.url)))) {
	try {
		assert(
			process.argv.length === 4 && ['--check', '--run'].includes(process.argv[2]),
			'usage: probe-patched-container-shell-cancel.mjs --check|--run /absolute/config.json'
		);
		assert(isAbsolute(process.argv[3]), 'absolute configuration required');
		const configuration = JSON.parse(await readFile(process.argv[3]));
		if (process.argv[2] === '--check') {
			await checkCancellationProbe(configuration);
			console.log(
				JSON.stringify({
					checked: true,
					built: false,
					browserLaunched: false,
					cases: cancellationFixtures.length
				})
			);
		} else {
			const result = await runCancellationProbe(configuration);
			console.log(JSON.stringify(result));
			if (!result.complete || !result.forcedOwnerCancellationPassed) process.exitCode = 1;
		}
	} catch (error) {
		console.error(String(error));
		process.exitCode = 1;
	}
}
