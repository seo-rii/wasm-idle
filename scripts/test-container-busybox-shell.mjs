// Real GNU Bash and BusyBox through the website's pinned same-origin assets.
// Example: node scripts/test-container-busybox-shell.mjs --assets /prepared/container-app --stage1 --output /new/evidence.json
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { addBrowserTestCookies } from './browser-test-cookies.mjs';
import { createCommandMatrix } from '../runtimes/wasm-busybox/test/command-cases.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
	assets: { type: 'string' }, output: { type: 'string' },
	stage1: { type: 'boolean' }, stage2: { type: 'boolean' }, stage3: { type: 'boolean' }, stage4: { type: 'boolean' },
	'dependency-root': { type: 'string' }, 'source-container': { type: 'boolean', default: false }
} });
const selected = [1, 2, 3, 4].filter(stage => values[`stage${stage}`]);
assert.equal(selected.length, 1, 'Select exactly one of --stage1, --stage2, --stage3, --stage4');
assert(values.assets && values.output, 'Required: --assets DIRECTORY --stageN --output NEW_JSON');
const stage = selected[0], assets = resolve(values.assets), output = resolve(values.output);
assert(!output.startsWith(repository + sep), 'Evidence output must be outside the checkout');
await access(dirname(output));
await assert.rejects(access(output), { code: 'ENOENT' }, 'Existing evidence is preserved');
const dependencyRequire = createRequire(pathToFileURL(resolve(values['dependency-root'] ?? repository, 'package.json')));
const { build } = dependencyRequire('esbuild'), { chromium } = dependencyRequire('playwright-core');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({ bytes: bytes.length, sha256: hash(bytes) });
const matrix = createCommandMatrix(stage);
const builtins = ['echo', 'false', 'printf', 'pwd', 'true'];
const commands = ['busybox', ...matrix.applets.filter(name => !builtins.includes(name))];
const script = [
	'set -eu', 'set -o pipefail',
	`for name in ${commands.join(' ')}; do test "$(command -v "$name")" = "/usr/local/bin/$name"; done`,
	'for name in echo printf pwd true false; do test "$(command -v "$name")" = "$name"; done',
	"printf 'stage1:routes-ok\\n'",
	'mkdir -p "/workspace/shell smoke"', 'cd "/workspace/shell smoke"',
	"printf 'beta\\nalpha\\nalpha\\n' > input.txt", "printf 'hidden\\n' > .hidden",
	'busybox --list > applets.txt', 'test "$(grep -x ls applets.txt)" = ls',
	'ls -a . > listing.txt', 'test "$(grep -x ".hidden" listing.txt)" = .hidden',
	'test "$(head -n 1 input.txt)" = beta', 'test "$(tail -n 1 input.txt)" = alpha',
	'test "$(wc -l < input.txt)" -eq 3',
	'cat input.txt | sort | uniq | tee sorted.txt > pipeline.txt',
	'test "$(cat sorted.txt)" = "alpha\nbeta"', 'test "$(cat pipeline.txt)" = "$(cat sorted.txt)"',
	"test \"$(printf 'name:7\\n' | cut -d ':' -f 2)\" = 7",
	"test \"$(printf 'ab\\n' | tr 'a-z' 'A-Z')\" = AB",
	"printf 'stage1:streams-ok\\n'",
	'test "$(basename "/workspace/shell smoke/input.txt")" = input.txt',
	'test "$(dirname "/workspace/shell smoke/input.txt")" = "/workspace/shell smoke"',
	'test "$(readlink link.txt)" = input.txt',
	'test "$(realpath link.txt)" = "/workspace/shell smoke/input.txt"',
	'cp input.txt copy.txt', 'mv copy.txt moved.txt', 'rm moved.txt',
	'mkdir removable', 'rmdir removable', "printf 'stage1:paths-ok\\n'",
	'if ls does-not-exist > missing.out 2> missing.err; then exit 91; else failed=$?; fi',
	'test "$failed" -eq 1', 'test -s missing.err', "printf 'stage1:missing-status=%s\\n' \"$failed\"",
	...(stage >= 2 ? [
		"sed 's/alpha/ALPHA/g' input.txt > transformed.txt", 'test "$(tail -n 1 transformed.txt)" = ALPHA',
		'mkdir -p copy-source/nested', "printf 'copy bytes\\n' > copy-source/nested/value.txt",
		'cp -R copy-source copy-destination',
		'cmp copy-source/nested/value.txt copy-destination/nested/value.txt',
		'diff copy-source/nested/value.txt copy-destination/nested/value.txt',
		'ln -s copy-source/nested/value.txt copied-link',
		'test "$(readlink copied-link)" = copy-source/nested/value.txt',
		'test "$(find copy-destination -type f)" = copy-destination/nested/value.txt',
		"printf abc > abc.txt", "test \"$(sha256sum abc.txt | cut -d ' ' -f 1)\" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		'test "$(base64 abc.txt)" = YWJj', "test \"$(printf YWJj | base64 -d)\" = abc",
		'test "$(od -An -tx1 abc.txt)" = " 61 62 63"',
		`test "$(hexdump -v -e '1/1 "%02x"' abc.txt)" = 616263`,
		"printf 'stage2:files-and-text-ok\\n'"
	] : []),
	...(stage >= 3 ? [
		'printf abc > metadata.txt', 'touch -t 202001020304.05 metadata.txt',
		'test "$(cat metadata.txt)" = abc', 'test "$(stat -c "%s|%Y" metadata.txt)" = "3|1577934245"',
		'touch -c not-created', 'test ! -e not-created', 'ls -ln metadata.txt > metadata.list',
		"printf 'stage3:metadata-ok\\n'"
	] : []),
	...(stage >= 4 ? [
		'mkdir -p archive-source/nested archive-destination unzip-destination',
		"printf 'archive bytes\\n' > archive-source/nested/text.txt", 'ln -s nested/text.txt archive-source/link',
		'tar -cf - archive-source | gzip -c > bundle.tar.gz',
		'gunzip -c bundle.tar.gz | tar -xf - -C archive-destination',
		'cmp archive-source/nested/text.txt archive-destination/archive-source/nested/text.txt',
		'test "$(readlink archive-destination/archive-source/link)" = nested/text.txt',
		'gunzip -c bundle.tar.gz | tar -tf - > members.txt',
		'test "$(grep -x archive-source/nested/text.txt members.txt)" = archive-source/nested/text.txt',
		'unzip -q /workspace/shell-fixture.zip -d unzip-destination',
		'cmp /workspace/shell-archive-expected.bin "unzip-destination/input file.bin"',
		"printf 'invalid gzip bytes\\n' > invalid.gz",
		'if gunzip -c invalid.gz > invalid.out 2> invalid.err; then exit 92; else failed=$?; fi',
		'test "$failed" -ne 0', 'test -s invalid.err', "printf 'stage4:archives-ok\\n'"
	] : []),
	`printf 'busybox-shell-stage-${stage}-ok\\n'`
].join('\n') + '\n';
const expectedStdout = ['stage1:routes-ok', 'stage1:streams-ok', 'stage1:paths-ok', 'stage1:missing-status=1',
	...(stage >= 2 ? ['stage2:files-and-text-ok'] : []), ...(stage >= 3 ? ['stage3:metadata-ok'] : []),
	...(stage >= 4 ? ['stage4:archives-ok'] : []), `busybox-shell-stage-${stage}-ok`].join('\n') + '\n';
const zipCase = stage === 4 ? matrix.cases.find(test => test.id === 'unzip-extract-space-binary') : undefined;
const fixture = zipCase ? { zipHex: zipCase.before['archive.zip'].hex, expectedHex: zipCase.after['input file.bin'].hex } : undefined;

const owner = `
import { createBashProfile } from './examples/container/bash-profile.mjs';
import { createWebsiteBashConfiguration } from './src/lib/playground/container/release.ts';
let profile, preparing, session, disposal, started = false;
const records = [], invocations = [];
const dispose = () => disposal ??= (async () => { await preparing?.catch(() => {}); await profile?.dispose(); })();
self.onmessage = async ({ data }) => {
  if (data.type === 'cleanup') {
    try { await dispose(); self.postMessage({ type: 'cleanup', workers: profile?.workers.inspect() }); }
    catch (error) { self.postMessage({ type: 'cleanup', error: String(error) }); }
    self.close(); return;
  }
  if (data.type !== 'run' || started) return;
  started = true;
  try {
    const { config, sdk } = await createWebsiteBashConfiguration(self.location.origin + '/');
    preparing = createBashProfile({ config: { ...config, commandTimeoutMs: 30000 }, sdk,
      onInvocation(value) { invocations.push({ path: value.path, argv: [...value.argv], cwd: value.cwd }); },
      onRecord(value) { records.push({ path: value.path, status: value.status, pid: value.pid, reason: value.result?.reason, code: value.result?.code, startError: value.startError }); }
    }).then(value => { profile = value; return value; });
    await preparing;
    const fs = profile.container.fs;
    fs.mkdir('/workspace/shell smoke'); fs.symlink('input.txt', '/workspace/shell smoke/link.txt');
    if (data.fixture) {
      const unhex = hex => Uint8Array.from(hex.match(/../g) ?? [], byte => parseInt(byte, 16));
      fs.writeFile('/workspace/shell-fixture.zip', unhex(data.fixture.zipHex));
      fs.writeFile('/workspace/shell-archive-expected.bin', unhex(data.fixture.expectedHex));
    }
    session = await profile.startShell({ args: ['--noprofile', '--norc', '-c', data.script], cwd: '/workspace', env: { TZ: 'UTC' } });
    let captured = 0;
    const drain = async stream => {
      const chunks = []; const reader = stream.getReader();
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; captured += value.length;
        if (captured > 2 ** 20) throw new Error('Shell capture exceeds 1 MiB'); chunks.push(...value); } }
      finally { reader.releaseLock(); }
      return chunks;
    };
    const streams = Promise.all([drain(session.stdout), drain(session.stderr)]);
    await session.stdin.close();
    const [result, [stdout, stderr]] = await Promise.all([session.exited, streams]);
    const files = {};
    for (const name of ['input.txt', 'sorted.txt', 'pipeline.txt', 'missing.err', 'metadata.txt', 'metadata.list', 'members.txt', 'invalid.err', 'unzip-destination/input file.bin']) {
      try { files[name] = Array.from(fs.readFile('/workspace/shell smoke/' + name)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    let metadata;
    if (data.stage >= 3) { const value = fs.stat('/workspace/shell smoke/metadata.txt'); metadata = { size: value.size, mode: value.mode, mtimeMs: value.mtimeMs, atimeMs: value.atimeMs }; }
    const processes = (await profile.container.inspect()).processes;
    await dispose();
    self.postMessage({ type: 'result', result, stdout, stderr, files, metadata, records, invocations, processes,
      workers: profile.workers.inspect(), configuration: { manifestSha256: config.manifestSha256, sdkUrl: config.sdkUrl, sdkWorkerUrl: config.sdkWorkerUrl,
        liveWorkerUrl: config.liveWorkerUrl, bashWasmSha256: config.bashWasmSha256, memory: config.memory } });
  } catch (error) {
    let cleanupError; try { await dispose(); } catch (failure) { cleanupError = String(failure); }
    self.postMessage({ type: 'failure', error: String(error), stack: error?.stack, cleanupError, records, invocations });
  }
};
`;

const aliases = {};
if (values['source-container']) {
	Object.assign(aliases, Object.fromEntries([
		['@wasm-idle/container', 'packages/container/src/index.ts'],
		['@wasm-idle/core', 'packages/core/src/index.ts'],
		['@wasm-idle/llvm-core/tool-host', 'packages/llvm-core/runtime/clang/src/tool-host.ts'],
		...['wasix', 'clang', 'clang-live', 'wasi-live'].map(name => [`@wasm-idle/container/adapters/${name}`, `packages/container/src/adapters/${name}/index.ts`])
	].map(([name, path]) => [name, join(repository, path)])));
} else {
	const entry = dependencyRequire.resolve('@wasm-idle/container'), containerRoot = dirname(dirname(entry));
	const containerRequire = createRequire(join(containerRoot, 'package.json'));
	aliases['@wasm-idle/container'] = entry;
	const containerPackage = JSON.parse(await readFile(join(containerRoot, 'package.json'), 'utf8'));
	for (const name of ['wasix', 'clang', 'clang-live', 'wasi-live']) aliases[`@wasm-idle/container/adapters/${name}`] = join(containerRoot, containerPackage.exports[`./adapters/${name}`].import);
	aliases['@wasm-idle/core'] = containerRequire.resolve('@wasm-idle/core');
	const llvmPath = containerRequire.resolve('@wasm-idle/llvm-core/package.json');
	aliases['@wasm-idle/llvm-core/tool-host'] = join(dirname(llvmPath), JSON.parse(await readFile(llvmPath, 'utf8')).exports['./tool-host'].import);
}
const sources = new Map();
for (const path of [fileURLToPath(import.meta.url), join(repository, 'runtimes/wasm-busybox/test/command-cases.mjs'), join(repository, 'scripts/browser-test-cookies.mjs'), join(repository, 'scripts/rust-browser-probe-lib.mjs')]) sources.set(path, identity(await readFile(path)));
const bundle = await build({ stdin: { contents: owner, resolveDir: repository, sourcefile: 'busybox-shell-owner.mjs', loader: 'js' },
	absWorkingDir: repository, alias: aliases, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
	metafile: true, logLevel: 'silent', plugins: [{ name: 'capture-shell-source-identities', setup(builder) {
		builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => {
			const bytes = await readFile(path), prior = sources.get(path);
			assert(!prior || prior.sha256 === hash(bytes), `Source changed while bundling: ${path}`);
			sources.set(path, identity(bytes)); return { contents: bytes, loader: path.endsWith('.ts') ? 'ts' : 'js' };
		});
	} }] });
assert(Object.values(bundle.metafile.outputs).every(file => file.imports.every(item => item.kind === 'dynamic-import')), 'Only website-selected SDK imports may remain dynamic');
const distributionBytes = await readFile(join(assets, 'distribution.json'));
const distribution = JSON.parse(distributionBytes), pageConfigBytes = await readFile(join(assets, 'page-config.json'));
const pageConfig = JSON.parse(pageConfigBytes), base = new URL(pageConfig.baseURL);
assert.equal(hash(distributionBytes), pageConfig.manifestSha256, 'Prepared distribution pin');
const files = new Map();
for (const pkg of distribution.packages) for (const asset of pkg.assets) {
	const path = new URL(asset.url).pathname.slice(base.pathname.length);
	assert(/^objects\/[a-f0-9]{64}\/[a-z0-9.-]+$/u.test(path), 'Fixed immutable asset path required');
	const bytes = await readFile(join(assets, path));
	assert.deepEqual(identity(bytes), { bytes: asset.delivery.bytes, sha256: asset.delivery.sha256 }, `Prepared asset: ${asset.id}`);
	files.set('/container-app/' + path, { bytes, type: asset.delivery.mediaType, identity: identity(bytes) });
}
async function hostFiles(directory, prefix) {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		assert(entry.isDirectory() || entry.isFile(), 'Prepared host graph cannot contain symlinks');
		if (entry.isDirectory()) await hostFiles(join(directory, entry.name), prefix + entry.name + '/');
		else { const bytes = await readFile(join(directory, entry.name)); files.set(prefix + entry.name, { bytes, type: entry.name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', identity: identity(bytes) }); }
	}
}
await hostFiles(join(assets, 'host', pageConfig.hostHash), `/container-app/host/${pageConfig.hostHash}/`);
files.set('/', { bytes: Buffer.from('<!doctype html><meta charset="utf-8"><title>GNU Bash BusyBox acceptance</title>'), type: 'text/html; charset=utf-8' });
files.set('/favicon.ico', { bytes: Buffer.alloc(0), type: 'image/x-icon' });
files.set('/owner.mjs', { bytes: bundle.outputFiles[0].contents, type: 'text/javascript' });
const receipt = { schemaVersion: 1, kind: 'real-gnu-bash-busybox-shell', stage, complete: false, passed: false,
	container: values['source-container'] ? 'source' : 'published', startedAt: new Date().toISOString(), script, expectedStdout,
	prepared: { distribution: identity(distributionBytes), pageConfig: identity(pageConfigBytes), ...pageConfig },
	sourceIdentities: Object.fromEntries([...sources].map(([path, value]) => [relative(repository, path), value])),
	ownerBundle: identity(bundle.outputFiles[0].contents), assetIdentities: Object.fromEntries([...files].filter(([, file]) => file.identity).map(([path, file]) => [path, file.identity])),
	requests: [], consoleErrors: [], blockedRequests: [], checks: [] };
const server = createServer((request, response) => {
	const url = new URL(request.url, 'http://127.0.0.1'), file = request.method === 'GET' && !url.search ? files.get(url.pathname) : undefined;
	receipt.requests.push({ path: url.pathname, accepted: !!file });
	response.writeHead(file ? 200 : 404, { 'Content-Type': file?.type ?? 'text/plain', 'Cache-Control': 'no-store',
		'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin',
		'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'" });
	response.end(file?.bytes ?? 'Not found');
});
let browser, context, failure;
try {
	await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
	const origin = `http://127.0.0.1:${server.address().port}`;
	const { resolveChromiumExecutable } = await import('./rust-browser-probe-lib.mjs');
	const executablePath = await resolveChromiumExecutable(process.env.CHROMIUM_PATH || process.env.WASM_IDLE_CHROMIUM_EXECUTABLE || '');
	receipt.chromium = { path: executablePath, ...identity(await readFile(executablePath)) };
	browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
	receipt.browserVersion = browser.version();
	const cdp = await browser.newBrowserCDPSession();
	await cdp.send('Target.setDiscoverTargets', { discover: true });
	const workers = async () => (await cdp.send('Target.getTargets')).targetInfos.filter(info => info.type === 'worker');
	receipt.initialWorkers = (await workers()).length;
	context = await browser.newContext({ serviceWorkers: 'block' });
	await addBrowserTestCookies(context, origin);
	await context.route('**/*', route => {
		const url = new URL(route.request().url());
		if (url.origin === origin && !url.search && files.has(url.pathname)) return route.continue();
		receipt.blockedRequests.push(url.pathname); return route.abort('blockedbyclient');
	});
	const page = await context.newPage();
	page.on('pageerror', error => receipt.consoleErrors.push(String(error).slice(0, 2000)));
	page.on('console', message => { if (message.type() === 'error') receipt.consoleErrors.push(message.text().slice(0, 2000)); });
	await page.goto(origin, { timeout: 10000 });
	receipt.run = await page.evaluate(({ script, stage, fixture }) => new Promise(resolve => {
		let settled = false, cleanupResolve;
		const owner = new Worker('/owner.mjs', { type: 'module' });
		const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
		const timer = setTimeout(() => finish({ type: 'timeout' }), 180000);
		globalThis.cleanupBusyboxOwner = () => new Promise(done => {
			const timer = setTimeout(() => { owner.terminate(); done({ mode: 'forced-owner-termination' }); }, 2000);
			cleanupResolve = value => { clearTimeout(timer); owner.terminate(); done(value); };
			owner.postMessage({ type: 'cleanup' });
		});
		owner.onmessage = ({ data }) => { if (data.type === 'cleanup') cleanupResolve?.(data); else finish(data); };
		owner.onerror = event => finish({ type: 'failure', error: event.message });
		owner.postMessage({ type: 'run', script, stage, fixture });
	}), { script, stage, fixture });
	receipt.ownerCleanup = await page.evaluate(() => globalThis.cleanupBusyboxOwner());
	const deadline = Date.now() + 5000;
	do { receipt.workersAfterRun = await workers(); if (!receipt.workersAfterRun.length) break; await new Promise(done => setTimeout(done, 100)); } while (Date.now() < deadline);
	const run = receipt.run, stdout = Buffer.from(run.stdout ?? []).toString(), stderr = Buffer.from(run.stderr ?? []).toString();
	receipt.stdout = stdout; receipt.stderr = stderr;
	const check = (id, passed, observed) => receipt.checks.push({ id, passed: Boolean(passed), observed });
	check('shell-completed', run.type === 'result' && run.result.code === 0 && run.result.reason === 'exited', run.result ?? run.error);
	check('exact-script-output', stdout === expectedStdout && stderr === '', { stdout, stderr });
	const dispatched = new Set((run.invocations ?? []).map(value => value.path.split('/').at(-1)));
	check('external-commands-dispatched', commands.every(name => dispatched.has(name)), [...dispatched]);
	check('missing-file-status-forwarded', run.records?.some(value => value.path.endsWith('/ls') && value.status === 1 && value.reason === 'exited'), run.records?.filter(value => value.status));
	check('supervised-exits', run.records?.length > 0 && run.records.every(value => Number.isInteger(value.pid) && value.reason === 'exited' && value.status === value.code && (value.status === 0 || value.path.endsWith('/ls') && value.status === 1 || stage === 4 && value.path.endsWith('/gunzip') && value.status !== 0)), run.records);
	check('filesystem-output', Buffer.from(run.files?.['sorted.txt'] ?? []).toString() === 'alpha\nbeta\n' && Buffer.from(run.files?.['pipeline.txt'] ?? []).toString() === 'alpha\nbeta\n', run.files);
	if (stage >= 3) check('real-metadata', run.metadata?.size === 3 && run.metadata.mtimeMs === 1577934245000 && /^-rw-r--r--\s+1\s+\d+\s+\d+\s+3\s+Jan\s+2\s+2020\s+metadata\.txt\n$/u.test(Buffer.from(run.files?.['metadata.list'] ?? []).toString()), run.metadata);
	if (stage === 4) check('unzip-binary-content', Buffer.from(run.files?.['unzip-destination/input file.bin'] ?? []).toString('hex') === fixture.expectedHex, run.files?.['unzip-destination/input file.bin']);
	check('owned-workers-retired', receipt.initialWorkers === 0 && run.workers?.disposed === true && run.workers.active === 0 && run.workers.created === run.workers.terminated && receipt.workersAfterRun.length === 0 && run.processes?.length === 0, run.workers);
	check('browser-errors', receipt.consoleErrors.length === 0 && receipt.blockedRequests.length === 0, { errors: receipt.consoleErrors, blocked: receipt.blockedRequests });
	for (const [path, before] of sources) assert.deepEqual(identity(await readFile(path)), before, `Source changed during execution: ${path}`);
	receipt.sourcesRechecked = true;
} catch (error) { failure = error; receipt.error = String(error); }
finally {
	await context?.close().catch(error => { failure ??= error; receipt.contextCleanupError = String(error); });
	if (browser) { const cdp = await browser.newBrowserCDPSession().catch(() => null); if (cdp) receipt.workersAfterContextClose = (await cdp.send('Target.getTargets')).targetInfos.filter(info => info.type === 'worker'); }
	await browser?.close().catch(error => { failure ??= error; receipt.browserCleanupError = String(error); });
	server.closeAllConnections(); if (server.listening) await new Promise(done => server.close(done));
	receipt.complete = true; receipt.finishedAt = new Date().toISOString();
	receipt.passed = !failure && receipt.checks.length > 0 && receipt.checks.every(check => check.passed) && receipt.workersAfterContextClose?.length === 0;
	await writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify({ output, passed: receipt.passed, checks: receipt.checks.length, failed: receipt.checks.filter(check => !check.passed).map(check => check.id), ...(failure ? { error: String(failure) } : {}) }));
if (!receipt.passed) process.exitCode = 1;
