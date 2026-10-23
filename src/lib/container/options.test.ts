import { describe, expect, it } from 'vitest';
import { resolveSandboxExecutionArgs } from '../playground/options.js';

describe('published runtime argv compatibility', () => {
	it.each(['C', 'CPP', 'OBJC', 'OBJECTIVECXX'])(
		'keeps legacy %s argv on the compiler',
		(language) => {
			expect(
				resolveSandboxExecutionArgs(language, ['-O2'], { programArgs: ['hello'] })
			).toEqual({
				compileArgs: ['-O2'],
				programArgs: ['hello']
			});
		}
	);
	it('keeps interpreter argv on the program and respects explicit empty overrides', () => {
		expect(resolveSandboxExecutionArgs('PYTHON3', ['one'])).toEqual({
			compileArgs: [],
			programArgs: ['one']
		});
		expect(resolveSandboxExecutionArgs('CPP', ['-O2'], { compileArgs: [] })).toEqual({
			compileArgs: [],
			programArgs: []
		});
		expect(resolveSandboxExecutionArgs('PYTHON3', ['one'], { programArgs: [] })).toEqual({
			compileArgs: [],
			programArgs: []
		});
	});
	it('snapshots both argv arrays before the caller changes them', () => {
		const compileArgs = ['-O2'],
			programArgs = ['one'];
		const result = resolveSandboxExecutionArgs('CPP', [], { compileArgs, programArgs });
		compileArgs.push('-g');
		programArgs[0] = 'two';
		expect(result).toEqual({ compileArgs: ['-O2'], programArgs: ['one'] });
	});
});
