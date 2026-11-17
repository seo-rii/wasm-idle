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

import Sed, { SED_INTERPRETER } from './sed';

describe('sed execution adapter', () => {
	beforeEach(() => vi.clearAllMocks());
	it('uses the original hash-pinned BusyBox interpreter with script-file argv', () => {
		new Sed();
		expect(calls.constructor).toHaveBeenCalledWith(SED_INTERPRETER);
		expect(SED_INTERPRETER.command).toBe('sed');
		expect(SED_INTERPRETER.args).toEqual(['-f']);
		expect(SED_INTERPRETER.hostProfile).toBe('busybox-text-v1');
	});
	it('passes explicit program arguments and workspace options to the existing lifecycle', async () => {
		const sandbox = new Sed();
		const options = {
			programArgs: ['-n', 'data/한글.txt'],
			activePath: 'scripts/main.sed',
			stdin: ''
		};
		await expect(sandbox.run('p', false, false, undefined, ['ignored'], options)).resolves.toBe(
			true
		);
		expect(calls.run).toHaveBeenCalledWith(
			'p',
			false,
			false,
			undefined,
			['-n', 'data/한글.txt'],
			options
		);
	});
	it('accepts legacy args and rejects compiler options before starting execution', async () => {
		const sandbox = new Sed();
		await sandbox.run('p', false, false, undefined, ['-E']);
		expect(calls.run).toHaveBeenCalledWith('p', false, false, undefined, ['-E'], {});
		calls.run.mockClear();
		await expect(
			sandbox.run('p', false, false, undefined, [], { compileArgs: ['-O2'] })
		).rejects.toMatchObject({ code: 'runtime-configuration', runtimeId: 'SED' });
		expect(calls.run).not.toHaveBeenCalled();
	});
});
