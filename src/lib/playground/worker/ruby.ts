import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';
import {
	RUBY_RUNTIME_VERIFIED_WASM_URL,
	normalizeWorkspacePath,
	RUBY_SPLIT_PROTOCOL,
	verifyRubySplitPayload,
	rewriteRubySplitRuntimeModule,
	parseRubyStdlibPack,
	createRubyStdlibPreopens,
	type RubyStdlibEntry,
	rewriteVerifiedRubyRuntimeModule,
	verifyRubyRuntimePreflightPayload
} from '@wasm-idle/core';

declare var self: any;

const encoder = new TextEncoder();

let stdinBufferRuby: Int32Array | null = null;
let runtimeState: 'uninitialized' | 'loading' | 'ready' | 'running' = 'uninitialized';
let loadedRuntime: LoadedRubyRuntime | null = null;
let preparedExecution: PreparedRubyExecution | null = null;

interface RubyRuntimeModule {
	RubyVM: any;
	consolePrinter(options: Record<string, (output: string) => void>): any;
	rubyStdlibWasmUrl: string;
	wasiShim: any;
}

interface LoadedRubyRuntime {
	stdlib?: ReadonlyArray<RubyStdlibEntry>;
	module: WebAssembly.Module;
	runtime: RubyRuntimeModule;
}

async function loadRubyModule(
	runtimePreflight: unknown,
	maxAssetBytes: number,
	context: RubyExecutionContext
) {
	if (runtimeState !== 'uninitialized') {
		throw new Error('Ruby runtime is already loaded.');
	}
	runtimeState = 'loading';
	try {
		const split =
			!!runtimePreflight &&
			typeof runtimePreflight === 'object' &&
			Object.getOwnPropertyDescriptor(runtimePreflight, 'protocol')?.value ===
				RUBY_SPLIT_PROTOCOL;
		const payload = split
			? await verifyRubySplitPayload(runtimePreflight, { maxAssetBytes })
			: await verifyRubyRuntimePreflightPayload(runtimePreflight, {
					maxAssetBytes
				});
		const buffers = [
			payload.manifestBytes,
			payload.moduleJavaScriptBytes,
			payload.wasmBytes,
			...('stdlibBytes' in payload ? [payload.stdlibBytes] : [])
		];
		if (
			buffers.some(
				(bytes) =>
					!ArrayBuffer.isView(bytes) ||
					Object.prototype.toString.call(bytes) !== '[object Uint8Array]' ||
					!(bytes.buffer instanceof ArrayBuffer) ||
					bytes.byteOffset !== 0 ||
					bytes.byteLength !== bytes.buffer.byteLength
			) ||
			new Set(buffers.map((bytes) => bytes.buffer)).size !== buffers.length
		) {
			throw new TypeError(
				'Ruby execution worker requires unique owned runtime preflight bytes'
			);
		}
		const wasmBytes = payload.wasmBytes as Uint8Array<ArrayBuffer>;
		const moduleSource =
			'stdlibBytes' in payload
				? rewriteRubySplitRuntimeModule(payload)
				: rewriteVerifiedRubyRuntimeModule(payload);
		if (
			typeof Blob !== 'function' ||
			typeof URL.createObjectURL !== 'function' ||
			typeof URL.revokeObjectURL !== 'function'
		) {
			throw new Error('Ruby runtime requires Blob module URL support.');
		}
		const verifiedModuleUrl = URL.createObjectURL(
			new Blob([moduleSource], { type: 'text/javascript' })
		);
		let runtime: RubyRuntimeModule;
		let module: WebAssembly.Module;
		try {
			[runtime, module] = await Promise.all([
				importRuntimeModule<RubyRuntimeModule>(verifiedModuleUrl),
				WebAssembly.compile(wasmBytes)
			]);
		} finally {
			try {
				URL.revokeObjectURL(verifiedModuleUrl);
			} catch {
				// Blob URL cleanup must not replace import or compilation outcomes.
			}
		}
		if (
			!runtime.RubyVM ||
			!runtime.consolePrinter ||
			!runtime.wasiShim ||
			runtime.rubyStdlibWasmUrl !== RUBY_RUNTIME_VERIFIED_WASM_URL
		) {
			throw new Error(
				'Ruby runtime module is missing required verified Ruby or WASI exports.'
			);
		}
		loadedRuntime = {
			module,
			runtime,
			...('stdlibBytes' in payload
				? { stdlib: parseRubyStdlibPack(payload.stdlibBytes) }
				: {})
		};
		// Initialize only the interpreter; never evaluate user source during prewarm.
		const candidate = await initializeRubyExecution(loadedRuntime, context, true);
		preparedExecution = candidate.stdin.wasReadBeforeActivation ? null : candidate;
		runtimeState = 'ready';
		return loadedRuntime;
	} catch (error) {
		loadedRuntime = null;
		preparedExecution = null;
		runtimeState = 'uninitialized';
		throw error;
	}
}

function createRubyStdin(
	runtime: RubyRuntimeModule,
	initialStdin: string | null,
	requestInput: () => string | null,
	deferred = false
) {
	const { Fd, Inode, wasi } = runtime.wasiShim;
	return new (class extends Fd {
		private readonly ino = Inode.issue_ino();
		private currentStdin = initialStdin;
		private pendingBytes: Uint8Array | null = null;
		private fixedInitialStdin = initialStdin != null;
		private active = !deferred;
		wasReadBeforeActivation = false;

		activate(initial: string | null, provider: () => string | null) {
			if (this.active) throw new Error('Ruby stdin is already active.');
			this.currentStdin = initial;
			this.fixedInitialStdin = initial != null;
			this.pendingBytes = null;
			requestInput = provider;
			this.active = true;
		}

		fd_fdstat_get() {
			const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
			fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
			return { ret: wasi.ERRNO_SUCCESS, fdstat };
		}

		fd_filestat_get() {
			return {
				ret: wasi.ERRNO_SUCCESS,
				filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
			};
		}

		fd_read(size: number) {
			if (!this.active) {
				// Do not request user input or block during speculative initialization.
				// Such an initialization may have cached EOF in libc; never reuse it.
				this.wasReadBeforeActivation = true;
				return { ret: wasi.ERRNO_SUCCESS, data: new Uint8Array() };
			}
			let bytes = this.pendingBytes;
			if (!bytes?.length) {
				const chunk = this.readChunk();
				if (chunk == null) return { ret: wasi.ERRNO_SUCCESS, data: new Uint8Array() };
				bytes = encoder.encode(chunk);
			}
			if (bytes.length <= size) {
				this.pendingBytes = null;
				return { ret: wasi.ERRNO_SUCCESS, data: bytes };
			}
			const head = bytes.slice(0, size);
			this.pendingBytes = bytes.slice(size);
			return { ret: wasi.ERRNO_SUCCESS, data: head };
		}

		private readChunk() {
			if (this.currentStdin != null) {
				const chunk = this.currentStdin;
				this.currentStdin = null;
				return chunk;
			}
			if (this.fixedInitialStdin) return null;
			return requestInput();
		}
	})();
}

type WorkspaceTree = Map<string, string | WorkspaceTree>;

function insertWorkspaceFile(tree: WorkspaceTree, path: string, content: string) {
	const [head, ...rest] = path.split('/').filter(Boolean);
	if (!head) return;
	if (!rest.length) {
		tree.set(head, content);
		return;
	}
	const existing = tree.get(head);
	const child = existing instanceof Map ? existing : new Map<string, string | WorkspaceTree>();
	tree.set(head, child);
	insertWorkspaceFile(child, rest.join('/'), content);
}

function materializeWorkspaceTree(
	runtime: RubyRuntimeModule,
	tree: WorkspaceTree
): Map<string, any> {
	const { Directory, File } = runtime.wasiShim;
	const contents = new Map<string, any>();
	for (const [name, entry] of tree) {
		contents.set(
			name,
			entry instanceof Map
				? new Directory(materializeWorkspaceTree(runtime, entry))
				: new File(encoder.encode(entry), { readonly: true })
		);
	}
	return contents;
}

function workspaceContents(runtime: RubyRuntimeModule, workspaceFiles: SandboxWorkspaceFile[]) {
	const tree: WorkspaceTree = new Map();
	for (const file of workspaceFiles) {
		const normalizedPath = file.path.replace(/^\/+/, '');
		if (!normalizedPath || normalizedPath.includes('\0')) continue;
		insertWorkspaceFile(tree, normalizedPath, file.content);
	}
	return materializeWorkspaceTree(runtime, tree);
}

interface RubyExecutionContext {
	args: string[];
	workspaceFiles: SandboxWorkspaceFile[];
	activePath: string;
}
interface PreparedRubyExecution {
	context: RubyExecutionContext;
	vm: { eval(source: string): unknown };
	stdin: ReturnType<typeof createRubyStdin>;
	activate(initial: string | null, provider: () => string | null): void;
	hasOutput(): { stdout: boolean; stderr: boolean };
}
const defaultContext = (): RubyExecutionContext => ({
	args: [],
	workspaceFiles: [],
	activePath: 'main.rb'
});
// This private bootstrap envelope contains data only, never source to evaluate or URLs.
function decodeStartupContext(value: unknown): RubyExecutionContext {
	if (value === undefined) return defaultContext();
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new TypeError('Invalid Ruby startup context.');
	const input = value as RubyExecutionContext;
	if (
		Object.keys(input).sort().join(',') !== 'activePath,args,workspaceFiles' ||
		!Array.isArray(input.args) ||
		input.args.some((arg) => typeof arg !== 'string') ||
		!Array.isArray(input.workspaceFiles) ||
		typeof input.activePath !== 'string'
	) {
		throw new TypeError('Invalid Ruby startup context.');
	}
	const workspaceFiles = input.workspaceFiles.map((file) => {
		if (
			!file ||
			typeof file !== 'object' ||
			Object.keys(file).sort().join(',') !== 'content,path' ||
			typeof file.path !== 'string' ||
			typeof file.content !== 'string'
		)
			throw new TypeError('Invalid Ruby startup workspace.');
		return { path: normalizeWorkspacePath(file.path), content: file.content };
	});
	return {
		args: [...input.args],
		workspaceFiles,
		activePath: normalizeWorkspacePath(input.activePath)
	};
}

const sameContext = (a: RubyExecutionContext, b: RubyExecutionContext) =>
	a.activePath === b.activePath &&
	a.args.length === b.args.length &&
	a.args.every((value, index) => value === b.args[index]) &&
	a.workspaceFiles.length === b.workspaceFiles.length &&
	a.workspaceFiles.every(
		(file, index) =>
			file.path === b.workspaceFiles[index].path &&
			file.content === b.workspaceFiles[index].content
	);

async function initializeRubyExecution(
	loaded: LoadedRubyRuntime,
	context: RubyExecutionContext,
	deferred: boolean,
	initial: string | null = null,
	provider: () => string | null = () => null
): Promise<PreparedRubyExecution> {
	const { runtime, module } = loaded;
	// Snapshot the immutable startup context before awaiting VM initialization.
	const snapshot: RubyExecutionContext = {
		args: [...context.args],
		activePath: context.activePath,
		workspaceFiles: context.workspaceFiles.map((file) => ({
			path: file.path,
			content: file.content
		}))
	};
	let active = !deferred;
	let hasStdout = false,
		hasStderr = false;
	let pendingBytes = 0;
	const pending: string[] = [];
	const emit = (output: string, error: boolean) => {
		if (!output) return;
		if (error) hasStderr = true;
		else hasStdout = true;
		if (active) postMessage({ output });
		else {
			pendingBytes += encoder.encode(output).byteLength;
			if (pendingBytes > 64 * 1024)
				throw new Error('Ruby initialization output exceeded 65536 bytes.');
			pending.push(output);
		}
	};
	const printer = runtime.consolePrinter({
		stdout: (output: string) => emit(output, false),
		stderr: (output: string) => emit(output, true)
	});
	const rubyStdin = createRubyStdin(runtime, initial, provider, deferred);
	const { File, OpenFile, PreopenDirectory, WASI } = runtime.wasiShim;
	const root = workspaceContents(runtime, snapshot.workspaceFiles);
	// Preserve the complete split standard library and ancestor directories for realpath.
	const preopens = loaded.stdlib
		? createRubyStdlibPreopens(loaded.stdlib, runtime.wasiShim, root)
		: [new PreopenDirectory('/', root)];
	// @ruby/wasm-wasi automatically requires /bundle/setup.rb while initializing.
	// The split profile owns and verifies that mount. For the embedded profile, hide a
	// same-named user directory until initialization completes so prewarm cannot run
	// workspace source; the live root map is restored before the VM can be claimed.
	const deferredUserBundle = loaded.stdlib ? undefined : root.get('bundle');
	if (deferredUserBundle) root.delete('bundle');
	const wasiInstance = new WASI(
		['ruby.wasm', ...snapshot.args],
		['USER=jungol'],
		[rubyStdin, new OpenFile(new File([])), new OpenFile(new File([])), ...preopens],
		{ debug: false }
	);
	let vm: { eval(source: string): unknown };
	try {
		({ vm } = await runtime.RubyVM.instantiateModule({
			module,
			wasip1: wasiInstance,
			args: ['ruby.wasm', '-EUTF-8', '-e_=0', '--', ...snapshot.args],
			addToImports(imports: WebAssembly.Imports) {
				printer.addToImports(imports);
			},
			setMemory(memory: WebAssembly.Memory) {
				printer.setMemory(memory);
			}
		}));
	} finally {
		if (deferredUserBundle) root.set('bundle', deferredUserBundle);
	}
	if (!vm || typeof vm.eval !== 'function')
		throw new Error('Ruby VM initialization did not return an evaluator.');
	return {
		context: snapshot,
		vm,
		stdin: rubyStdin,
		activate(initial, provider) {
			if (active) throw new Error('Ruby execution is already active.');
			rubyStdin.activate(initial, provider);
			active = true;
			for (const output of pending.splice(0)) postMessage({ output });
			pendingBytes = 0;
		},
		hasOutput: () => ({ stdout: hasStdout, stderr: hasStderr })
	};
}

self.onmessage = async (event: { data: any }) => {
	const message = event.data;
	const {
		load,
		runtimePreflight,
		maxAssetBytes,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.rb',
		workspaceFiles = [],
		log
	} = message;
	let ownsRuntimeState = false;
	try {
		if (Object.prototype.hasOwnProperty.call(message, 'load')) {
			const actualKeys = Object.keys(message).sort();
			const expectedKeys = Object.prototype.hasOwnProperty.call(message, 'startupContext')
				? ['load', 'maxAssetBytes', 'runtimePreflight', 'startupContext']
				: ['load', 'maxAssetBytes', 'runtimePreflight'];
			if (
				load !== true ||
				actualKeys.length !== expectedKeys.length ||
				actualKeys.some((key, index) => key !== expectedKeys[index]) ||
				!Number.isSafeInteger(maxAssetBytes) ||
				maxAssetBytes <= 0
			) {
				throw new Error('Ruby runtime load message has an invalid shape.');
			}
			const context = decodeStartupContext(message.startupContext);
			postMessage({ progress: { percent: 5, stage: 'Loading Ruby runtime' } });
			await loadRubyModule(runtimePreflight, maxAssetBytes, context);
			postMessage({ progress: { percent: 100, stage: 'Ruby runtime ready' } });
			postMessage({ load: true });
			return;
		}

		stdinBufferRuby = new Int32Array(buffer);
		if (runtimeState !== 'ready' || !loadedRuntime) {
			throw new Error('Ruby runtime is not ready.');
		}
		runtimeState = 'running';
		ownsRuntimeState = true;
		const context: RubyExecutionContext = { args, workspaceFiles, activePath };
		if (preparedExecution && !sameContext(preparedExecution.context, context))
			preparedExecution = null;
		if (prepare) {
			if (!preparedExecution) {
				const candidate = await initializeRubyExecution(loadedRuntime, context, true);
				preparedExecution = candidate.stdin.wasReadBeforeActivation ? null : candidate;
			}
			postMessage({ results: true });
			return;
		}

		const initialStdin = typeof stdin === 'string' ? stdin : null;
		// Capture this run's buffer; no retained VM may read a previous caller's input.
		const inputBuffer = stdinBufferRuby;
		const requestInput = () => {
			const chunk = waitForBufferedStdin(inputBuffer!, () => postMessage({ buffer: true }));
			if (log)
				console.log(
					chunk == null
						? '[wasm-idle:ruby-stdin] read(bytes=0, eof=true)'
						: `[wasm-idle:ruby-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
				);
			return chunk;
		};
		// Claim before evaluation. A VM which has run user code is never cached.
		let execution = preparedExecution;
		preparedExecution = null;
		if (execution) execution.activate(initialStdin, requestInput);
		else
			execution = await initializeRubyExecution(
				loadedRuntime,
				context,
				false,
				initialStdin,
				requestInput
			);
		const { vm } = execution;
		if (log) {
			console.log(
				`[wasm-idle:ruby-worker] eval start bytes=${code.length} activePath=${activePath}`
			);
		}
		postMessage({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'Ruby program started'
			}
		});
		vm.eval(code);
		if (log) {
			console.log(
				`[wasm-idle:ruby-worker] eval settled stdout=${String(execution.hasOutput().stdout)} stderr=${String(execution.hasOutput().stderr)}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:ruby-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	} finally {
		if (ownsRuntimeState && runtimeState === 'running') runtimeState = 'ready';
	}
};
