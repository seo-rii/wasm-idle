import wabtFactory from 'wabt';

export type BrowserWatDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface BrowserWatDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: BrowserWatDiagnosticSeverity;
	message: string;
}

export interface BrowserWatCompileRequest {
	code: string;
	fileName?: string;
	log?: boolean;
	features?: Record<string, boolean>;
}

export interface BrowserWatArtifact {
	wasm: Uint8Array;
	source: string;
	fileName: string;
	log: string;
}

export interface BrowserWatCompileResult {
	success: boolean;
	artifact?: BrowserWatArtifact;
	diagnostics: BrowserWatDiagnostic[];
	stdout: string;
	stderr: string;
}

export interface BrowserWatCompiler {
	compile(request: BrowserWatCompileRequest): Promise<BrowserWatCompileResult>;
}

export type BrowserWatCompilerFactory = () => Promise<BrowserWatCompiler>;

export interface BrowserWatExecutionOptions {
	imports?: WebAssembly.Imports;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
}

export interface BrowserWatExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

let wabtPromise: ReturnType<typeof wabtFactory> | null = null;

export async function compileWat(
	request: BrowserWatCompileRequest
): Promise<BrowserWatCompileResult> {
	const fileName = request.fileName || 'main.wat';
	let parsedModule: any = null;
	try {
		const wabt = await (wabtPromise ??= wabtFactory());
		parsedModule = wabt.parseWat(fileName, request.code, request.features as never);
		parsedModule.resolveNames();
		parsedModule.validate();
		const binary = parsedModule.toBinary({
			log: Boolean(request.log),
			write_debug_names: true
		});
		return {
			success: true,
			artifact: {
				wasm: binary.buffer,
				source: request.code,
				fileName,
				log: binary.log || ''
			},
			diagnostics: [],
			stdout: request.log && binary.log ? binary.log : '',
			stderr: ''
		};
	} catch (error) {
		const rawMessage = error instanceof Error ? error.message : String(error);
		const cleanMessage = rawMessage.replace(/^parseWat failed:\n?/u, '').trim();
		const match = /([^:\n]+):(\d+):(\d+):\s*(error|warning):\s*([\s\S]*)/u.exec(cleanMessage);
		const diagnostic: BrowserWatDiagnostic = {
			fileName: match?.[1] || fileName,
			lineNumber: Number(match?.[2] || 1),
			severity: match?.[4] === 'warning' ? 'warning' : 'error',
			message: (match?.[5] || cleanMessage || rawMessage).trim()
		};
		if (match?.[3]) diagnostic.columnNumber = Number(match[3]);
		return {
			success: false,
			diagnostics: [diagnostic],
			stdout: '',
			stderr: diagnostic.message
		};
	} finally {
		parsedModule?.destroy();
	}
}

export async function createWatCompiler(): Promise<BrowserWatCompiler> {
	await (wabtPromise ??= wabtFactory());
	return {
		compile: compileWat
	};
}

export async function executeBrowserWatArtifact(
	artifact: BrowserWatArtifact,
	options: BrowserWatExecutionOptions = {}
): Promise<BrowserWatExecutionResult> {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const stdout = (chunk: string) => {
		stdoutChunks.push(chunk);
		options.stdout?.(chunk);
	};
	const stderr = (chunk: string) => {
		stderrChunks.push(chunk);
		options.stderr?.(chunk);
	};

	try {
		const wasmBytes =
			artifact.wasm instanceof Uint8Array ? artifact.wasm : new Uint8Array(artifact.wasm);
		const wasm = new Uint8Array(wasmBytes.byteLength);
		wasm.set(wasmBytes);
		const compiledModule = await WebAssembly.compile(wasm);
		const instance = await WebAssembly.instantiate(compiledModule, options.imports || {});
		const exports = instance.exports;
		const preferredExportName =
			typeof exports._start === 'function'
				? '_start'
				: typeof exports.main === 'function'
					? 'main'
					: '';
		let printed = false;

		if (preferredExportName) {
			const value = (exports[preferredExportName] as () => unknown)();
			if (typeof value === 'number' || typeof value === 'bigint') {
				stdout(`${preferredExportName}=${String(value)}\n`);
				printed = true;
			}
		} else {
			for (const [name, value] of Object.entries(exports)) {
				if (name.startsWith('_') || typeof value !== 'function') continue;
				try {
					const result = (value as () => unknown)();
					if (typeof result === 'number' || typeof result === 'bigint') {
						stdout(`${name}=${String(result)}\n`);
						printed = true;
					}
				} catch {
					// Exports that need parameters are still valid; they just are not auto-run.
				}
			}
		}

		if (!printed && !preferredExportName) {
			const exportNames = Object.keys(exports).sort().join(', ');
			stdout(exportNames ? `exports: ${exportNames}\n` : 'compiled WebAssembly module\n');
		}

		return {
			exitCode: 0,
			stdout: stdoutChunks.join(''),
			stderr: stderrChunks.join('')
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr(`${message}\n`);
		return {
			exitCode: 1,
			stdout: stdoutChunks.join(''),
			stderr: stderrChunks.join('')
		};
	}
}

export default createWatCompiler;
