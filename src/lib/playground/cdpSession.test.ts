// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { CdpSandboxSession } from './cdpSession';

it.each([false, true])(
	'disconnects even when the stop listener throws (initialization failure: %s)',
	async (fail) => {
		const transport = {
			request: vi.fn(async (): Promise<any> => {
				if (fail) throw new Error('Native initialization failed');
				return {};
			}),
			onEvent: () => () => undefined,
			disconnect: vi.fn(async () => undefined)
		};
		const session = new CdpSandboxSession({
			workerName: 'test',
			sourcePath: 'main.js',
			source: '1',
			url: 'wasm-idle://test',
			breakpoints: [],
			pauseOnEntry: false,
			transport,
			onFailure: () => undefined,
			onDebugEvent: (event) => {
				if (event.type === 'stop') throw new Error('Caller failed');
			}
		});
		if (fail) await expect(session.start()).rejects.toThrow('Native initialization failed');
		else await session.start();
		await session.dispose();
		await session.dispose();
		expect(transport.disconnect).toHaveBeenCalledTimes(1);
	}
);
