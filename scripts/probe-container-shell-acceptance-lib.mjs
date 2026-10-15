// Pins, script and acceptance for the shell acceptance script with actual Bash, BusyBox and Clang.
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { BASH_WASM_SHA256, BASH_WEBC, digest, identity } from './probe-patched-container-shell-lib.mjs';
import { FULL_SYSROOT_SHA256, loadClangBrowserInputs } from '../packages/container/scripts/clang-browser-inputs.mjs';

export { BASH_WASM_SHA256, digest, identity };
// SDK with bridge patches 0001-0013: directory routing and host-command work off the scheduler thread.
export const PACKAGE_RECEIPT = {
	bytes: 2605,
	sha256: 'ac5b9ce4cf673f3917775aa87fa95715794f61c0d6ff27b3fd05996d5d0dfc85'
};
export const BINARY_RECEIPT_SHA256 = '947691664652580593aacc4dd78861909dede3e0d0dd85501ea143b99e4220b6';
export const SDK_WASM = {
	bytes: 9215380,
	sha256: '9fb4a0aced4526547a061599f3ad8522e22cef766f33a73e5566de85687661af'
};
export const MEMORY = { initial: 35, maximum: 16384, shared: true };
// BusyBox B1, qualified live in runtimes/wasm-busybox/LIVE.md.
export const BUSYBOX = {
	bytes: 447557,
	sha256: '547827daf25957a4e2f77ba9ba76b4734f363f867a8a5cb39302dce1b1c36ade'
};
export const BUSYBOX_APPLETS = ['cat', 'cp', 'echo', 'false', 'grep', 'mkdir', 'mv', 'printf', 'pwd', 'rm', 'true'];
// The producer receipt and revision recorded by runtimes/wasm-busybox/evidence/container-live-b1.json.
export const BUSYBOX_RECEIPT_SHA256 = '95788aa1a140e73efbcc77ed714933db7a18777ab0bc18479663928e6faf2a51';
export const BUSYBOX_PRODUCER_REVISION = '3097726bc6e04667ba7d92738d5bcf4798062617';
// wasm-llvm process-sysroot.py: the full selected-target sysroot with initial_cwd linked into crt1.o.
export const PROCESS_SYSROOT = {
	bytes: 35328000,
	sha256: 'b5c51389ce2f2b404f8b354788aa4a19a65d7e4af746cf52d24e7276d2eabf7f'
};
export const PROCESS_SYSROOT_RECEIPT_SHA256 = '105089044738721b7177c1846454d8132578d79292100d6413c56b09fd27304c';
export const RUN_TIMEOUT_MS = 300000;
export const COMMAND_TIMEOUT_MS = 240000;
// docs/container-development-plan.md, unchanged.
export const SCRIPT = [
	'set -eu',
	'mkdir -p /workspace/demo',
	'cd /workspace/demo',
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o hello.wasm',
	'./hello.wasm | grep hello > result.txt',
	'cat result.txt'
].join('\n') + '\n';
const text = (value) => [...new TextEncoder().encode(value)];
export const SOURCE = text('#include <stdio.h>\nint main(void){puts("hello");return 0;}\n');
export const READ_FILES = ['/workspace/demo/main.c', '/workspace/demo/result.txt'];
export const BIN = '/usr/local/bin';
export const SYSROOT = '/usr/share/wasm-sysroot';
export const CLANG_PROFILE = Object.freeze([
	'--target=wasm32-wasi', '-fuse-ld=/opt/toolchains/llvm/bin/wasm-ld', `--sysroot=${SYSROOT}`,
	`-resource-dir=${SYSROOT}/lib/clang/22`, '-Wl,--max-memory=67108864'
]);
// The pinned Clang 22 deprecates its own default triple and says so once per driver run.
// The sysroot is laid out for wasm32-wasi only, so the profile cannot select wasm32-wasip1.
export const CLANG_TRIPLE_WARNING =
	"clang: warning: argument '--target=wasm32-wasi' is deprecated, use --target=wasm32-wasip1 instead [-Wdeprecated]\n";
// The order Bash dispatches the script's commands; the pipeline's two children may swap.
export const DISPATCHES = [
	{ path: `${BIN}/mkdir`, cwd: '/workspace' },
	{ path: `${BIN}/clang`, cwd: '/workspace/demo' },
	{ path: '/workspace/demo/hello.wasm', cwd: '/workspace/demo', pipeline: true },
	{ path: `${BIN}/grep`, cwd: '/workspace/demo', pipeline: true },
	{ path: `${BIN}/cat`, cwd: '/workspace/demo' }
];
// A third run in the same profile interrupts a running artifact and a running compile.
export const INTERRUPT_SCRIPT = [
	'set -u',
	'mkdir -p /workspace/demo',
	'cd /workspace/demo',
	"printf 'int main(void){for(;;){}}\\n' > spin.c",
	'clang spin.c -o spin.wasm',
	'./spin.wasm; printf \'spin=%d\\n\' "$?"',
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o interrupted.wasm; printf \'clang=%d\\n\' "$?"',
	'if [ -e interrupted.wasm ]; then echo kept; else echo discarded; fi',
	'clang main.c -o hello.wasm && ./hello.wasm'
].join('\n') + '\n';
export const INTERRUPTS = [
	{ path: '/workspace/demo/spin.wasm', occurrence: 1, delayMs: 1000 },
	// The snapshot adapter reports running only after its Worker is ready; the compile itself
	// then takes about a second, so a one-second delay can arrive just as it completes.
	{ path: `${BIN}/clang`, occurrence: 2, delayMs: 50 }
];
export const INTERRUPT_DISPATCHES = [
	[`${BIN}/mkdir`, 0], [`${BIN}/clang`, 0], ['/workspace/demo/spin.wasm', 130],
	[`${BIN}/clang`, 130], [`${BIN}/clang`, 0], ['/workspace/demo/hello.wasm', 0]
];
// A fourth run with its own cache and a corrupted BusyBox body: an integrity failure, a
// compile error and a missing command each fail alone, and the shell keeps working.
export const FAILURE_SCRIPT = [
	'set -u',
	'mkdir -p /workspace/demo; printf \'mkdir=%d\\n\' "$?"',
	'mkdir -p /workspace/demo; printf \'retry=%d\\n\' "$?"',
	'cd /workspace',
	"printf 'int main(void){' > bad.c",
	'clang bad.c -o bad.wasm; printf \'bad=%d\\n\' "$?"',
	'if [ -e bad.wasm ]; then echo artifact; else echo no-artifact; fi',
	'nosuch-command; printf \'missing=%d\\n\' "$?"',
	"printf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c",
	'clang main.c -o hello.wasm && ./hello.wasm'
].join('\n') + '\n';
export const FAILURE_DISPATCHES = [
	[`${BIN}/mkdir`, 126, 'INTEGRITY'], [`${BIN}/mkdir`, 126, 'INTEGRITY'], [`${BIN}/clang`, 1, 'exited'],
	[`${BIN}/clang`, 0, 'exited'], ['/workspace/hello.wasm', 0, 'exited']
];
export const RUNS = ['cold', 'warm', 'interrupt', 'failure'];
export const RUN_SCRIPTS = { cold: SCRIPT, warm: SCRIPT, interrupt: INTERRUPT_SCRIPT, failure: FAILURE_SCRIPT };

async function pinned(file, expected) {
	assert(path.isAbsolute(file), 'absolute input paths required');
	const stat = await lstat(file);
	assert(stat.isFile() && !stat.isSymbolicLink(), `regular pinned input required: ${file}`);
	assert.equal(stat.size, expected.bytes, `input byte count: ${file}`);
	const bytes = await readFile(file);
	assert.deepEqual(identity(bytes), expected, `input identity: ${file}`);
	return bytes;
}

export async function readPinnedProbeInputs(configuration) {
	assert.equal(configuration.packageReceiptSha256, PACKAGE_RECEIPT.sha256);
	const receipt = JSON.parse(await pinned(configuration.packageReceipt, PACKAGE_RECEIPT));
	assert.equal(receipt.complete, true, 'actual completed SDK package required');
	assert.equal(receipt.guestQualified, false, 'packaging is not guest acceptance');
	assert.equal(receipt.binaryReceiptIdentity.sha256, BINARY_RECEIPT_SHA256);
	assert.deepEqual(receipt.entries['wasmer_js_bg.wasm'], SDK_WASM);
	assert.deepEqual(receipt.memoryProfile, { shared: true, minimumPages: MEMORY.initial, maximumPages: MEMORY.maximum });
	assert.equal(receipt.packageId, 'sha256-' + digest(Buffer.from(JSON.stringify(receipt.entries))));
	const packageRoot = path.join(path.dirname(configuration.packageReceipt), receipt.packageId);
	const entries = new Map();
	for (const [name, expected] of Object.entries(receipt.entries)) {
		assert(/^[A-Za-z0-9_.-]+$/.test(name), 'single package entry name required');
		entries.set(name, await pinned(path.join(packageRoot, name), expected));
	}
	for (const name of ['index.mjs', 'worker.mjs', 'wasmer_js_bg.wasm'])
		assert(entries.has(name), `missing actual package entry: ${name}`);
	const bash = await pinned(configuration.bashWebc, BASH_WEBC);
	// BusyBox: the producer's passing receipt and its exact artifact.
	assert.equal(configuration.busyboxReceiptSha256, BUSYBOX_RECEIPT_SHA256);
	const busyboxReceiptBytes = await readFile(configuration.busyboxReceipt);
	assert.equal(digest(busyboxReceiptBytes), configuration.busyboxReceiptSha256, 'BusyBox receipt digest');
	const busyboxReceipt = JSON.parse(busyboxReceiptBytes);
	assert.equal(busyboxReceipt.status, 'producer-smoke-passed');
	assert.equal(busyboxReceipt.b1SmokePassed, true);
	assert.equal(busyboxReceipt.wasiNodeSmokePassed, true);
	assert.deepEqual(busyboxReceipt.nodeWasiApplets, BUSYBOX_APPLETS);
	assert.deepEqual({ bytes: busyboxReceipt.wasi.artifact.size, sha256: busyboxReceipt.wasi.artifact.sha256 }, BUSYBOX);
	const busybox = await pinned(configuration.busyboxWasm, BUSYBOX);
	// Clang/LLD/sysroot: the same producer gates as the Clang browser qualification.
	const clang = await loadClangBrowserInputs({
		CONTAINER_PRODUCER_RECEIPT: configuration.clangProducerReceipt,
		CONTAINER_PRODUCER_RECEIPT_SHA256: configuration.clangProducerReceiptSha256,
		CONTAINER_PRODUCER_SMOKE: configuration.clangProducerSmoke,
		CONTAINER_PRODUCER_SMOKE_SHA256: configuration.clangProducerSmokeSha256,
		CONTAINER_CLANG_WASM: configuration.clangWasm,
		CONTAINER_LLD_WASM: configuration.lldWasm,
		CONTAINER_SYSROOT: configuration.sysroot
	});
	// User programs need the initial_cwd contract to run in the shell's directory; the
	// process-profile sysroot is derived from the pinned one with only crt1.o changed.
	assert.equal(configuration.processSysrootReceiptSha256, PROCESS_SYSROOT_RECEIPT_SHA256);
	const processReceiptBytes = await readFile(configuration.processSysrootReceipt);
	assert.equal(digest(processReceiptBytes), PROCESS_SYSROOT_RECEIPT_SHA256, 'process sysroot receipt digest');
	const processReceipt = JSON.parse(processReceiptBytes);
	assert.equal(processReceipt.complete, true);
	assert.equal(processReceipt.producerTreeClean, true);
	assert.equal(processReceipt.inputs.sysroot.sha256, FULL_SYSROOT_SHA256);
	assert.deepEqual(processReceipt.changedEntries, ['lib/wasm32-wasi/crt1.o']);
	assert.equal(processReceipt.cwdFixture?.passed, true);
	assert.deepEqual(processReceipt.outputs['sysroot.tar'], PROCESS_SYSROOT);
	const processSysroot = await pinned(configuration.processSysroot, PROCESS_SYSROOT);
	const logical = { ...PROCESS_SYSROOT, mediaType: 'application/x-tar' };
	clang.assets.sysroot = {
		delivery: processSysroot,
		metadata: { id: 'sysroot', encoding: 'identity', delivery: logical, logical }
	};
	return {
		receipt, packageRoot, entries, bash, busybox, clang,
		busyboxReceiptSha256: configuration.busyboxReceiptSha256,
		processSysroot: { receiptSha256: PROCESS_SYSROOT_RECEIPT_SHA256, producerCommit: processReceipt.producerCommit,
			derivedFrom: FULL_SYSROOT_SHA256, crt1: processReceipt.crt1.derived }
	};
}

const decode = (bytes) => Buffer.from(bytes ?? []).toString('utf8');
const same = (actual, expected) => Array.isArray(actual) &&
	actual.length === expected.length && actual.every((byte, index) => byte === expected[index]);

/** One run's acceptance. `downloads` are the server's body counts at the run's start and end. */
function judgeRun(run, result, downloads, assetPaths, checks) {
	const check = (id, passed, observed) => checks.push({ id: `${run}:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result;
	check('script', completed && output.code === 0 && decode(output.stdout) === 'hello\n' &&
		decode(output.stderr) === CLANG_TRIPLE_WARNING,
		{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr: decode(output?.stderr), error: result?.error });
	check('workspace-files', same(result?.files?.['/workspace/demo/main.c'], SOURCE) &&
		decode(result?.files?.['/workspace/demo/result.txt']) === 'hello\n', result?.files && Object.keys(result.files));
	check('artifact', same(result?.artifact?.magic?.slice(0, 4), [0, 97, 115, 109]) && result.artifact.bytes > 8, result?.artifact);
	// Each command reached the container in the shell's cwd and exited 0 there.
	const invocations = result?.invocations ?? [], records = result?.records ?? [];
	const order = invocations.map((invocation) => invocation.path);
	const expected = DISPATCHES.map((dispatch) => dispatch.path);
	const pipeline = (paths) => paths.map((path) => DISPATCHES.find((d) => d.path === path)?.pipeline ? 'pipeline' : path);
	check('dispatch-order', order.length === expected.length &&
		JSON.stringify(pipeline(order)) === JSON.stringify(pipeline(expected)) &&
		expected.every((path) => order.includes(path)), order);
	check('shared-cwd', DISPATCHES.every((dispatch) => invocations.find((invocation) => invocation.path === dispatch.path)?.cwd === dispatch.cwd),
		invocations.map(({ path, cwd }) => [path, cwd]));
	check('supervisor-exits', records.length === expected.length && records.every((record) =>
		record.status === 0 && record.result?.reason === 'exited' && record.result?.code === 0 && Number.isSafeInteger(record.pid)),
	records.map(({ path, status, pid }) => [path, status, pid]));
	check('artifact-in-supervisor', records.some((record) => record.path === '/workspace/demo/hello.wasm' && record.status === 0),
		records.map(({ path }) => path));
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('metadata-only-lookup', result?.assetsBeforeShell?.cachedEntries === 0 &&
		result?.lookups?.clang === 'llvm' && ['cat', 'grep', 'mkdir'].every((name) => result.lookups[name] === 'busybox'), result?.lookups);
	// Lazy loading: no asset is requested before the command that needs it.
	const timeline = result?.timeline ?? [];
	const first = (predicate) => timeline.find(predicate)?.seq ?? Infinity;
	const fetches = (name) => timeline.filter((entry) => entry.type === 'fetch' && entry.url.endsWith(`/assets/${name}`));
	const dispatchOf = (path) => first((entry) => entry.type === 'dispatch' && entry.path === path);
	const fetched = (name) => downloads.end[`/assets/${name}`] - downloads.start[`/assets/${name}`];
	if (run === 'cold') {
		check('busybox-lazy', fetches('busybox').length === 1 && fetches('busybox')[0].seq > dispatchOf(`${BIN}/mkdir`) &&
			fetched('busybox') === 1, { fetches: fetches('busybox'), mkdir: dispatchOf(`${BIN}/mkdir`) });
		check('clang-lazy', ['clang', 'lld', 'sysroot'].every((name) => fetches(name).length === 1 &&
			fetches(name)[0].seq > dispatchOf(`${BIN}/clang`) && fetched(name) === 1),
		{ clang: dispatchOf(`${BIN}/clang`), fetches: ['clang', 'lld', 'sysroot'].map((name) => fetches(name)) });
	} else {
		check('verified-cache-reuse', assetPaths.every((asset) => downloads.end[asset] === downloads.start[asset]) &&
			result?.assetsBeforeShell?.cachedEntries === 0, { downloads, assetsBeforeShell: result?.assetsBeforeShell });
	}
	check('sysroot-closure', result?.sysroot?.entries === 2285 && result.sysroot.files === 2168, result?.sysroot);
	check('public-api', result?.publicApi?.runtime?.includes('registerHostCommandDirectory') &&
		result.publicApi.directory?.includes('fromHostFileSystem'), result?.publicApi);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

/** The owner interrupts a running artifact and a running compile; Bash continues. */
function judgeInterrupt(result, checks) {
	const check = (id, passed, observed) => checks.push({ id: `interrupt:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result, stderr = decode(output?.stderr);
	const warnings = stderr.split(CLANG_TRIPLE_WARNING);
	check('script', completed && output.code === 0 && decode(output.stdout) === 'spin=130\nclang=130\ndiscarded\nhello\n' &&
		warnings.every((part) => part === '') && [3, 4].includes(warnings.length),
	{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr, error: result?.error });
	const records = result?.records ?? [];
	check('supervisor-statuses', JSON.stringify(records.map((record) => [record.path, record.status])) === JSON.stringify(INTERRUPT_DISPATCHES),
		records.map(({ path, status, startError, result: value }) => [path, status, startError ?? value?.reason]));
	// Each interrupt stopped exactly one command while it ran, between its dispatch and completion.
	const timeline = result?.timeline ?? [];
	const interrupts = timeline.filter((entry) => entry.type === 'interrupt');
	check('interrupted-while-running', interrupts.length === 2 && interrupts.every((entry) => entry.interrupted === 1) &&
		INTERRUPTS.every((plan, index) => {
			const dispatches = timeline.filter((entry) => entry.type === 'dispatch' && entry.path === plan.path);
			const ends = timeline.filter((entry) => entry.type === 'dispatchEnd' && entry.path === plan.path);
			const at = interrupts[index]?.seq;
			return at > dispatches[plan.occurrence - 1]?.seq && at < ends[plan.occurrence - 1]?.seq && ends[plan.occurrence - 1]?.status === 130;
		}), interrupts);
	check('interrupted-compile-discarded', result?.files?.['/workspace/demo/interrupted.wasm']?.error === 'ENOENT',
		result?.files?.['/workspace/demo/interrupted.wasm']);
	check('later-artifact', same(result?.artifact?.magic?.slice(0, 4), [0, 97, 115, 109]), result?.artifact);
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

/** Integrity failure, compile error and missing command, each contained; the shell continues. */
function judgeFailure(result, downloads, checks) {
	const check = (id, passed, observed) => checks.push({ id: `failure:${id}`, passed: Boolean(passed), observed });
	const completed = result?.type === 'result' && result.backendCompleted === true;
	const output = result?.result, stderr = decode(output?.stderr);
	const lines = stderr.split('\n').filter(Boolean);
	check('script', completed && output.code === 0 &&
		decode(output.stdout) === 'mkdir=126\nretry=126\nbad=1\nno-artifact\nmissing=127\nhello\n',
	{ type: result?.type, code: output?.code, stdout: decode(output?.stdout), stderr, error: result?.error });
	// Each integrity failure is one host diagnostic; the compiler's own diagnostics name bad.c.
	check('diagnostics', lines.filter((line) => line.startsWith('mkdir: ')).length === 2 &&
		lines.some((line) => /^bad\.c:1:\d+: error: /.test(line)) &&
		lines.some((line) => /^bash: line \d+: nosuch-command: command not found$/.test(line)), lines);
	const records = result?.records ?? [];
	check('supervisor-statuses', JSON.stringify(records.map((record) => [record.path, record.status, record.startError ?? record.result?.reason])) ===
		JSON.stringify(FAILURE_DISPATCHES), records.map(({ path, status, startError, result: value }) => [path, status, startError ?? value?.reason]));
	check('no-artifact-from-error', result?.files?.['/workspace/bad.wasm']?.error === 'ENOENT', result?.files?.['/workspace/bad.wasm']);
	check('later-artifact', same(result?.artifact?.magic?.slice(0, 4), [0, 97, 115, 109]), result?.artifact);
	// A failed body is fetched again by the retry, never served from a cache.
	const fetched = (name) => downloads.end[`/assets/${name}`] - downloads.start[`/assets/${name}`];
	check('integrity-not-cached', fetched('busybox-corrupt') === 2 && fetched('busybox') === 0, downloads);
	check('processes-retired', completed && Array.isArray(result.containerProcesses) && !result.containerProcesses.length,
		result?.containerProcesses?.length);
	check('browser-errors', !result?.events?.some((event) => event.type === 'threadError') &&
		!result?.blockedRequests?.length && !result?.consoleErrors?.length, result?.consoleErrors);
	check('owned-workers-retired', result?.remainingWorkerTargets === 0, result?.remainingWorkerTargetDetails);
}

export function judgeShellAcceptance(receipt) {
	const checks = [];
	const assetPaths = ['busybox', 'clang', 'lld', 'sysroot'].map((name) => `/assets/${name}`);
	for (const run of RUNS) {
		const entry = receipt.runs?.find((candidate) => candidate.run === run);
		if (run === 'interrupt') judgeInterrupt(entry?.result, checks);
		else if (run === 'failure') judgeFailure(entry?.result, entry?.downloads ?? { start: {}, end: {} }, checks);
		else judgeRun(run, entry?.result, entry?.downloads ?? { start: {}, end: {} }, assetPaths, checks);
	}
	checks.push({ id: 'context-cleanup', passed: receipt.initialWorkerTargets === 0 && receipt.workersAfterContextClose === 0,
		observed: [receipt.initialWorkerTargets, receipt.workersAfterContextClose] });
	return {
		checks,
		passed: checks.filter((entry) => entry.passed).length,
		total: checks.length,
		shellAcceptancePassed: checks.every((entry) => entry.passed),
		commonContainerFdVfsQualified: false,
		shellBackendReady: false
	};
}
