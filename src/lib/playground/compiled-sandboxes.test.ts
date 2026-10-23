import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const debuggerState = vi.hoisted(() => ({ sessions: [] as any[] }));
vi.mock('$lib/playground/lldbSession', () => ({
	LldbSandboxSession: class {
		options: any;
		complete!: (value: boolean) => void;
		completion = new Promise<boolean>((resolve) => {
			this.complete = resolve;
		});
		write = vi.fn();
		eof = vi.fn();
		setBreakpoints = vi.fn();
		debugCommand = vi.fn();
		disconnect = vi.fn(async () => {
			this.complete(true);
		});
		constructor(options: any) {
			this.options = options;
			debuggerState.sessions.push(this);
		}
		start() {
			return this.completion;
		}
	}
}));

const workers: MockWorker[] = [];
class MockWorker {
	onmessage: ((event: any) => void) | null = null;
	onerror = null;
	onmessageerror = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) queueMicrotask(() => this.onmessage?.({ data: { load: true } }));
	});
	terminate = vi.fn();
	constructor() {
		workers.push(this);
	}
}
vi.mock('$lib/playground/worker/objectivec?worker', () => ({ default: MockWorker }));
vi.mock('$lib/playground/worker/v?worker', () => ({ default: MockWorker }));
vi.mock('$lib/playground/worker/d?worker', () => ({ default: MockWorker }));

import ObjectiveC from './objectivec';
import V from './v';
import D from './d';

describe('compiled language sandbox LLDB handoff', () => {
	beforeEach(() => {
		workers.length = 0;
		debuggerState.sessions.length = 0;
		vi.stubGlobal('Worker', MockWorker);
		vi.stubGlobal('MessageChannel', undefined);
	});
	afterEach(() => vi.unstubAllGlobals());

	it.each([
		['Objective-C', () => new ObjectiveC(), 'main.m', 'main'],
		['Objective-C++', () => new ObjectiveC('OBJECTIVECXX'), 'main.mm', 'main'],
		['V', () => new V(), 'main.v', 'main__main'],
		['D', () => new D(), 'main.d', '_Dmain']
	] as const)(
		'%s retires its compiler and keeps the run pending until LLDB exits',
		async (_name, create, activePath, entryFunctionName) => {
			const sandbox = create();
			const output: string[] = [];
			sandbox.output = (text: string) => output.push(text);
			await sandbox.load('/');
			const worker = workers[0];
			const running = sandbox.run('source', false, false, undefined, [], {
				debugMode: 'lldb',
				activePath,
				breakpoints: [3],
				programArgs: ['argument']
			});
			sandbox.write('68\n');
			sandbox.eof();
			sandbox.setBreakpoints([4], activePath);
			worker.onmessage?.({
				data: {
					lldbArtifact: {
						bytes: new Uint8Array([0, 97, 115, 109]),
						sources: [{ path: `/workspace/${activePath}`, content: 'source' }]
					}
				}
			});
			expect(worker.postMessage).toHaveBeenLastCalledWith(
				expect.objectContaining({ debugMode: 'lldb' })
			);
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			const session = debuggerState.sessions[0];
			expect(session.options).toMatchObject({
				sourcePath: `/workspace/${activePath}`,
				entryFunctionName,
				breakpoints: [4],
				programArgs: ['argument']
			});
			expect(session.write).toHaveBeenCalledWith('68\n');
			expect(session.eof).toHaveBeenCalledOnce();
			let settled = false;
			void running.then(() => {
				settled = true;
			});
			await Promise.resolve();
			expect(settled).toBe(false);
			session.options.onOutput('result=73\n');
			session.complete(true);
			await expect(running).resolves.toBe(true);
			expect(output).toEqual(['result=73\n']);
		}
	);

	it('terminates LLDB and rejects an active V run when its abort signal fires', async () => {
		const sandbox = new V();
		await sandbox.load('/');
		const controller = new AbortController();
		const running = sandbox.run('fn main() {}', false, false, undefined, [], {
			debugMode: 'lldb',
			signal: controller.signal
		});
		const rejected = expect(running).rejects.toBe('cancel debugger');
		workers[0].onmessage?.({
			data: {
				lldbArtifact: {
					bytes: new Uint8Array([0, 97, 115, 109]),
					sources: [{ path: '/workspace/main.v', content: 'fn main() {}' }]
				}
			}
		});
		controller.abort('cancel debugger');
		await rejected;
		expect(debuggerState.sessions[0].disconnect).toHaveBeenCalledOnce();
		expect(sandbox.exit).toBe(true);
	});
});
