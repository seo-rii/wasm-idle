import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fixtures, judgeHostCommandProbe, readPinnedProbeInputs } from './probe-container-shell-host-command-lib.mjs';

const bytes = (value) => [...new TextEncoder().encode(value)];
const invocation = (path, argv, extra = {}) => ({
	path, argv, cwd: '/workspace', env: ['G0=space 한글', 'PATH=/opt/host/bin:/usr/bin:/bin'],
	frozen: true, descriptors: [0, 1, 2], owner: 'sdk-scheduler-thread', ...extra
});
const tool = (...args) => invocation('/opt/host/bin/tool', ['/opt/host/bin/tool', ...args]);
const probe = (...args) => invocation('/opt/host/bin/probe', ['/opt/host/bin/probe', ...args]);
const special = {
	'HOST-METADATA': {
		stdout: bytes('probe\0roundtrip\0space arg\0한글\0\0status=0\n'),
		stderr: bytes('G0=space 한글\0PATH=/opt/host/bin:/usr/bin:/bin\0'),
		invocations: [probe('roundtrip', 'space arg', '한글', '')].map((entry) => ({ ...entry, cwd: '/workspace/sub' })),
		files: { '/sub/out.bin': { error: 'entry not found' } },
		containerFiles: { '/workspace/sub/out.bin': bytes('saved') }
	},
	'HOST-PIPE-REDIRECT': {
		invocations: [tool(), tool(), tool()], files: { '/binary': [0, 255, 226, 130, 172, 10, 13, 97, 98] },
		records: [0, 0, 0].map((status) => ({ status, result: { code: status, reason: 'exited' } }))
	},
	'HOST-EXACT-CONSUMPTION': { invocations: [tool('one'), tool()] },
	'HOST-STATUS': {
		invocations: [probe('exit'), tool('crash')],
		records: [{ status: 23, result: { code: 23, reason: 'exited' } }, { status: 134, result: { code: null, reason: 'runtime-error' } }]
	},
	'HOST-EPIPE': {
		invocations: [tool('yes'), tool('one')],
		records: [0, 64].map((status) => ({ status, result: { code: status, reason: 'exited' } }))
	},
	'HOST-PATH-LOOKUP': { invocations: [{ ...tool(), argv: ['tool'] }] },
	'HOST-FAILURE': {
		stdout: bytes('broken=126\nnative=126\nafter\n'),
		invocations: [invocation('/opt/host/bin/broken', ['/opt/host/bin/broken'])], records: [], consoleErrors: ['native exec failure']
	},
	'HOST-TAIL-EXEC': { code: 23, invocations: [probe('exit')] },
	'BASH-PIPESTATUS': { stdout: bytes('pipestatus=[]\n'), invocations: [] },
	'BASH-SUBSHELL-DUP': { stdout: bytes('after\n'), stderr: bytes('top\n'), invocations: [] }
};
function observations() {
	return fixtures.map((fixture) => {
		const extra = structuredClone(special[fixture.id] ?? {});
		return {
			id: fixture.id, type: 'result', backendCompleted: true,
			result: { code: extra.code ?? 0, stdout: extra.stdout ?? fixture.expectedStdout, stderr: extra.stderr ?? fixture.expectedStderr ?? [] },
			invocations: extra.invocations, records: extra.records ?? [],
			files: extra.files ?? {}, containerFiles: extra.containerFiles ?? {}, containerProcesses: [],
			events: [{ type: 'sdkInitialized' }, { type: 'started' }],
			publicApi: {
				runtime: ['constructor', 'registerHostCommand', 'unregisterHostCommand'],
				hostCommandDescriptor: ['constructor', 'fd', 'read', 'write', 'close']
			},
			consoleErrors: extra.consoleErrors ?? [], blockedRequests: [],
			initialWorkerTargets: 0, remainingWorkerTargets: 0, workersAfterContextClose: 0
		};
	});
}
const failed = (results) => judgeHostCommandProbe(results).checks.filter((check) => !check.passed).map((check) => check.id);

test('actual dispatch evidence passes every check while common fd/VFS stays unqualified', () => {
	const judged = judgeHostCommandProbe(observations());
	assert.deepEqual(failed(observations()), []);
	assert.equal(judged.hostCommandDispatchPassed, true);
	assert.equal(judged.passed, judged.total);
	assert.equal(judged.commonContainerFdVfsQualified, false);
	assert.equal(judged.shellBackendReady, false);
	assert.equal(judged.observations.bashPipestatus, 'pipestatus=[]\n', 'recorded without affecting acceptance');
	assert.deepEqual(judged.observations.bashSubshellDup, { stdout: 'after\n', stderr: 'top\n' });
});

test('every pipeline member status is checked against the Supervisor records', () => {
	const results = observations();
	results.find((result) => result.id === 'HOST-EPIPE').records[1].status = 0;
	results.find((result) => result.id === 'HOST-PIPE-REDIRECT').records.pop();
	results.find((result) => result.id === 'HOST-PIPE-REDIRECT').result.stderr = bytes('bash: line 1: 2: Invalid argument\n');
	assert.deepEqual(failed(results), ['HOST-PIPE-REDIRECT', 'HOST-PIPE-REDIRECT:process-records', 'HOST-EPIPE:process-records']);
});

test('missing or extra dispatches fail, including native fallback of an unregistered path', () => {
	const results = observations();
	results.find((result) => result.id === 'HOST-FAILURE').invocations.push(invocation('/opt/host/bin/unregistered', ['/opt/host/bin/unregistered']));
	results.find((result) => result.id === 'HOST-PATH-LOOKUP').invocations = [];
	assert.deepEqual(failed(results), ['HOST-PATH-LOOKUP:dispatches', 'HOST-FAILURE:dispatches', 'HOST-PATH-LOOKUP:argv0', 'HOST-FAILURE:no-native-fallback']);
});

test('byte, status and metadata mismatches fail', () => {
	const results = observations();
	results.find((result) => result.id === 'HOST-PIPE-REDIRECT').files['/binary'] = [0, 255];
	results.find((result) => result.id === 'HOST-EPIPE').result.stdout = bytes('y\npipe=0 0\n');
	results.find((result) => result.id === 'HOST-METADATA').invocations[0].cwd = '/workspace';
	results.find((result) => result.id === 'HOST-TAIL-EXEC').result.code = 0;
	assert.deepEqual(failed(results), ['HOST-EPIPE', 'HOST-TAIL-EXEC', 'HOST-METADATA:prepared-child', 'HOST-PIPE-REDIRECT:shell-file']);
});

test('a shared filesystem observation is not misreported as separate namespaces', () => {
	const results = observations();
	results.find((result) => result.id === 'HOST-METADATA').files['/sub/out.bin'] = bytes('saved');
	assert.deepEqual(failed(results), ['HOST-METADATA:distinct-filesystems']);
});

test('timeouts, leaked processes, worker leaks and unexpected console errors fail', () => {
	const results = observations();
	Object.assign(results.find((result) => result.id === 'HOST-STATUS'), { type: 'timeout', backendCompleted: false });
	results.find((result) => result.id === 'HOST-EXACT-CONSUMPTION').containerProcesses = [{ pid: 3 }];
	results.find((result) => result.id === 'HOST-PATH-LOOKUP').workersAfterContextClose = 1;
	results.find((result) => result.id === 'HOST-EPIPE').consoleErrors = ['unexpected'];
	assert.deepEqual(failed(results), [
		'HOST-EXACT-CONSUMPTION:container-processes-retired', 'HOST-STATUS', 'HOST-STATUS:container-processes-retired',
		'browser-errors', 'owned-host-context-cleanup'
	]);
});

test('a handler running outside the scheduler owner or with a mutable invocation fails', () => {
	const results = observations();
	results.find((result) => result.id === 'HOST-EPIPE').invocations[1].owner = 'guest-worker';
	results.find((result) => result.id === 'HOST-PATH-LOOKUP').invocations[0].frozen = false;
	assert.deepEqual(failed(results), ['HOST-EPIPE:dispatches', 'HOST-PATH-LOOKUP:dispatches']);
});

test('pinned inputs reject a wrong package receipt digest before reading files', async () => {
	await assert.rejects(readPinnedProbeInputs({ packageReceipt: '/nonexistent', packageReceiptSha256: '0'.repeat(64) }));
});

const archived = async (name) => JSON.parse(await readFile(new URL(`../packages/container/test/host-command-shell/evidence/${name}.json`, import.meta.url)));

test('the archived module-import attempt failed before any guest or dispatch', async () => {
	const receipt = await archived('module-import');
	assert.equal(receipt.complete, true);
	assert.equal(receipt.hostCommandDispatchPassed, false);
	assert.equal(receipt.results.length, 8);
	for (const result of receipt.results) {
		assert.equal(result.type, 'failure');
		assert.match(result.error, /Failed to resolve module specifier "@wasm-idle\/core"/);
		assert.equal(result.invocations, undefined);
		assert.equal(result.workersAfterContextClose, 0);
	}
	assert.equal((await archived('module-import-process')).exitCode, 1);
});

test('the archived first dispatch run keeps its 31 of 35 result and exact failures', async () => {
	const receipt = await archived('first-dispatch');
	assert.equal(receipt.applicationCommit, 'ad23994135b804a4f0103886997a854c564eca5a');
	assert.equal(receipt.hostCommandDispatchPassed, false);
	const { passed, total, checks } = receipt.qualification;
	assert.deepEqual([passed, total], [31, 35]);
	assert.deepEqual(checks.filter((check) => !check.passed).map((check) => check.id),
		['HOST-PIPE-REDIRECT', 'HOST-STATUS', 'HOST-EPIPE', 'HOST-FAILURE']);
	const byId = Object.fromEntries(receipt.results.map((result) => [result.id, result]));
	const stdout = (id) => Buffer.from(byId[id].result.stdout).toString();
	// Host-command statuses 126/134 and Bash's native exec failure 126 all arrived as 79.
	assert.equal(stdout('HOST-STATUS'), 'exit=23\ncrash=79\n');
	assert.equal(stdout('HOST-FAILURE'), 'broken=79\nnative=79\nafter\n');
	assert.deepEqual(byId['HOST-STATUS'].records.map((record) => record.status), [23, 134]);
	assert.equal(stdout('HOST-EPIPE'), 'y\npipe=\n');
	assert.deepEqual(byId['HOST-EPIPE'].records.map((record) => record.status), [0, 64]);
	assert(receipt.results.every((result) => result.workersAfterContextClose === 0));
	assert.equal((await archived('first-dispatch-process')).exitCode, 1);
});

test('the archived pipeline-status rerun reproduces the errno-range status loss before patch 0009', async () => {
	const receipt = await archived('pipeline-status');
	assert.equal(receipt.applicationCommit, '22b03116d7059d7853bf8e4bf36bd18aa116bd2e');
	assert.deepEqual([receipt.qualification.passed, receipt.qualification.total], [33, 37]);
	assert.deepEqual(receipt.qualification.observations, { bashPipestatus: 'pipestatus=[]\n' });
	const byId = Object.fromEntries(receipt.results.map((result) => [result.id, result]));
	const text = (id, stream) => Buffer.from(byId[id].result[stream]).toString();
	assert.equal(text('HOST-STATUS', 'stdout'), 'exit=23\ncrash=79\n');
	// `>&2` inside the pipeline subshell failed before printf ran; the reader still saw the bytes.
	assert.equal(text('HOST-EPIPE', 'stdout'), 'y\nreader=0\n');
	assert.equal(text('HOST-EPIPE', 'stderr'), 'bash: line 1: 2: Invalid argument\nbash: line 1: 6: Invalid argument\n');
	assert.equal((await archived('pipeline-status-process')).exitCode, 1);
});

test('the archived subshell-redirect rerun shows redirection failing inside a forked pipeline subshell', async () => {
	const receipt = await archived('subshell-redirect');
	assert.equal(receipt.applicationCommit, '9b091e5a662e580c8e0fb9f9f5fc64c1a1baa098');
	assert.deepEqual([receipt.qualification.passed, receipt.qualification.total], [35, 39]);
	const byId = Object.fromEntries(receipt.results.map((result) => [result.id, result]));
	const text = (id, stream) => Buffer.from(byId[id].result[stream]).toString();
	assert.equal(text('HOST-EPIPE', 'stderr'), 'bash: line 1: writer: Invalid argument\nbash: line 1: 7: Invalid argument\n');
	assert.deepEqual(byId['HOST-EPIPE'].records.map((record) => record.status), [0, 64]);
	assert.deepEqual(receipt.qualification.observations.bashSubshellDup, {
		stdout: 'after\n', stderr: 'top\nbash: line 1: 2: Invalid argument\nbash: line 1: 6: Invalid argument\n'
	});
	assert.equal((await archived('subshell-redirect-process')).exitCode, 1);
});
