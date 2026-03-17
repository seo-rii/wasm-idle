import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'Main.java',
							lineNumber: 2,
							columnNumber: 5,
							severity: 'warning',
							message: 'unused import'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true, buffer: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'sum=10\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/java?worker', () => ({
	default: MockWorker
}));

import Java from './java';

describe('TeaVM Java sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('loads the TeaVM worker and resolves prepare/run messages', async () => {
		const sandbox = new Java();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = `public class Main {
    static boolean isEven(int value) {
        return value == 0 || isOdd(value - 1);
    }

    static boolean isOdd(int value) {
        return value != 0 && isEven(value - 1);
    }

    public static void main(String[] args) {
        int left = 3, right = 7;
        System.out.println((left + right) + ":" + isEven(left + right));
    }
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(sandbox.run(code, false, true, undefined, ['one', 'two'])).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				assets: expect.objectContaining({
					baseUrl: expect.stringMatching(
						/^http:\/\/localhost(?::\d+)?\/absproxy\/5173\/teavm\/$/
					),
					useAssetBridge: false
				})
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: []
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two']
			})
		);
		expect(outputs).toContain('sum=10\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'Main.java',
				lineNumber: 2,
				columnNumber: 5,
				severity: 'warning',
				message: 'unused import'
			}
		]);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Java();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('42\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run(
				`public class Main {
    public static void main(String[] args) throws Exception {
        System.out.println(System.in.read());
    }
}`,
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('writes EOF when the worker requests stdin after eof is signaled', async () => {
		const sandbox = new Java();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.eof();
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(sandbox.run('public class Main {}', false)).resolves.toBe(true);
		expect(readBufferedStdin(runMessage.buffer)).toBeNull();
	});

	it('rejects the active run when kill terminates the worker', async () => {
		const sandbox = new Java();

		await sandbox.load('/');
		const worker = workerInstances[workerInstances.length - 1];
		worker.postMessage.mockImplementationOnce(() => {});
		const running = sandbox.run('public class Main {}', false);
		sandbox.kill();

		await expect(running).rejects.toBe('Process terminated');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('forwards runtime errors from the TeaVM worker', async () => {
		const sandbox = new Java();
		const worker = new MockWorker();

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() =>
			queueMicrotask(() =>
				worker.onmessage?.({
					data: {
						error: 'Exception in thread "main" java.lang.ArithmeticException: / by zero'
					}
				} as MessageEvent<any>)
			)
		);

		await expect(
			sandbox.run(
				`public class Main {
    public static void main(String[] args) {
        int zero = 0, value = 10;
        System.out.println(value / zero);
    }
}`,
				false
			)
		).rejects.toContain('ArithmeticException');
	});
});
