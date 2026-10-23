import { afterEach, describe, expect, it, vi } from 'vitest';
import Nim from './nim';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';

describe('Nim debug producer gate', () => {
	afterEach(() => vi.restoreAllMocks());

	it('rejects debug requests before executing an ordinary release build', async () => {
		const run = vi.spyOn(StaticWorkerRuntimeSandbox.prototype, 'run').mockResolvedValue(true);
		const sandbox = new Nim();
		await expect(
			sandbox.run('echo 73', false, false, undefined, [], { debugMode: 'lldb' })
		).rejects.toThrow('does not return a DWARF artifact');
		expect(run).not.toHaveBeenCalled();
		await expect(sandbox.run('echo 73', false)).resolves.toBe(true);
		expect(run).toHaveBeenCalledOnce();
	});
});
