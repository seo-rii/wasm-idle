import { describe, expect, it, vi } from 'vitest';

import { executeTerminalRun } from './execute';

describe('executeTerminalRun', () => {
	it('runs prepare then execute with debug options', async () => {
		const terminal = {
			clear: vi.fn(async () => {}),
			prepare: vi.fn(async () => true),
			run: vi.fn(async () => 'ok')
		};

		const result = await executeTerminalRun({
			terminal,
			language: 'CPP',
			code: 'int main() {}',
			log: false,
			options: { debug: true, breakpoints: [3, 7], pauseOnEntry: true }
		});

		expect(terminal.clear).toHaveBeenCalledTimes(1);
		expect(terminal.prepare).toHaveBeenCalledWith(
			'CPP',
			'int main() {}',
			false,
			undefined,
			[],
			{ debug: true, breakpoints: [3, 7], pauseOnEntry: true }
		);
		expect(terminal.run).toHaveBeenCalledWith('CPP', 'int main() {}', false, undefined, [], {
			debug: true,
			breakpoints: [3, 7],
			pauseOnEntry: true
		});
		expect(result).toBe('ok');
	});

	it('skips execute when prepare fails', async () => {
		const terminal = {
			clear: vi.fn(async () => {}),
			prepare: vi.fn(async () => false),
			run: vi.fn(async () => 'should not happen')
		};

		const result = await executeTerminalRun({
			terminal,
			language: 'CPP',
			code: 'int main() {}'
		});

		expect(terminal.run).not.toHaveBeenCalled();
		expect(result).toBe(false);
	});

	it('marks loading complete before execute starts', async () => {
		const values: number[] = [];
		const terminal = {
			clear: vi.fn(async () => {}),
			prepare: vi.fn(async (_language, _code, _log, progress) => {
				progress?.set?.(0.5);
				return true;
			}),
			run: vi.fn(async () => 'ok')
		};

		await executeTerminalRun({
			terminal,
			language: 'PYTHON',
			code: 'print(1)',
			progress: {
				set(value: number) {
					values.push(value);
				}
			}
		});

		expect(values).toEqual([0.5, 1]);
		expect(terminal.run).toHaveBeenCalledWith('PYTHON', 'print(1)', true, undefined, [], {});
	});
});
