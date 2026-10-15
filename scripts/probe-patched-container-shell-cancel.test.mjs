// Protocol evaluator guards only; actual cancellation requires the browser receipt.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
	cancellationFixtures,
	judgeCancellationProbe
} from './probe-patched-container-shell-cancel-lib.mjs';

const bytes = (text) => Array.from(new TextEncoder().encode(text));
const observations = () =>
	cancellationFixtures.map((fixture) => ({
		id: fixture.id,
		initialWorkers: 0,
		cancellation: {
			type: 'cancelled',
			backendCompleted: false,
			pendingBeforeTermination: true,
			generation: 1,
			hostSettlementCount: 1,
			workerTerminalMessageCount: 0,
			events: fixture.slowDownload
				? [{ type: 'downloadPending', receivedBytes: 16, expectedBytes: 100 }]
				: [
						{ type: 'guestReady', bytes: bytes('ready\n') },
						{ type: 'pendingGuest', stdinLocked: fixture.interactive === true }
					],
			cleanup: {
				type: 'ownerCleanup',
				scope: 'forced-host-group',
				backendCompleted: false,
				remainingTrackedChildren: 0,
				requestedWorkerTerminations: 4
			}
		},
		recovery: {
			type: 'result',
			backendCompleted: true,
			generation: 2,
			hostSettlementCount: 1,
			workerTerminalMessageCount: 1,
			memoryDistinctFromPrevious: true,
			events: [],
			result: { code: 0, stdout: bytes('recovered'), stderr: [] }
		},
		workersBeforeRecovery: 0,
		workersAfterRecovery: 0,
		workersAfterContextClose: 0,
		samePageRecovery: true,
		hostContextClosed: true,
		consoleErrors: [],
		blockedRequests: [],
		...(fixture.slowDownload
			? {
					download: {
						active: 0,
						aborted: 1,
						completed: 0,
						sentBytes: 16,
						expectedBytes: 100
					}
				}
			: {})
	}));

test('selected forced owner cleanup never qualifies signals, surviving shell or common Container resources', () => {
	const judged = judgeCancellationProbe(observations());
	assert.equal(judged.forcedOwnerCancellationPassed, true);
	assert.equal(judged.checks.length, 19);
	for (const key of [
		'guestSignalQualified',
		'survivingShellQualified',
		'commonContainerFdVfsQualified',
		'shellBackendReady'
	])
		assert.equal(judged[key], false);
});

test('context teardown cannot hide leaked workers before same-page recovery', () => {
	const results = observations();
	results[0].workersBeforeRecovery = 1;
	assert.equal(judgeCancellationProbe(results).forcedOwnerCancellationPassed, false);
});

test('timeout, completed guest, missing readiness or unlocked stdin cannot count as cancellation', () => {
	for (const alter of [
		(value) => {
			value.cancellation.type = 'timeout';
		},
		(value) => {
			value.cancellation.backendCompleted = true;
		},
		(value) => {
			value.cancellation.events[0].bytes = [];
		},
		(value) => {
			value.cancellation.events[1].stdinLocked = false;
		}
	]) {
		const results = observations();
		alter(results[1]);
		assert.equal(judgeCancellationProbe(results).forcedOwnerCancellationPassed, false);
	}
});

test('download must actually be partial and server-observed abort must retire the request', () => {
	for (const alter of [
		(value) => {
			value.download.active = 1;
		},
		(value) => {
			value.download.completed = 1;
		},
		(value) => {
			value.download.aborted = 0;
		},
		(value) => {
			value.cancellation.events[0].receivedBytes = 100;
		}
	]) {
		const results = observations();
		alter(results[2]);
		assert.equal(judgeCancellationProbe(results).forcedOwnerCancellationPassed, false);
	}
});

test('recovery requires a new generation and memory, real stdout, and one terminal result', () => {
	for (const alter of [
		(value) => {
			value.recovery.generation = 1;
		},
		(value) => {
			value.recovery.memoryDistinctFromPrevious = false;
		},
		(value) => {
			value.recovery.result.stdout = [];
		},
		(value) => {
			value.cancellation.hostSettlementCount = 2;
		},
		(value) => {
			value.recovery.events = [{ type: 'threadError' }];
		},
		(value) => {
			value.cancellation.events.push({ type: 'failure', backendCompleted: false });
		},
		(value) => {
			value.cancellation.workerTerminalMessageCount = 1;
		}
	]) {
		const results = observations();
		alter(results[0]);
		assert.equal(judgeCancellationProbe(results).forcedOwnerCancellationPassed, false);
	}
});
