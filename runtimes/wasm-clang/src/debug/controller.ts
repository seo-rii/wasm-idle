import type { DebugCommand, BrowserClangRuntimeRunOptions } from '../types.js';
import {
	bufferedSequence,
	flushQueuedStdin,
	resetBufferedStdin,
	waitForBufferedSequenceChange
} from '../stdin-buffer.js';

const DEFAULT_DEBUG_BREAKPOINT_BUFFER_INTS = 1028;
const DEFAULT_DEBUG_WATCH_BUFFER_BYTES = 1024;
const COMMAND_INDEX = 1;
const BREAKPOINT_VERSION_INDEX = 2;
const BREAKPOINT_COUNT_INDEX = 3;
const FIRST_BREAKPOINT_INDEX = 4;

export interface CreateBrowserClangDebugControllerOptions {
	breakpointBufferInts?: number;
	watchBufferBytes?: number;
	breakpoints?: number[];
}

export type BrowserClangDebugRuntimeOptions = Pick<
	BrowserClangRuntimeRunOptions,
	| 'debug'
	| 'breakpoints'
	| 'pauseOnEntry'
	| 'debugBuffer'
	| 'interruptBuffer'
	| 'watchBuffer'
	| 'watchResultBuffer'
>;

export class BrowserClangDebugController {
	readonly debugBuffer: Int32Array;
	readonly watchBuffer: Int32Array;
	readonly watchResultBuffer: Int32Array;
	readonly interruptBuffer: Uint8Array;

	constructor(options: CreateBrowserClangDebugControllerOptions = {}) {
		const breakpointBufferInts = Math.max(
			FIRST_BREAKPOINT_INDEX + 1,
			Math.trunc(options.breakpointBufferInts || DEFAULT_DEBUG_BREAKPOINT_BUFFER_INTS)
		);
		const watchBufferBytes = Math.max(
			Int32Array.BYTES_PER_ELEMENT * 4,
			Math.ceil(
				(options.watchBufferBytes || DEFAULT_DEBUG_WATCH_BUFFER_BYTES) /
					Int32Array.BYTES_PER_ELEMENT
			) * Int32Array.BYTES_PER_ELEMENT
		);

		this.debugBuffer = new Int32Array(
			new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * breakpointBufferInts)
		);
		this.watchBuffer = new Int32Array(new SharedArrayBuffer(watchBufferBytes));
		this.watchResultBuffer = new Int32Array(new SharedArrayBuffer(watchBufferBytes));
		this.interruptBuffer = new Uint8Array(new SharedArrayBuffer(1));
		this.setBreakpoints(options.breakpoints || []);
	}

	get breakpoints() {
		const count = Math.max(0, Atomics.load(this.debugBuffer, BREAKPOINT_COUNT_INDEX));
		return Array.from({ length: count }, (_, index) =>
			Atomics.load(this.debugBuffer, FIRST_BREAKPOINT_INDEX + index)
		).filter((line) => line > 0);
	}

	private notify(command = 0) {
		if (command > 0) {
			Atomics.store(this.debugBuffer, COMMAND_INDEX, command);
		}
		Atomics.add(this.debugBuffer, 0, 1);
		Atomics.notify(this.debugBuffer, 0);
	}

	setBreakpoints(lines: number[]) {
		const next = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))]
			.sort((left, right) => left - right)
			.slice(0, Math.max(0, this.debugBuffer.length - FIRST_BREAKPOINT_INDEX));
		for (let index = FIRST_BREAKPOINT_INDEX; index < this.debugBuffer.length; index += 1) {
			Atomics.store(this.debugBuffer, index, next[index - FIRST_BREAKPOINT_INDEX] || 0);
		}
		Atomics.store(this.debugBuffer, BREAKPOINT_COUNT_INDEX, next.length);
		Atomics.add(this.debugBuffer, BREAKPOINT_VERSION_INDEX, 1);
	}

	dispatch(command: DebugCommand) {
		this.notify(
			command === 'stepInto' ? 2 : command === 'nextLine' ? 3 : command === 'stepOut' ? 4 : 1
		);
	}

	resume() {
		this.dispatch('continue');
	}

	stepInto() {
		this.dispatch('stepInto');
	}

	nextLine() {
		this.dispatch('nextLine');
	}

	stepOut() {
		this.dispatch('stepOut');
	}

	async evaluate(expression: string, timeoutMs = 5000) {
		resetBufferedStdin(this.watchResultBuffer);
		const previousSequence = bufferedSequence(this.watchResultBuffer);
		flushQueuedStdin([expression], this.watchBuffer);
		this.notify(5);
		return (
			(await waitForBufferedSequenceChange(
				this.watchResultBuffer,
				previousSequence,
				timeoutMs
			)) ?? '?'
		);
	}

	interrupt() {
		this.interruptBuffer[0] = 2;
		this.notify();
	}

	clear() {
		this.interruptBuffer[0] = 0;
		resetBufferedStdin(this.watchBuffer);
		resetBufferedStdin(this.watchResultBuffer);
		this.debugBuffer.fill(0);
	}

	createRuntimeRunOptions(
		options: Pick<BrowserClangRuntimeRunOptions, 'breakpoints' | 'pauseOnEntry'> = {}
	): BrowserClangDebugRuntimeOptions {
		if (options.breakpoints) {
			this.setBreakpoints(options.breakpoints);
		}
		this.interruptBuffer[0] = 0;
		resetBufferedStdin(this.watchBuffer);
		resetBufferedStdin(this.watchResultBuffer);
		return {
			debug: true,
			breakpoints: this.breakpoints,
			pauseOnEntry: !!options.pauseOnEntry,
			debugBuffer: this.debugBuffer,
			interruptBuffer: this.interruptBuffer,
			watchBuffer: this.watchBuffer,
			watchResultBuffer: this.watchResultBuffer
		};
	}
}

export const createBrowserClangDebugController = (
	options: CreateBrowserClangDebugControllerOptions = {}
) => new BrowserClangDebugController(options);
