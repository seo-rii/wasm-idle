// Evaluator for experimental forced host-group cleanup, not guest signal support.
export const cancellationFixtures = [
	{ id: 'G0-CANCEL-CPU', script: './probe.wasm loop', cancel: true },
	{ id: 'G0-CANCEL-READ', script: './probe.wasm blocked', interactive: true, cancel: true },
	{ id: 'G0-CANCEL-DOWNLOAD', script: ':', slowDownload: true, cancel: true }
];

const equal = (a, b) => Array.isArray(a) && a.length === b.length && a.every((v, i) => v === b[i]);
const encoded = (text) => Array.from(new TextEncoder().encode(text));

export function judgeCancellationProbe(results) {
	const checks = [];
	for (const fixture of cancellationFixtures) {
		const value = results.find(({ id }) => id === fixture.id);
		const cancelled = value?.cancellation;
		const check = (name, passed) =>
			checks.push({
				id: fixture.id + ':' + name,
				status: !value ? 'not-run' : passed ? 'passed' : 'failed'
			});
		check(
			'pending-operation',
			cancelled?.type === 'cancelled' &&
				cancelled.backendCompleted === false &&
				cancelled.pendingBeforeTermination === true &&
				(fixture.slowDownload
					? cancelled.events?.some(
							({ type, receivedBytes, expectedBytes }) =>
								type === 'downloadPending' &&
								receivedBytes > 0 &&
								receivedBytes < expectedBytes
						)
					: equal(
							cancelled.events
								?.filter(({ type }) => type === 'guestReady')
								.flatMap(({ bytes }) => bytes),
							encoded('ready\n')
						) &&
						cancelled.events?.some(
							({ type, stdinLocked }) =>
								type === 'pendingGuest' &&
								(!fixture.interactive || stdinLocked === true)
						))
		);
		check(
			'owner-acknowledged',
			cancelled?.cleanup?.type === 'ownerCleanup' &&
				cancelled.cleanup.scope === 'forced-host-group' &&
				cancelled.cleanup.backendCompleted === false &&
				cancelled.cleanup.remainingTrackedChildren === 0 &&
				(fixture.slowDownload || cancelled.cleanup.requestedWorkerTerminations > 0)
		);
		check(
			'single-terminal-result',
			cancelled?.hostSettlementCount === 1 &&
				value?.recovery?.hostSettlementCount === 1 &&
				cancelled?.workerTerminalMessageCount === 0 &&
				value?.recovery?.workerTerminalMessageCount === 1
		);
		check('workers-retired-before-recovery', value?.workersBeforeRecovery === 0);
		check(
			'same-page-recovery',
			value?.samePageRecovery === true &&
				value.recovery?.type === 'result' &&
				value.recovery.backendCompleted === true &&
				value.recovery.generation === cancelled?.generation + 1 &&
				value.recovery.memoryDistinctFromPrevious === true &&
				value.recovery.result?.code === 0 &&
				equal(value.recovery.result.stdout, encoded('recovered')) &&
				equal(value.recovery.result.stderr, []) &&
				value.workersAfterRecovery === 0
		);
		check(
			'clean-context',
			value?.initialWorkers === 0 &&
				value.workersAfterContextClose === 0 &&
				value.hostContextClosed === true &&
				value.consoleErrors?.length === 0 &&
				value.blockedRequests?.length === 0 &&
				!cancelled?.events?.some(({ type }) =>
					['threadError', 'result', 'failure', 'error'].includes(type)
				) &&
				!value.recovery?.events?.some(({ type }) =>
					['threadError', 'failure', 'error'].includes(type)
				)
		);
		if (fixture.slowDownload)
			check(
				'network-request-retired',
				value?.download?.active === 0 &&
					value.download.aborted === 1 &&
					value.download.completed === 0 &&
					value.download.sentBytes > 0 &&
					value.download.sentBytes < value.download.expectedBytes
			);
	}
	return {
		collectionComplete:
			results.length === cancellationFixtures.length &&
			new Set(results.map(({ id }) => id)).size === cancellationFixtures.length,
		forcedOwnerCancellationPassed:
			results.length === cancellationFixtures.length &&
			checks.every(({ status }) => status === 'passed'),
		checks,
		cancellationScope: 'forced host-group termination; fresh SDK memory for recovery',
		guestSignalQualified: false,
		survivingShellQualified: false,
		commonContainerFdVfsQualified: false,
		shellBackendReady: false
	};
}
