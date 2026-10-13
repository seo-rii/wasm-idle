import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeShellProbe } from './probe-container-shell-lib.mjs';

const bytes = (text) => Array.from(new TextEncoder().encode(text));
const observed = (id, stdout = '', extra = {}) => ({
	id,
	type: 'result',
	result: { code: 0, stdout: bytes(stdout), stderr: [] },
	remainingWorkerTargets: 0,
	blockedRequests: [],
	...extra
});
const check = (results, id) =>
	judgeShellProbe(results).checks.find((value) => value.id === id).status;

test('a missing experiment never qualifies a backend', () => {
	const result = judgeShellProbe([]);
	assert.equal(result.shellBackendReady, false);
	assert.equal(result.checks.find(({ id }) => id === 'g0-clang-link').status, 'not-run');
});

test('exit zero cannot hide a lost empty argument', () => {
	const prefix = 'arg=./probe.wasm\0arg=report\0arg=space arg\0arg=한글\0';
	const suffix = 'G0=space 한글\0';
	assert.equal(check([observed('G0-SHELL', prefix + suffix)], 'argv-env'), 'failed');
	assert.equal(check([observed('G0-SHELL', prefix + 'arg=\0' + suffix)], 'argv-env'), 'passed');
});

test('pipe stdout does not prove that a redirect reached the common mount', () => {
	const binary = [0, 255, 226, 130, 172, 10, 13, 97, 98];
	const result = observed('G0-FD', '', {
		result: { code: 0, stdout: binary, stderr: [] },
		files: { '/binary': { error: 'entry not found' } }
	});
	assert.equal(check([result], 'pipe-bytes'), 'passed');
	assert.equal(check([result], 'redirect-mount'), 'failed');
});

test('cancellation needs guest readiness, observed Worker retirement and recovery', () => {
	const result = observed('G0-CANCEL-CPU', '', {
		type: 'cancelled',
		remainingTrackedWorkers: 0,
		trace: [{ stream: 'stdout', bytes: bytes('ready\n') }],
		recovery: observed('recovery', 'recovered')
	});
	assert.equal(check([result], 'cancel-cpu'), 'passed');
	assert.equal(check([{ ...result, trace: [] }], 'cancel-cpu'), 'failed');
	assert.equal(check([{ ...result, remainingWorkerTargets: 1 }], 'cancel-cpu'), 'failed');
	assert.equal(check([{ ...result, recovery: { type: 'timeout' } }], 'cancel-cpu'), 'failed');
});

test('a compiler diagnostic and missing output cannot be counted as linking', () => {
	const result = observed('G0-CLANG-LINK', '', {
		result: {
			code: 1,
			stdout: [],
			stderr: bytes('WASI does not support spawning subprocesses')
		},
		files: { '/hello.wasm': { error: 'entry not found' } }
	});
	assert.equal(check([result], 'g0-clang-link'), 'failed');
});
