import { prepareJavaStdinInjection } from '$lib/playground/javaStdin';
import { resolveJavaSourceIdentity } from '$lib/playground/javaSource';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
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
let runtimeLoad: ((code: string | ArrayBufferView, options?: object) => Promise<any>) | null = null;
let loadedBaseUrl = '';
let stdoutBuffer = '';
let stderrBuffer = '';
let stdinBufferJava: Int32Array | null = null;
let stdinChunkJava = new Uint8Array(0);
let stdinChunkOffsetJava = 0;
let compiledCode = '';
let compiledStdin = '';
let compiledMainClass = '';
let compiledWasm: Uint8Array | null = null;
let compiledActivePath = '';
let compiledWorkspaceFiles: Array<{ path: string; content: string }> = [];
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
		args = [],
		stdin = '',
		hasExplicitStdin = false,
		activePath,
		workspaceFiles = []
	} = event.data;
	try {
		if (load) {
			const runtimeAssets = assets as WorkerRuntimeAssetConfig | undefined;
			configureWorkerRuntimeAssets(runtimeAssets || null);
			const baseUrl = runtimeAssets?.baseUrl || '';
			if (!compiler || loadedBaseUrl !== baseUrl) {
				loadedBaseUrl = baseUrl;
				const runtimeSource = decoder.decode(
					(await loadWorkerRuntimeAsset('compiler.wasm-runtime.js')).bytes
				);
				const runtimeUrl = URL.createObjectURL(
					new Blob([runtimeSource], { type: 'text/javascript;charset=utf-8' })
				);
				const runtimeModule = await import(/* @vite-ignore */ runtimeUrl);
				URL.revokeObjectURL(runtimeUrl);
				const runtimeLoadFn = runtimeModule.load as NonNullable<typeof runtimeLoad>;
				runtimeLoad = runtimeLoadFn;
				const compilerWasm = (await loadWorkerRuntimeAsset('compiler.wasm')).bytes;
				const compilerModule = await runtimeLoadFn(compilerWasm, {
					stackDeobfuscator: { enabled: false }
				});
				compilerLib = compilerModule.exports;
				compiler = compilerLib.createCompiler();
				const [sdk, runtimeClasslib] = await Promise.all([
					loadWorkerRuntimeAsset('compile-classlib-teavm.bin').then(({ bytes }) =>
						toInt8Array(bytes)
					),
					loadWorkerRuntimeAsset('runtime-classlib-teavm.bin').then(({ bytes }) =>
						toInt8Array(bytes)
					)
				]);
				compiler.setSdk(sdk);
				compiler.setTeaVMClasslib(runtimeClasslib);
				compiledCode = '';
				compiledStdin = '';
				compiledMainClass = '';
				compiledWasm = null;
				compiledActivePath = '';
				compiledWorkspaceFiles = [];
				currentSourcePaths = new Set();
			}
			self.postMessage({ load: true });
			return;
		}

		if (!compiler || !runtimeLoad) throw new Error('TeaVM compiler not loaded');
		stdoutBuffer = '';
		stderrBuffer = '';
		const explicitStdin = hasExplicitStdin === true;
		const stdinInjection = prepareJavaStdinInjection(code, stdin, explicitStdin);
		const sourceIdentity = resolveJavaSourceIdentity(code);
		const sourcePath =
			typeof activePath === 'string' && activePath ? activePath : sourceIdentity.sourcePath;
		const sourceFileName = sourcePath.split('/').pop() || sourcePath;
		if (
			!Array.isArray(workspaceFiles) ||
			!workspaceFiles.every(
				(file) => file && typeof file.path === 'string' && typeof file.content === 'string'
			)
		) {
			throw new Error('Invalid Java workspace files');
		}
		const sourceFiles = workspaceFiles as Array<{ path: string; content: string }>;
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
			prepare ||
			compiledCode !== code ||
			compiledStdin !== stdinInjection.stdinCacheKey ||
			workspaceChanged ||
			!compiledWasm
		) {
			const mainClass = sourceIdentity.mainClass;
			currentSourcePaths = new Set(
				[sourcePath, ...sourceFiles.map((file) => file.path)].flatMap((path) => [
					path,
					path.split('/').pop() || path
				])
			);
			const diagnosticLines: string[] = [];
			const diagnosticRegistration = compiler.onDiagnostic((diagnostic: any) => {
				const severity = diagnostic.severity
					? String(diagnostic.severity).toLowerCase()
					: 'error';
				const location = diagnostic.fileName
					? `${diagnostic.fileName}:${diagnostic.lineNumber || 0}${diagnostic.columnNumber ? `:${diagnostic.columnNumber}` : ''}`
					: 'TeaVM';
				diagnosticLines.push(`${location}: ${severity}: ${diagnostic.message}`);
				const fileName = diagnostic.fileName ? String(diagnostic.fileName) : null;
				if (fileName && !currentSourcePaths.has(fileName)) {
					return;
				}
				self.postMessage({
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
				});
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
			compiler.addSourceFile(sourceFileName, stdinInjection.transformedCode);
			for (const file of sourceFiles) {
				compiler.addSourceFile(file.path.split('/').pop() || file.path, file.content);
			}
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
			const generateOk = compiler.generateWebAssembly({
				outputName: 'app',
				mainClass
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
			compiledWasm = new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'));
			compiledActivePath = sourcePath;
			compiledWorkspaceFiles = sourceFiles.map((file) => ({ ...file }));
		}

		if (prepare) {
			self.postMessage({ results: true });
			return;
		}

		stdinBufferJava = new Int32Array(buffer);
		stdinChunkJava = explicitStdin ? new Uint8Array(0) : new TextEncoder().encode(stdin);
		stdinChunkOffsetJava = 0;
		const workerGlobal = globalThis as typeof globalThis & {
			window?: Window & typeof globalThis;
			wasmIdleJavaStdin?: { readByte: () => number };
		};
		const previousWindow = workerGlobal.window;
		workerGlobal.window = workerGlobal as Window & typeof globalThis;
		workerGlobal.wasmIdleJavaStdin = {
			readByte() {
				while (true) {
					if (stdinChunkOffsetJava < stdinChunkJava.length) {
						return stdinChunkJava[stdinChunkOffsetJava++] ?? -1;
					}
					if (explicitStdin) return -1;
					const chunk = waitForBufferedStdin(stdinBufferJava!, () =>
						self.postMessage({ buffer: true })
					);
					if (chunk === null) {
						return -1;
					}
					stdinChunkJava = new TextEncoder().encode(chunk);
					stdinChunkOffsetJava = 0;
				}
			}
		};
		try {
			const module = await runtimeLoad(compiledWasm!, {
				installImports(imports: any) {
					imports.teavmConsole.putcharStdout = pushStdout;
					imports.teavmConsole.putcharStderr = pushStderr;
				},
				stackDeobfuscator: {
					enabled: false
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
			module.exports.main(args);
			flushStdout();
			flushStderr();
			self.postMessage({ results: true, mainClass: compiledMainClass });
		} finally {
			delete workerGlobal.wasmIdleJavaStdin;
			if (previousWindow === undefined) {
				Reflect.deleteProperty(workerGlobal, 'window');
			} else {
				workerGlobal.window = previousWindow;
			}
			stdinChunkJava = new Uint8Array(0);
			stdinChunkOffsetJava = 0;
			stdinBufferJava = null;
		}
	} catch (error) {
		flushStdout();
		flushStderr();
		self.postMessage({
			error: error instanceof Error ? error.message : String(error)
		});
	}
});
