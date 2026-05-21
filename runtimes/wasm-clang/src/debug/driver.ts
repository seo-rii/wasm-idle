import Runtime from '../runtime.js';
import type {
	BrowserClangRuntimeOptions,
	BrowserClangRuntimeRunOptions
} from '../types.js';
import {
	BrowserClangDebugController,
	type CreateBrowserClangDebugControllerOptions
} from './controller.js';

export interface CreateBrowserClangDebugDriverOptions
	extends BrowserClangRuntimeOptions,
		CreateBrowserClangDebugControllerOptions {}

export interface BrowserClangDebugRunRequest
	extends Omit<
		BrowserClangRuntimeRunOptions,
		| 'debug'
		| 'breakpoints'
		| 'pauseOnEntry'
		| 'debugBuffer'
		| 'interruptBuffer'
		| 'watchBuffer'
		| 'watchResultBuffer'
	> {
	code: string;
	breakpoints?: number[];
	pauseOnEntry?: boolean;
}

export class BrowserClangDebugDriver {
	readonly runtime: Runtime;
	readonly controller: BrowserClangDebugController;

	constructor(runtime: Runtime, controller: BrowserClangDebugController) {
		this.runtime = runtime;
		this.controller = controller;
	}

	get breakpoints() {
		return this.controller.breakpoints;
	}

	setBreakpoints(lines: number[]) {
		this.controller.setBreakpoints(lines);
	}

	resume() {
		this.controller.resume();
	}

	stepInto() {
		this.controller.stepInto();
	}

	nextLine() {
		this.controller.nextLine();
	}

	stepOut() {
		this.controller.stepOut();
	}

	evaluate(expression: string, timeoutMs?: number) {
		return this.controller.evaluate(expression, timeoutMs);
	}

	interrupt() {
		this.controller.interrupt();
	}

	clear() {
		this.controller.clear();
	}

	async run(request: BrowserClangDebugRunRequest) {
		const { code, breakpoints, pauseOnEntry, ...runtimeOptions } = request;
		await this.runtime.compileLinkRun(code, {
			...runtimeOptions,
			...this.controller.createRuntimeRunOptions({
				breakpoints,
				pauseOnEntry
			})
		});
	}
}

export async function createBrowserClangDebugDriver(
	options: CreateBrowserClangDebugDriverOptions = {}
) {
	const runtime = new Runtime(options);
	await runtime.ready;
	const controller = new BrowserClangDebugController(options);
	return new BrowserClangDebugDriver(runtime, controller);
}
