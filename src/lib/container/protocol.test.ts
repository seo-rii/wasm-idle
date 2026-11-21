// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ScriptExitError } from '../playground/executionObservation.js';
import { serializeContainerWorkerError, snapshotContainerArguments } from './protocol.js';
describe('container call snapshot', () => {
	it('transfers the actual program exit code without treating an arbitrary exception as an exit', () => {
		expect(serializeContainerWorkerError(new ScriptExitError(7))).toMatchObject({ exitCode: 7 });
		expect(serializeContainerWorkerError(new Error('SystemExit: 0'))).not.toHaveProperty('exitCode');
	});
	it('uses cancellation messages while retaining a process env variable named signal', () => {
		const signal = new AbortController().signal;
		expect(
			snapshotContainerArguments({ signal, env: { signal: 'literal', LANG: 'ko_KR.UTF-8' } })
		).toEqual({ env: { signal: 'literal', LANG: 'ko_KR.UTF-8' } });
	});
	it('copies workspace binary views before the caller can mutate them', () => {
		const bytes = Uint8Array.of(0, 255, 9);
		const args = [{ path: 'program.wasm', content: bytes }];
		const cloned = snapshotContainerArguments(args);
		bytes[1] = 1;
		args[0].path = 'changed';
		expect(cloned).toEqual([{ path: 'program.wasm', content: Uint8Array.of(0, 255, 9) }]);
	});
});
