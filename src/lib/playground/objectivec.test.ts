import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushQueuedStdin } from './stdinBuffer';

vi.mock('$env/dynamic/public', () => ({
	env: {}
}));

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		queueMicrotask(() => {
			this.onmessage?.({
				data: {
					debugEvent: {
						type: 'pause',
						line: 3,
						reason: 'entry',
						locals: [{ name: 'value', value: '73' }],
						callStack: [{ functionName: 'main', line: 3 }]
					}
				}
			} as MessageEvent<any>);
			this.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/objectivec?worker', () => ({
	default: MockWorker
}));

import ObjectiveC from './objectivec';

describe('Objective-C sandbox debugging', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('forwards debug controls, buffers, and pause events to the Objective-C worker', async () => {
		const sandbox = new ObjectiveC();
		const events: any[] = [];
		sandbox.ondebug = (event) => events.push(event);

		await sandbox.load('/');
		await expect(
			sandbox.run(
				'int main(void) {\n    int value = 73;\n    return value;\n}',
				false,
				false,
				undefined,
				[],
				{
					debug: true,
					breakpoints: [3],
					pauseOnEntry: true,
					activePath: 'main.m',
					programArgs: ['--trace']
				}
			)
		).resolves.toBe(true);

		const runMessage = workerInstances[0]?.postMessage.mock.calls[1]?.[0];
		expect(runMessage).toEqual(
			expect.objectContaining({
				debug: true,
				breakpoints: [3],
				pauseOnEntry: true,
				activePath: 'main.m',
				programArgs: ['--trace'],
				debugBuffer: sandbox.debugBuffer,
				watchBuffer: sandbox.watchBuffer,
				watchResultBuffer: sandbox.watchResultBuffer,
				interrupt: sandbox.interruptBuffer
			})
		);
		expect(events).toEqual([
			expect.objectContaining({ type: 'pause', line: 3, reason: 'entry' }),
			{ type: 'stop' }
		]);
	});

	it('updates breakpoints and resumes a paused Objective-C trace session', () => {
		const sandbox = new ObjectiveC();
		const events: any[] = [];
		sandbox.ondebug = (event) => events.push(event);

		sandbox.setBreakpoints([7, 3, 7, -1]);
		const control = new Int32Array(sandbox.debugBuffer);
		expect(Atomics.load(control, 3)).toBe(2);
		expect([Atomics.load(control, 4), Atomics.load(control, 5)]).toEqual([3, 7]);

		sandbox.debugCommand('nextLine');
		expect(Atomics.load(control, 1)).toBe(3);
		expect(events).toEqual([{ type: 'resume', command: 'nextLine' }]);
	});

	it('evaluates Objective-C watch expressions through the shared debug buffers', async () => {
		const sandbox = new ObjectiveC();
		sandbox.worker = {} as Worker;
		setTimeout(() => flushQueuedStdin(['73'], sandbox.watchResultBuffer), 0);

		await expect(sandbox.debugEvaluate('value')).resolves.toBe('73');
	});
});
