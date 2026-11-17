import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ constructor: vi.fn(), run: vi.fn() }));
vi.mock('./wasm', () => ({
	default: class {
		constructor(profile: unknown) {
			calls.constructor(profile);
		}
		run(...args: unknown[]) {
			calls.run(...args);
			return Promise.resolve(true);
		}
	}
}));

import Uiua from './uiua';
import { WASM_UIUA_INTERPRETER } from './wasmUiuaVersion';

describe('Uiua execution adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('loads the verified upstream interpreter profile', () => {
		new Uiua();
		expect(calls.constructor).toHaveBeenCalledWith(WASM_UIUA_INTERPRETER);
		expect(WASM_UIUA_INTERPRETER).toMatchObject({
			id: 'UIUA',
			folder: 'wasm-uiua',
			sourcePath: 'main.ua',
			forwardProgramArgs: true
		});
	});
	it('forwards explicit program arguments with source and workspace options', async () => {
		const sandbox = new Uiua();
		const options = {
			programArgs: ['한글', 'second'],
			activePath: 'src/main.ua',
			workspaceFiles: [{ path: 'data.txt', content: 'input data' }],
			stdin: 'line\n'
		};
		await expect(
			sandbox.run('&p &sc', false, false, undefined, ['ignored'], options)
		).resolves.toBe(true);
		expect(calls.run).toHaveBeenCalledWith(
			'&p &sc',
			false,
			false,
			undefined,
			['한글', 'second'],
			options
		);
	});
	it('accepts legacy arguments and rejects compiler arguments before worker execution', async () => {
		const sandbox = new Uiua();
		await sandbox.run('&p 1', false, false, undefined, ['value']);
		expect(calls.run).toHaveBeenCalledWith('&p 1', false, false, undefined, ['value'], {});
		calls.run.mockClear();
		await expect(
			sandbox.run('&p 1', false, false, undefined, [], { compileArgs: ['-O2'] })
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'UIUA'
		});
		expect(calls.run).not.toHaveBeenCalled();
	});
});
