import { describe, expect, it, vi } from 'vitest';
import { createDebugSessionController } from '@wasm-idle/debug/controller';
import type { DebugSourceBreakpoint } from '@wasm-idle/core';
import type { BoundSandbox, PlaygroundBinding } from '../playground/sandbox.js';
import { createContainerPlaygroundBinding } from './binding.js';
import type { ContainerWorkerClient } from './client.js';
import { ContainerRuntimeAdapter } from './runtime-adapter.js';

function fixture(language = 'RUST') {
	const runtime = {
		setBreakpoints: vi.fn(async (_lines: number[], _sourcePath?: string) => {}),
		debugCommand: vi.fn(async (_command: string) => {}),
		debugScopes: async () => [],
		debugFrameName: async () => null
	};
	const adapter = new ContainerRuntimeAdapter({
		runtimeAssets: '/runtime/',
		emit() {},
		createBinding: () =>
			({
				load: async () => runtime as unknown as BoundSandbox
			}) as unknown as PlaygroundBinding
	});
	const binding = createContainerPlaygroundBinding('/runtime/', {
		applicationRootURL: 'https://example.test/',
		workspaceId: 'debug-fallback-test',
		clientFactory: () =>
			({
				onEvent: () => () => {},
				call: (method: string, [language, ...args]: unknown[]) =>
					adapter.debug(language as string, method, args),
				dispose: async () => {}
			}) as unknown as ContainerWorkerClient
	});
	return { runtime, adapter, binding, language };
}

describe('legacy debugger control through the container facade', () => {
	it.each(['RUST', 'JAVA', 'PYTHON3', 'RUBY', 'LUA', 'GO', 'V'])(
		'updates live %s breakpoints and runs to the cursor through the controller',
		async (language) => {
			const { runtime, adapter, binding } = fixture(language);
			const terminal = await binding.load(language);
			const controller = createDebugSessionController({
				terminal: {
					setSourceBreakpoints: (values, path) =>
						terminal.setSourceBreakpoints!(values, path),
					debugScopes: terminal.debugScopes,
					debugFrameName: terminal.debugFrameName,
					debugCommand: async (command) => terminal.debugCommand?.(command),
					stop: async () => {
						await terminal.terminate();
					}
				},
				sourcePath: '/workspace/main'
			});
			try {
				controller.handleEvent({
					type: 'pause',
					reason: 'step',
					line: 3,
					sourcePath: '/workspace/main',
					frameId: 1,
					locals: [],
					callStack: [{ id: 1, functionName: 'main', line: 3 }]
				});
				controller.setBreakpoints([9]);
				await vi.waitFor(() =>
					expect(runtime.setBreakpoints).toHaveBeenLastCalledWith([9], '/workspace/main')
				);
				expect(controller.breakpointError).toBeNull();
				await controller.runToCursor(12);
				expect(runtime.setBreakpoints).toHaveBeenLastCalledWith([9, 12], '/workspace/main');
				expect(runtime.debugCommand).toHaveBeenCalledWith('continue');
			} finally {
				controller.reset();
				await binding.dispose?.();
				await adapter.dispose();
			}
		}
	);

	it('removes disabled specifications and preserves the source path for a legacy runtime', async () => {
		const { runtime, adapter } = fixture();
		await adapter.debug('RUST', 'setSourceBreakpoints', [
			[{ line: 4 }, { line: 5, enabled: false, condition: 'unsupported()' }],
			'/workspace/helper.rs'
		]);
		expect(runtime.setBreakpoints).toHaveBeenCalledWith([4], '/workspace/helper.rs');
		await adapter.debug('RUST', 'setSourceBreakpoints', [[], '/workspace/helper.rs']);
		expect(runtime.setBreakpoints).toHaveBeenLastCalledWith([], '/workspace/helper.rs');
		await adapter.dispose();
	});

	it.each([{ condition: 'value > 3' }, { hitCondition: '2' }, { logMessage: 'value = {value}' }])(
		'rejects unsupported metadata without changing installed breakpoints: %j',
		async (metadata) => {
			const { runtime, adapter } = fixture();
			await expect(
				adapter.debug('RUST', 'setSourceBreakpoints', [[{ line: 4, ...metadata }]])
			).rejects.toThrow('Debugger does not support breakpoint');
			expect(runtime.setBreakpoints).not.toHaveBeenCalled();
			await adapter.dispose();
		}
	);

	it('rejects an invalid source path before creating a runtime session', async () => {
		const { runtime, adapter } = fixture();
		await expect(
			adapter.debug('RUST', 'setSourceBreakpoints', [[{ line: 4 }], 42])
		).rejects.toThrow('Invalid debugger source path');
		expect(runtime.setBreakpoints).not.toHaveBeenCalled();
		await adapter.dispose();
	});

	it('retains the complete specification when the runtime supports structured breakpoints', async () => {
		const setSourceBreakpoints = vi.fn(
			async (_values: DebugSourceBreakpoint[], _path: string) => {}
		);
		const adapter = new ContainerRuntimeAdapter({
			runtimeAssets: '/runtime/',
			emit() {},
			createBinding: () =>
				({ load: async () => ({ setSourceBreakpoints }) }) as unknown as PlaygroundBinding
		});
		const values = [{ line: 4, condition: 'value > 3' }];
		const update = adapter.debug('CPP', 'setSourceBreakpoints', [
			values,
			'/workspace/main.cpp'
		]);
		values[0].condition = 'changed after dispatch';
		await update;
		expect(setSourceBreakpoints).toHaveBeenCalledWith(
			[{ line: 4, condition: 'value > 3' }],
			'/workspace/main.cpp'
		);
		await adapter.dispose();
	});
});
