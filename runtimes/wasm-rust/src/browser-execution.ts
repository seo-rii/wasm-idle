import { Fd, Inode } from '@bjorn3/browser_wasi_shim/dist/fd.js';
import { PreopenDirectory } from '@bjorn3/browser_wasi_shim/dist/fs_mem.js';
import WASI from '@bjorn3/browser_wasi_shim/dist/wasi.js';
import * as wasi from '@bjorn3/browser_wasi_shim/dist/wasi_defs.js';

import { resolveVersionedAssetUrl } from './asset-url.js';
import { BufferedExecutionInput, toStandaloneBytes } from './browser-stdin.js';
import {
	createPreview2ImportObject,
	transpilePreview2Component
} from './browser-component-tools.js';
import type { BrowserRustCompilerResult } from './types.js';

export interface BrowserExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface BrowserExecutionOptions {
	args?: string[];
	env?: Record<string, string>;
	stdin?: () => string | Uint8Array | ArrayBuffer | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
}

class CaptureFd extends Fd {
	ino = Inode.issue_ino();
	private readonly decoder = new TextDecoder();
	private readonly chunks: string[] = [];
	private readonly output: ((chunk: string) => void) | undefined;

	constructor(output?: (chunk: string) => void) {
		super();
		this.output = output;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_WRITE);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_write(data: Uint8Array) {
		const chunk = this.decoder.decode(data, { stream: true });
		this.chunks.push(chunk);
		this.output?.(chunk);
		return {
			ret: wasi.ERRNO_SUCCESS,
			nwritten: data.byteLength
		};
	}

	append(data: Uint8Array) {
		const chunk = this.decoder.decode(data, { stream: true });
		this.chunks.push(chunk);
		this.output?.(chunk);
	}

	getText() {
		const trailing = this.decoder.decode();
		if (trailing) {
			this.chunks.push(trailing);
			this.output?.(trailing);
		}
		return this.chunks.join('');
	}
}

class StdinFd extends Fd {
	ino = Inode.issue_ino();
	private readonly source: BufferedExecutionInput;

	constructor(source: BufferedExecutionInput) {
		super();
		this.source = source;
	}

	fd_filestat_get() {
		return {
			ret: wasi.ERRNO_SUCCESS,
			filestat: new wasi.Filestat(this.ino, wasi.FILETYPE_CHARACTER_DEVICE, 0n)
		};
	}

	fd_fdstat_get() {
		const fdstat = new wasi.Fdstat(wasi.FILETYPE_CHARACTER_DEVICE, 0);
		fdstat.fs_rights_base = BigInt(wasi.RIGHTS_FD_READ);
		return {
			ret: wasi.ERRNO_SUCCESS,
			fdstat
		};
	}

	fd_read(size: number) {
		return {
			ret: wasi.ERRNO_SUCCESS,
			data: this.source.read(size)
		};
	}
}

async function runPreview1WasiModule(
	wasmArtifact: Uint8Array | ArrayBuffer,
	options: BrowserExecutionOptions = {}
) {
	const bytes = toStandaloneBytes(wasmArtifact);
	const stdin = new BufferedExecutionInput(options.stdin);
	const stdout = new CaptureFd(options.stdout);
	const stderr = new CaptureFd(options.stderr);
	const wasiInstance = new WASI(
		['main.wasm', ...(options.args || [])],
		Object.entries(options.env || {}).map(([key, value]) => `${key}=${value}`),
		[
			new StdinFd(stdin),
			stdout,
			stderr,
			new PreopenDirectory('/tmp', new Map())
		]
	);
	const module = await WebAssembly.compile(bytes);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	const exitCode = wasiInstance.start(instance as unknown as {
		exports: {
			memory: WebAssembly.Memory;
			_start: () => unknown;
		};
	});
	return {
		exitCode,
		stdout: stdout.getText(),
		stderr: stderr.getText()
	} satisfies BrowserExecutionResult;
}

async function runPreview2Component(
	componentBytes: Uint8Array | ArrayBuffer,
	runtimeBaseUrl: string,
	options: BrowserExecutionOptions = {}
) {
	const bytes = toStandaloneBytes(componentBytes);
	const stdin = new BufferedExecutionInput(options.stdin);
	const stdout = new CaptureFd(options.stdout);
	const stderr = new CaptureFd(options.stderr);
	const transpiled = await transpilePreview2Component(bytes, runtimeBaseUrl, 'wasm-rust-component');
	const entryName = Array.from(transpiled.files.keys()).find((name) => name.endsWith('.js'));
	if (!entryName) {
		throw new Error('jco transpile did not generate a JavaScript entry file');
	}
	const entryFile = transpiled.files.get(entryName);
	if (!entryFile) {
		throw new Error(`jco transpile produced a missing entry asset: ${entryName}`);
	}
	const entrySource = new TextDecoder().decode(entryFile);
	const entryUrl = URL.createObjectURL(
		new Blob([entrySource], { type: 'text/javascript;charset=utf-8' })
	);
	const imports = await createPreview2ImportObject(runtimeBaseUrl, {
		args: ['component.wasm', ...(options.args || [])],
		requiredImports: transpiled.imports,
		...(options.env ? { env: options.env } : {}),
		stdin: {
			blockingRead(length: number) {
				return stdin.read(length);
			}
		},
		stdout: (chunk) => stdout.append(chunk),
		stderr: (chunk) => stderr.append(chunk)
	});

	try {
		const componentModule = (await import(
			/* @vite-ignore */ entryUrl
		)) as {
			instantiate: (
				getCoreModule: (name: string) => Promise<WebAssembly.Module>,
				imports: Record<string, unknown>,
				instantiateCore?: typeof WebAssembly.instantiate
			) => Promise<Record<string, any>>;
		};
		const instantiated = await componentModule.instantiate(async (name) => {
			const normalizedName = name.replace(/^[./]+/, '');
			const moduleBytes = transpiled.files.get(normalizedName) || transpiled.files.get(name);
			if (!moduleBytes) {
				throw new Error(`missing transpiled preview2 core module ${name}`);
			}
			return WebAssembly.compile(new Uint8Array(moduleBytes));
		}, imports);
		const runExport =
			instantiated.run ||
			instantiated['wasi:cli/run@0.2.3'] ||
			Object.values(instantiated).find(
				(value) => value && typeof value === 'object' && typeof value.run === 'function'
			);
		if (!runExport || typeof runExport.run !== 'function') {
			throw new Error('transpiled preview2 component is missing a runnable wasi:cli/run export');
		}
		let exitCode = 0;
		try {
			await runExport.run();
		} catch (error) {
			if (
				error &&
				typeof error === 'object' &&
				'exitError' in error &&
				'code' in error
			) {
				exitCode = Number((error as { code: number }).code);
			} else {
				throw error;
			}
		}
		return {
			exitCode,
			stdout: stdout.getText(),
			stderr: stderr.getText()
		} satisfies BrowserExecutionResult;
	} finally {
		URL.revokeObjectURL(entryUrl);
	}
}

export function executeBrowserRustArtifact(
	artifact: NonNullable<BrowserRustCompilerResult['artifact']>,
	options?: BrowserExecutionOptions
): Promise<BrowserExecutionResult>;
export function executeBrowserRustArtifact(
	artifact: NonNullable<BrowserRustCompilerResult['artifact']>,
	runtimeBaseUrl: string,
	options?: BrowserExecutionOptions
): Promise<BrowserExecutionResult>;
export async function executeBrowserRustArtifact(
	artifact: NonNullable<BrowserRustCompilerResult['artifact']>,
	runtimeBaseUrlOrOptions: string | BrowserExecutionOptions = {},
	options: BrowserExecutionOptions = {}
) {
	if (!artifact.wasm) {
		throw new Error('wasm-rust artifact is missing wasm bytes');
	}
	const runtimeBaseUrl =
		typeof runtimeBaseUrlOrOptions === 'string'
			? runtimeBaseUrlOrOptions
			: resolveVersionedAssetUrl(import.meta.url, './runtime/').toString();
	const executionOptions =
		typeof runtimeBaseUrlOrOptions === 'string' ? options : runtimeBaseUrlOrOptions;
	if (artifact.format === 'component') {
		return runPreview2Component(artifact.wasm, runtimeBaseUrl, executionOptions);
	}
	return runPreview1WasiModule(artifact.wasm, executionOptions);
}
