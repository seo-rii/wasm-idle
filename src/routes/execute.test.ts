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

	it('finishes prepared runtime loading before code can wait for input', async () => {
		const values: number[] = [];
		const stages: Array<string | undefined> = [];
		const progress = {
			set(value: number, stage?: string) {
				values.push(value);
				stages.push(stage);
			}
		};
		const terminal = {
			clear: vi.fn(async () => {}),
			prepare: vi.fn(async (_language, _code, _log, progress) => {
				progress?.set?.(0.5, 'Compiling and linking Nim output');
				return true;
			}),
			run: vi.fn(async (_language, _code, _log, progress) => {
				progress?.set?.(0.75, 'Starting runtime');
				return 'ok';
			})
		};

		await executeTerminalRun({
			terminal,
			language: 'PYTHON',
			code: 'print(1)',
			progress
		});

		expect(values).toEqual([0.5, 1]);
		expect(stages).toEqual(['Compiling and linking Nim output', 'PYTHON runtime ready']);
		expect(terminal.run).toHaveBeenCalledWith('PYTHON', 'print(1)', true, undefined, [], {});
	});

	it('keeps deferred runtime loading connected through execute', async () => {
		const values: number[] = [];
		const stages: Array<string | undefined> = [];
		const progress = {
			set(value: number, stage?: string) {
				values.push(value);
				stages.push(stage);
			}
		};
		const terminal = {
			clear: vi.fn(async () => {}),
			prepare: vi.fn(async (_language, _code, _log, sink) => {
				sink?.set?.(0.25, 'Nim worker ready');
				return true;
			}),
			run: vi.fn(async (_language, _code, _log, sink) => {
				sink?.set?.(0.75, 'Loading Nim runtime');
				return 'ok';
			})
		};

		await executeTerminalRun({
			terminal,
			language: 'NIM',
			code: 'echo "ok"',
			progress
		});

		expect(values).toEqual([0.25, 0.75, 1]);
		expect(stages).toEqual(['Nim worker ready', 'Loading Nim runtime', 'NIM run ready']);
		expect(terminal.run).toHaveBeenCalledWith('NIM', 'echo "ok"', true, progress, [], {});
	});
});
