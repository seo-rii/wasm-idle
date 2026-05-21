import {
	resolveScalaRuntimeAssetConfig,
	type PlaygroundRuntimeAssets,
	type ResolvedScalaRuntimeAssetConfig
} from '$lib/playground/assets';
import {
	resolveSandboxExecutionArgs,
	type CompilerDiagnostic,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox, SandboxProgress } from '$lib/playground/sandbox';

type CheerpJGlobal = typeof globalThis & {
	cheerpjInit?: (options?: Record<string, unknown>) => Promise<void>;
	cheerpjRunMain?: (className: string, classPath: string, ...args: string[]) => Promise<number>;
	cheerpOSAddStringFile?: (path: string, content: string | Uint8Array) => Promise<void>;
	cjFileBlob?: (path: string) => Promise<Blob>;
};

type ScalaCompileCache = {
	cacheKey: string;
	classesDir: string;
	mainClass: string;
	workDir: string;
};

const readsScalaStdin = (code: string) =>
	/\b(?:scala\.io\.)?StdIn\.|\bSystem\.in\b|\breadLine\s*\(/.test(code);

let cheerpJLoaderUrl = '';
let cheerpJLoadPromise: Promise<void> | null = null;
let cheerpJInitPromise: Promise<void> | null = null;
let runSequence = 0;

function cheerpJGlobal() {
	return globalThis as CheerpJGlobal;
}

function ensureCheerpJLoader(loaderUrl: string) {
	const target = cheerpJGlobal();
	if (target.cheerpjInit) return Promise.resolve();
	if (cheerpJLoadPromise && cheerpJLoaderUrl === loaderUrl) return cheerpJLoadPromise;
	if (typeof document === 'undefined') {
		return Promise.reject('CheerpJ Scala runtime requires a browser document');
	}
	cheerpJLoaderUrl = loaderUrl;
	cheerpJLoadPromise = new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[data-wasm-idle-cheerpj="true"]`
		);
		if (existing) {
			existing.addEventListener('load', () => resolve(), { once: true });
			existing.addEventListener('error', () => reject('Failed to load CheerpJ'), {
				once: true
			});
			return;
		}
		const script = document.createElement('script');
		script.src = loaderUrl;
		script.async = true;
		script.dataset.wasmIdleCheerpj = 'true';
		script.addEventListener('load', () => resolve(), { once: true });
		script.addEventListener('error', () => reject(`Failed to load CheerpJ from ${loaderUrl}`), {
			once: true
		});
		document.head.appendChild(script);
	});
	return cheerpJLoadPromise;
}

async function ensureCheerpJ(loaderUrl: string) {
	await ensureCheerpJLoader(loaderUrl);
	const target = cheerpJGlobal();
	if (!target.cheerpjInit) throw new Error('CheerpJ loader did not expose cheerpjInit');
	if (!cheerpJInitPromise) {
		cheerpJInitPromise = target.cheerpjInit({ version: 8 });
	}
	await cheerpJInitPromise;
	if (!target.cheerpjRunMain) throw new Error('CheerpJ loader did not expose cheerpjRunMain');
	if (!target.cheerpOSAddStringFile) {
		throw new Error('CheerpJ loader did not expose cheerpOSAddStringFile');
	}
	if (!target.cjFileBlob) throw new Error('CheerpJ loader did not expose cjFileBlob');
}

function nextRunId() {
	runSequence += 1;
	return `${Date.now().toString(36)}-${runSequence.toString(36)}`;
}

function sanitizeFileName(value: string | undefined) {
	const base = (value || 'Main.scala').split('/').pop() || 'Main.scala';
	const safe = base.replace(/[^A-Za-z0-9_.-]/g, '_');
	return safe.endsWith('.scala') ? safe : `${safe}.scala`;
}

function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseScalaDiagnostics(
	sourcePath: string,
	displayFileName: string,
	text: string
): CompilerDiagnostic[] {
	const diagnostics: CompilerDiagnostic[] = [];
	const sourcePattern = escapeRegExp(sourcePath);
	const sourceBasePattern = escapeRegExp(sanitizeFileName(sourcePath));
	const diagnosticPattern = new RegExp(
		`(?:${sourcePattern}|${sourceBasePattern}):(\\d+):\\s*(error|warning):\\s*([^\\n]+)(?:\\n([^\\n]*)(?:\\n(\\s*\\^))?)?`,
		'g'
	);
	let match: RegExpExecArray | null;
	while ((match = diagnosticPattern.exec(text))) {
		const sourceLine = match[4] || '';
		const caretLine = match[5] || '';
		const caretColumn = caretLine ? Math.max(1, caretLine.indexOf('^') + 1) : 1;
		diagnostics.push({
			fileName: displayFileName,
			lineNumber: Number(match[1]) || 1,
			columnNumber: sourceLine ? caretColumn : 1,
			severity: match[2] === 'warning' ? 'warning' : 'error',
			message: match[3]?.trim() || ''
		});
	}
	return diagnostics;
}

async function readVirtualText(path: string) {
	try {
		const blob = await cheerpJGlobal().cjFileBlob?.(path);
		return blob ? await blob.text() : '';
	} catch {
		return '';
	}
}

function trimStatus(value: string) {
	return value.trim() || '1';
}

class Scala implements Sandbox {
	output: any = null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	activeReject: ((reason: string) => void) | null = null;
	pendingInput: string[] = [];
	pendingEof = false;
	stdinWaiters: Array<() => void> = [];
	config: ResolvedScalaRuntimeAssetConfig | null = null;
	configKey = '';
	compiled: ScalaCompileCache | null = null;

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: SandboxProgress
	) {
		void _code;
		void _log;
		void _args;
		void _options;
		const nextConfig = resolveScalaRuntimeAssetConfig(
			runtimeAssets,
			typeof window !== 'undefined' ? window.location.href : ''
		);
		const nextConfigKey = JSON.stringify(nextConfig);
		if (nextConfigKey !== this.configKey) {
			this.compiled = null;
			this.config = nextConfig;
			this.configKey = nextConfigKey;
		}
		await ensureCheerpJ(nextConfig.cheerpjLoaderUrl);
		progress?.set?.(1);
	}

	write(input: string) {
		this.pendingInput.push(input);
		this.pendingEof = false;
		this.resolveStdinWaiters();
	}

	eof() {
		this.pendingEof = true;
		this.resolveStdinWaiters();
	}

	private resolveStdinWaiters() {
		const waiters = this.stdinWaiters.splice(0);
		for (const resolve of waiters) resolve();
	}

	private async collectStdinForRun(
		code: string,
		prepare: boolean,
		options: SandboxExecutionOptions
	) {
		if (
			!prepare &&
			!options.stdin &&
			this.pendingInput.length === 0 &&
			!this.pendingEof &&
			readsScalaStdin(code)
		) {
			await new Promise<void>((resolve) => this.stdinWaiters.push(resolve));
		}
		const stdin = `${options.stdin || ''}${this.pendingInput.join('')}`;
		if (!prepare) {
			this.pendingInput = [];
			this.pendingEof = false;
		}
		return stdin;
	}

	run(
		code: string,
		prepare: boolean,
		log = true,
		prog?: SandboxProgress,
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const _uid = ++this.uid;
		this.exit = false;
		this.begin = Date.now();
		return new Promise<boolean | string>((resolve, reject) => {
			this.activeReject = reject;
			this.runInternal(code, prepare, log, prog, args, options, _uid)
				.then((result) => {
					if (_uid === this.uid) resolve(result);
				})
				.catch((error) => {
					if (_uid === this.uid) reject(error?.message || String(error));
				})
				.finally(() => {
					if (_uid !== this.uid) return;
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
				});
		});
	}

	private async runInternal(
		code: string,
		prepare: boolean,
		log: boolean,
		prog: SandboxProgress | undefined,
		args: string[],
		options: SandboxExecutionOptions,
		uid: number
	) {
		if (!this.config) throw new Error('Scala runtime not loaded');
		const { compileArgs, programArgs } = resolveSandboxExecutionArgs('SCALA', args, options);
		const sourceName = sanitizeFileName(options.activePath);
		const compileCacheKey = JSON.stringify({ code, compileArgs, sourceName });
		if (!this.compiled || this.compiled.cacheKey !== compileCacheKey) {
			this.compiled = await this.compile(code, sourceName, compileArgs, log, prog);
		}
		if (uid !== this.uid) return false;
		if (prepare) return true;

		const stdin = await this.collectStdinForRun(code, prepare, options);
		if (uid !== this.uid) return false;
		return await this.execute(stdin, programArgs);
	}

	private async compile(
		code: string,
		sourceName: string,
		compileArgs: string[],
		log: boolean,
		prog?: SandboxProgress
	): Promise<ScalaCompileCache> {
		if (!this.config) throw new Error('Scala runtime not loaded');
		const runId = nextRunId();
		const sourcePath = `/str/wasm-idle-scala-${runId}-${sourceName}`;
		const workDir = `/files/wasm-idle-scala/${runId}`;
		const classesDir = `${workDir}/classes`;
		await cheerpJGlobal().cheerpOSAddStringFile?.(sourcePath, code);
		prog?.set?.(0.02);
		if (log) this.output?.(`scalac ${sourceName}\n`);
		const bridgeExitCode = await cheerpJGlobal().cheerpjRunMain?.(
			this.config.bridgeClassName,
			this.config.compilerClassPath,
			'compile',
			sourcePath,
			classesDir,
			this.config.libraryJar,
			workDir,
			...compileArgs
		);
		prog?.set?.(1);
		const [stdout, stderr, status, mainClass, bridgeStderr] = await Promise.all([
			readVirtualText(`${workDir}/compile.stdout.txt`),
			readVirtualText(`${workDir}/compile.stderr.txt`),
			readVirtualText(`${workDir}/compile.status.txt`),
			readVirtualText(`${workDir}/main-class.txt`),
			readVirtualText(`${workDir}/bridge.stderr.txt`)
		]);
		const compilerOutput = `${stdout || ''}${stderr || ''}`;
		if (stdout) this.output?.(stdout);
		if (stderr) this.output?.(stderr);
		for (const diagnostic of parseScalaDiagnostics(sourcePath, sourceName, compilerOutput)) {
			this.oncompilerdiagnostic?.(diagnostic);
		}
		if (trimStatus(status) !== '0' || bridgeExitCode !== 0) {
			throw new Error(compilerOutput || bridgeStderr || 'Scala compilation failed');
		}
		const resolvedMainClass = mainClass.trim();
		if (!resolvedMainClass) throw new Error('Scala main class was not reported');
		return {
			cacheKey: JSON.stringify({ code, compileArgs, sourceName }),
			classesDir,
			mainClass: resolvedMainClass,
			workDir
		};
	}

	private async execute(stdin: string, args: string[]) {
		if (!this.config || !this.compiled) throw new Error('Scala program not compiled');
		const runId = nextRunId();
		const workDir = `/files/wasm-idle-scala/${runId}`;
		const stdinPath = `/str/wasm-idle-scala-stdin-${runId}.txt`;
		await cheerpJGlobal().cheerpOSAddStringFile?.(stdinPath, stdin);
		const bridgeExitCode = await cheerpJGlobal().cheerpjRunMain?.(
			this.config.bridgeClassName,
			this.config.compilerClassPath,
			'run',
			this.compiled.classesDir,
			this.compiled.mainClass,
			this.config.libraryJar,
			stdinPath,
			workDir,
			...args
		);
		const [stdout, stderr, status, bridgeStderr] = await Promise.all([
			readVirtualText(`${workDir}/run.stdout.txt`),
			readVirtualText(`${workDir}/run.stderr.txt`),
			readVirtualText(`${workDir}/run.status.txt`),
			readVirtualText(`${workDir}/bridge.stderr.txt`)
		]);
		if (stdout) this.output?.(stdout);
		if (stderr) this.output?.(stderr);
		if (trimStatus(status) !== '0' || bridgeExitCode !== 0) {
			throw new Error(stderr || bridgeStderr || 'Scala program failed');
		}
		return true;
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.uid += 1;
		this.resolveStdinWaiters();
		this.exit = true;
	}

	async clear() {
		this.pendingInput = [];
		this.pendingEof = false;
		this.resolveStdinWaiters();
		if (!this.exit) this.terminate();
	}
}

export { parseScalaDiagnostics };
export default Scala;
