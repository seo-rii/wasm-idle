import {
	resolveKotlinCheerpjBaseUrl,
	resolveKotlinHomePath,
	resolveKotlinStdlibPath,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import Java from '$lib/playground/java';
import type { CompilerDiagnostic, SandboxExecutionOptions } from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

declare global {
	interface Window {
		cheerpjInit?: (options?: {
			version?: number;
			status?: 'splash' | 'none' | 'default';
			javaProperties?: string[];
		}) => Promise<void>;
		cheerpjRunMain?: (
			className: string,
			classPath: string,
			...args: string[]
		) => Promise<number>;
		cheerpOSAddStringFile?: (path: string, data: string | Uint8Array) => Promise<void> | void;
		cjFileBlob?: (path: string) => Promise<Blob | null>;
	}
}

const KOTLIN_COMPILER_JARS = [
	'kotlinc-browser-patch.jar',
	'kotlin-compiler.jar',
	'kotlin-stdlib.jar',
	'kotlin-reflect.jar',
	'kotlin-script-runtime.jar',
	'kotlinx-coroutines-core-jvm.jar',
	'annotations-13.0.jar',
	'trove4j.jar'
];

let cheerpjInitPromise: Promise<void> | null = null;
let cheerpjLoadedBaseUrl = '';
const stdlibCache = new Map<string, Promise<Uint8Array>>();

class Kotlin implements Sandbox {
	output: any = null;
	elapse = 0;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;
	private java = new Java();
	private runtimeAssets: string | PlaygroundRuntimeAssets = '';
	private cheerpjBaseUrl = '';
	private kotlinHomePath = '/app/wasm-kotlin-jvm';
	private kotlinStdlibPath = '/app/wasm-kotlin-jvm/lib/kotlin-stdlib.jar';
	private compiledCode = '';
	private compiledSourcePath = '';
	private compiledJar: Uint8Array | null = null;
	private compiledStdlib: Uint8Array | null = null;
	private compiledMainClassHint = 'MainKt';

	async load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void }
	) {
		this.runtimeAssets = runtimeAssets;
		this.cheerpjBaseUrl = resolveKotlinCheerpjBaseUrl(
			runtimeAssets,
			typeof window !== 'undefined' ? window.location.href : ''
		);
		this.kotlinHomePath = resolveKotlinHomePath(runtimeAssets);
		this.kotlinStdlibPath = resolveKotlinStdlibPath(runtimeAssets);
		this.java.output = (data: string) => this.output?.(data);
		this.java.oncompilerdiagnostic = (diagnostic) => this.oncompilerdiagnostic?.(diagnostic);
		await this.java.load(runtimeAssets, _code, _log, _args, _options, progress);
		progress?.set?.(0.55);
		await this.ensureCheerpjRuntime();
		progress?.set?.(1);
	}

	write(input: string) {
		this.java.write(input);
	}

	eof() {
		this.java.eof();
	}

	async run(
		code: string,
		prepare: boolean,
		log = true,
		prog?: { set?: (value: number) => void },
		args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		const begin = Date.now();
		await this.ensureCheerpjRuntime();
		const activePath = options.activePath?.endsWith('.kt') ? options.activePath : 'Main.kt';
		if (
			!this.compiledJar ||
			this.compiledCode !== code ||
			this.compiledSourcePath !== activePath
		) {
			prog?.set?.(0.05);
			const fileName = activePath.split('/').pop() || 'Main.kt';
			const baseName = fileName.replace(/\.kt$/i, '');
			this.compiledMainClassHint = /^[A-Za-z_$][\w$]*$/.test(baseName)
				? `${baseName}Kt`
				: 'MainKt';
			const sourcePath = `/str/${fileName}`;
			if (!window.cheerpOSAddStringFile || !window.cjFileBlob) {
				throw new Error('CheerpJ loader did not expose the expected filesystem APIs');
			}
			await window.cheerpOSAddStringFile(sourcePath, code);
			prog?.set?.(0.15);

			const classPath = KOTLIN_COMPILER_JARS.map(
				(name) => `${this.kotlinHomePath}/lib/${name}`
			).join(':');
			const outputPath = '/files/wasm-idle-kotlin-out.jar';
			const compileLogs: string[] = [];
			const previousLog = console.log;
			const previousWarn = console.warn;
			const previousError = console.error;
			console.log = (...values: unknown[]) => {
				compileLogs.push(values.map(String).join(' '));
				previousLog(...values);
			};
			console.warn = (...values: unknown[]) => {
				compileLogs.push(values.map(String).join(' '));
				previousWarn(...values);
			};
			console.error = (...values: unknown[]) => {
				compileLogs.push(values.map(String).join(' '));
				previousError(...values);
			};
			let exitCode = 1;
			try {
				exitCode = await window.cheerpjRunMain!(
					'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
					classPath,
					'-no-stdlib',
					'-no-reflect',
					'-classpath',
					this.kotlinStdlibPath,
					'-d',
					outputPath,
					sourcePath
				);
			} finally {
				console.log = previousLog;
				console.warn = previousWarn;
				console.error = previousError;
			}
			if (compileLogs.length) this.output?.(`${compileLogs.join('\n')}\n`);
			if (exitCode !== 0) throw new Error(`Kotlin compiler exited with code ${exitCode}`);
			prog?.set?.(0.45);
			const outputBlob = await window.cjFileBlob?.(outputPath);
			if (!outputBlob) throw new Error('Kotlin compiler did not produce an output jar');
			this.compiledJar = new Uint8Array(await outputBlob.arrayBuffer());
			const urlPath = this.kotlinStdlibPath.startsWith('/app/')
				? this.kotlinStdlibPath.slice('/app'.length)
				: this.kotlinStdlibPath;
			const stdlibUrl = new URL(
				urlPath,
				typeof window !== 'undefined' ? window.location.origin : ''
			).href;
			let cached = stdlibCache.get(stdlibUrl);
			if (!cached) {
				cached = fetch(stdlibUrl).then(async (response) => {
					if (!response.ok) {
						throw new Error(
							`Failed to load Kotlin stdlib at ${stdlibUrl}: ${response.status}`
						);
					}
					return new Uint8Array(await response.arrayBuffer());
				});
				stdlibCache.set(stdlibUrl, cached);
			}
			this.compiledStdlib = await cached;
			this.compiledCode = code;
			this.compiledSourcePath = activePath;
		}

		prog?.set?.(0.6);
		const result = await this.java.run(code, prepare, log, prog, args, {
			...options,
			jvmInputJars: [
				{ name: 'kotlin-app.jar', bytes: this.compiledJar! },
				{ name: 'kotlin-stdlib.jar', bytes: this.compiledStdlib! }
			],
			jvmMainClassHint: this.compiledMainClassHint
		});
		this.elapse = Date.now() - begin;
		return result;
	}

	kill() {
		this.java.kill?.();
	}

	terminate() {
		this.java.terminate();
	}

	async clear() {
		await this.java.clear();
	}

	private async ensureCheerpjRuntime() {
		if (typeof window === 'undefined') throw new Error('Kotlin/JVM requires a browser');
		if (
			!cheerpjInitPromise &&
			window.cheerpjRunMain &&
			window.cheerpOSAddStringFile &&
			window.cjFileBlob
		) {
			cheerpjLoadedBaseUrl = this.cheerpjBaseUrl;
			cheerpjInitPromise = Promise.resolve();
		}
		if (cheerpjInitPromise) {
			if (cheerpjLoadedBaseUrl !== this.cheerpjBaseUrl) {
				throw new Error(
					`CheerpJ is already loaded from ${cheerpjLoadedBaseUrl}; reload the page to use ${this.cheerpjBaseUrl}`
				);
			}
			return cheerpjInitPromise;
		}
		cheerpjLoadedBaseUrl = this.cheerpjBaseUrl;
		const requestedBaseUrl = this.cheerpjBaseUrl;
		cheerpjInitPromise = new Promise<void>((resolve, reject) => {
			const script = document.createElement('script');
			script.src = new URL('loader.js', this.cheerpjBaseUrl).href;
			script.async = true;
			script.onload = () => {
				const started = Date.now();
				const waitForLoader = () => {
					if (window.cheerpjInit) {
						resolve();
						return;
					}
					if (Date.now() - started > 30_000) {
						reject(
							new Error('CheerpJ loader did not expose the expected runtime APIs')
						);
						return;
					}
					window.setTimeout(waitForLoader, 50);
				};
				waitForLoader();
			};
			script.onerror = () =>
				reject(
					new Error(
						`Failed to load self-hosted CheerpJ runtime at ${script.src}. Copy a licensed CheerpJ runtime to static/cheerpj/4.3 before enabling Kotlin/JVM.`
					)
				);
			document.head.append(script);
		})
			.then(async () => {
				if (!window.cheerpjInit) {
					throw new Error('CheerpJ loader did not expose the expected runtime APIs');
				}
				await window.cheerpjInit({
					version: 17,
					status: 'none',
					javaProperties: [
						'kotlin.colors.enabled=false',
						'org.fusesource.jansi.Ansi.disable=true'
					]
				});
				if (!window.cheerpjRunMain || !window.cheerpOSAddStringFile || !window.cjFileBlob) {
					throw new Error('CheerpJ loader did not expose the expected filesystem APIs');
				}
			})
			.catch((error) => {
				if (cheerpjLoadedBaseUrl === requestedBaseUrl) {
					cheerpjInitPromise = null;
					cheerpjLoadedBaseUrl = '';
				}
				throw error;
			});
		return cheerpjInitPromise;
	}
}

export default Kotlin;
