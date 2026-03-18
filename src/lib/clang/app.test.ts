import { describe, expect, it, vi } from 'vitest';

import App from '$lib/clang/app';
import { NotImplemented, ProcExit } from '$lib/clang/error';
import * as wasmModule from '$lib/clang/wasm';

describe('App debug tracing', () => {
	it('binds clock_time_get into the WASI import table', async () => {
		const getInstance = vi.spyOn(wasmModule, 'getInstance').mockResolvedValue({
			exports: {
				memory: new WebAssembly.Memory({ initial: 1 })
			}
		} as WebAssembly.Instance);
		const memfs = { exports: {} } as any;
		const module = {} as WebAssembly.Module;
		const app = new App(module, memfs, 'test.wasm');

		await app.ready;

		expect(getInstance).toHaveBeenCalledWith(
			module,
			expect.objectContaining({
				wasi_unstable: expect.objectContaining({
					clock_time_get: expect.any(Function)
				})
			})
		);
	});

	it('traces normal proc_exit without treating it as an error', async () => {
		const trace = vi.fn();
		const stdout = vi.fn();
		const app = Object.assign(Object.create(App.prototype), {
			ready: Promise.resolve(),
			argv: ['test.wasm'],
			memfs: { stdout },
			exports: {
				_start() {
					throw new ProcExit(0);
				}
			},
			trace
		}) as App;

		await expect(app.run()).resolves.toBe(false);
		expect(trace).toHaveBeenCalledWith(expect.stringContaining('start(argv='));
		expect(trace).toHaveBeenCalledWith('proc_exit(code=0)');
		expect(stdout).not.toHaveBeenCalled();
	});

	it('traces not implemented WASI calls and writes the runtime error', async () => {
		const trace = vi.fn();
		const stdout = vi.fn();
		const error = new NotImplemented('wasi_unstable', 'clock_time_get');
		const app = Object.assign(Object.create(App.prototype), {
			ready: Promise.resolve(),
			argv: ['test.wasm'],
			memfs: { stdout },
			exports: {
				_start() {
					throw error;
				}
			},
			trace
		}) as App;

		await expect(app.run()).rejects.toBe(error);
		expect(trace).toHaveBeenCalledWith(
			'not_implemented(wasi_unstable.clock_time_get not implemented.)'
		);
		expect(stdout).toHaveBeenCalledWith(
			expect.stringContaining('Error: wasi_unstable.clock_time_get not implemented.')
		);
	});

	it('emits current locals when pausing on a debug line', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'add_one' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'value',
							kind: 'number',
							fromLine: 4,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				frames: [
					{ functionId: 1, functionName: 'add_one', line: 0, values: new Map([[1, '9']]) }
				],
				onPause
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_line(1, 4)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 4,
			reason: 'step',
			locals: [{ name: 'value', value: '9' }],
			callStack: [{ functionName: 'add_one', line: 4 }]
		});
	});

	it('records function entry lines on debug enter', () => {
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4)),
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: false,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 0,
				stepOutDepth: 0,
				currentFunctionId: 0,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 7: 'main' },
				variableMetadata: {},
				frames: [],
				globalValues: new Map()
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_enter(7, 12)).toBe(0);
		expect(app.debugSession?.currentLine).toBe(12);
		expect(app.debugSession?.frames).toEqual([
			{ functionId: 7, functionName: 'main', line: 12, values: new Map() }
		]);
	});

	it('arms a step fallback when next-line leaves the current function before another line', () => {
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4)),
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: false,
				nextLineArmed: true,
				stepOutArmed: false,
				callDepth: 2,
				stepOutDepth: 0,
				currentFunctionId: 2,
				currentLine: 14,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 2,
				nextLineLine: 14,
				functionMetadata: { 1: 'main', 2: 'helper' },
				variableMetadata: {},
				frames: [
					{ functionId: 1, functionName: 'main', line: 9, values: new Map() },
					{ functionId: 2, functionName: 'helper', line: 14, values: new Map() }
				],
				globalValues: new Map()
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_leave(2)).toBe(0);
		expect(app.debugSession?.nextLineArmed).toBe(false);
		expect(app.debugSession?.stepArmed).toBe(true);
	});

	it('emits placeholders for declared locals without runtime values yet', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'main' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'result1',
							kind: 'number',
							fromLine: 6,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				frames: [{ functionId: 1, functionName: 'main', line: 0, values: new Map() }],
				onPause
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_line(1, 6)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 6,
			reason: 'step',
			locals: [{ name: 'result1', value: '?' }],
			callStack: [{ functionName: 'main', line: 6 }]
		});
	});

	it('skips duplicate same-line hooks right after resume and pauses on the next source location', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>([4]),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 4,
				resumeSkipActive: true,
				resumeSkipFunctionId: 1,
				resumeSkipLine: 4,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'main' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'value',
							kind: 'number',
							fromLine: 4,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				frames: [
					{ functionId: 1, functionName: 'main', line: 4, values: new Map([[1, '9']]) }
				],
				onPause
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_line(1, 4)).toBe(0);
		expect(onPause).not.toHaveBeenCalled();
		expect(app.debugSession?.stepArmed).toBe(true);

		expect(app.__wasm_idle_debug_line(1, 5)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 5,
			reason: 'step',
			locals: [{ name: 'value', value: '9' }],
			callStack: [{ functionName: 'main', line: 5 }]
		});
	});

	it('renders fixed-size array locals from wasm memory at pause time', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'main' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'values',
							kind: 'array',
							elementKind: 'int',
							length: 3,
							fromLine: 4,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				frames: [
					{ functionId: 1, functionName: 'main', line: 0, values: new Map([[1, '16']]) }
				],
				onPause
			},
			mem: {
				check: vi.fn(),
				read8: vi.fn(),
				readInt32: vi
					.fn()
					.mockImplementation((offset: number) => ({ 16: 1, 20: 2, 24: 3 })[offset] ?? 0),
				readFloat32: vi.fn(),
				readFloat64: vi.fn()
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_line(1, 4)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 4,
			reason: 'step',
			locals: [{ name: 'values', value: '[1, 2, 3]' }],
			callStack: [{ functionName: 'main', line: 4 }]
		});
	});

	it('stores string previews reported by container hooks', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'main' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'values',
							kind: 'text',
							fromLine: 4,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				frames: [{ functionId: 1, functionName: 'main', line: 0, values: new Map() }],
				onPause
			},
			mem: {
				check: vi.fn(),
				readStr: vi.fn(() => '[1, 2, 3]')
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_value_text(1, 1, 32, 9)).toBe(0);
		expect(app.__wasm_idle_debug_line(1, 4)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 4,
			reason: 'step',
			locals: [{ name: 'values', value: '[1, 2, 3]' }],
			callStack: [{ functionName: 'main', line: 4 }]
		});
	});

	it('renders fixed-size two-dimensional array locals from wasm memory at pause time', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'main' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'grid',
							kind: 'array',
							elementKind: 'int',
							length: 2,
							dimensions: [2, 3],
							fromLine: 4,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				frames: [
					{ functionId: 1, functionName: 'main', line: 0, values: new Map([[1, '16']]) }
				],
				onPause
			},
			mem: {
				check: vi.fn(),
				read8: vi.fn(),
				readInt32: vi
					.fn()
					.mockImplementation(
						(offset: number) =>
							({ 16: 1, 20: 2, 24: 3, 28: 4, 32: 5, 36: 6 })[offset] ?? 0
					),
				readFloat32: vi.fn(),
				readFloat64: vi.fn()
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_line(1, 4)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 4,
			reason: 'step',
			locals: [{ name: 'grid', value: '[[1, 2, 3], [4, 5, 6]]' }],
			callStack: [{ functionName: 'main', line: 4 }]
		});
	});

	it('includes global scalar values when pausing inside a function', () => {
		const onPause = vi.fn();
		const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
		const control = new Int32Array(buffer);
		control[1] = 1;
		const app = Object.assign(Object.create(App.prototype), {
			debugSession: {
				buffer: control,
				interruptBuffer: new Uint8Array(new SharedArrayBuffer(1)),
				breakpoints: new Set<number>(),
				pauseOnEntry: false,
				stepArmed: true,
				nextLineArmed: false,
				stepOutArmed: false,
				callDepth: 1,
				stepOutDepth: 0,
				currentFunctionId: 1,
				currentLine: 0,
				resumeSkipActive: false,
				resumeSkipFunctionId: 0,
				resumeSkipLine: 0,
				nextLineFunctionId: 0,
				nextLineLine: 0,
				functionMetadata: { 1: 'main' },
				variableMetadata: {
					1: [
						{
							slot: 1,
							name: 'local',
							kind: 'number',
							fromLine: 4,
							toLine: Number.MAX_SAFE_INTEGER
						}
					]
				},
				globalVariableMetadata: [
					{
						slot: 10,
						name: 'counter',
						kind: 'number',
						fromLine: 1,
						toLine: Number.MAX_SAFE_INTEGER
					}
				],
				frames: [
					{ functionId: 1, functionName: 'main', line: 0, values: new Map([[1, '3']]) }
				],
				globalValues: new Map([[10, '7']]),
				onPause
			},
			trace: vi.fn()
		}) as App;

		expect(app.__wasm_idle_debug_line(1, 4)).toBe(0);
		expect(onPause).toHaveBeenCalledWith({
			type: 'pause',
			line: 4,
			reason: 'step',
			locals: [
				{ name: 'local', value: '3' },
				{ name: 'counter', value: '7' }
			],
			callStack: [{ functionName: 'main', line: 4 }]
		});
	});
});
