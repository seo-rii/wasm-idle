import { Fd, Inode, PreopenDirectory, WASI, wasi } from '@bjorn3/browser_wasi_shim';

import { resolveVersionedAssetUrl } from './asset-url.js';
import { BufferedExecutionInput, toStandaloneBytes } from './browser-stdin.js';
import {
	createPreview2ImportObject,
	transpilePreview2Component
} from './browser-component-tools.js';
import type { BrowserRustCompilerResult, RuntimeAssetDeliveryBudgetDescriptor } from './types.js';

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
	assetDeliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor;
}

// Cache only immutable engine code. Every invocation still owns fresh WASI state and instances.
// The byte cap describes input size, not the engine's opaque native-code allocation.
const executionModules = new Map<string, { bytes: number; module: Promise<WebAssembly.Module> }>();
const MAX_EXECUTION_MODULES = 4;
const MAX_EXECUTION_MODULE_BYTES = 32 * 1024 * 1024;
type TranspiledComponent = Awaited<ReturnType<typeof transpilePreview2Component>>;
const executionComponents = new Map<
	string,
	{ bytes: number; result: Promise<TranspiledComponent> }
>();
const MAX_EXECUTION_COMPONENT_BYTES = 32 * 1024 * 1024;
let executionCacheGeneration = 0;

export function clearBrowserRustExecutionCache() {
	executionCacheGeneration += 1;
	executionModules.clear();
	executionComponents.clear();
}

async function executionContentHash(bytes: Uint8Array<ArrayBuffer>) {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
	return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function compileExecutionModule(
	bytes: Uint8Array<ArrayBuffer>,
	generation = executionCacheGeneration
): Promise<WebAssembly.Module> {
	if (
		!globalThis.crypto?.subtle ||
		bytes.byteLength > MAX_EXECUTION_MODULE_BYTES ||
		generation !== executionCacheGeneration
	) {
		return WebAssembly.compile(bytes);
	}
	// bytes is an owned snapshot: mutable caller buffers cannot change the hash/compile identity.
	const key = await executionContentHash(bytes);
	if (generation !== executionCacheGeneration) return WebAssembly.compile(bytes);
	let entry = executionModules.get(key);
	if (entry) {
		executionModules.delete(key);
	} else {
		entry = { bytes: bytes.byteLength, module: WebAssembly.compile(bytes) };
		const operation = entry;
		void entry.module.catch(() => {
			if (executionModules.get(key) === operation) executionModules.delete(key);
		});
	}
	executionModules.set(key, entry);
	let retainedBytes = [...executionModules.values()].reduce((sum, value) => sum + value.bytes, 0);
	while (
		executionModules.size > MAX_EXECUTION_MODULES ||
		retainedBytes > MAX_EXECUTION_MODULE_BYTES
	) {
		const oldest = executionModules.keys().next().value!;
		retainedBytes -= executionModules.get(oldest)!.bytes;
		executionModules.delete(oldest);
	}
	return entry.module;
}

function trimExecutionComponents() {
	let retainedBytes = [...executionComponents.values()].reduce(
		(sum, entry) => sum + entry.bytes,
		0
	);
	while (executionComponents.size > 2 || retainedBytes > MAX_EXECUTION_COMPONENT_BYTES) {
		const oldest = executionComponents.keys().next().value!;
		retainedBytes -= executionComponents.get(oldest)!.bytes;
		executionComponents.delete(oldest);
	}
}

async function transpileExecutionComponent(
	bytes: Uint8Array<ArrayBuffer>,
	runtimeBaseUrl: string,
	deliveryBudget?: RuntimeAssetDeliveryBudgetDescriptor
) {
	const transpile = () =>
		transpilePreview2Component(bytes, runtimeBaseUrl, 'wasm-rust-component', deliveryBudget);
	if (!globalThis.crypto?.subtle || bytes.byteLength > MAX_EXECUTION_COMPONENT_BYTES)
		return transpile();
	const generation = executionCacheGeneration;
	const key = `${runtimeBaseUrl}\0${await executionContentHash(bytes)}`;
	if (generation !== executionCacheGeneration) return transpile();
	let entry = executionComponents.get(key);
	if (entry) {
		executionComponents.delete(key);
	} else {
		entry = { bytes: bytes.byteLength, result: transpile() };
		const operation = entry;
		void entry.result.then(
			(result) => {
				if (executionComponents.get(key) !== operation) return;
				// Include both the source snapshot and generated JS/core Wasm in the byte bound.
				operation.bytes += [...result.files.values()].reduce(
					(sum, file) => sum + file.byteLength,
					0
				);
				trimExecutionComponents();
			},
			() => {
				if (executionComponents.get(key) === operation) executionComponents.delete(key);
			}
		);
	}
	executionComponents.set(key, entry);
	trimExecutionComponents();
	return entry.result;
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
		[new StdinFd(stdin), stdout, stderr, new PreopenDirectory('/tmp', new Map())]
	);
	const module = await compileExecutionModule(bytes);
	const instance = await WebAssembly.instantiate(module, {
		wasi_snapshot_preview1: wasiInstance.wasiImport
	});
	const exitCode = wasiInstance.start(
		instance as unknown as {
			exports: {
				memory: WebAssembly.Memory;
				_start: () => unknown;
			};
		}
	);
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
	const generation = executionCacheGeneration;
	const bytes = toStandaloneBytes(componentBytes);
	const stdin = new BufferedExecutionInput(options.stdin);
	const stdout = new CaptureFd(options.stdout);
	const stderr = new CaptureFd(options.stderr);
	const transpiled = await transpileExecutionComponent(
		bytes,
		runtimeBaseUrl,
		options.assetDeliveryBudget
	);
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
		const componentModule = (await import(/* @vite-ignore */ entryUrl)) as {
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
			return compileExecutionModule(new Uint8Array(moduleBytes), generation);
		}, imports);
		const runExport =
			instantiated.run ||
			instantiated['wasi:cli/run@0.2.3'] ||
			Object.values(instantiated).find(
				(value) => value && typeof value === 'object' && typeof value.run === 'function'
			);
		if (!runExport || typeof runExport.run !== 'function') {
			throw new Error(
				'transpiled preview2 component is missing a runnable wasi:cli/run export'
			);
		}
		let exitCode = 0;
		try {
			await runExport.run();
		} catch (error) {
			if (error && typeof error === 'object' && 'exitError' in error && 'code' in error) {
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
