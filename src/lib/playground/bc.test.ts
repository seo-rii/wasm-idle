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

import Bc from './bc';
import { WASM_BC_INTERPRETER } from './wasmBcVersion';

describe('Bc execution adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('loads the verified upstream interpreter profile', () => {
		new Bc();
		expect(calls.constructor).toHaveBeenCalledWith(WASM_BC_INTERPRETER);
		expect(WASM_BC_INTERPRETER).toMatchObject({
			id: 'BC',
			folder: 'wasm-bc',
			sourcePath: 'main.bc',
			forwardProgramArgs: true
		});
	});
	it('forwards explicit program arguments with source and workspace options', async () => {
		const sandbox = new Bc();
		const options = {
			programArgs: ['한글', 'second'],
			activePath: 'src/main.bc',
			workspaceFiles: [{ path: 'data.txt', content: 'input data' }],
			stdin: 'line\n'
		};
		await expect(
			sandbox.run('a=read();a\n', false, false, undefined, ['ignored'], options)
		).resolves.toBe(true);
		expect(calls.run).toHaveBeenCalledWith(
			'a=read();a\n',
			false,
			false,
			undefined,
			['한글', 'second'],
			options
		);
	});
	it('accepts legacy arguments and rejects compiler arguments before worker execution', async () => {
		const sandbox = new Bc();
		await sandbox.run('1+2\n', false, false, undefined, ['value']);
		expect(calls.run).toHaveBeenCalledWith('1+2\n', false, false, undefined, ['value'], {});
		calls.run.mockClear();
		await expect(
			sandbox.run('1+2\n', false, false, undefined, [], { compileArgs: ['-O2'] })
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'BC'
		});
		expect(calls.run).not.toHaveBeenCalled();
	});
});
