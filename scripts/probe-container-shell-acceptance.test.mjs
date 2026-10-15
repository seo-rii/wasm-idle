import assert from 'node:assert/strict';
import test from 'node:test';
import {
	BIN, CLANG_TRIPLE_WARNING, DISPATCHES, SCRIPT, SOURCE, judgeShellAcceptance, readPinnedProbeInputs
} from './probe-container-shell-acceptance-lib.mjs';

const bytes = (value) => [...new TextEncoder().encode(value)];
const assets = ['busybox', 'clang', 'lld', 'sysroot'].map((name) => `/assets/${name}`);
function result(run) {
	let seq = 0;
	const timeline = [{ seq: seq++, type: 'shellStart' }];
	const fetch = (name) => run === 'cold' && timeline.push({ seq: seq++, type: 'fetch', url: `http://127.0.0.1:1/assets/${name}` });
	for (const dispatch of DISPATCHES) {
		timeline.push({ seq: seq++, type: 'dispatch', path: dispatch.path });
		if (dispatch.path.endsWith('/mkdir')) fetch('busybox');
		if (dispatch.path.endsWith('/clang')) ['clang', 'lld', 'sysroot'].forEach(fetch);
		timeline.push({ seq: seq++, type: 'dispatchEnd', path: dispatch.path, status: 0 });
	}
	return {
		type: 'result', backendCompleted: true,
		result: { code: 0, stdout: bytes('hello\n'), stderr: bytes(CLANG_TRIPLE_WARNING) },
		files: { '/workspace/demo/main.c': [...SOURCE], '/workspace/demo/result.txt': bytes('hello\n') },
		artifact: { bytes: 1234, magic: [0, 97, 115, 109, 1, 0, 0, 0] },
		invocations: DISPATCHES.map(({ path, cwd }) => ({ path, cwd, argv: [path], descriptors: [0, 1, 2] })),
		records: DISPATCHES.map(({ path }, pid) => ({ path, status: 0, pid: pid + 1, result: { code: 0, reason: 'exited' } })),
		timeline, lookups: { cat: 'busybox', cp: 'busybox', grep: 'busybox', mkdir: 'busybox', mv: 'busybox', rm: 'busybox', clang: 'llvm' },
		assetsBeforeShell: { cachedEntries: 0 }, sysroot: { entries: 2285, files: 2168 }, containerProcesses: [],
		publicApi: { runtime: ['registerHostCommand', 'registerHostCommandDirectory'], directory: ['fromHostFileSystem'] },
		events: [], consoleErrors: [], blockedRequests: [], remainingWorkerTargets: 0
	};
}
function receipt() {
	const counts = (value) => Object.fromEntries(assets.map((path) => [path, value]));
	return {
		initialWorkerTargets: 0, workersAfterContextClose: 0,
		runs: [
			{ run: 'cold', result: result('cold'), downloads: { start: counts(0), end: counts(1) } },
			{ run: 'warm', result: result('warm'), downloads: { start: counts(1), end: counts(1) } }
		]
	};
}
const failed = (value) => judgeShellAcceptance(value).checks.filter((check) => !check.passed).map((check) => check.id);

test('the plan script is unchanged and an actual passing receipt passes without readiness claims', () => {
	assert.equal(SCRIPT, "set -eu\nmkdir -p /workspace/demo\ncd /workspace/demo\nprintf '#include <stdio.h>\\nint main(void){puts(\"hello\");return 0;}\\n' > main.c\nclang main.c -o hello.wasm\n./hello.wasm | grep hello > result.txt\ncat result.txt\n");
	const judged = judgeShellAcceptance(receipt());
	assert.deepEqual(failed(receipt()), []);
	assert.equal(judged.shellAcceptancePassed, true);
	assert.equal(judged.shellBackendReady, false);
	assert.equal(judged.commonContainerFdVfsQualified, false);
});

test('printing hello alone is insufficient', () => {
	const value = receipt();
	delete value.runs[0].result.files['/workspace/demo/result.txt'];
	value.runs[0].result.records.pop();
	value.runs[0].result.invocations[2].cwd = '/workspace';
	value.runs[0].result.artifact = { error: 'ENOENT' };
	assert.deepEqual(failed(value), ['cold:workspace-files', 'cold:artifact', 'cold:shared-cwd', 'cold:supervisor-exits']);
});

test('an eager or repeated asset body request fails', () => {
	const value = receipt();
	// Clang fetched at shell start, before its command.
	const timeline = value.runs[0].result.timeline;
	timeline.find((entry) => entry.type === 'fetch' && entry.url.endsWith('/clang')).seq = -1;
	value.runs[1].downloads.end['/assets/sysroot'] = 2;
	assert.deepEqual(failed(value), ['cold:clang-lazy', 'warm:verified-cache-reuse']);
});

test('a natively executed artifact, wrong order, nonzero exit or leaked process fails', () => {
	const value = receipt(), run = value.runs[0].result;
	run.records = run.records.filter((record) => !record.path.endsWith('hello.wasm'));
	run.invocations = run.invocations.filter((invocation) => !invocation.path.endsWith('hello.wasm'));
	value.runs[1].result.result.code = 1;
	value.runs[1].result.containerProcesses = [{ pid: 3 }];
	assert.deepEqual(failed(value), ['cold:dispatch-order', 'cold:shared-cwd', 'cold:supervisor-exits', 'cold:artifact-in-supervisor',
		'warm:script', 'warm:processes-retired']);
});

test('the pipeline children may dispatch in either order', () => {
	const value = receipt(), run = value.runs[1].result;
	[run.invocations[2], run.invocations[3]] = [run.invocations[3], run.invocations[2]];
	assert.deepEqual(failed(value), []);
	[run.invocations[1], run.invocations[2]] = [run.invocations[2], run.invocations[1]];
	assert.deepEqual(failed(value), ['warm:dispatch-order']);
	assert.equal(BIN, '/usr/local/bin');
});

test('stderr may hold only the pinned Clang triple warning, once', () => {
	const value = receipt();
	value.runs[0].result.result.stderr = bytes(CLANG_TRIPLE_WARNING + CLANG_TRIPLE_WARNING);
	value.runs[1].result.result.stderr = bytes('main.c:1:1: warning: something else\n');
	assert.deepEqual(failed(value), ['cold:script', 'warm:script']);
	value.runs[1].result.result.stderr = [];
	assert.deepEqual(failed(value), ['cold:script', 'warm:script'], 'the warning proves Clang ran on the forwarded route');
});

test('browser errors and Workers that outlive their owner fail', () => {
	const value = receipt();
	value.runs[0].result.consoleErrors = ['boom'];
	value.runs[1].result.remainingWorkerTargets = 1;
	value.workersAfterContextClose = 2;
	assert.deepEqual(failed(value), ['cold:browser-errors', 'warm:owned-workers-retired', 'context-cleanup']);
});

test('pinned inputs reject a wrong package receipt digest before reading files', async () => {
	await assert.rejects(readPinnedProbeInputs({ packageReceipt: '/nonexistent', packageReceiptSha256: '1'.repeat(64) }));
});
