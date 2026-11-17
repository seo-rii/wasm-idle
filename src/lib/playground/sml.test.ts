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

import Sml from './sml';
import { WASM_SML_INTERPRETER } from './wasmSmlVersion';

describe('Sml execution adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('loads the verified upstream interpreter profile', () => {
		new Sml();
		expect(calls.constructor).toHaveBeenCalledWith(WASM_SML_INTERPRETER);
		expect(WASM_SML_INTERPRETER).toMatchObject({
			id: 'SML',
			folder: 'wasm-sml',
			sourcePath: 'main.sml',
			forwardProgramArgs: true
		});
	});
	it('rejects workspace files in the reserved embedded Basis directory', async () => {
		const sandbox = new Sml();
		await expect(
			sandbox.run('val _ = ();', false, false, undefined, [], {
				workspaceFiles: [{ path: '.wasm-idle-sml-basis/all.sml', content: 'val _ = ();' }]
			})
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'SML' });
		expect(calls.run).not.toHaveBeenCalled();
	});
	it('forwards explicit program arguments with source and workspace options', async () => {
		const sandbox = new Sml();
		const options = {
			programArgs: ['한글', 'second'],
			activePath: 'src/main.sml',
			workspaceFiles: [{ path: 'data.txt', content: 'input data' }],
			stdin: 'line\n'
		};
		await expect(
			sandbox.run(
				'val _ = print (valOf (TextIO.inputLine TextIO.stdIn));',
				false,
				false,
				undefined,
				['ignored'],
				options
			)
		).resolves.toBe(true);
		expect(calls.run).toHaveBeenCalledWith(
			'val _ = print (valOf (TextIO.inputLine TextIO.stdIn));',
			false,
			false,
			undefined,
			['한글', 'second'],
			options
		);
	});
	it('accepts legacy arguments and rejects compiler arguments before worker execution', async () => {
		const sandbox = new Sml();
		await sandbox.run('val _ = print "1";', false, false, undefined, ['value']);
		expect(calls.run).toHaveBeenCalledWith(
			'val _ = print "1";',
			false,
			false,
			undefined,
			['value'],
			{}
		);
		calls.run.mockClear();
		await expect(
			sandbox.run('val _ = print "1";', false, false, undefined, [], {
				compileArgs: ['-O2']
			})
		).rejects.toMatchObject({
			code: 'runtime-configuration',
			runtimeId: 'SML'
		});
		expect(calls.run).not.toHaveBeenCalled();
	});
});
