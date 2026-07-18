import {
	resolveHaskellBsdtarUrl,
	resolveHaskellModuleUrl,
	resolveHaskellRootfsUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';
import {
	flushBufferedEof,
	flushQueuedStdin,
	resetBufferedStdin
} from '$lib/playground/stdinBuffer';
import { createWasmIdleSharedBuffer } from '$lib/playground/sharedBuffer';
import { WorkerSession } from '$lib/playground/workerSession';
import { reportWorkerProgress } from '$lib/playground/workerProgress';

const DEFAULT_HASKELL_MAIN_SO_PATH = '/tmp/libplayground001.so';
const DEFAULT_HASKELL_SEARCH_DIRS = [
	'/tmp/clib',
	'/tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace'
];

function haskellRuntimeKey(runtimeAssets: string | PlaygroundRuntimeAssets, currentUrl: string) {
	const runtimeConfig = typeof runtimeAssets === 'object' ? runtimeAssets.haskell : undefined;
	return JSON.stringify({
		moduleUrl: resolveHaskellModuleUrl(runtimeAssets, currentUrl),
		rootfsUrl: resolveHaskellRootfsUrl(runtimeAssets, currentUrl),
		bsdtarUrl: resolveHaskellBsdtarUrl(runtimeAssets, currentUrl),
		mainSoPath: runtimeConfig?.mainSoPath || DEFAULT_HASKELL_MAIN_SO_PATH,
		searchDirs: runtimeConfig?.searchDirs || DEFAULT_HASKELL_SEARCH_DIRS
	});
}

class Haskell implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	buffer = createWasmIdleSharedBuffer(1024);
	pendingInput: string[] = [];
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	runtimeKey = '';
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	waitingForInput = false;
	pendingEof = false;
	private readonly workerSession = new WorkerSession({
		label: 'Haskell',
		onDispose: (worker) => {
			if (this.worker === worker) delete this.worker;
			this.exit = true;
			this.waitingForInput = false;
			this.pendingEof = false;
		}
	});

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		return this.workerSession.load(async (resolve, reject) => {
			this.pendingInput = [];
			this.waitingForInput = false;
			this.pendingEof = false;
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const moduleUrl = resolveHaskellModuleUrl(runtimeAssets, currentUrl);
			const rootfsUrl = resolveHaskellRootfsUrl(runtimeAssets, currentUrl);
			const bsdtarUrl = resolveHaskellBsdtarUrl(runtimeAssets, currentUrl);
			if (!moduleUrl || !rootfsUrl || !bsdtarUrl) {
				return reject(
					'Haskell runtime is not configured. Set PUBLIC_WASM_HASKELL_MODULE_URL, PUBLIC_WASM_HASKELL_ROOTFS_URL, and PUBLIC_WASM_HASKELL_BSDTAR_URL, or runtimeAssets.haskell.'
				);
			}
			const runtimeConfig =
				typeof runtimeAssets === 'object' ? runtimeAssets.haskell : undefined;
			const nextRuntimeKey = haskellRuntimeKey(runtimeAssets, currentUrl);
			const needsWorkerReset = !this.worker || this.runtimeKey !== nextRuntimeKey;
			this.runtimeKey = nextRuntimeKey;
			if (needsWorkerReset && this.worker) {
				this.workerSession.reset();
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/haskell?worker')).default();
				this.workerSession.attach(this.worker);
				this.worker.onmessage = (event: MessageEvent<any>) => {
					reportWorkerProgress(progress, event.data?.progress);
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					moduleUrl,
					rootfsUrl,
					bsdtarUrl,
					mainSoPath: runtimeConfig?.mainSoPath || DEFAULT_HASKELL_MAIN_SO_PATH,
					searchDirs: runtimeConfig?.searchDirs || DEFAULT_HASKELL_SEARCH_DIRS,
					log: _log
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
		_prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const { compileArgs, programArgs } = resolveSandboxExecutionArgs(
				'HASKELL',
				args,
				options
			);
			const _uid = ++this.uid;
			const operation = this.workerSession.beginRun(this.worker, reject);
			const handler = (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, buffer, diagnostic, progress } = event.data;
				if (buffer) {
					this.waitingForInput = true;
					this.flushPendingInput();
				}
				reportWorkerProgress(_prog, progress);
				if (output) this.output?.(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.waitingForInput = false;
					this.pendingEof = false;
					this.workerSession.complete(operation);
					reject(error);
				}
			};
			this.worker.onmessage = handler;
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				buffer: this.buffer,
				ghcArgs: compileArgs.length ? compileArgs.join(' ') : programArgs.join(' '),
				stdin: options.stdin,
				activePath: options.activePath || 'main.hs',
				workspaceFiles: options.workspaceFiles || [],
				log: _log
			});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.waitingForInput = false;
		this.pendingEof = false;
		this.uid += 1;
		this.workerSession.terminate();
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.waitingForInput = false;
		this.pendingEof = false;
		if (this.worker) this.worker.onmessage = null;
		resetBufferedStdin(this.buffer);
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Haskell;
