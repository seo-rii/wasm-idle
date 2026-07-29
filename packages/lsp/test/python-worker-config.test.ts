import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class FakePythonWorkerScope {
	readonly messages: unknown[] = [];
	private messageListener?: (event: MessageEvent) => void;

	addEventListener(type: 'message', listener: (event: MessageEvent) => void) {
		if (type === 'message') this.messageListener = listener;
	}

	postMessage(message: unknown) {
		this.messages.push(message);
	}

	dispatch(data: unknown) {
		this.messageListener?.({ data } as MessageEvent);
	}
}

describe('Python LSP worker configuration', () => {
	let scope: FakePythonWorkerScope;

	beforeEach(async () => {
		vi.resetModules();
		scope = new FakePythonWorkerScope();
		vi.stubGlobal('self', scope);
		await import('../src/python/worker.js');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('rejects initialization without an explicit Pyodide base URL', () => {
		scope.dispatch({ type: 'init' });

		expect(scope.messages).toEqual([
			{
				type: 'error',
				error: 'Python LSP init requires an explicit pyodideBaseUrl'
			}
		]);
	});

	it('rejects JSON-RPC traffic before initialization', () => {
		scope.dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' });

		expect(scope.messages).toEqual([
			{
				type: 'error',
				error: 'Python LSP worker requires init before JSON-RPC messages'
			}
		]);
	});
});
