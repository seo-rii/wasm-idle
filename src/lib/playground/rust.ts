import { resolveRustCompilerUrl, type PlaygroundRuntimeAssets } from '$lib/playground/assets';
import {
	type DebugCommand,
	type DebugSessionEvent,
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer, requireSharedArrayBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';

const debugBreakpointBufferInts = 1028;

class Rust implements Sandbox {
	output: any = null;
	ondebug?: (event: DebugSessionEvent) => void;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	debugBuffer = createWasmIdleSharedBuffer(
		Int32Array.BYTES_PER_ELEMENT * debugBreakpointBufferInts
	);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	compilerUrl = '';
	assetPath = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private readonly workerSession = new WorkerSession({
		label: 'Rust',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
			this.ondebug?.({ type: 'stop' });
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return this.workerSession.load(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextCompilerUrl = resolveRustCompilerUrl(runtimeAssets, currentUrl);
			const nextAssetPath =
				typeof runtimeAssets === 'string'
					? runtimeAssets
					: runtimeAssets?.rootUrl ||
						(typeof window !== 'undefined'
							? window.location.pathname.replace(/\/$/, '')
							: '');
			if (!nextCompilerUrl) {
				return reject(
					'Rust runtime is not configured. Set PUBLIC_WASM_RUST_COMPILER_URL or runtimeAssets.rust.compilerUrl.'
				);
			}
			const needsWorkerReset =
				!this.worker ||
				this.compilerUrl !== nextCompilerUrl ||
				this.assetPath !== nextAssetPath;
			this.compilerUrl = nextCompilerUrl;
			this.assetPath = nextAssetPath;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/rust?worker')).default();
				this.workerSession.attach(this.worker);
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					compilerUrl: this.compilerUrl,
					path: this.assetPath
				});
			} else {
				progress?.set?.(1);
				resolve();
			}
		});
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.flushPendingInput();
	}

	eof() {
		this.pendingEof = true;
		this.flushPendingInput();
	}

	private flushPendingInput() {
		if (!this.waitingForInput) return;
		if (flushQueuedStdin(this.pendingInput, this.buffer)) {
			this.waitingForInput = false;
			return;
		}
		if (this.pendingEof) {
			flushBufferedEof(this.buffer);
			this.pendingEof = false;
			this.waitingForInput = false;
		}
	}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		if (options.debug) requireSharedArrayBuffer('Rust debugging');
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const { programArgs } = resolveSandboxExecutionArgs('RUST', args, options);
			const targetTriple = options.rustTargetTriple || 'wasm32-wasip1';
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(this.worker, reject);
			this.setBreakpoints(options.debug ? [...(options.breakpoints || [])] : []);
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, buffer, diagnostic, progress, debugEvent } =
					event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				if (progress && typeof progress.percent === 'number') {
					_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
				}
				if (output) this.output(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (debugEvent) this.ondebug?.(debugEvent);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.ondebug?.({ type: 'stop' });
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					this.ondebug?.({ type: 'stop' });
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				debugBuffer: this.debugBuffer,
				stdin: options.stdin,
				args: programArgs,
				targetTriple,
				log: _log,
				debug: !!options.debug,
				breakpoints: [...(options.breakpoints || [])],
				pauseOnEntry: !!options.pauseOnEntry
			});
		});
	}

	debugCommand(command: DebugCommand) {
		const control = new Int32Array(this.debugBuffer);
		Atomics.store(
			control,
			1,
			command === 'stepInto' ? 2 : command === 'nextLine' ? 3 : command === 'stepOut' ? 4 : 1
		);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.ondebug?.({ type: 'resume', command });
	}

	setBreakpoints(lines: number[]) {
		const control = new Int32Array(this.debugBuffer);
		const next = [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))]
			.sort((left, right) => left - right)
			.slice(0, Math.max(0, control.length - 4));
		for (let index = 4; index < control.length; index += 1) {
			Atomics.store(control, index, next[index - 4] || 0);
		}
		Atomics.store(control, 3, next.length);
		Atomics.add(control, 2, 1);
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		const control = new Int32Array(this.debugBuffer);
		Atomics.add(control, 0, 1);
		Atomics.notify(control, 0);
		this.workerSession.terminate();
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		new Int32Array(this.debugBuffer).fill(0);
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Rust;
