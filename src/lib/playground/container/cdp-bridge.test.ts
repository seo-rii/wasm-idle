import { describe, expect, it, vi } from 'vitest';
import type { CdpEvent, CdpTransport } from '@wasm-idle/debug';
import { createContainerCdpTransportFactory, installContainerCdpRelay } from './cdp-bridge';

function endpoints() {
	const parent = new EventTarget(),
		child = new EventTarget();
	const endpoint = (local: EventTarget, remote: EventTarget) => ({
		postMessage(data: unknown) {
			queueMicrotask(() => remote.dispatchEvent(new MessageEvent('message', { data })));
		},
		addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
			local.addEventListener('message', listener as EventListener);
		},
		removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
			local.removeEventListener('message', listener as EventListener);
		}
	});
	return { parent: endpoint(parent, child), child: endpoint(child, parent) };
}

describe('container native debugger bridge', () => {
	it('routes VM commands and native pauses through the document and disposes connections', async () => {
		const pair = endpoints();
		let emit!: (event: CdpEvent) => void;
		const native: CdpTransport = {
			request: vi.fn(async () => ({ value: 7 })) as CdpTransport['request'],
			onEvent(listener) {
				emit = listener;
				return vi.fn();
			},
			disconnect: vi.fn(async () => {})
		};
		const connect = vi.fn(async () => native);
		const disposeRelay = installContainerCdpRelay(pair.parent, 'owner-one', connect);
		const owner = createContainerCdpTransportFactory(pair.child, 'owner-one');
		try {
			const transport = await owner.connect('wasm-idle-cdp:test');
			expect(connect).toHaveBeenCalledWith('wasm-idle-cdp:test');
			await expect(
				transport.request('Debugger.evaluateOnCallFrame', { expression: 'value' })
			).resolves.toEqual({ value: 7 });
			expect(native.request).toHaveBeenCalledWith('Debugger.evaluateOnCallFrame', {
				expression: 'value'
			});
			const pauses = vi.fn();
			transport.onEvent(pauses);
			emit({ method: 'Debugger.paused', params: { reason: 'other' } });
			await vi.waitFor(() => expect(pauses).toHaveBeenCalledOnce());
			await transport.disconnect();
			expect(native.disconnect).toHaveBeenCalledOnce();
			await expect(transport.request('Debugger.resume')).rejects.toThrow('closed');
		} finally {
			owner.dispose();
			disposeRelay();
		}
	});

	it('does not route requests from a different owner and cancels pending requests on retirement', async () => {
		const pair = endpoints();
		const connect = vi.fn();
		const disposeRelay = installContainerCdpRelay(pair.parent, 'owner-one', connect);
		const wrongOwner = createContainerCdpTransportFactory(pair.child, 'owner-two');
		const result = wrongOwner.connect('wasm-idle-cdp:test').catch((error) => error);
		await Promise.resolve();
		expect(connect).not.toHaveBeenCalled();
		wrongOwner.dispose();
		await expect(result).resolves.toMatchObject({
			message: 'Container debugger owner is closed'
		});
		disposeRelay();
	});

	it('disconnects a native connection that finishes attaching after its owner retired', async () => {
		const pair = endpoints();
		let finish!: (value: CdpTransport) => void;
		const attaching = new Promise<CdpTransport>((resolve) => {
			finish = resolve;
		});
		const connect = vi.fn(() => attaching);
		const disposeRelay = installContainerCdpRelay(pair.parent, 'owner-one', connect);
		const owner = createContainerCdpTransportFactory(pair.child, 'owner-one');
		const result = owner.connect('wasm-idle-cdp:test').catch((error) => error);
		await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce());
		disposeRelay();
		owner.dispose();
		const disconnect = vi.fn(async () => {});
		finish({ disconnect, request: vi.fn(), onEvent: vi.fn() });
		await vi.waitFor(() => expect(disconnect).toHaveBeenCalledOnce());
		await expect(result).resolves.toBeInstanceOf(Error);
	});

	it('disconnects an attachment that completes after its request timed out', async () => {
		vi.useFakeTimers();
		const pair = endpoints();
		let finish!: (value: CdpTransport) => void;
		const attaching = new Promise<CdpTransport>((resolve) => {
			finish = resolve;
		});
		const disposeRelay = installContainerCdpRelay(pair.parent, 'owner-one', () => attaching);
		const owner = createContainerCdpTransportFactory(pair.child, 'owner-one');
		try {
			const result = owner.connect('wasm-idle-cdp:test').catch((error) => error);
			await vi.advanceTimersByTimeAsync(15_001);
			await expect(result).resolves.toMatchObject({
				message: 'Container debugger request timed out'
			});
			const disconnect = vi.fn(async () => {});
			finish({ disconnect, request: vi.fn(), onEvent: vi.fn() });
			await vi.advanceTimersByTimeAsync(0);
			expect(disconnect).toHaveBeenCalledOnce();
		} finally {
			owner.dispose();
			disposeRelay();
			vi.useRealTimers();
		}
	});
});
