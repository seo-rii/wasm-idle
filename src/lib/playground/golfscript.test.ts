import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUBY_MAX_ASSET_BYTES } from '@wasm-idle/core';
import { createRubyRuntimeTestPreflightPayload } from './rubyTestPreflight';
import { WASM_GOLFSCRIPT_INTERPRETER_RECEIPT } from './wasmGolfscriptVersion';

const mocks = vi.hoisted(() => ({
	preflightVerifiedRubyRuntimeAssets: vi.fn(),
	fetchPinnedRuntimeAsset: vi.fn()
}));
vi.mock('@wasm-idle/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/core')>()),
	fetchPinnedRuntimeAsset: mocks.fetchPinnedRuntimeAsset
}));
vi.mock('$lib/playground/rubyAssets', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rubyAssets')>()),
	preflightVerifiedRubyRuntimeAssets: mocks.preflightVerifiedRubyRuntimeAssets
}));

const workers: MockWorker[] = [];
let autoExecute = true;
class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any, _transfer?: Transferable[]) => {
		if (message.load) queueMicrotask(() => this.emit({ load: true }));
		else if (message.prepare || autoExecute) queueMicrotask(() => this.emit({ results: true }));
	});
	terminate = vi.fn();
	constructor() {
		workers.push(this);
	}
	emit(data: any) {
		this.onmessage?.({ data } as MessageEvent<any>);
	}
}
vi.mock('$lib/playground/worker/ruby?worker', () => ({ default: MockWorker }));

import Golfscript from './golfscript';
const sandboxes: Golfscript[] = [];
const createSandbox = () => {
	const sandbox = new Golfscript();
	sandboxes.push(sandbox);
	return sandbox;
};
beforeEach(() => {
	workers.length = 0;
	autoExecute = true;
	mocks.preflightVerifiedRubyRuntimeAssets
		.mockReset()
		.mockImplementation(async () => createRubyRuntimeTestPreflightPayload());
	mocks.fetchPinnedRuntimeAsset
		.mockReset()
		.mockResolvedValue(new Uint8Array(WASM_GOLFSCRIPT_INTERPRETER_RECEIPT.bytes));
});
afterEach(async () => {
	await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.dispose()));
	vi.useRealTimers();
});

describe('GolfScript sandbox using the genuine Ruby runtime', () => {
	it('transfers separately verified, owned interpreter bytes with a main.gs startup context', async () => {
		const sandbox = createSandbox();
		await sandbox.load({ rootUrl: '/playground' });
		expect(mocks.fetchPinnedRuntimeAsset).toHaveBeenCalledWith(
			expect.objectContaining({
				url: expect.stringContaining('/playground/wasm-golfscript/golfscript.rb?v='),
				receipt: WASM_GOLFSCRIPT_INTERPRETER_RECEIPT,
				maxAssetBytes: expect.any(Number),
				signal: expect.any(AbortSignal)
			})
		);
		const [load, transfer] = workers[0].postMessage.mock.calls[0];
		expect(Object.keys(load).sort()).toEqual([
			'interpreterBytes',
			'language',
			'load',
			'maxAssetBytes',
			'runtimePreflight',
			'startupContext'
		]);
		expect(load).toMatchObject({
			language: 'golfscript',
			startupContext: { args: [], activePath: 'main.gs', workspaceFiles: [] },
			maxAssetBytes: RUBY_MAX_ASSET_BYTES
		});
		expect(load.interpreterBytes.byteLength).toBe(WASM_GOLFSCRIPT_INTERPRETER_RECEIPT.bytes);
		expect(transfer).toHaveLength(4);
		expect(new Set(transfer).size).toBe(4);
		expect(transfer?.at(-1)).toBe(load.interpreterBytes.buffer);
		expect(load.interpreterBytes).not.toBe(
			await mocks.fetchPinnedRuntimeAsset.mock.results[0].value
		);
	});

	it('reuses the same worker and includes the interpreter URL in its cache identity', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/playground');
		await sandbox.load('/playground');
		expect(workers).toHaveLength(1);
		expect(mocks.fetchPinnedRuntimeAsset).toHaveBeenCalledOnce();
		await sandbox.load({
			rootUrl: '/playground',
			golfscript: { interpreterUrl: '/other/golfscript.rb' }
		});
		expect(workers).toHaveLength(2);
		expect(mocks.fetchPinnedRuntimeAsset).toHaveBeenCalledTimes(2);
		expect(workers[0].terminate).toHaveBeenCalledOnce();
	});

	it('forwards real CLI options, explicit stdin and exact source/workspace names as data', async () => {
		const sandbox = createSandbox();
		const code = '~+';
		const activePath = "examples/한글#{1} 'quoted'.gs";
		const workspaceFiles = [{ path: 'helper.txt', content: 'value' }];
		const args = ['--', "#{1+1} a'b\\c", '-value'];
		await sandbox.load('/playground', code, false, args, { activePath, workspaceFiles });
		await expect(
			sandbox.run(code, true, false, undefined, args, { activePath, workspaceFiles })
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, false, undefined, args, {
				activePath,
				workspaceFiles,
				stdin: '20 22\n'
			})
		).resolves.toBe(true);
		expect(workers[0].postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				code,
				prepare: false,
				args,
				activePath,
				workspaceFiles,
				stdin: '20 22\n'
			})
		);
		// User files, rather than the separately mounted 19 KB interpreter, consume source quota.
		await expect(
			sandbox.run(code, false, false, undefined, [], {
				stdin: '',
				limits: { maxWorkspaceBytes: 2 }
			})
		).resolves.toBe(true);
	});

	it('rejects runtime-namespace collisions before worker startup or source dispatch', async () => {
		const sandbox = createSandbox();
		await expect(
			sandbox.load('/playground', '', false, [], {
				activePath: '__wasm_idle_golfscript__/golfscript.rb'
			})
		).rejects.toMatchObject({ runtimeId: 'GOLFSCRIPT', phase: 'configuration' });
		expect(workers).toHaveLength(0);
		await sandbox.load('/playground');
		await expect(
			sandbox.run('~+', false, false, undefined, [], {
				workspaceFiles: [
					{ path: '__wasm_idle_golfscript__/golfscript.rb', content: 'fake' }
				]
			})
		).rejects.toMatchObject({ runtimeId: 'GOLFSCRIPT', phase: 'configuration' });
		expect(workers[0].postMessage).toHaveBeenCalledOnce();
		await expect(sandbox.run(';42', false, false, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
	});

	it('reports GolfScript output limits, terminates the worker and recovers with a fresh load', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/playground');
		autoExecute = false;
		const running = sandbox.run(';42', false, false, undefined, [], {
			limits: { maxOutputBytes: 3 }
		});
		workers[0].emit({ output: '🙂', results: true });
		await expect(running).rejects.toMatchObject({
			code: 'output-limit',
			runtimeId: 'GOLFSCRIPT',
			actual: 4,
			limit: 3
		});
		expect(output).not.toHaveBeenCalled();
		expect(workers[0].terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		autoExecute = true;
		await sandbox.load('/playground');
		await expect(sandbox.run(';42', false, false, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
	});

	it('retains typed GolfScript execution timeout and disposed-state identities', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/playground');
		autoExecute = false;
		vi.useFakeTimers();
		const running = sandbox.run(';{1}do', false, false, undefined, [], {
			stdin: '',
			limits: { compileTimeoutMs: 1, runTimeoutMs: 10 }
		});
		const failure = expect(running).rejects.toMatchObject({
			code: 'timeout',
			runtimeId: 'GOLFSCRIPT'
		});
		await vi.advanceTimersByTimeAsync(11);
		await failure;
		await sandbox.dispose();
		await expect(sandbox.run(';42', false)).rejects.toMatchObject({
			runtimeId: 'GOLFSCRIPT',
			phase: 'dispose'
		});
	});
});
