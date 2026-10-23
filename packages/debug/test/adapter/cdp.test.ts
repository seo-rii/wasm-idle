import { describe, expect, it, vi } from 'vitest';
import { CdpDebugAdapter } from '../../src/adapter/cdp.js';
import type { CdpEvent, CdpTransport } from '../../src/adapter/cdp-transport.js';

function nativeTransport() {
	let listener: (event: CdpEvent) => void = () => undefined;
	const transport: CdpTransport = {
		request: vi.fn(async (method, params) =>
			method === 'Debugger.setBreakpoint'
				? {
						breakpointId: `bp-${params?.location.columnNumber}`,
						actualLocation: params?.location
					}
				: {}
		),
		onEvent: (callback) => {
			listener = callback;
			return () => {
				listener = () => undefined;
			};
		},
		disconnect: vi.fn(async () => undefined)
	};
	return {
		transport,
		emit: (method: string, params: Record<string, unknown> = {}) => listener({ method, params })
	};
}

describe('native CDP adapter', () => {
	it('steps out of compiler-inlined Java methods without leaving the physical caller', async () => {
		const { transport, emit } = nativeTransport();
		const adapter = new CdpDebugAdapter({
			transport,
			source: { path: 'Main.java' },
			variables: false
		});
		adapter.registerWasmSource('java', [
			{
				address: 100,
				endAddress: 110,
				sourcePath: 'Main.java',
				line: 4,
				functionName: 'Main.main'
			},
			{
				address: 110,
				endAddress: 115,
				sourcePath: 'Main.java',
				line: 11,
				functionName: 'Helper.add',
				inlineDepth: 1
			},
			{
				address: 115,
				endAddress: 120,
				sourcePath: 'Main.java',
				line: 12,
				functionName: 'Helper.add',
				inlineDepth: 1
			},
			{
				address: 120,
				endAddress: 130,
				sourcePath: 'Main.java',
				line: 6,
				functionName: 'Main.main'
			}
		]);
		const events: string[] = [];
		adapter.onEvent((event) => events.push(event.type));
		const pause = (address: number) =>
			emit('Debugger.paused', {
				callFrames: [
					{
						callFrameId: 'frame',
						functionName: 'physical-main',
						location: { scriptId: 'java', lineNumber: 0, columnNumber: address },
						scopeChain: []
					}
				]
			});
		pause(110);
		await adapter.stepOut(1);
		expect(transport.request).toHaveBeenLastCalledWith('Debugger.stepOver');
		emit('Debugger.resumed');
		pause(115);
		expect(events.filter((type) => type === 'stopped')).toHaveLength(1);
		emit('Debugger.resumed');
		pause(120);
		expect(events.filter((type) => type === 'stopped')).toHaveLength(2);
		expect((await adapter.stackTrace(1))[0]).toMatchObject({ line: 6, name: 'Main.main' });
		pause(100);
		await adapter.next(1);
		emit('Debugger.resumed');
		pause(110);
		expect(events.filter((type) => type === 'stopped')).toHaveLength(3);
		expect(transport.request).toHaveBeenLastCalledWith('Debugger.stepOver');
		emit('Debugger.resumed');
		pause(120);
		expect(events.filter((type) => type === 'stopped')).toHaveLength(4);
	});

	it('invalidates scope references and in-flight property reads when the VM resumes', async () => {
		const { transport, emit } = nativeTransport();
		const adapter = new CdpDebugAdapter({
			transport,
			source: { path: 'main.js' },
			url: 'wasm-idle://main',
			lineOffset: 2
		});
		emit('Debugger.scriptParsed', { scriptId: '1', url: 'wasm-idle://main' });
		emit('Debugger.paused', {
			callFrames: [
				{
					callFrameId: 'frame',
					functionName: '',
					location: { scriptId: '1', lineNumber: 4, columnNumber: 0 },
					scopeChain: [{ type: 'local', object: { objectId: 'locals' } }]
				}
			]
		});
		const [frame] = await adapter.stackTrace(1);
		expect(frame.line).toBe(3);
		const [scope] = await adapter.scopes(frame.id);
		let resolve!: (value: any) => void;
		vi.mocked(transport.request).mockImplementationOnce(
			() =>
				new Promise((done) => {
					resolve = done;
				})
		);
		const pending = adapter.variables(scope.variablesReference);
		emit('Debugger.resumed');
		resolve({ result: [{ name: 'secret', value: { type: 'number', value: 7 } }] });
		expect(await pending).toEqual([]);
		expect(await adapter.variables(scope.variablesReference)).toEqual([]);
		await expect(adapter.evaluate('1', frame.id)).rejects.toThrow('paused frame');
	});

	it('binds TeaVM byte ranges, coalesces same-source instruction steps, and exposes no invented Java locals', async () => {
		const { transport, emit } = nativeTransport();
		const adapter = new CdpDebugAdapter({
			transport,
			source: { path: 'Main.java' },
			variables: false
		});
		adapter.registerWasmSource('java', [
			{
				address: 100,
				endAddress: 110,
				sourcePath: 'Main.java',
				line: 5,
				functionName: 'Main.main'
			},
			{
				address: 120,
				endAddress: 140,
				sourcePath: 'Main.java',
				line: 6,
				functionName: 'Main.main'
			}
		]);
		expect(await adapter.setBreakpoints({ path: 'Main.java' }, [4])).toMatchObject([
			{ requestedLine: 4, line: 5, verified: true }
		]);
		const events: string[] = [];
		adapter.onEvent((event) => events.push(event.type));
		const pause = (address: number) =>
			emit('Debugger.paused', {
				callFrames: [
					{
						callFrameId: 'frame',
						functionName: 'wasm-func',
						location: { scriptId: 'java', lineNumber: 0, columnNumber: address },
						scopeChain: []
					}
				]
			});
		pause(100);
		await adapter.next(1);
		emit('Debugger.resumed');
		pause(101);
		expect(events.filter((type) => type === 'stopped')).toHaveLength(1);
		expect(transport.request).toHaveBeenLastCalledWith('Debugger.stepOver');
		emit('Debugger.resumed');
		pause(115); // Generated instructions between Java source spans stay under step control.
		expect(events.filter((type) => type === 'stopped')).toHaveLength(1);
		expect(transport.request).toHaveBeenLastCalledWith('Debugger.stepOver');
		emit('Debugger.resumed');
		pause(120);
		expect(events.filter((type) => type === 'stopped')).toHaveLength(2);
		expect((await adapter.stackTrace(1))[0]).toMatchObject({ line: 6, name: 'Main.main' });
		expect(adapter.capabilities.supportsVariables).toBe(false);
		await expect(adapter.evaluate('value')).rejects.toThrow();
		pause(140);
		expect(await adapter.stackTrace(1)).toEqual([]);
	});
});
