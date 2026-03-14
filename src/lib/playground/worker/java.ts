import { prepareJavaStdinInjection } from '$lib/playground/javaStdin';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { resolveTeaVmAssetUrl } from '$lib/playground/teavmConfig';

declare const self: DedicatedWorkerGlobalScope & {
	postMessage: (message: any) => void;
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
let currentSourcePath = '';

const isGzip = (bytes: Uint8Array) => bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

const maybeDecompressWasm = async (bytes: Uint8Array) => {
	if (!isGzip(bytes)) return bytes;
	if (typeof DecompressionStream === 'undefined') {
		throw new Error(
			'Generated WebAssembly is gzip-compressed, but DecompressionStream is unavailable'
		);
	}
	const stream = new Blob([Uint8Array.from(bytes)])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
};

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
	const { load, baseUrl, buffer, code, prepare, args = [], stdin = '' } = event.data;
	try {
		if (load) {
			if (!compiler || loadedBaseUrl !== baseUrl) {
				loadedBaseUrl = baseUrl;
				const runtimeSource = await fetch(
					resolveTeaVmAssetUrl(baseUrl, 'compiler.wasm-runtime.js')
				).then((response) => {
					if (!response.ok)
						throw new Error(
							`Failed to load TeaVM compiler runtime: ${response.status}`
						);
					return response.text();
				});
				const runtimeUrl = URL.createObjectURL(
					new Blob([runtimeSource], { type: 'text/javascript;charset=utf-8' })
				);
				const runtimeModule = await import(/* @vite-ignore */ runtimeUrl);
				const runtimeLoadFn = runtimeModule.load as NonNullable<typeof runtimeLoad>;
				runtimeLoad = runtimeLoadFn;
				const compilerWasm = await fetch(
					resolveTeaVmAssetUrl(baseUrl, 'compiler.wasm')
				).then(async (response) => {
					if (!response.ok)
						throw new Error(`Failed to load TeaVM compiler wasm: ${response.status}`);
					return await maybeDecompressWasm(new Uint8Array(await response.arrayBuffer()));
				});
				const compilerModule = await runtimeLoadFn(compilerWasm, {
					stackDeobfuscator: { enabled: false }
				});
				compilerLib = compilerModule.exports;
				compiler = compilerLib.createCompiler();
				const [sdk, runtimeClasslib] = await Promise.all([
					fetch(resolveTeaVmAssetUrl(baseUrl, 'compile-classlib-teavm.bin')).then(
						async (response) => {
							if (!response.ok)
								throw new Error(`Failed to load TeaVM SDK: ${response.status}`);
							return new Int8Array(await response.arrayBuffer());
						}
					),
					fetch(resolveTeaVmAssetUrl(baseUrl, 'runtime-classlib-teavm.bin')).then(
						async (response) => {
							if (!response.ok)
								throw new Error(
									`Failed to load TeaVM runtime classlib: ${response.status}`
								);
							return new Int8Array(await response.arrayBuffer());
						}
					)
				]);
				compiler.setSdk(sdk);
				compiler.setTeaVMClasslib(runtimeClasslib);
				compiledCode = '';
				compiledStdin = '';
				compiledMainClass = '';
				compiledWasm = null;
			}
			self.postMessage({ load: true });
			return;
		}

		if (!compiler || !runtimeLoad) throw new Error('TeaVM compiler not loaded');
		stdoutBuffer = '';
		stderrBuffer = '';
		const stdinInjection = prepareJavaStdinInjection(code, stdin);

		if (
			prepare ||
			compiledCode !== code ||
			compiledStdin !== stdinInjection.stdinCacheKey ||
			!compiledWasm
		) {
			const packageMatch = code.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m);
			const typeMatch =
				code.match(
					/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m
				) ||
				code.match(
					/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m
				);
			const className = typeMatch?.[1];
			if (!className)
				throw new Error(
					'Java source must define a top-level class, record, enum, or interface'
				);
			const packageName = packageMatch?.[1] || '';
			const sourcePath = packageName
				? `${packageName.replaceAll('.', '/')}/${className}.java`
				: `${className}.java`;
			const mainClass = packageName ? `${packageName}.${className}` : className;
			currentSourcePath = sourcePath;
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
				if (
					fileName &&
					fileName !== currentSourcePath &&
					fileName !== currentSourcePath.split('/').pop()
				) {
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
			compiler.addSourceFile(sourcePath, stdinInjection.transformedCode);
			if (
				stdinInjection.usesStdin &&
				stdinInjection.helperSourcePath &&
				stdinInjection.helperSource
			) {
				compiler.addSourceFile(
					stdinInjection.helperSourcePath,
					stdinInjection.helperSource
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
			compiledWasm = await maybeDecompressWasm(
				new Uint8Array(compiler.getWebAssemblyOutputFile('app.wasm'))
			);
		}

		if (prepare) {
			self.postMessage({ results: true });
			return;
		}

		stdinBufferJava = new Int32Array(buffer);
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
