import rubyStdlibWasmUrl from '@ruby/3.4-wasm-wasi/dist/ruby+stdlib.wasm?url';
import {
	Fd,
	Inode,
	OpenFile,
	File,
	Directory,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import { RubyVM, consolePrinter } from '@ruby/wasm-wasi';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';

declare var self: any;

const encoder = new TextEncoder();

let stdinBufferRuby: Int32Array | null = null;
let wasmUrl = '';
let loadedWasmUrl = '';
let modulePromise: Promise<WebAssembly.Module> | null = null;

class RubyStdin extends Fd {
	private readonly ino = Inode.issue_ino();
	private initialStdin: string | null;
	private pendingBytes: Uint8Array | null = null;
	private readonly fixedInitialStdin: boolean;

	constructor(
		initialStdin: string | null,
		private readonly requestInput: () => string | null
	) {
		super();
		this.initialStdin = initialStdin;
		this.fixedInitialStdin = initialStdin != null;
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
		let bytes = this.pendingBytes;
		if (!bytes?.length) {
			const chunk = this.readChunk();
			if (chunk == null) {
				return { ret: wasi.ERRNO_SUCCESS, data: new Uint8Array() };
			}
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
		if (this.initialStdin != null) {
			const chunk = this.initialStdin;
			this.initialStdin = null;
			return chunk;
		}
		if (this.fixedInitialStdin) return null;
		return this.requestInput();
	}
}

async function loadRubyModule(url: string) {
	const nextUrl = url || rubyStdlibWasmUrl;
	if (loadedWasmUrl === nextUrl && modulePromise) {
		return await modulePromise;
	}
	loadedWasmUrl = nextUrl;
	modulePromise = (async () => {
		const response = await fetch(nextUrl);
		if (!response.ok) {
			throw new Error(
				`Failed to load Ruby WASM asset: ${response.status} ${response.statusText}`
			);
		}
		return WebAssembly.compile(await response.arrayBuffer());
	})();
	return await modulePromise;
}

type WorkspaceTree = Map<string, File | WorkspaceTree>;

function insertWorkspaceFile(tree: WorkspaceTree, path: string, content: string) {
	const [head, ...rest] = path.split('/').filter(Boolean);
	if (!head) return;
	if (!rest.length) {
		tree.set(head, new File(encoder.encode(content), { readonly: true }));
		return;
	}
	const existing = tree.get(head);
	const child = existing instanceof Map ? existing : new Map<string, File | WorkspaceTree>();
	tree.set(head, child);
	insertWorkspaceFile(child, rest.join('/'), content);
}

function materializeWorkspaceTree(tree: WorkspaceTree): Map<string, any> {
	const contents = new Map<string, any>();
	for (const [name, entry] of tree) {
		contents.set(
			name,
			entry instanceof Map ? new Directory(materializeWorkspaceTree(entry)) : entry
		);
	}
	return contents;
}

function workspaceContents(workspaceFiles: SandboxWorkspaceFile[]) {
	const tree: WorkspaceTree = new Map();
	for (const file of workspaceFiles) {
		const normalizedPath = file.path.replace(/^\/+/, '');
		if (!normalizedPath || normalizedPath.includes('\0')) continue;
		insertWorkspaceFile(tree, normalizedPath, file.content);
	}
	return materializeWorkspaceTree(tree);
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		wasmUrl: nextWasmUrl,
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
			wasmUrl = nextWasmUrl || '';
			if (log) {
				console.log(`[wasm-idle:ruby-worker] load wasmUrl=${wasmUrl || rubyStdlibWasmUrl}`);
			}
			await loadRubyModule(wasmUrl);
			postMessage({ load: true });
			return;
		}

		stdinBufferRuby = new Int32Array(buffer);
		const rubyModule = await loadRubyModule(wasmUrl);

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		let stdout = '';
		let stderr = '';
		const printer = consolePrinter({
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
		const rubyStdin = new RubyStdin(hasInitialStdin ? stdin : null, () => {
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
		const fds = [
			rubyStdin,
			new OpenFile(new File([])),
			new OpenFile(new File([])),
			new PreopenDirectory('/', workspaceContents(workspaceFiles))
		];
		const wasiInstance = new WASI(['ruby.wasm', ...args], ['USER=jungol'], fds, {
			debug: false
		});
		const { vm } = await RubyVM.instantiateModule({
			module: rubyModule,
			wasip1: wasiInstance,
			args: ['ruby.wasm', '-EUTF-8', '-e_=0', ...args],
			addToImports(imports) {
				printer.addToImports(imports);
			},
			setMemory(memory) {
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
