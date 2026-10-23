import { describe, expect, it, vi } from 'vitest';
import type { DebugScope, DebugVariable } from '@wasm-idle/core';
import { createDebugSessionController } from '../src/controller.js';

const prefix = Array.from({ length: 50 }, (_, index) => ({ name: `v${index}`, value: '0' }));
const outer: DebugScope = {
	name: 'Globals',
	variablesReference: 20,
	expensive: true,
	variables: [{ name: 'target', value: 'GLOBAL' }]
};

function fixture(values: DebugVariable[], total: number | undefined = values.length) {
	const debugVariables = vi.fn(async (_reference: number, start = 0, count?: number) =>
		values.slice(start, count === undefined ? undefined : start + count)
	);
	const controller = createDebugSessionController({
		sourcePath: '/workspace/main.c',
		terminal: {
			debugVariables,
			debugScopes: async () => {
				throw new Error('frame unavailable');
			}
		}
	});
	const pause = (scope: Partial<DebugScope> = {}) =>
		controller.handleEvent({
			type: 'pause',
			reason: 'step',
			line: 3,
			frameId: 1,
			sourcePath: '/workspace/main.c',
			locals: [],
			callStack: [
				{ id: 1, functionName: 'main', line: 3 },
				{ id: 2, functionName: 'caller', line: 8 }
			],
			scopes: [
				{
					name: 'Locals',
					variablesReference: 10,
					expensive: false,
					variables: [],
					...(total === undefined ? {} : { namedVariables: total }),
					...scope
				},
				outer
			]
		});
	pause();
	return { controller, debugVariables, pause };
}

async function loaded(controller: ReturnType<typeof createDebugSessionController>) {
	await vi.waitFor(() => expect(controller.variablesByReference.has(10)).toBe(true));
	controller.addWatchExpression('target');
	await vi.waitFor(() => expect(controller.watchValues[0]?.value).not.toBe('...'));
}

describe('paged scope name precedence', () => {
	it('does not expose a shadowed global until the local name is loaded', async () => {
		const { controller, debugVariables } = fixture([
			...prefix,
			{ name: 'target', value: 'LOCAL' }
		]);
		await loaded(controller);
		expect(controller.watchValues[0].value).toBe('?');
		expect(await controller.resolveHover('target')).toBeNull();
		expect(controller.scopeNodes(outer)[0].expression).toBeUndefined();
		expect(debugVariables).toHaveBeenCalledExactlyOnceWith(10, 0, 50);

		await controller.loadVariableChildren(10, 50, 50);
		await vi.waitFor(() => expect(controller.watchValues[0].value).toBe('LOCAL'));
		expect((await controller.resolveHover('target'))?.value).toBe('LOCAL');
		expect(controller.scopeNodes(outer)[0].expression).toBeUndefined();
	});

	it('allows an outer name after all declared locals rule out shadowing', async () => {
		const { controller } = fixture([...prefix, { name: 'last', value: '1' }]);
		await loaded(controller);
		expect(controller.watchValues[0].value).toBe('?');
		await controller.loadVariableChildren(10, 50, 50);
		await vi.waitFor(() => expect(controller.watchValues[0].value).toBe('GLOBAL'));
		expect(controller.scopeNodes(outer)[0].expression).toBe('target');
	});

	it('requires an end page when the runtime omits scope counts', async () => {
		const { controller } = fixture(prefix);
		// Replace the initial metadata before its variable promise settles.
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		const pause = {
			type: 'pause' as const,
			reason: 'step' as const,
			line: 3,
			frameId: 1,
			sourcePath: '/workspace/main.c',
			locals: [],
			callStack: [{ id: 1, functionName: 'main', line: 3 }],
			scopes: [
				{ name: 'Locals', variablesReference: 10, expensive: false, variables: [] },
				outer
			]
		};
		controller.handleEvent(pause);
		await loaded(controller);
		expect(controller.watchValues[0].value).toBe('?');
		await controller.loadVariableChildren(10, 50, 50);
		await vi.waitFor(() => expect(controller.watchValues[0].value).toBe('GLOBAL'));
		expect(controller.scopeNodes(outer)[0].expression).toBe('target');
	});

	it('retains unknown-count completeness guards if frame selection fails', async () => {
		const { controller, pause } = fixture(prefix);
		pause({ namedVariables: undefined });
		await loaded(controller);
		expect(await controller.selectFrame(2)).toBe(false);
		await vi.waitFor(() => expect(controller.watchValues[0].value).not.toBe('...'));
		expect(controller.watchValues[0].value).toBe('?');
		expect(await controller.resolveHover('target')).toBeNull();
	});

	it('does not treat a suffix read past an unloaded gap as a complete scope', async () => {
		const { controller, pause } = fixture(prefix);
		pause({ namedVariables: undefined });
		await loaded(controller);
		await controller.loadVariableChildren(10, 100);
		await vi.waitFor(() => expect(controller.watchValues[0].value).not.toBe('...'));
		expect(controller.watchValues[0].value).toBe('?');
		expect(controller.scopeNodes(outer)[0].expression).toBeUndefined();
	});

	it('does not carry an incomplete scope flag into the next stop with reused references', async () => {
		const { controller, pause } = fixture(prefix);
		pause({ namedVariables: undefined });
		await loaded(controller);
		expect(controller.watchValues[0].value).toBe('?');
		controller.handleEvent({ type: 'resume', command: 'nextLine' });
		pause({ namedVariables: 1, variables: [{ name: 'other', value: '1' }] });
		await vi.waitFor(() => expect(controller.watchValues[0].value).toBe('GLOBAL'));
		expect(controller.scopeNodes(outer)[0].expression).toBe('target');
	});
});
