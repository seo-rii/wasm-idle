import { describe, expect, it } from 'vitest';
import { createDebugSessionController } from '../src/controller.js';

function pausedController(frameId: number | null = 1) {
	const controller = createDebugSessionController({
		sourcePath: '/workspace/helper.c',
		terminal: { debugScopes: async () => [] }
	});
	controller.handleEvent({
		type: 'pause',
		reason: 'step',
		line: 3,
		frameId: frameId ?? undefined,
		sourcePath: '/workspace/helper.c',
		locals: [],
		callStack: [
			{ id: 1, functionName: 'helper', sourcePath: '/workspace/helper.c', line: 3 },
			{ id: 2, functionName: 'main', sourcePath: '/workspace/main.c', line: 25 }
		]
	});
	return controller;
}

describe('selected debug frame source navigation', () => {
	it('highlights the selected caller after the UI opens its source file', async () => {
		const controller = pausedController();
		expect(await controller.selectFrame(2)).toBe(true);
		expect(controller.pausedLine).toBeNull();
		controller.setSourcePath('/workspace/main.c');
		expect(controller.frameId).toBe(2);
		expect(controller.pausedLine).toBe(25);

		controller.setSourcePath('/workspace/helper.c');
		expect(controller.pausedLine).toBeNull();
		controller.setSourcePath('/workspace/main.c');
		expect(controller.pausedLine).toBe(25);
	});

	it('keeps selected caller locations hidden after that source was edited', async () => {
		const controller = pausedController();
		await controller.selectFrame(2);
		controller.markSourceRevisionStale('/workspace/main.c');
		controller.setSourcePath('/workspace/main.c');
		expect(controller.sourceRevisionStale).toBe(true);
		expect(controller.pausedLine).toBeNull();
	});

	it('uses the top frame for trace stops without an explicit frame selection', () => {
		const controller = pausedController(null);
		expect(controller.frameId).toBeNull();
		controller.setSourcePath('/workspace/main.c');
		controller.setSourcePath('/workspace/helper.c');
		expect(controller.pausedLine).toBe(3);
	});
});
