import { describe, expect, it } from 'vitest';

import { createBrowserClangDebugController } from '../src/debug/index.js';
import { flushQueuedStdin, readBufferedStdin } from '../src/stdin-buffer.js';

describe('BrowserClangDebugController', () => {
	it('stores normalized breakpoints in the shared debug buffer', () => {
		const controller = createBrowserClangDebugController({
			breakpoints: [9, 2, 9, -1, 0]
		});

		expect(controller.breakpoints).toEqual([2, 9]);
		expect(Atomics.load(controller.debugBuffer, 2)).toBe(1);
		expect(Atomics.load(controller.debugBuffer, 3)).toBe(2);
		expect(Atomics.load(controller.debugBuffer, 4)).toBe(2);
		expect(Atomics.load(controller.debugBuffer, 5)).toBe(9);
		expect(controller.createRuntimeRunOptions({ pauseOnEntry: true })).toEqual(
			expect.objectContaining({
				debug: true,
				breakpoints: [2, 9],
				pauseOnEntry: true,
				debugBuffer: controller.debugBuffer,
				interruptBuffer: controller.interruptBuffer,
				watchBuffer: controller.watchBuffer,
				watchResultBuffer: controller.watchResultBuffer
			})
		);
	});

	it('encodes debug commands into the control buffer', () => {
		const controller = createBrowserClangDebugController();

		controller.resume();
		expect(Atomics.load(controller.debugBuffer, 1)).toBe(1);
		controller.stepInto();
		expect(Atomics.load(controller.debugBuffer, 1)).toBe(2);
		controller.nextLine();
		expect(Atomics.load(controller.debugBuffer, 1)).toBe(3);
		controller.stepOut();
		expect(Atomics.load(controller.debugBuffer, 1)).toBe(4);
	});

	it('round-trips watch expressions through the shared stdin buffers', async () => {
		const controller = createBrowserClangDebugController();

		setTimeout(() => {
			expect(readBufferedStdin(controller.watchBuffer)).toBe('value + 1');
			flushQueuedStdin(['42'], controller.watchResultBuffer);
		}, 0);

		await expect(controller.evaluate('value + 1', 1000)).resolves.toBe('42');
	});
});
