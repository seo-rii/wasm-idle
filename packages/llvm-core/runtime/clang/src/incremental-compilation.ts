/**
 * Session-local object reuse. Clang remains the authority for preprocessing; no
 * JavaScript include scanner attempts to predict macro/conditional dependencies.
 * A preprocessing pass is intentionally paid even on a hit. Measure that tradeoff
 * with the actual browser compiler before enabling this experimental path by default.
 */
export interface IncrementalCompilationOptions {
	maxEntries?: number;
	maxBytes?: number;
	maxPreprocessedBytes?: number;
	maxDependencyBytes?: number;
}

export interface IncrementalCompilerHost<T> {
	signal?: AbortSignal;
	read(path: string): Uint8Array;
	write(path: string, bytes: Uint8Array): void;
	/** Capture diagnostics even when emit=false. Never mark a partial run cacheable. */
	execute(args: string[], emit: boolean): Promise<{
		value: T;
		diagnostics: string;
		cacheable: boolean;
	}>;
	replay(diagnostics: string): void;
}

const ROOT = '__wasm_idle_build/incremental';
const PREPROCESSED = `${ROOT}/current.ii`;
const DEPENDENCIES = `${ROOT}/current.d`;
const MAX_DEPFILE_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function positiveInteger(value: number | undefined, fallback: number, label: string) {
	const result = value ?? fallback;
	if (!Number.isSafeInteger(result) || result <= 0) {
		throw new TypeError(`${label} must be a positive safe integer`);
	}
	return result;
}

async function digest(bytes: Uint8Array): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
	return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Parse the single Make rule produced by -dependency-file/-MT; fail closed on ambiguity. */
export function parseClangDependencies(text: string): string[] | undefined {
	if (!text.startsWith('wasm_idle_cache:')) return undefined;
	const body = text.slice('wasm_idle_cache:'.length);
	const paths: string[] = [];
	let token = '';
	const finish = () => {
		if (token) paths.push(token);
		token = '';
	};
	for (let i = 0; i < body.length; i += 1) {
		const character = body[i];
		if (character === '\\') {
			const next = body[++i];
			if (next === undefined) return undefined;
			if (next === '\n') {
				finish();
				continue;
			}
			if (next === '\r' && body[i + 1] === '\n') {
				i += 1;
				finish();
				continue;
			}
			if (![' ', '\t', '#', '\\', ':'].includes(next)) return undefined;
			token += next;
		} else if (character === '$') {
			if (body[++i] !== '$') return undefined;
			token += '$';
		} else if (character === ':' || character === '#' || character === '\0') {
			return undefined;
		} else if (/\s/.test(character)) {
			finish();
		} else {
			token += character;
		}
	}
	finish();
	return paths.length ? [...new Set(paths)].sort() : undefined;
}

/** Restrict the opt-in cache to inspectable compile-only flags. Unknown flags compile normally. */
export function incrementalArgumentsEligible(args: readonly unknown[]): boolean {
	return args.every(
		(arg) =>
			typeof arg === 'string' &&
			(/^-O[0-3sz]$/.test(arg) ||
				/^-std=[a-zA-Z0-9+]+$/.test(arg) ||
				/^-[DU][A-Za-z_][^\r\n]*$/.test(arg) ||
				/^-I[^\r\n]+$/.test(arg) ||
				/^-W[a-zA-Z0-9=-]+$/.test(arg) ||
				['-w', '-pedantic', '-pedantic-errors', '-ffreestanding', '-fno-builtin',
					'-fexceptions', '-fno-exceptions', '-frtti', '-fno-rtti',
					'-funsigned-char', '-fsigned-char', '-fwrapv', '-fno-strict-aliasing'].includes(arg))
	);
}

interface Entry {
	bytes: Uint8Array;
	diagnostics: string;
	cost: number;
}

export class IncrementalCompilationCache {
	private readonly entries = new Map<string, Entry>();
	private readonly maxEntries: number;
	private readonly maxBytes: number;
	private readonly maxPreprocessedBytes: number;
	private readonly maxDependencyBytes: number;
	private bytes = 0;
	private active = false;
	private generation = 0;
	private counters = { hits: 0, misses: 0, bypasses: 0, preprocesses: 0 };

	constructor(options: IncrementalCompilationOptions = {}) {
		this.maxEntries = positiveInteger(options.maxEntries, 16, 'maxEntries');
		this.maxBytes = positiveInteger(options.maxBytes, 32 * 1024 * 1024, 'maxBytes');
		this.maxPreprocessedBytes = positiveInteger(options.maxPreprocessedBytes, 16 * 1024 * 1024, 'maxPreprocessedBytes');
		this.maxDependencyBytes = positiveInteger(options.maxDependencyBytes, 64 * 1024 * 1024, 'maxDependencyBytes');
	}

	get stats() {
		return { ...this.counters, entries: this.entries.size, accountedBytes: this.bytes };
	}

	clear() {
		this.generation += 1;
		this.entries.clear();
		this.bytes = 0;
	}

	async compile<T>(
		host: IncrementalCompilerHost<T>,
		args: readonly string[],
		input: string,
		object: string,
		compilerIdentity: string
	): Promise<T> {
		if (this.active) throw new Error('Concurrent incremental compilations are unsupported');
		this.active = true;
		try {
			host.signal?.throwIfAborted();
			return await this.compileExclusive(host, args, input, object, compilerIdentity);
		} finally {
			// These paths are reserved scratch files, not user files. Do not retain their contents.
			try { host.write(PREPROCESSED, new Uint8Array()); } catch { /* Best-effort cleanup. */ }
			try { host.write(DEPENDENCIES, new Uint8Array()); } catch { /* Best-effort cleanup. */ }
			this.active = false;
		}
	}

	private async compileExclusive<T>(host: IncrementalCompilerHost<T>, args: readonly string[], input: string, object: string, compilerIdentity: string): Promise<T> {
		const generation = this.generation;
		const normal = async () => (await host.execute([...args], true)).value;
		const actionIndex = args.indexOf('-emit-obj');
		const outputIndex = args.indexOf('-o');
		if (actionIndex < 0 || outputIndex < 0 || args[outputIndex + 1] !== object ||
			args.includes('-include-pch') || !args.includes(input)) {
			this.counters.bypasses += 1;
			return normal();
		}
		let key: string;
		try {
			const preprocess = [...args];
			preprocess[actionIndex] = '-E';
			preprocess[outputIndex + 1] = PREPROCESSED;
			// Full system dependencies and original comments protect diagnostics as well as code.
			// Volatile time macros make a second frontend invocation unsafe: bypass, don't freeze them.
			preprocess.push('-C', '-dependency-file', DEPENDENCIES, '-MT', 'wasm_idle_cache', '-sys-header-deps', '-Werror=date-time');
			host.write(PREPROCESSED, new Uint8Array());
			host.write(DEPENDENCIES, new Uint8Array());
			this.counters.preprocesses += 1;
			const result = await host.execute(preprocess, false);
			if (!result.cacheable) throw new Error('Preprocessing was not a complete successful run');
			const preprocessed = host.read(PREPROCESSED);
			if (preprocessed.byteLength > this.maxPreprocessedBytes) throw new Error('Preprocessed input exceeds cache budget');
			const preprocessedHash = await digest(preprocessed);
			const depfile = host.read(DEPENDENCIES);
			if (depfile.byteLength > MAX_DEPFILE_BYTES) throw new Error('Dependency file exceeds cache budget');
			const paths = parseClangDependencies(decoder.decode(depfile));
			if (!paths) throw new Error('Cannot safely parse compiler dependencies');
			let dependencyBytes = 0;
			const dependencies: Array<[string, string]> = [];
			// Also fingerprint the explicit main source even if a compiler omits it from a depfile.
			for (const path of [...new Set([input, ...paths])].sort()) {
				host.signal?.throwIfAborted();
				const contents = host.read(path);
				dependencyBytes += contents.byteLength;
				if (dependencyBytes > this.maxDependencyBytes) throw new Error('Dependencies exceed cache budget');
				// Time macros and diagnostic overrides defeat deterministic two-pass compilation.
				const text = decoder.decode(contents);
				if (/\b__(?:DATE|TIME|TIMESTAMP)__\b|date-time/.test(text)) {
					throw new Error('Time-dependent preprocessing is not cacheable');
				}
				dependencies.push([path, await digest(contents)]);
			}
			const normalizedArgs = [...args];
			normalizedArgs[outputIndex + 1] = '<object-output>';
			key = await digest(encoder.encode(JSON.stringify({
				format: 'clang-object-v1', compilerIdentity, args: normalizedArgs, input,
				preprocessedHash, dependencies, preprocessingDiagnostics: result.diagnostics
			})));
		} catch {
			host.signal?.throwIfAborted();
			this.counters.bypasses += 1;
			return normal();
		}
		host.signal?.throwIfAborted();
		const previous = this.entries.get(key);
		if (previous) {
			this.entries.delete(key);
			this.entries.set(key, previous);
			host.write(object, Uint8Array.from(previous.bytes));
			host.replay(previous.diagnostics);
			this.counters.hits += 1;
			// Compiler invocations in the browser return null only after successful completion.
			return null as T;
		}
		this.counters.misses += 1;
		const result = await host.execute([...args], true);
		host.signal?.throwIfAborted();
		if (result.cacheable && result.value === null && generation === this.generation) {
			const bytes = host.read(object);
			const cost = bytes.byteLength + 2 * result.diagnostics.length + 2 * key.length;
			if (bytes.byteLength >= 8 && bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109 && cost <= this.maxBytes) {
				while (this.entries.size >= this.maxEntries || this.bytes + cost > this.maxBytes) {
					const oldestKey = this.entries.keys().next().value;
					if (oldestKey === undefined) break;
					this.bytes -= this.entries.get(oldestKey)!.cost;
					this.entries.delete(oldestKey);
				}
				this.entries.set(key, { bytes: Uint8Array.from(bytes), diagnostics: result.diagnostics, cost });
				this.bytes += cost;
			}
		}
		return result.value;
	}
}
