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

import Apl from './apl';
import { WASM_APL_INTERPRETER } from './wasmAplVersion';

describe('GNU APL execution adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('loads the original CLI with source and program arguments separated', () => {
		new Apl();
		expect(calls.constructor).toHaveBeenCalledWith(WASM_APL_INTERPRETER);
		expect(WASM_APL_INTERPRETER).toMatchObject({
			id: 'APL',
			folder: 'wasm-apl',
			sourcePath: 'main.apl',
			args: ['--script', '--rawCIN', '--OFF', '--noSV', '-f'],
			forwardProgramArgs: true,
			programArgsPrefix: ['--']
		});
	});
	it('forwards explicit Unicode arguments, stdin and nested workspace paths', async () => {
		const sandbox = new Apl();
		const options = {
			programArgs: ['--value', '한글'],
			activePath: 'src/한글.apl',
			stdin: '입력\n',
			workspaceFiles: [{ path: 'data/input.txt', content: 'workspace\n' }]
		};
		await expect(
			sandbox.run('⎕←⍞', false, false, undefined, ['ignored'], options)
		).resolves.toBe(true);
		expect(calls.run).toHaveBeenCalledWith(
			'⎕←⍞',
			false,
			false,
			undefined,
			['--value', '한글'],
			options
		);
	});
	it('accepts legacy program arguments and rejects compiler arguments before creating work', async () => {
		const sandbox = new Apl();
		await sandbox.run('⎕←1', false, false, undefined, ['value']);
		expect(calls.run).toHaveBeenCalledWith('⎕←1', false, false, undefined, ['value'], {});
		calls.run.mockClear();
		await expect(
			sandbox.run('⎕←1', false, false, undefined, [], {
				compileArgs: ['--safe']
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'APL' });
		expect(calls.run).not.toHaveBeenCalled();
		await expect(sandbox.run('⎕←2', false, false, undefined, [], { stdin: '' })).resolves.toBe(
			true
		);
	});
});
