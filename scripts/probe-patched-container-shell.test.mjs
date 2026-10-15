// Contract unit observations only. These tests do not produce browser evidence.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtures, judgePatchedShellProbe, readPinnedProbeInputs } from './probe-patched-container-shell-lib.mjs';

const bytes = (text) => Array.from(new TextEncoder().encode(text));
const binary = [0, 255, 226, 130, 172, 10, 13, 97, 98];
const stdout = {
	'PATCHED-BUILTINS': 'builtins:한글\nstdin:real-input\n',
	'G0-SHELL': 'arg=./probe.wasm\0arg=report\0arg=space arg\0arg=한글\0arg=\0G0=space 한글\0',
	'G0-ARGV-FRAME': 'arg=./probe.wasm\0arg=report\0arg=\0arg=line\nbreak\0arg=carriage\rreturn\0arg=\0G0=space 한글\0',
	'G0-ENV-UNSET': 'arg=./probe.wasm\0arg=report\0',
	'PATCHED-ENV-EMPTY': 'env-count=0\n',
	'G0-TAIL-EXEC': 'arg=./probe.wasm\0arg=report\0arg=tail\0G0=space 한글\0',
	'G0-EXIT': 'exit=23\n',
	'G0-CWD': '/workspace/sub\nexit=0\n',
	'G0-FS': 'real-cwd\nfile-exit=0\nfrom-shell\n'
};
const observations = () => fixtures.map(({ id }) => ({
	id, type: 'result', backendCompleted: true,
	result: {
		code: 0, stdout: id === 'G0-FD' ? binary : bytes(stdout[id]),
		stderr: id === 'G0-SHELL' ? [...bytes('stderr'), 0, 255, 226, 130, 172] : []
	},
	files: id === 'G0-FD' ? { '/binary': binary } : id === 'G0-FS' ? {
		'/sub/source': bytes('from-shell\n'), '/sub/changed': bytes('from-shell\n')
	} : {},
	events: [{ type: 'sdkInitialized' }], consoleErrors: [],
	remainingWorkerTargets: 0, blockedRequests: [], initialWorkerTargets: 0,
	hostContextClosed: true, workersAfterContextClose: 0
}));

test('complete minimum observations remain separate from common Container/backend qualification', () => {
	const judged = judgePatchedShellProbe(observations());
	assert.equal(judged.guestAcceptancePassed, true);
	assert.equal(judged.backendCompleteCases, 10);
	assert.equal(judged.shellBackendReady, false);
	assert.equal(judged.commonContainerFdVfsQualified, false);
	assert.equal(judged.originalG0Evaluation.shellBackendReady, false);
});

test('host context cleanup cannot turn a real timeout into backend completion', () => {
	const results = observations();
	results[0].type = 'timeout';
	results[0].backendCompleted = false;
	const judged = judgePatchedShellProbe(results);
	assert.equal(judged.guestAcceptancePassed, false);
	assert.equal(judged.backendCompleteCases, 9);
	assert.equal(judged.checks.find(({ id }) => id === 'owned-host-context-cleanup').status, 'passed');
	assert.equal(judged.checks.find(({ id }) => id === 'actual-backend-completion').status, 'failed');
});

test('unset-variable evidence cannot replace an explicitly empty real exec environment', () => {
	const results = observations();
	results.find(({ id }) => id === 'PATCHED-ENV-EMPTY').result.stdout = bytes('env-count=1\n');
	assert.equal(judgePatchedShellProbe(results).guestAcceptancePassed, false);
});

test('a failed initializer or leaked Worker cannot be hidden by final guest output', () => {
	for (const alter of [
		(value) => { value.events = []; },
		(value) => { value.remainingWorkerTargets = 1; },
		(value) => { value.events.push({ type: 'threadError' }); }
	]) {
		const results = observations();
		alter(results[0]);
		assert.equal(judgePatchedShellProbe(results).guestAcceptancePassed, false);
	}
});

test('an unapproved package receipt digest is rejected before reading any local input', async () => {
	await assert.rejects(readPinnedProbeInputs({ packageReceiptSha256: '0'.repeat(64) }));
});
