import { afterEach, describe, expect, it, vi } from 'vitest';

const runtimeState = vi.hoisted(() => ({
	instances: [] as Array<{ options: Record<string, unknown> }>,
	runCalls: [] as Array<{ code: string; options: Record<string, unknown> }>
}));

vi.mock('../src/runtime.js', () => ({
	default: class MockRuntime {
		readonly ready = Promise.resolve();
		readonly options: Record<string, unknown>;

		constructor(options: Record<string, unknown>) {
			this.options = options;
			runtimeState.instances.push(this as unknown as { options: Record<string, unknown> });
		}

		async compileLinkRun(code: string, options: Record<string, unknown>) {
			runtimeState.runCalls.push({ code, options });
		}
	}
}));

import { createBrowserClangDebugDriver } from '../src/index.js';

describe('BrowserClangDebugDriver', () => {
	afterEach(() => {
		runtimeState.instances.length = 0;
		runtimeState.runCalls.length = 0;
		vi.restoreAllMocks();
	});

	it('wraps runtime debug execution with shared control buffers', async () => {
		const driver = await createBrowserClangDebugDriver({
			runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/',
			breakpoints: [4]
		});

		await driver.run({
			code: 'int main(void) { return 0; }',
			language: 'C',
			fileName: 'main.c',
			breakpoints: [9, 4],
			pauseOnEntry: true,
			programArgs: ['--flag']
		});

		expect(runtimeState.instances[0]?.options).toEqual(
			expect.objectContaining({
				runtimeBaseUrl: 'https://cdn.example.com/pkg/runtime/'
			})
		);
		expect(runtimeState.runCalls).toEqual([
			{
				code: 'int main(void) { return 0; }',
				options: expect.objectContaining({
					language: 'C',
					fileName: 'main.c',
					programArgs: ['--flag'],
					debug: true,
					breakpoints: [4, 9],
					pauseOnEntry: true,
					debugBuffer: driver.controller.debugBuffer,
					interruptBuffer: driver.controller.interruptBuffer,
					watchBuffer: driver.controller.watchBuffer,
					watchResultBuffer: driver.controller.watchResultBuffer
				})
			}
		]);
	});
});
