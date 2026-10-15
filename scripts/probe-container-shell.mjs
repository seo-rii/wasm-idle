import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, release, platform } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { resolveChromiumExecutable } from './rust-browser-probe-lib.mjs';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { judgeShellProbe } from './probe-container-shell-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'packages/container/test/g0-shell');
const assetRoot = resolve(
	process.env.WASM_IDLE_CONTAINER_BASH_ASSETS || join(root, 'static/wasm-bash')
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const temporary = await mkdtemp(join(tmpdir(), 'container-g0-'));
const receipts = {};
let browser, server;
try {
	const lock = JSON.parse(
		await readFile(join(root, 'scripts/wasm-bash-assets.lock.json'), 'utf8')
	);
	const assets = new Map();
	for (const [url, path, receipt, gzip] of [
		['/sdk/index.mjs', 'sdk/index.mjs.bin', lock.wasmerSdk.files['dist/index.mjs'], false],
		[
			'/sdk/wasmer.wasm',
			'sdk/wasmer_js_bg.wasm.gz.bin',
			lock.wasmerSdk.files['dist/wasmer_js_bg.wasm'],
			true
		],
		[
			'/bash.webc',
			'bash.webc.gz.bin',
			{ bytes: lock.bash.runtimeBuild.webcBytes, sha256: lock.bash.runtimeBuild.webcSha256 },
			true
		]
	]) {
		const delivery = await readFile(join(assetRoot, path));
		const logical = gzip ? gunzipSync(delivery) : delivery;
		assert.equal(logical.length, receipt.bytes, `${path}: logical byte count`);
		assert.equal(sha256(logical), receipt.sha256, `${path}: pinned logical SHA-256`);
		assets.set(url, logical);
		receipts[path] = {
			deliveryBytes: delivery.length,
			deliverySha256: sha256(delivery),
			...receipt
		};
	}
	const compiler = process.env.WASM_IDLE_CONTAINER_FIXTURE_CLANG || 'clang';
	const compilerArgs = [
		'--target=wasm32',
		'-nostdlib',
		'-O1',
		'-fno-builtin',
		'-Wl,--entry=_start',
		'-Wl,--export-memory',
		'-Wl,--max-memory=16777216',
		'-Wl,-z,stack-size=65536',
		'-o',
		join(temporary, 'probe.wasm'),
		join(fixtureRoot, 'probe.c')
	];
	execFileSync(compiler, compilerArgs, { stdio: 'pipe' });
	const probe = await readFile(join(temporary, 'probe.wasm'));
	assets.set('/probe.wasm', probe);
	execFileSync(compiler, [...compilerArgs, '-DG0_WASIX_CWD', '-o', join(temporary, 'cwd.wasm')], {
		stdio: 'pipe'
	});
	assets.set('/cwd.wasm', await readFile(join(temporary, 'cwd.wasm')));
	if (process.env.WASM_IDLE_CONTAINER_CLANG_GZIP) {
		const clang = gunzipSync(await readFile(process.env.WASM_IDLE_CONTAINER_CLANG_GZIP));
		assert.equal(
			sha256(clang),
			'd92ef06cdd3fea88acf384db15a6f2a344790c05bcba8e9f13f5b75b36ad4a99'
		);
		assets.set('/clang.wasm', clang);
		receipts.clang = {
			bytes: clang.length,
			sha256: sha256(clang),
			imports: WebAssembly.Module.imports(await WebAssembly.compile(clang))
		};
	}
	assets.set('/worker.mjs', await readFile(join(fixtureRoot, 'worker.mjs')));
	assets.set('/syscall-trace.mjs', await readFile(join(fixtureRoot, 'syscall-trace.mjs')));
	assets.set('/', Buffer.from('<!doctype html><title>Container G0 shell probe</title>'));
	const requests = [];
	let activeDownloads = 0,
		abortedDownloads = 0;
	server = createServer((req, res) => {
		const path = new URL(req.url, 'http://localhost').pathname;
		requests.push(path);
		const body = assets.get(path === '/slow-bash.webc' ? '/bash.webc' : path);
		res.writeHead(body ? 200 : 404, {
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Cross-Origin-Embedder-Policy': 'require-corp',
			'Content-Type': path.endsWith('.mjs')
				? 'text/javascript'
				: path.endsWith('.wasm')
					? 'application/wasm'
					: path === '/'
						? 'text/html'
						: 'application/octet-stream',
			'Cache-Control': 'no-store'
		});
		if (path === '/slow-bash.webc') {
			activeDownloads++;
			res.write(body.subarray(0, 16384));
			const finish = setTimeout(() => res.end(body.subarray(16384)), 10000);
			res.once('close', () => {
				clearTimeout(finish);
				activeDownloads--;
				if (!res.writableFinished) abortedDownloads++;
			});
		} else res.end(body ?? 'Not found');
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	const origin = `http://127.0.0.1:${server.address().port}`;
	browser = await chromium.launch({
		executablePath: await resolveChromiumExecutable(
			process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || ''
		),
		headless: true,
		args: ['--no-sandbox']
	});
	const cases = [
		{ id: 'G0-SHELL', script: './probe.wasm report "space arg" "한글" ""; :' },
		{
			id: 'G0-ARGV-FRAME',
			script: './probe.wasm report "" $\'line\\nbreak\' $\'carriage\\rreturn\' ""; :'
		},
		{ id: 'G0-ENV-UNSET', script: 'unset G0; ./probe.wasm report; :' },
		{ id: 'G0-TAIL-EXEC', script: './probe.wasm report tail' },
		{ id: 'G0-EXIT', script: './probe.wasm exit; printf "exit=%d\\n" "$?"' },
		{ id: 'G0-CWD', script: 'cd sub; /workspace/cwd.wasm cwd; printf "\\nexit=%d\\n" "$?"' },
		{
			id: 'G0-FD',
			script: './probe.wasm copy | ./probe.wasm copy > binary; ./probe.wasm copy < binary',
			stdin: [0, 255, 226, 130, 172, 10, 13, 97, 98],
			readFiles: ['/binary']
		},
		{
			id: 'G0-FS',
			script: 'cd sub; IFS= read -r marker < marker; printf "%s\\n" "$marker"; printf "from-shell\\n" > source; /workspace/probe.wasm file /workspace/sub/source /workspace/sub/changed; printf "file-exit=%d\\n" "$?"; IFS= read -r changed < changed; printf "%s\\n" "$changed"',
			readFiles: ['/sub/source', '/sub/changed']
		},
		{ id: 'G0-BRIDGE-IMPORT', script: './bridge.wasm; printf "bridge-exit=%d\\n" "$?"' },
		{ id: 'G0-CANCEL-CPU', script: './probe.wasm loop', cancel: true },
		{ id: 'G0-CANCEL-READ', script: './probe.wasm blocked', interactive: true, cancel: true },
		{ id: 'G0-CANCEL-DOWNLOAD', script: ':', slowDownload: true, cancel: true }
	];
	if (assets.has('/clang.wasm'))
		cases.push(
			{ id: 'G0-CLANG-VERSION', script: './clang --version; exit "$?"', clang: true },
			{
				id: 'G0-CLANG-RELATIVE',
				script: './clang --target=wasm32 -c main.c -o main.o; exit "$?"',
				clang: true,
				readFiles: ['/main.o']
			},
			{
				id: 'G0-CLANG-COMPILE',
				script: './clang --target=wasm32 -c /workspace/main.c -o /workspace/main.o; exit "$?"',
				clang: true,
				readFiles: ['/main.o']
			},
			{
				id: 'G0-CLANG-LINK',
				script: './clang --target=wasm32 -nostdlib -Wl,--no-entry -Wl,--export-all /workspace/main.c -o /workspace/hello.wasm; exit "$?"',
				clang: true,
				readFiles: ['/hello.wasm']
			}
		);
	const results = [];
	let runtimeInventory;
	for (const fixture of cases) {
		if (process.env.WASM_IDLE_CONTAINER_TRACE_SYSCALLS === '1') fixture.traceSyscalls = true;
		if (
			process.env.WASM_IDLE_CONTAINER_PROBE_CASES &&
			!process.env.WASM_IDLE_CONTAINER_PROBE_CASES.split(',').includes(fixture.id)
		)
			continue;
		const context = await browser.newContext();
		const blockedRequests = [];
		await context.route('**/*', (route) => {
			if (new URL(route.request().url()).origin === origin) return route.continue();
			blockedRequests.push(route.request().url());
			return route.abort('blockedbyclient');
		});
		await addBrowserTestCookies(context, origin);
		const page = await context.newPage();
		const consoleErrors = [];
		page.on('pageerror', (error) => consoleErrors.push(String(error)));
		page.on('console', (message) => {
			if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 2000));
		});
		await page.goto(origin);
		const cdp = await context.newCDPSession(page);
		const contextId = (await cdp.send('Target.getTargetInfo')).targetInfo.browserContextId;
		const start = Date.now();
		await page.evaluate(() => {
			globalThis.runG0 = async (fixture) => {
				if (!crossOriginIsolated) throw new Error('Probe requires cross-origin isolation');
				return await new Promise((done) => {
					const worker = new Worker('/worker.mjs', { type: 'module' });
					const trace = [];
					const syscalls = [];
					const timer = setTimeout(() => {
						worker.terminate();
						done({ type: 'timeout', syscalls });
					}, 20000);
					worker.onmessage = ({ data }) => {
						if (data.type === 'g0Syscall') syscalls.push(data);
						if (data.type === 'downloadPending' && fixture.cancel)
							setTimeout(() => worker.postMessage({ type: 'cancel' }), 100);
						if (data.type === 'output' && data.stream === 'stdout' && fixture.cancel)
							setTimeout(() => worker.postMessage({ type: 'cancel' }), 50);
						if (data.type === 'output') trace.push(data);
						if (['result', 'failure', 'cancelled'].includes(data.type)) {
							clearTimeout(timer);
							worker.terminate();
							done({
								...data,
								trace,
								...(fixture.traceSyscalls ? { syscalls } : {})
							});
						}
					};
					worker.onerror = (event) => {
						clearTimeout(timer);
						worker.terminate();
						done({ type: 'error', error: event.message });
					};
					worker.postMessage({ type: 'run', ...fixture });
				});
			};
		});
		const result = await page.evaluate((fixture) => globalThis.runG0(fixture), fixture);
		if (result.bashWasmSha256) {
			assert.equal(
				result.bashWasmSha256,
				lock.bash.runtimeBuild.wasmSha256,
				'Bash executable identity'
			);
			runtimeInventory = {
				bashWasmSha256: result.bashWasmSha256,
				bashImports: result.bashImports,
				publicApi: result.publicApi
			};
			delete result.bashImports;
			delete result.bashWasmSha256;
			delete result.publicApi;
		}
		let targets;
		const retiredBy = Date.now() + 5000;
		do {
			await page.waitForTimeout(100);
			targets = (await cdp.send('Target.getTargets')).targetInfos.filter(
				({ type, browserContextId }) => type === 'worker' && browserContextId === contextId
			);
		} while (targets.length && Date.now() < retiredBy);
		const recovered = fixture.cancel
			? await page.evaluate(() => globalThis.runG0({ script: 'printf recovered' }))
			: undefined;
		const recovery = recovered ? { type: recovered.type, result: recovered.result } : undefined;
		results.push({
			id: fixture.id,
			script: fixture.script,
			...result,
			elapsedMs: Date.now() - start,
			remainingWorkerTargets: targets.length,
			consoleErrors,
			blockedRequests,
			...(recovery ? { recovery } : {}),
			...(fixture.slowDownload ? { activeDownloads, abortedDownloads } : {})
		});
		await context.close();
	}
	const receipt = {
		schemaVersion: 1,
		applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: root,
			encoding: 'utf8'
		}).trim(),
		browser: browser.version(),
		os: `${platform()} ${release()}`,
		isolated: true,
		cache: 'no-store / fresh context per case',
		sdkVersion: lock.wasmerSdk.npmVersion,
		bashSourceRevision: lock.bash.runtimeBuild.sourceRevision,
		assets: receipts,
		fixture: {
			sourceSha256: sha256(await readFile(join(fixtureRoot, 'probe.c'))),
			bytes: probe.length,
			sha256: sha256(probe),
			compiler: execFileSync(compiler, ['--version'], { encoding: 'utf8' }).split('\n')[0],
			imports: WebAssembly.Module.imports(await WebAssembly.compile(probe))
		},
		results,
		requests
	};
	receipt.qualification = judgeShellProbe(results);
	receipt.runtimeInventory = runtimeInventory;
	const cwd = assets.get('/cwd.wasm');
	receipt.fixture.cwd = {
		bytes: cwd.length,
		sha256: sha256(cwd),
		imports: WebAssembly.Module.imports(await WebAssembly.compile(cwd))
	};
	receipt.harness = {
		runnerSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
		workerSha256: sha256(await readFile(join(fixtureRoot, 'worker.mjs')))
	};
	if (process.env.WASM_IDLE_CONTAINER_TRACE_SYSCALLS === '1')
		receipt.harness.syscallTraceSha256 = sha256(
			await readFile(join(fixtureRoot, 'syscall-trace.mjs'))
		);
	if (process.env.WASM_IDLE_CONTAINER_PROBE_OUTPUT)
		await writeFile(
			process.env.WASM_IDLE_CONTAINER_PROBE_OUTPUT,
			JSON.stringify(receipt, null, 2) + '\n',
			{ mode: 0o600 }
		);
	console.log(JSON.stringify(receipt, null, 2));
	if (process.argv.includes('--require-shell-gate') && !receipt.qualification.shellBackendReady)
		process.exitCode = 1;
} finally {
	await browser?.close();
	await new Promise((done) => (server ? server.close(done) : done()));
	await rm(temporary, { recursive: true, force: true });
}
