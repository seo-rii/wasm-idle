import { acceptCompiledTeaVmModule, loadStreamingJavaCompiler } from './javaStreaming';
import {
	createJavaStdinBridge,
	prepareJavaRuntimeStdinInjection
} from '$lib/playground/javaRuntimeStdin';
import { resolveJavaSourceIdentity } from '$lib/playground/javaSource';
import { prepareJavaExceptionBridge } from '$lib/playground/javaRuntimeErrors';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { createJavaDebugBridge } from '../javaDebugBridge';
import { readDebugCommand } from '../debugMailbox';
import { createJavaDebugRuntime, type JavaDebugFile } from './javaDebugRuntime';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	loadWorkerRuntimeAsset,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';

declare const self: {
	postMessage: (message: any) => void;
	addEventListener: (
		type: 'message',
		listener: (event: MessageEvent<any>) => void | Promise<void>
	) => void;
};

let compilerLib: any = null;
let compiler: any = null;
let runtimeLoad:
	| ((code: string | ArrayBufferView | WebAssembly.Module, options?: object) => Promise<any>)
	| null = null;
let exceptionDeobfuscator: WebAssembly.Module | null = null;
let loadedBaseUrl = '';
let stdoutBuffer = '';
let stderrBuffer = '';
let compiledCode = '';
let compiledStdin = '';
let compiledMainClass = '';
let compiledExceptionFormatter = '';
let compiledWasm: Uint8Array | null = null;
let compiledDiagnostics: object[] = [];
let compiledActivePath = '';
let compiledWorkspaceFiles: Array<{ path: string; content: string }> = [];
let compiledDebugEnabled = false;
let compiledDebugFiles: JavaDebugFile[] = [];
let currentSourcePaths = new Set<string>();
const decoder = new TextDecoder();

const toInt8Array = (bytes: Uint8Array) =>
	new Int8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

const flushStdout = () => {
	if (!stdoutBuffer) return;
	self.postMessage({ output: stdoutBuffer });
	stdoutBuffer = '';
};

const flushStderr = () => {
	if (!stderrBuffer) return;
	self.postMessage({ output: stderrBuffer });
	stderrBuffer = '';
};

const pushStdout = (charCode: number) => {
	stdoutBuffer += String.fromCharCode(charCode);
	if (charCode === 10) flushStdout();
};

const pushStderr = (charCode: number) => {
	stderrBuffer += String.fromCharCode(charCode);
	if (charCode === 10) flushStderr();
};

self.addEventListener('message', async (event) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		load,
		assets,
		buffer,
		code,
		prepare,
		debugMode,
		javaDebug,
		args = [],
		stdin = '',
		hasExplicitStdin = false,
		activePath,
		workspaceFiles = []
	} = event.data;
	try {
		if (load) {
			const runtimeAssets = assets as
				(WorkerRuntimeAssetConfig & { streamCompiler?: boolean }) | undefined;
			configureWorkerRuntimeAssets(runtimeAssets || null);
			const baseUrl = runtimeAssets?.baseUrl || '';
			const streamCompiler = runtimeAssets?.streamCompiler === true;
			if (!compiler || loadedBaseUrl !== baseUrl) {
				// Observe every branch immediately: failed assets must not leave an
				// unhandled rejection while another branch is still initializing Wasm.
				const [nextRuntime, sdk, runtimeClasslib, deobfuscator] = await Promise.all([
					(async () => {
						const [runtimeModule, compilerAsset] = await Promise.all([
							(async () => {
								let runtimeSource = decoder.decode(
									(await loadWorkerRuntimeAsset('compiler.wasm-runtime.js')).bytes
								);
								if (streamCompiler)
									runtimeSource = acceptCompiledTeaVmModule(runtimeSource);
								const runtimeUrl = URL.createObjectURL(
									new Blob([runtimeSource], {
										type: 'text/javascript;charset=utf-8'
									})
								);
								try {
									return await import(/* @vite-ignore */ runtimeUrl);
								} finally {
									URL.revokeObjectURL(runtimeUrl);
								}
							})(),
							(async () => {
								const module = streamCompiler
									? await loadStreamingJavaCompiler(
											baseUrl,
											runtimeAssets?.maxAssetBytes ?? 128 * 1024 * 1024
										)
									: undefined;
								return module
									? { bytes: module }
									: loadWorkerRuntimeAsset('compiler.wasm');
							})()
						]);
						const load = runtimeModule.load as NonNullable<typeof runtimeLoad>;
						const module = await load(compilerAsset.bytes, {
							stackDeobfuscator: { enabled: false }
						});
						return {
							load,
							lib: module.exports,
							compiler: module.exports.createCompiler()
						};
					})(),
					loadWorkerRuntimeAsset('compile-classlib-teavm.bin').then(({ bytes }) =>
						toInt8Array(bytes)
					),
					loadWorkerRuntimeAsset('runtime-classlib-teavm.bin').then(({ bytes }) =>
						toInt8Array(bytes)
					),
					loadWorkerRuntimeAsset('compiler.wasm-deobfuscator.wasm').then(({ bytes }) =>
						(
							WebAssembly.compile as (
								bytes: BufferSource,
								options: { builtins: string[] }
							) => Promise<WebAssembly.Module>
						)(bytes as BufferSource, { builtins: ['js-string'] })
					)
				]);
				// Publish only a fully initialized compiler; a failed first attempt
				// must retry instead of acknowledging a partially initialized runtime.
				nextRuntime.compiler.setSdk(sdk);
				nextRuntime.compiler.setTeaVMClasslib(runtimeClasslib);
				compilerLib = nextRuntime.lib;
				compiler = nextRuntime.compiler;
				runtimeLoad = nextRuntime.load;
				exceptionDeobfuscator = deobfuscator;
				loadedBaseUrl = baseUrl;
				compiledCode = '';
				compiledStdin = '';
				compiledMainClass = '';
				compiledExceptionFormatter = '';
				compiledWasm = null;
				compiledDiagnostics = [];
				compiledActivePath = '';
				compiledWorkspaceFiles = [];
				compiledDebugEnabled = false;
				compiledDebugFiles = [];
				currentSourcePaths = new Set();
			}
			self.postMessage({ load: true });
			return;
		}

		if (!compiler || !runtimeLoad || !exceptionDeobfuscator)
			throw new Error('TeaVM compiler not loaded');
		stdoutBuffer = '';
		stderrBuffer = '';
		const explicitStdin = hasExplicitStdin === true;
		const stdinInjection = prepareJavaRuntimeStdinInjection(code);
		const sourceIdentity = resolveJavaSourceIdentity(code);
		const sourcePath =
			typeof activePath === 'string' && activePath ? activePath : sourceIdentity.sourcePath;
		const sourceFileName = sourcePath.split('/').pop() || sourcePath;
		if (
			!Array.isArray(workspaceFiles) ||
			!workspaceFiles.every(
				(file) =>
					file &&
					typeof file.path === 'string' &&
					(typeof file.content === 'string' || file.content instanceof Uint8Array)
			)
		) {
			throw new Error('Invalid Java workspace files');
		}
		// Container files arrive as bytes; Java compiler inputs are strict UTF-8 source text.
		const sourceDecoder = new TextDecoder('utf-8', { fatal: true });
		const sourceFiles: Array<{ path: string; content: string }> = workspaceFiles.map(
			(file: { path: string; content: string | Uint8Array }) => ({
				path: file.path,
				content:
					typeof file.content === 'string'
						? file.content
						: sourceDecoder.decode(file.content)
			})
		);
		const debugEnabled = debugMode === 'trace';
		if (debugMode && debugMode !== 'none' && !debugEnabled)
			throw new Error('Java supports the trace debugger backend');
		const workspaceChanged =
			compiledActivePath !== sourcePath ||
			compiledWorkspaceFiles.length !== sourceFiles.length ||
			compiledWorkspaceFiles.some(
				(file, index) =>
					file.path !== sourceFiles[index]?.path ||
					file.content !== sourceFiles[index]?.content
			);
		if (
			stdinInjection.usesStdin &&
			stdinInjection.helperSourcePath &&
			(sourcePath === stdinInjection.helperSourcePath ||
				sourceFiles.some((file) => file.path === stdinInjection.helperSourcePath))
		) {
			throw new Error(
				`Java workspace conflicts with generated stdin helper: ${stdinInjection.helperSourcePath}`
			);
		}

		if (
			compiledCode !== code ||
			compiledDebugEnabled !== debugEnabled ||
			compiledStdin !== stdinInjection.stdinCacheKey ||
			workspaceChanged ||
			!compiledWasm
		) {
			// A failed rebuild must never leave a previous artifact eligible for reuse.
			compiledWasm = null;
			compiledDiagnostics = [];
			compiledDebugFiles = [];
			const mainClass = sourceIdentity.mainClass;
			currentSourcePaths = new Set(
				[sourcePath, ...sourceFiles.map((file) => file.path)].flatMap((path) => [
					path,
					path.split('/').pop() || path
				])
			);
			let mainSource = stdinInjection.transformedCode;
			let otherSources = sourceFiles;
			let debugBridge: ReturnType<typeof createJavaDebugBridge> | undefined;
			const debugFiles: JavaDebugFile[] = [];
			if (debugEnabled) {
				const { instrumentJavaDebugSource } = await import('../javaDebugSource');
				const originals = [{ path: sourcePath, content: code }, ...sourceFiles];
				let nonce: string;
				do {
					nonce = crypto.randomUUID().replaceAll('-', '');
				} while (
					originals.some(
						(file) => file.content.includes(nonce) || file.path.includes(nonce)
					)
				);
				debugBridge = createJavaDebugBridge(
					`WasmIdleJavaDebug_${nonce}`,
					`wasm_idle_debug_${nonce}`
				);
				const instrumented: Array<{ path: string; content: string }> = [];
				for (const file of originals) {
					if (file.path !== sourcePath && !file.path.endsWith('.java')) {
						instrumented.push(file);
						continue;
					}
					const result = instrumentJavaDebugSource(
						file.content,
						file.path,
						debugBridge.qualifiedName
					);
					const hash = new Uint8Array(
						await crypto.subtle.digest(
							'SHA-256',
							new TextEncoder().encode(file.content)
						)
					);
					debugFiles.push({
						path: file.path,
						sourceContentSha256: [...hash]
							.map((byte) => byte.toString(16).padStart(2, '0'))
							.join(''),
						lineCount: file.content.trimEnd().split(/\r\n|\r|\n/).length,
						locations: result.locations
					});
					instrumented.push({ path: file.path, content: result.code });
				}
				mainSource = prepareJavaRuntimeStdinInjection(
					instrumented[0].content
				).transformedCode;
				otherSources = instrumented.slice(1);
			}
			const diagnosticLines: string[] = [];
			const diagnosticMessages: object[] = [];
			let compilingExceptionBridge = false;
			const diagnosticRegistration = compiler.onDiagnostic((diagnostic: any) => {
				const severity = diagnostic.severity
					? String(diagnostic.severity).toLowerCase()
					: 'error';
				const location = diagnostic.fileName
					? `${diagnostic.fileName}:${diagnostic.lineNumber || 0}${diagnostic.columnNumber ? `:${diagnostic.columnNumber}` : ''}`
					: 'TeaVM';
				diagnosticLines.push(`${location}: ${severity}: ${diagnostic.message}`);
				if (compilingExceptionBridge) return;
				const fileName = diagnostic.fileName ? String(diagnostic.fileName) : null;
				if (fileName && !currentSourcePaths.has(fileName)) {
					return;
				}
				const diagnosticMessage = {
					diagnostic: {
						fileName,
						lineNumber: Number(diagnostic.lineNumber) || 1,
						columnNumber: Number(diagnostic.columnNumber) || 1,
						severity:
							severity === 'warning'
								? 'warning'
								: severity === 'other'
									? 'other'
									: 'error',
						message: String(diagnostic.message || '')
					}
				};
				diagnosticMessages.push(diagnosticMessage);
				self.postMessage(diagnosticMessage);
			});
			const disposeDiagnosticRegistration = () => {
				if (typeof diagnosticRegistration === 'function') {
					diagnosticRegistration();
					return;
				}
				diagnosticRegistration?.destroy?.();
			};
			compiler.clearSourceFiles?.();
			compiler.clearInputClassFiles?.();
			compiler.clearOutputFiles?.();
			// TeaVM derives packages from source text but validates public types against the basename.
			compiler.addSourceFile(sourceFileName, mainSource);
			for (const file of otherSources) {
				compiler.addSourceFile(file.path.split('/').pop() || file.path, file.content);
			}
			if (debugBridge) compiler.addSourceFile(debugBridge.sourceFileName, debugBridge.source);
			if (
				stdinInjection.usesStdin &&
				stdinInjection.helperSourcePath &&
				stdinInjection.helperSource
			) {
				compiler.addSourceFile(
					stdinInjection.helperSourcePath.split('/').pop() ||
						stdinInjection.helperSourcePath,
					stdinInjection.helperSource
				);
				currentSourcePaths.add(stdinInjection.helperSourcePath);
				currentSourcePaths.add(
					stdinInjection.helperSourcePath.split('/').pop() ||
						stdinInjection.helperSourcePath
				);
			}
			const javacOk = compiler.compile();
			if (!javacOk) {
				disposeDiagnosticRegistration();
				throw new Error(diagnosticLines.join('\n') || 'TeaVM javac compilation failed');
			}
			const mainClasses = Array.from(compiler.detectMainClasses() as string[]);
			if (mainClasses.length !== 1) {
				disposeDiagnosticRegistration();
				throw new Error(
					mainClasses.length === 0
						? 'Main method not found'
						: 'Multiple main methods found'
				);
			}
			// Compile the launcher against the original class files so user diagnostics and
			// main-method validation stay independent, and original source lines are unchanged.
			const classFiles = Array.from(compiler.listOutputFiles() as string[]);
			const exceptionBridge = prepareJavaExceptionBridge(
				mainClass,
				[
					code,
					...sourceFiles.map((file) => file.content),
					stdinInjection.helperSource || ''
				],
				classFiles
			);
			for (const path of classFiles) {
				if (path.endsWith('.class'))
					compiler.addClassFile(path, compiler.getOutputFile(path));
			}
			compiler.clearSourceFiles();
			compiler.addSourceFile(exceptionBridge.sourceFileName, exceptionBridge.source);
			compiler.addSourceFile(
				exceptionBridge.formatterSourceFileName,
				exceptionBridge.formatterSource
			);
			let bridgeOk: boolean;
			try {
				compilingExceptionBridge = true;
				bridgeOk = compiler.compile();
			} finally {
				compilingExceptionBridge = false;
			}
			if (!bridgeOk) {
				disposeDiagnosticRegistration();
				throw new Error(
					diagnosticLines.join('\n') || 'Java exception bridge compilation failed'
				);
			}
			const generateOk = compiler.generateWebAssembly({
				outputName: 'app',
				mainClass: exceptionBridge.mainClass
			});
			disposeDiagnosticRegistration();
			if (!generateOk) {
				throw new Error(
					diagnosticLines.join('\n') || 'TeaVM WebAssembly generation failed'
				);
			}
			compiledCode = code;
			compiledStdin = stdinInjection.stdinCacheKey;
			compiledMainClass = mainClass;
			compiledExceptionFormatter = exceptionBridge.formatExport;
			compiledWasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
			compiledActivePath = sourcePath;
			compiledWorkspaceFiles = sourceFiles.map((file) => ({ ...file }));
			compiledDebugEnabled = debugEnabled;
			compiledDebugFiles = debugFiles;
			compiledDiagnostics = diagnosticMessages;
		} else {
			// Every operation has its own diagnostic sink, even when compilation is reused.
			for (const diagnostic of compiledDiagnostics) self.postMessage(diagnostic);
		}

		if (prepare) {
			self.postMessage({ results: true });
			return;
		}

		const stdinBufferJava = new Int32Array(buffer);
		const stdinBridge = createJavaStdinBridge(stdin, explicitStdin, () => {
			// Publish prompts before the host blocks waiting for interactive input.
			flushStdout();
			flushStderr();
			return waitForBufferedStdin(stdinBufferJava, () => self.postMessage({ buffer: true }));
		});
		const workerGlobal = globalThis as typeof globalThis & {
			window?: Window & typeof globalThis;
			wasmIdleJavaStdin?: unknown;
			wasmIdleJavaDebug?: unknown;
		};
		const previousWindow = workerGlobal.window;
		const hadStdinBridge = Object.prototype.hasOwnProperty.call(
			workerGlobal,
			'wasmIdleJavaStdin'
		);
		const previousStdinBridge = workerGlobal.wasmIdleJavaStdin;
		const hadDebugBridge = Object.prototype.hasOwnProperty.call(
			workerGlobal,
			'wasmIdleJavaDebug'
		);
		const previousDebugBridge = workerGlobal.wasmIdleJavaDebug;
		const errorConstructor = Error as ErrorConstructor & { stackTraceLimit?: number };
		const stackTraceLimit = Object.getOwnPropertyDescriptor(
			errorConstructor,
			'stackTraceLimit'
		);
		workerGlobal.window = workerGlobal as Window & typeof globalThis;
		workerGlobal.wasmIdleJavaStdin = stdinBridge;
		try {
			if (debugEnabled) {
				if (!javaDebug) throw new Error('Java debugger command transport is missing');
				// V8 defaults to ten physical frames; retain full depth for recursive next/out.
				if (typeof errorConstructor.stackTraceLimit === 'number')
					errorConstructor.stackTraceLimit = Infinity;
				workerGlobal.wasmIdleJavaDebug = createJavaDebugRuntime(
					compiledDebugFiles,
					{
						activePath: sourcePath,
						debugPath: javaDebug.sourcePath,
						breakpoints: javaDebug.breakpoints ?? [],
						sourceBreakpoints: javaDebug.sourceBreakpoints,
						pauseOnEntry: javaDebug.pauseOnEntry !== false
					},
					(event, stopId) => {
						if (event.type === 'pause') {
							flushStdout();
							flushStderr();
						}
						self.postMessage({ javaDebug: { event, stopId } });
					},
					(blocking) =>
						readDebugCommand(
							javaDebug.buffer,
							blocking,
							() => self.postMessage({ javaDebug: { consumed: true } }),
							'Java'
						),
					(response) => self.postMessage({ javaDebug: { response } })
				);
			}
			const module = await runtimeLoad(compiledWasm!, {
				installImports(imports: any) {
					imports.teavmConsole.putcharStdout = pushStdout;
					imports.teavmConsole.putcharStderr = pushStderr;
				},
				stackDeobfuscator: {
					enabled: true,
					path: exceptionDeobfuscator,
					infoLocation: 'embedded'
				}
			});
			self.postMessage({
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'Java program started'
				}
			});
			try {
				module.exports.main(args);
			} catch (error) {
				// JSExceptions retrieves the real Java Throwable; its class, causes, and
				// source stack survive even when getMessage() is null or empty.
				let javaError: unknown;
				try {
					javaError = module.exports[compiledExceptionFormatter](error);
				} catch {
					// A formatting failure must not replace the original runtime failure.
				}
				if (typeof javaError === 'string' && javaError) throw new Error(javaError);
				throw error;
			}
			flushStdout();
			flushStderr();
			self.postMessage({ results: true, mainClass: compiledMainClass });
		} finally {
			stdinBridge.dispose();
			if (hadDebugBridge) workerGlobal.wasmIdleJavaDebug = previousDebugBridge;
			else delete workerGlobal.wasmIdleJavaDebug;
			if (stackTraceLimit)
				Object.defineProperty(errorConstructor, 'stackTraceLimit', stackTraceLimit);
			else Reflect.deleteProperty(errorConstructor, 'stackTraceLimit');
			if (hadStdinBridge) workerGlobal.wasmIdleJavaStdin = previousStdinBridge;
			else delete workerGlobal.wasmIdleJavaStdin;
			if (previousWindow === undefined) {
				Reflect.deleteProperty(workerGlobal, 'window');
			} else {
				workerGlobal.window = previousWindow;
			}
		}
	} catch (error) {
		flushStdout();
		flushStderr();
		self.postMessage({
			error: error instanceof Error ? error.message : String(error)
		});
	}
});
