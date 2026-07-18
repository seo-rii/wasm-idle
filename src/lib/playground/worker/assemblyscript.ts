import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface AssemblyScriptCompilerModule {
	main?: (
		args: string[],
		options: {
			stdout: { write(chunk: Uint8Array | string): void; toString(): string };
			stderr: { write(chunk: Uint8Array | string): void; toString(): string };
			readFile(filePath: string): string | null;
			writeFile(filePath: string, contents: Uint8Array | string): void;
			listFiles(dirPath: string): string[];
		}
	) =>
		| Promise<{ error?: Error; stdout?: unknown; stderr?: unknown }>
		| { error?: Error; stdout?: unknown; stderr?: unknown };
}

interface AssemblyScriptRuntimeModule {
	instantiate<T extends Record<string, unknown>>(
		module: WebAssembly.Module | ArrayBufferView,
		imports?: WebAssembly.Imports
	): Promise<{ exports: T & AssemblyScriptRuntimeExports }>;
	loadCompiler(): Promise<AssemblyScriptCompilerModule>;
}

interface AssemblyScriptRuntimeExports {
	__getString?(pointer: number): string;
	__newString?(value: string): number;
}

let loaded = false;
let compilerPromise: Promise<AssemblyScriptCompilerModule> | null = null;
let runtimePromise: Promise<AssemblyScriptRuntimeModule> | null = null;
let runtimeModuleUrl = '';
let compiledWasm: Uint8Array | null = null;
let compiledCacheKey = '';
let compiledReturnTypes: Record<string, string> = {};

async function loadRuntime(url: string) {
	if (!url) throw new Error('AssemblyScript runtime module URL is not configured.');
	if (!runtimePromise || runtimeModuleUrl !== url) {
		runtimeModuleUrl = url;
		runtimePromise = importRuntimeModule<AssemblyScriptRuntimeModule>(url);
		compilerPromise = null;
	}
	return await runtimePromise;
}

class AssemblyScriptStdin {
	private initialStdin: string | null;
	private readonly fixedInitialStdin: boolean;
	private currentBytes = new Uint8Array(0);
	private currentOffset = 0;

	constructor(
		initialStdin: string | undefined,
		private readonly buffer: Int32Array | null,
		private readonly log: boolean
	) {
		this.initialStdin = typeof initialStdin === 'string' ? initialStdin : null;
		this.fixedInitialStdin = typeof initialStdin === 'string';
	}

	readByte() {
		while (this.currentOffset >= this.currentBytes.length) {
			const chunk = this.readChunk();
			if (chunk == null) return -1;
			if (!chunk) continue;
			this.currentBytes = encoder.encode(chunk);
			this.currentOffset = 0;
		}
		return this.currentBytes[this.currentOffset++] ?? -1;
	}

	readLine() {
		const bytes: number[] = [];
		while (true) {
			const byte = this.readByte();
			if (byte < 0) {
				return bytes.length ? decoder.decode(new Uint8Array(bytes)) : null;
			}
			if (byte === 10) {
				if (bytes[bytes.length - 1] === 13) bytes.pop();
				return decoder.decode(new Uint8Array(bytes));
			}
			bytes.push(byte);
		}
	}

	readAll() {
		const bytes: number[] = [];
		while (true) {
			const byte = this.readByte();
			if (byte < 0) return decoder.decode(new Uint8Array(bytes));
			bytes.push(byte);
		}
	}

	private readChunk() {
		if (this.initialStdin != null) {
			const chunk = this.initialStdin;
			this.initialStdin = null;
			return chunk;
		}
		if (this.fixedInitialStdin || !this.buffer) return null;
		const chunk = waitForBufferedStdin(this.buffer, () => postMessage({ buffer: true }));
		if (this.log) {
			console.log(
				chunk == null
					? '[wasm-idle:assemblyscript-stdin] read(bytes=0, eof=true)'
					: `[wasm-idle:assemblyscript-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
			);
		}
		return chunk;
	}
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		code,
		prepare,
		buffer,
		stdin,
		activePath = 'main.as.ts',
		workspaceFiles = [],
		log
	}: {
		load?: boolean;
		moduleUrl?: string;
		code?: string;
		prepare?: boolean;
		buffer?: SharedArrayBuffer;
		stdin?: string;
		activePath?: string;
		workspaceFiles?: SandboxWorkspaceFile[];
		log?: boolean;
	} = event.data;
	try {
		if (load) {
			loaded = true;
			postMessage({ progress: { percent: 5, stage: 'Loading AssemblyScript runtime' } });
			await loadRuntime(nextModuleUrl || runtimeModuleUrl);
			if (log) {
				console.log(
					`[wasm-idle:assemblyscript-worker] load runtime=${nextModuleUrl || runtimeModuleUrl}`
				);
			}
			postMessage({ progress: { percent: 100, stage: 'AssemblyScript runtime ready' } });
			postMessage({ load: true });
			return;
		}

		if (!loaded) loaded = true;
		const source = code || '';
		const compileCacheKey = JSON.stringify({
			activePath,
			source,
			workspaceFiles
		});
		if (!compiledWasm || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:assemblyscript-worker] compile start prepare=${String(prepare)} activePath=${activePath} bytes=${source.length}`
				);
			}
			if (!compilerPromise) {
				compilerPromise = (await loadRuntime(runtimeModuleUrl)).loadCompiler();
			}
			const files: Record<string, string> = {};
			for (const file of workspaceFiles) {
				files[file.path] = file.content;
			}
			files[activePath] = source;
			const compiler = await compilerPromise;
			if (!compiler.main) {
				throw new Error('AssemblyScript compiler main export was not found.');
			}
			const outputFiles: Record<string, Uint8Array | string> = {};
			let stdoutText = '';
			let stderrText = '';
			const stdout = {
				write(chunk: Uint8Array | string) {
					stdoutText += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
				},
				toString() {
					return stdoutText;
				}
			};
			const stderr = {
				write(chunk: Uint8Array | string) {
					stderrText += typeof chunk === 'string' ? chunk : decoder.decode(chunk);
				},
				toString() {
					return stderrText;
				}
			};
			const compileResult = await compiler.main(
				[
					activePath,
					'--outFile',
					'module.wasm',
					'--runtime',
					'incremental',
					'--bindings',
					'raw',
					'--optimize',
					'--exportRuntime'
				],
				{
					stdout,
					stderr,
					readFile(filePath) {
						return files[filePath] ?? null;
					},
					writeFile(filePath, contents) {
						outputFiles[filePath] = contents;
					},
					listFiles(dirPath) {
						const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
						return Object.keys(files).filter((filePath) => filePath.startsWith(prefix));
					}
				}
			);
			const outputWasm = outputFiles['module.wasm'];
			const result = {
				error: compileResult.error,
				stdout: String(compileResult.stdout ?? stdout),
				stderr: String(compileResult.stderr ?? stderr),
				wasm: typeof outputWasm === 'string' ? encoder.encode(outputWasm) : outputWasm,
				files: outputFiles
			};
			if (log) {
				console.log(
					`[wasm-idle:assemblyscript-worker] compile settled success=${String(!result.error && Boolean(result.wasm))} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (result.stderr) postMessage({ output: result.stderr });
			if (result.error || !result.wasm) {
				const message =
					result.stderr || result.error?.message || 'AssemblyScript compilation failed';
				const locationMatch = message.match(/in ([^(]+)\((\d+),(\d+)\)/);
				postMessage({
					diagnostic: {
						fileName: locationMatch?.[1] || activePath,
						lineNumber: Math.max(1, Number(locationMatch?.[2] || 1)),
						columnNumber: Math.max(1, Number(locationMatch?.[3] || 1)),
						severity: 'error',
						message
					}
				});
				throw new Error(message);
			}
			compiledWasm =
				result.wasm instanceof Uint8Array ? result.wasm : new Uint8Array(result.wasm);
			compiledCacheKey = compileCacheKey;
			compiledReturnTypes = {};
			const declarationFile = result.files['module.d.ts'];
			if (typeof declarationFile === 'string') {
				const exportPattern = /export function ([A-Za-z_$][\w$]*)\(([^)]*)\): ([^;]+);/g;
				let match: RegExpExecArray | null;
				while ((match = exportPattern.exec(declarationFile))) {
					if (!match[2].trim()) compiledReturnTypes[match[1]] = match[3].trim();
				}
			}
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		let activeExports: (Record<string, unknown> & AssemblyScriptRuntimeExports) | null = null;
		const stdinReader = new AssemblyScriptStdin(
			stdin,
			buffer ? new Int32Array(buffer) : null,
			Boolean(log)
		);
		const createAssemblyScriptString = (value: string | null) => {
			if (value == null) return 0;
			if (!activeExports?.__newString) {
				throw new Error('AssemblyScript runtime string allocator is unavailable');
			}
			return activeExports.__newString(value);
		};
		const imports = {
			env: {
				seed() {
					return Math.floor(Math.random() * 0x7fffffff);
				},
				readByte() {
					return stdinReader.readByte();
				},
				readLine() {
					return createAssemblyScriptString(stdinReader.readLine());
				},
				readAll() {
					return createAssemblyScriptString(stdinReader.readAll());
				},
				abort(message: number, fileName: number, lineNumber: number, columnNumber: number) {
					const text = activeExports?.__getString
						? activeExports.__getString(message >>> 0)
						: 'abort';
					const file = activeExports?.__getString
						? activeExports.__getString(fileName >>> 0)
						: activePath;
					throw new Error(
						`${text || 'abort'} in ${file || activePath}:${lineNumber}:${columnNumber}`
					);
				},
				trace(message: number, numArgs = 0, ...args: number[]) {
					const text = activeExports?.__getString
						? activeExports.__getString(message >>> 0)
						: 'trace';
					const suffix = args.slice(0, numArgs).map(String).join(', ');
					postMessage({ output: suffix ? `${text}: ${suffix}\n` : `${text}\n` });
				}
			}
		};
		const runtime = await loadRuntime(runtimeModuleUrl);
		const instance = await runtime.instantiate<Record<string, unknown>>(compiledWasm, imports);
		activeExports = instance.exports;
		const getString = activeExports.__getString;
		const preferredExportName =
			typeof activeExports._start === 'function'
				? '_start'
				: typeof activeExports.main === 'function'
					? 'main'
					: '';
		let printed = false;

		if (preferredExportName) {
			const value = (activeExports[preferredExportName] as () => unknown)();
			const returnType = compiledReturnTypes[preferredExportName] || '';
			if (returnType === 'string' && typeof value === 'number' && getString) {
				postMessage({
					output: `${preferredExportName}=${getString(value >>> 0)}\n`
				});
				printed = true;
			} else if (returnType === 'boolean' && typeof value === 'number') {
				postMessage({ output: `${preferredExportName}=${value !== 0}\n` });
				printed = true;
			} else if (typeof value === 'number' || typeof value === 'bigint') {
				postMessage({ output: `${preferredExportName}=${String(value)}\n` });
				printed = true;
			}
		} else {
			for (const [name, value] of Object.entries(activeExports)) {
				if (
					name.startsWith('_') ||
					name === 'memory' ||
					name === 'table' ||
					typeof value !== 'function'
				) {
					continue;
				}
				try {
					const result = (value as () => unknown)();
					const returnType = compiledReturnTypes[name] || '';
					if (returnType === 'string' && typeof result === 'number' && getString) {
						postMessage({
							output: `${name}=${getString(result >>> 0)}\n`
						});
						printed = true;
					} else if (returnType === 'boolean' && typeof result === 'number') {
						postMessage({ output: `${name}=${result !== 0}\n` });
						printed = true;
					} else if (typeof result === 'number' || typeof result === 'bigint') {
						postMessage({ output: `${name}=${String(result)}\n` });
						printed = true;
					}
				} catch {
					// Exports that need parameters are valid but are not auto-run.
				}
			}
		}

		if (!printed && !preferredExportName) {
			const exportNames = Object.keys(activeExports).sort().join(', ');
			postMessage({
				output: exportNames ? `exports: ${exportNames}\n` : 'compiled WebAssembly module\n'
			});
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:assemblyscript-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
