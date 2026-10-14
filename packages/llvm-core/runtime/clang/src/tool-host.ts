import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';

export type LlvmToolExecutable = 'clang' | 'wasm-ld';
export type LlvmToolHostErrorCode =
	| 'INVALID_ARGUMENT' | 'INTEGRITY' | 'COMPILE_FAILED' | 'STARTUP_FAILED'
	| 'RUNTIME_ERROR' | 'DISPOSED' | 'BUSY';

export class LlvmToolHostError extends Error {
	override readonly name = 'LlvmToolHostError';
	constructor(readonly code: LlvmToolHostErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
	}
}

export interface LlvmToolIdentity {
	readonly executable: LlvmToolExecutable;
	readonly sha256: string;
	readonly bytes: number;
}
export interface LlvmToolInvocation {
	readonly executable: LlvmToolExecutable;
	/** Complete native argv, including argv[0]; this is never a shell string. */
	readonly argv: readonly string[];
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
}
export interface LlvmToolBindingContext extends LlvmToolInvocation {
	readonly identity: LlvmToolIdentity;
	/** Top-level invocation is depth 1. */
	readonly depth: number;
}
export interface LlvmToolBindings {
	readonly imports: WebAssembly.Imports;
	run(instance: WebAssembly.Instance): { readonly code: number };
	dispose(): void;
}
export interface CreateLlvmToolHostOptions {
	readonly tools: Readonly<Record<LlvmToolExecutable, { readonly bytes: Uint8Array; readonly sha256: string }>>;
	/** The closure owns common filesystem/fd bindings. No dependency on container is needed. */
	readonly createBindings: (context: LlvmToolBindingContext) => LlvmToolBindings;
	/** Additional exact filesystem names for the same pinned linker, chosen by trusted host code. */
	readonly linkerPaths?: readonly string[];
	/** Opt in to the pinned multicall producer's ['', 'clang', '-cc1'/'-cc1as', ...] child jobs. */
	readonly allowClangCc1?: boolean;
	/** Optional host profile admission before any instance can execute. */
	readonly validateModule?: (executable: LlvmToolExecutable, module: WebAssembly.Module) => void;
}
export interface LlvmToolInvocationProvenance {
	readonly identity: LlvmToolIdentity;
	readonly depth: number;
	readonly code: number | null;
	readonly reason: 'exited' | 'startup-failure' | 'runtime-error';
}
export interface LlvmToolResult {
	readonly code: number;
	readonly provenance: Readonly<{
		root: LlvmToolIdentity;
		/** Completion order, including child startup/runtime failures. Contains no argv/env. */
		invocations: readonly LlvmToolInvocationProvenance[];
	}>;
}
export interface LlvmToolHost {
	readonly identities: Readonly<Record<LlvmToolExecutable, LlvmToolIdentity>>;
	run(invocation: LlvmToolInvocation): LlvmToolResult;
	/** Releases compiled-module references. CPU-loop cancellation belongs to the owning Worker. */
	dispose(): void;
}

const tools = ['clang', 'wasm-ld'] as const;
const MAX_ENTRIES = 4096;
const MAX_TEXT_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const linkers = new Set(['wasm-ld', 'ld.lld', '/usr/bin/wasm-ld', '/usr/bin/ld.lld']);

function invalid(message: string): never {
	throw new LlvmToolHostError('INVALID_ARGUMENT', message);
}
function safeText(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.includes('\0') || value.length > MAX_TEXT_BYTES) invalid(`${label} must be bounded text without NUL`);
	const bytes = encoder.encode(value);
	if (bytes.length > MAX_TEXT_BYTES || decoder.decode(bytes) !== value) invalid(`${label} must be valid UTF-8 text`);
	return value;
}
function snapshotInvocation(value: LlvmToolInvocation, allowEmptyArgv0 = false): LlvmToolInvocation {
	if (!value || !tools.includes(value.executable)) invalid('Unknown pinned LLVM executable');
	if (!Array.isArray(value.argv) || value.argv.length < 1 || value.argv.length > MAX_ENTRIES) invalid('argv must contain 1..4096 arguments');
	const argv = Object.freeze(value.argv.map((arg) => safeText(arg, 'argv')));
	if (!argv[0] && !allowEmptyArgv0) invalid('argv[0] must not be empty');
	const cwd = safeText(value.cwd, 'cwd');
	if (!cwd.startsWith('/') || encoder.encode(cwd).length > 4096) invalid('cwd must be a bounded absolute POSIX path');
	if (!value.env || typeof value.env !== 'object' || Array.isArray(value.env)) invalid('env must be a record');
	const entries = Object.entries(value.env);
	if (entries.length > MAX_ENTRIES) invalid('env exceeds 4096 entries');
	const env: Record<string, string> = Object.create(null);
	let textBytes = encoder.encode(cwd).length + argv.reduce((sum, arg) => sum + encoder.encode(arg).length, 0);
	for (const [name, raw] of entries) {
		const key = safeText(name, 'env name'), entry = safeText(raw, 'env value');
		if (!key || key.includes('=')) invalid('Environment names must be nonempty and exclude =');
		textBytes += encoder.encode(key).length + 1 + encoder.encode(entry).length;
		if (textBytes > MAX_TEXT_BYTES) invalid('Invocation text exceeds one MiB');
		env[key] = entry;
	}
	if (textBytes > MAX_TEXT_BYTES) invalid('Invocation text exceeds one MiB');
	return Object.freeze({ executable: value.executable, argv, cwd, env: Object.freeze(env) });
}
const isPromise = (value: unknown): boolean => Boolean(value && (typeof value === 'object' || typeof value === 'function') && typeof (value as { then?: unknown }).then === 'function');

/** Prepare trusted bytes once; execution and child exec imports remain synchronous. */
export async function createLlvmToolHost(options: CreateLlvmToolHostOptions): Promise<LlvmToolHost> {
	if (!options || typeof options.createBindings !== 'function') invalid('A synchronous bindings factory is required');
	const createBindings = options.createBindings;
	const validateModule = options.validateModule;
	if (options.allowClangCc1 !== undefined && typeof options.allowClangCc1 !== 'boolean') invalid('allowClangCc1 must be boolean');
	const allowClangCc1 = options.allowClangCc1 === true;
	if (validateModule !== undefined && typeof validateModule !== 'function') invalid('validateModule must be a synchronous function');
	if (options.linkerPaths !== undefined && (!Array.isArray(options.linkerPaths) || options.linkerPaths.length > 16)) invalid('Too many linker paths');
	const allowedLinkers = new Set(linkers);
	for (const path of options.linkerPaths ?? []) {
		if (typeof path !== 'string' || !path.startsWith('/') || path.includes('\0') || path.includes('\\') || path.slice(1).split('/').some((part) => !part || part === '.' || part === '..') || encoder.encode(path).length > 4096) invalid('Linker paths must be canonical absolute filesystem paths');
		allowedLinkers.add(path);
	}
	// Copy every input before the first digest await, so caller mutation cannot replace a pin.
	const pinned = tools.map((executable) => {
		const tool = options.tools?.[executable];
		if (!tool || !(tool.bytes instanceof Uint8Array) || !/^[a-f0-9]{64}$/u.test(tool.sha256)) invalid(`Invalid pinned tool ${executable}`);
		return { executable, bytes: Uint8Array.from(tool.bytes), sha256: tool.sha256 };
	});
	for (const tool of pinned) {
		try { await verifyRuntimeAssetIntegrity({ asset: tool.executable, bytes: tool.bytes, expected: tool.sha256 }); }
		catch (cause) { throw new LlvmToolHostError('INTEGRITY', `Pinned ${tool.executable} failed integrity verification`, { cause }); }
	}
	const modules = new Map<LlvmToolExecutable, WebAssembly.Module>();
	for (const tool of pinned) {
		try {
			const module = await WebAssembly.compile(tool.bytes);
			if (isPromise(validateModule?.(tool.executable, module))) invalid('Module validation must be synchronous');
			modules.set(tool.executable, module);
		}
		catch (cause) { throw new LlvmToolHostError('COMPILE_FAILED', `Pinned ${tool.executable} is not a supported Wasm module`, { cause }); }
	}
	const identities = Object.freeze(Object.fromEntries(pinned.map((tool) => [tool.executable,
		Object.freeze({ executable: tool.executable, sha256: tool.sha256, bytes: tool.bytes.length })
	])) as Record<LlvmToolExecutable, LlvmToolIdentity>);
	let disposed = false, running = false;

	const execute = (invocation: LlvmToolInvocation, depth: number, trace: LlvmToolInvocationProvenance[]): number => {
		const identity = identities[invocation.executable];
		const context = Object.freeze({ ...invocation, identity, depth });
		let bindings: LlvmToolBindings | undefined;
		let instance: WebAssembly.Instance | undefined;
		let started = false;
		let code: number | null = null;
		let failure: unknown;
		let failed = false;
		try {
			bindings = createBindings(context);
			if (!bindings || isPromise(bindings) || typeof bindings.run !== 'function' || typeof bindings.dispose !== 'function' || !bindings.imports || typeof bindings.imports !== 'object') {
				throw new LlvmToolHostError('STARTUP_FAILED', 'Bindings must provide synchronous imports, run and dispose');
			}
			if (Object.hasOwn(bindings.imports, 'wasm_idle_tool_host')) throw new LlvmToolHostError('STARTUP_FAILED', 'The tool host owns wasm_idle_tool_host imports');
			const exec = (programPtr: number, programLen: number, argvPtr: number, argc: number, envPtr: number, envc: number, flags: number): number => {
				try {
					if (!instance || invocation.executable !== 'clang' || depth !== 1 || disposed) return -1;
					const memory = instance.exports.memory;
					if (!(memory instanceof WebAssembly.Memory)) return -1;
					const u32 = (value: number) => {
						if (!Number.isInteger(value) || value < -2147483648 || value > 0xffffffff) invalid('Invalid exec_v1 integer');
						return value >>> 0;
					};
					let textBytes = 0;
					const span = (pointer: number, length: number) => {
						const offset = u32(pointer), bytes = u32(length), buffer = memory.buffer;
						if (offset + bytes > buffer.byteLength) invalid('exec_v1 memory range is outside the caller');
						return new Uint8Array(buffer, offset, bytes);
					};
					const text = (pointer: number, length: number) => {
						textBytes += u32(length);
						if (textBytes > MAX_TEXT_BYTES) invalid('exec_v1 text exceeds one MiB');
						const value = decoder.decode(span(pointer, length));
						if (value.includes('\0')) invalid('exec_v1 text includes NUL');
						return value;
					};
					const table = (pointer: number, count: number) => {
						const n = u32(count);
						if (n > MAX_ENTRIES) invalid('exec_v1 table exceeds 4096 entries');
						const bytes = span(pointer, n * 8);
						const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
						return Array.from({ length: n }, (_, i) => text(view.getUint32(i * 8, true), view.getUint32(i * 8 + 4, true)));
					};
					if (flags !== 0 && flags !== 1) return -1;
					const program = text(programPtr, programLen);
					const argv = table(argvPtr, argc);
					// The qualified fixture resolves no main-executable path. Its
					// multicall driver requests these exact self jobs when it has more
					// than one action. Preserve argv, including its empty first entry.
					const compilerChild = allowClangCc1 && program === '' && argv[0] === '' && argv[1] === 'clang' && (argv[2] === '-cc1' || argv[2] === '-cc1as');
					if (!compilerChild && !allowedLinkers.has(program)) return -1;
					let env: Readonly<Record<string, string>>;
					if (flags === 1) {
						u32(envPtr); // An empty SmallVector may still have a non-null data pointer.
						if (u32(envc) !== 0) return -1;
						env = invocation.env;
					} else {
						const explicit: Record<string, string> = Object.create(null);
						for (const entry of table(envPtr, envc)) {
							const separator = entry.indexOf('=');
							if (separator < 1) return -1;
							const name = entry.slice(0, separator);
							if (Object.hasOwn(explicit, name)) return -1;
							explicit[name] = entry.slice(separator + 1);
						}
						env = explicit;
					}
					const child = snapshotInvocation({ executable: compilerChild ? 'clang' : 'wasm-ld', argv, cwd: invocation.cwd, env }, compilerChild);
					try { return execute(child, depth + 1, trace); }
					catch (error) { return error instanceof LlvmToolHostError && error.code === 'STARTUP_FAILED' ? -1 : -2; }
				} catch { return -1; }
			};
			instance = new WebAssembly.Instance(modules.get(invocation.executable)!, {
				...bindings.imports, wasm_idle_tool_host: { exec_v1: exec }
			});
			started = true;
			const result = bindings.run(instance);
			if (!result || isPromise(result) || !Number.isSafeInteger(result.code) || result.code < 0 || result.code > 0x7fffffff) {
				throw new LlvmToolHostError('RUNTIME_ERROR', 'Tool result must contain a synchronous nonnegative int32 exit code');
			}
			code = result.code;
		} catch (cause) {
			failed = true;
			const phase = started ? 'RUNTIME_ERROR' : 'STARTUP_FAILED';
			failure = cause instanceof LlvmToolHostError && cause.code === phase ? cause : new LlvmToolHostError(phase, `Cannot ${started ? 'run' : 'start'} pinned ${invocation.executable}`, { cause });
		} finally {
			if (bindings && typeof bindings.dispose === 'function') {
				try {
					const result = bindings.dispose();
					if (isPromise(result)) throw new Error('Bindings disposal must be synchronous');
				} catch (cause) {
					failed = true;
					failure = new LlvmToolHostError('RUNTIME_ERROR', `Cannot dispose pinned ${invocation.executable} bindings`, { cause });
				}
			}
			trace.push(Object.freeze({ identity, depth, code: failed ? null : code,
				reason: failed ? (failure instanceof LlvmToolHostError && failure.code === 'STARTUP_FAILED' ? 'startup-failure' : 'runtime-error') : 'exited' }));
		}
		if (failed) throw failure;
		return code!;
	};
	return Object.freeze({
		identities,
		run(value: LlvmToolInvocation) {
			if (disposed) throw new LlvmToolHostError('DISPOSED', 'LLVM tool host has been disposed');
			if (running) throw new LlvmToolHostError('BUSY', 'Public run() is not reentrant');
			const invocation = snapshotInvocation(value);
			const trace: LlvmToolInvocationProvenance[] = [];
			running = true;
			try {
				const code = execute(invocation, 1, trace);
				return Object.freeze({ code, provenance: Object.freeze({ root: identities[invocation.executable], invocations: Object.freeze(trace) }) });
			} finally { running = false; }
		},
		dispose() {
			if (running) throw new LlvmToolHostError('BUSY', 'Dispose the owning Worker to stop an active synchronous tool');
			disposed = true; modules.clear();
		}
	});
}
