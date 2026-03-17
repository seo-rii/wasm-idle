import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: '10:1\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/clang?worker', () => ({
	default: MockWorker
}));

import Clang from './clang';

describe('Clang sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('passes complex C++ source with multiple declarations and mutual recursion to the worker', async () => {
		const sandbox = new Clang('CPP');
		const outputs: string[] = [];
		const code = `#include <stdio.h>

bool is_odd(int value);

bool is_even(int value) {
    return value == 0 || is_odd(value - 1);
}

bool is_odd(int value) {
    return value != 0 && is_even(value - 1);
}

int main() {
    int left = 3, right = 7;
    printf("%d:%d\\n", left + right, is_even(left + right));
    return 0;
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/');
		await expect(sandbox.run(code, false)).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				code,
				prepare: false
			})
		);
		expect(outputs).toContain('10:1\n');
	});

	it('forwards C++ runtime errors', async () => {
		const sandbox = new Clang('CPP');
		const worker = new MockWorker();
		const events: any[] = [];

		sandbox.ondebug = (event) => events.push(event);
		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() =>
			queueMicrotask(() =>
				worker.onmessage?.({
					data: { error: 'Runtime error: division by zero' }
				} as MessageEvent<any>)
			)
		);

		await expect(
			sandbox.run(
				`#include <stdio.h>
int main() {
    int left = 10, right = 0;
    printf("%d\\n", left / right);
    return 0;
}`,
				false
			)
		).rejects.toContain('Runtime error');
		expect(events).toEqual([{ type: 'stop' }]);
	});

	it('aliases kill to terminate for C++ sessions', () => {
		const sandbox = new Clang('CPP');
		sandbox.terminate = vi.fn();

		sandbox.kill?.();
		expect(sandbox.terminate).toHaveBeenCalledTimes(1);
	});

	it('separates compile args from runtime args for C++ runs', async () => {
		const sandbox = new Clang('CPP');
		sandbox.output = vi.fn();

		await sandbox.load('/');
		await expect(
			sandbox.run('int main() {}', false, true, undefined, ['-DLEGACY=1'], {
				programArgs: ['one', 'two'],
				cppVersion: 'CPP17'
			})
		).resolves.toBe(true);

		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				language: 'CPP',
				compileArgs: ['-DLEGACY=1'],
				programArgs: ['one', 'two'],
				cppVersion: 'CPP17'
			})
		);
	});
});
