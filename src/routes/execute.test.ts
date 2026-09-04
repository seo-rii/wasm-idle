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
			options: {
				debug: true,
				interactive: true,
				breakpoints: [3, 7],
				pauseOnEntry: true
			}
		});

		expect(terminal.clear).toHaveBeenCalledTimes(1);
		expect(terminal.prepare).toHaveBeenCalledWith(
			'CPP',
			'int main() {}',
			false,
			undefined,
			[],
			{ debug: true, interactive: true, breakpoints: [3, 7], pauseOnEntry: true }
		);
		expect(terminal.run).toHaveBeenCalledWith('CPP', 'int main() {}', false, undefined, [], {
			debug: true,
			interactive: true,
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

	it('does not prepare after cancellation wins during terminal clear', async () => {
		let releaseClear: (() => void) | undefined;
		const terminal = {
			clear: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						releaseClear = resolve;
					})
			),
			prepare: vi.fn(async () => true),
			run: vi.fn(async () => 'should not happen')
		};
		const controller = new AbortController();
		const reason = new DOMException('execution stopped during clear', 'AbortError');
		const execution = executeTerminalRun({
			terminal,
			language: 'C',
			code: 'int main(void) { return 0; }',
			options: { signal: controller.signal }
		});
		const rejected = expect(execution).rejects.toBe(reason);

		await vi.waitFor(() => expect(terminal.clear).toHaveBeenCalledTimes(1));
		controller.abort(reason);
		releaseClear?.();

		await rejected;
		expect(terminal.prepare).not.toHaveBeenCalled();
		expect(terminal.run).not.toHaveBeenCalled();
	});

	it('does not run after cancellation wins during terminal prepare', async () => {
		let releasePrepare: ((prepared: boolean) => void) | undefined;
		const terminal = {
			clear: vi.fn(async () => {}),
			prepare: vi.fn(
				() =>
					new Promise<boolean>((resolve) => {
						releasePrepare = resolve;
					})
			),
			run: vi.fn(async () => 'should not happen')
		};
		const controller = new AbortController();
		const reason = new DOMException('execution stopped during prepare', 'AbortError');
		const execution = executeTerminalRun({
			terminal,
			language: 'CPP',
			code: 'int main() { return 0; }',
			options: { signal: controller.signal }
		});
		const rejected = expect(execution).rejects.toBe(reason);

		await vi.waitFor(() => expect(terminal.prepare).toHaveBeenCalledTimes(1));
		controller.abort(reason);
		releasePrepare?.(true);

		await rejected;
		expect(terminal.run).not.toHaveBeenCalled();
	});

	it('keeps one progress lifecycle connected through prepare and execute for every language', async () => {
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

		expect(values).toEqual([0.5, 0.75]);
		expect(stages).toEqual(['Compiling and linking Nim output', 'Starting runtime']);
		expect(terminal.run).toHaveBeenCalledWith('PYTHON', 'print(1)', true, progress, [], {});
	});

	it('does not synthesize 100% when a run fails', async () => {
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
				return false;
			})
		};

		await executeTerminalRun({
			terminal,
			language: 'NIM',
			code: 'echo "ok"',
			progress
		});

		expect(values).toEqual([0.25, 0.75]);
		expect(stages).toEqual(['Nim worker ready', 'Loading Nim runtime']);
		expect(terminal.run).toHaveBeenCalledWith('NIM', 'echo "ok"', true, progress, [], {});
	});
});
