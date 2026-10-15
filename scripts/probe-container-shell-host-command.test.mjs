import assert from 'node:assert/strict';
import test from 'node:test';
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
	'HOST-PIPE-REDIRECT': { invocations: [tool(), tool(), tool()], files: { '/binary': [0, 255, 226, 130, 172, 10, 13, 97, 98] } },
	'HOST-EXACT-CONSUMPTION': { invocations: [tool('one'), tool()] },
	'HOST-STATUS': {
		invocations: [probe('exit'), tool('crash')],
		records: [{ status: 23, result: { code: 23, reason: 'exited' } }, { status: 134, result: { code: null, reason: 'runtime-error' } }]
	},
	'HOST-EPIPE': { invocations: [tool('yes'), tool('one')] },
	'HOST-PATH-LOOKUP': { invocations: [{ ...tool(), argv: ['tool'] }] },
	'HOST-FAILURE': {
		stdout: bytes('broken=126\nnative=126\nafter\n'),
		invocations: [invocation('/opt/host/bin/broken', ['/opt/host/bin/broken'])], records: [], consoleErrors: ['native exec failure']
	},
	'HOST-TAIL-EXEC': { code: 23, invocations: [probe('exit')] }
};
function observations() {
	return fixtures.map((fixture) => {
		const extra = structuredClone(special[fixture.id] ?? {});
		return {
			id: fixture.id, type: 'result', backendCompleted: true,
			result: { code: extra.code ?? 0, stdout: extra.stdout ?? fixture.expectedStdout, stderr: extra.stderr ?? [] },
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
