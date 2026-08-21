import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';
import {
	loadVerifiedRubyRuntimeAssets,
	snapshotRubyRuntimeAssetConfig,
	type RubyRuntimeAssetConfig
} from '$lib/playground/rubyAssets';

declare var self: any;

const encoder = new TextEncoder();

let stdinBufferRuby: Int32Array | null = null;
let runtimeConfig: RubyRuntimeAssetConfig | null = null;
let loadedRuntimeIdentity = '';
let runtimePromise: Promise<LoadedRubyRuntime> | null = null;

interface RubyRuntimeModule {
	RubyVM: any;
	consolePrinter(options: Record<string, (output: string) => void>): any;
	rubyStdlibWasmUrl: string;
	wasiShim: any;
}

interface LoadedRubyRuntime {
	module: WebAssembly.Module;
	runtime: RubyRuntimeModule;
}

const runtimeIdentity = (config: RubyRuntimeAssetConfig) =>
	JSON.stringify([
		config.moduleUrl,
		config.wasmUrl,
		Object.entries(config.integrity).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0
		)
	]);

async function loadRubyModule(config: RubyRuntimeAssetConfig) {
	const snapshot = snapshotRubyRuntimeAssetConfig(config);
	const identity = runtimeIdentity(snapshot);
	if (loadedRuntimeIdentity === identity && runtimePromise) return await runtimePromise;
	const pending = (async (): Promise<LoadedRubyRuntime> => {
		const { moduleSource, wasmBytes } = await loadVerifiedRubyRuntimeAssets(snapshot);
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
		if (!runtime.RubyVM || !runtime.consolePrinter || !runtime.wasiShim) {
			throw new Error('Ruby runtime module is missing required Ruby or WASI exports.');
		}
		return { module, runtime };
	})();
	loadedRuntimeIdentity = identity;
	runtimePromise = pending;
	try {
		return await pending;
	} catch (error) {
		if (runtimePromise === pending && loadedRuntimeIdentity === identity) {
			runtimePromise = null;
			loadedRuntimeIdentity = '';
		}
		throw error;
	}
}

function createRubyStdin(
	runtime: RubyRuntimeModule,
	initialStdin: string | null,
	requestInput: () => string | null
) {
	const { Fd, Inode, wasi } = runtime.wasiShim;
	return new (class extends Fd {
		private readonly ino = Inode.issue_ino();
		private currentStdin = initialStdin;
		private pendingBytes: Uint8Array | null = null;
		private readonly fixedInitialStdin = initialStdin != null;

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

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl,
		wasmUrl,
		integrity,
		maxAssetBytes,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.rb',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			runtimeConfig = snapshotRubyRuntimeAssetConfig({
				moduleUrl,
				wasmUrl,
				integrity,
				maxAssetBytes
			});
			postMessage({ progress: { percent: 5, stage: 'Loading Ruby runtime' } });
			await loadRubyModule(runtimeConfig);
			if (log) {
				console.log(`[wasm-idle:ruby-worker] load moduleUrl=${runtimeConfig.moduleUrl}`);
			}
			postMessage({ progress: { percent: 100, stage: 'Ruby runtime ready' } });
			postMessage({ load: true });
			return;
		}

		stdinBufferRuby = new Int32Array(buffer);
		if (!runtimeConfig) throw new Error('Ruby runtime has not been loaded.');
		const { module: rubyModule, runtime } = await loadRubyModule(runtimeConfig);

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		let stdout = '';
		let stderr = '';
		const printer = runtime.consolePrinter({
			stdout(output: string) {
				stdout += output;
				if (output) postMessage({ output });
			},
			stderr(output: string) {
				stderr += output;
				if (output) postMessage({ output });
			}
		});
		const hasInitialStdin = typeof stdin === 'string';
		const rubyStdin = createRubyStdin(runtime, hasInitialStdin ? stdin : null, () => {
			const chunk = waitForBufferedStdin(stdinBufferRuby!, () =>
				postMessage({ buffer: true })
			);
			if (log) {
				console.log(
					chunk == null
						? '[wasm-idle:ruby-stdin] read(bytes=0, eof=true)'
						: `[wasm-idle:ruby-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
				);
			}
			return chunk;
		});
		const { File, OpenFile, PreopenDirectory, WASI } = runtime.wasiShim;
		const fds = [
			rubyStdin,
			new OpenFile(new File([])),
			new OpenFile(new File([])),
			new PreopenDirectory('/', workspaceContents(runtime, workspaceFiles))
		];
		const wasiInstance = new WASI(['ruby.wasm', ...args], ['USER=jungol'], fds, {
			debug: false
		});
		const { vm } = await runtime.RubyVM.instantiateModule({
			module: rubyModule,
			wasip1: wasiInstance,
			args: ['ruby.wasm', '-EUTF-8', '-e_=0', ...args],
			addToImports(imports: WebAssembly.Imports) {
				printer.addToImports(imports);
			},
			setMemory(memory: WebAssembly.Memory) {
				printer.setMemory(memory);
			}
		});
		if (log) {
			console.log(
				`[wasm-idle:ruby-worker] eval start bytes=${code.length} activePath=${activePath}`
			);
		}
		vm.eval(code);
		if (log) {
			console.log(
				`[wasm-idle:ruby-worker] eval settled stdout=${String(Boolean(stdout))} stderr=${String(Boolean(stderr))}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:ruby-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
