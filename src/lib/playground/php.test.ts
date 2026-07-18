import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
let suppressAutoLoadAck = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (suppressAutoLoadAck) return;
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() =>
				this.onmessage?.({ data: { results: true } } as MessageEvent<any>)
			);
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'factorial_plus_bonus=27\n', results: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/php?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import Php from './php';

describe('PHP sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		suppressAutoLoadAck = false;
	});

	it('loads the PHP worker and forwards run output', async () => {
		const sandbox = new Php();
		const outputs: string[] = [];
		const code = '<?php echo "factorial_plus_bonus=27\\n";';

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['5'], {
				activePath: 'main.php',
				stdin: '4\n'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
			expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, {
				load: true,
				moduleUrl: 'http://localhost:3000/absproxy/5173/wasm-php/runtime.mjs',
				log: true
		});
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				activePath: 'main.php',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['5'],
				stdin: '4\n',
				activePath: 'main.php',
				log: true
			})
		);
		expect(outputs).toContain('factorial_plus_bonus=27\n');
	});

	it('rejects load when the PHP worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Php();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/php.js',
			lineno: 8,
			colno: 2
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'PHP worker script error: worker script error (/worker/php.js:8:2)'
		);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Php();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('27\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run("<?php echo file_get_contents('php://input');", false)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('27\n');
	});
});
