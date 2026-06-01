import { LuaFactory } from 'wasmoon';

export type BrowserLuaDiagnosticSeverity = 'error' | 'warning' | 'other';

export interface BrowserLuaDiagnostic {
	fileName?: string | null;
	lineNumber: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity: BrowserLuaDiagnosticSeverity;
	message: string;
}

export interface BrowserLuaCompileRequest {
	code: string;
	fileName?: string;
	log?: boolean;
	wasmUrl?: string;
}

export interface BrowserLuaArtifact {
	source: string;
	fileName: string;
}

export interface BrowserLuaCompileResult {
	success: boolean;
	artifact?: BrowserLuaArtifact;
	diagnostics: BrowserLuaDiagnostic[];
	stdout: string;
	stderr: string;
}

export interface BrowserLuaCompiler {
	compile(request: BrowserLuaCompileRequest): Promise<BrowserLuaCompileResult>;
}

export interface BrowserLuaCompilerOptions {
	wasmUrl?: string;
}

export type BrowserLuaCompilerFactory = (
	options?: BrowserLuaCompilerOptions | string
) => Promise<BrowserLuaCompiler>;

export interface BrowserLuaExecutionOptions {
	args?: string[];
	stdin?: () => string | null;
	stdout?: (chunk: string) => void;
	stderr?: (chunk: string) => void;
	wasmUrl?: string;
}

export interface BrowserLuaExecutionResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

const luaFactories = new Map<string, LuaFactory>();

function defaultLuaWasmUrl() {
	if (/\/src\/index\.ts(?:$|\?)/u.test(import.meta.url)) {
		return new URL('../dist/glue.wasm', import.meta.url).href;
	}
	return new URL('./glue.wasm', import.meta.url).href;
}

function normalizeWasmUrl(value?: string) {
	return value && value.trim() ? value.trim() : defaultLuaWasmUrl();
}

function getLuaFactory(wasmUrl?: string) {
	const normalized = normalizeWasmUrl(wasmUrl);
	let factory = luaFactories.get(normalized);
	if (!factory) {
		factory = new LuaFactory(normalized);
		luaFactories.set(normalized, factory);
	}
	return factory;
}

function parseLuaDiagnostic(error: unknown, fileName: string): BrowserLuaDiagnostic {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const cleanMessage = rawMessage.replace(/^Error:\s*/u, '').trim();
	const match = /^([^:\n]+):(\d+):\s*([\s\S]*)$/u.exec(cleanMessage);
	return {
		fileName: match?.[1] || fileName,
		lineNumber: Number(match?.[2] || 1),
		severity: 'error',
		message: (match?.[3] || cleanMessage || rawMessage).trim()
	};
}

function luaStringLiteral(value: string) {
	return `"${value
		.replace(/\\/gu, '\\\\')
		.replace(/"/gu, '\\"')
		.replace(/\n/gu, '\\n')
		.replace(/\r/gu, '\\r')
		.replace(/\t/gu, '\\t')}"`;
}

function createLuaArgBootstrap(fileName: string, args: string[]) {
	const entries = [`[0] = ${luaStringLiteral(fileName)}`];
	for (const [index, arg] of args.entries()) {
		entries.push(`[${index + 1}] = ${luaStringLiteral(arg)}`);
	}
	return `arg = { ${entries.join(', ')} }`;
}

function createLuaStdinReader(stdin: BrowserLuaExecutionOptions['stdin']) {
	let buffer = '';
	let eof = false;
	const readMore = () => {
		if (eof || !stdin) return false;
		const chunk = stdin();
		if (chunk == null) {
			eof = true;
			return false;
		}
		buffer += String(chunk);
		return true;
	};

	return (mode: unknown = '*l') => {
		const normalizedMode = String(mode || '*l');
		if (normalizedMode === '*a' || normalizedMode === 'a') {
			while (readMore()) {}
			const value = buffer;
			buffer = '';
			return value;
		}

		const numericMode =
			typeof mode === 'number'
				? Math.max(0, Math.trunc(mode))
				: /^\d+$/u.test(normalizedMode)
					? Number(normalizedMode)
					: null;
		if (numericMode !== null) {
			while (buffer.length < numericMode && readMore()) {}
			if (!buffer && eof) return null;
			const value = buffer.slice(0, numericMode);
			buffer = buffer.slice(numericMode);
			return value;
		}

		while (!buffer.includes('\n') && readMore()) {}
		if (!buffer && eof) return null;
		const newlineIndex = buffer.indexOf('\n');
		if (newlineIndex === -1) {
			const value = buffer.replace(/\r$/u, '');
			buffer = '';
			return value || null;
		}
		const value = buffer.slice(0, newlineIndex).replace(/\r$/u, '');
		buffer = buffer.slice(newlineIndex + 1);
		return value;
	};
}

function formatLuaValue(value: unknown) {
	if (value === null || value === undefined) return 'nil';
	return String(value);
}

export async function compileLua(
	request: BrowserLuaCompileRequest
): Promise<BrowserLuaCompileResult> {
	const fileName = request.fileName || 'main.lua';
	const factory = getLuaFactory(request.wasmUrl);
	const lua = await factory.createEngine();
	try {
		lua.global.set('__wasm_idle_source', request.code);
		lua.global.set('__wasm_idle_chunk_name', `@${fileName}`);
		await lua.doString(`
local chunk, err = load(__wasm_idle_source, __wasm_idle_chunk_name)
if not chunk then
  error(err, 0)
end
`);
		return {
			success: true,
			artifact: {
				source: request.code,
				fileName
			},
			diagnostics: [],
			stdout: '',
			stderr: ''
		};
	} catch (error) {
		const diagnostic = parseLuaDiagnostic(error, fileName);
		return {
			success: false,
			diagnostics: [diagnostic],
			stdout: '',
			stderr: diagnostic.message
		};
	} finally {
		lua.global.close();
	}
}

export async function createLuaCompiler(
	options: BrowserLuaCompilerOptions | string = {}
): Promise<BrowserLuaCompiler> {
	const wasmUrl = typeof options === 'string' ? options : options.wasmUrl;
	getLuaFactory(wasmUrl);
	return {
		compile: (request) =>
			compileLua({
				...request,
				wasmUrl: request.wasmUrl || wasmUrl
			})
	};
}

export async function executeBrowserLuaArtifact(
	artifact: BrowserLuaArtifact,
	options: BrowserLuaExecutionOptions = {}
): Promise<BrowserLuaExecutionResult> {
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

	const factory = getLuaFactory(options.wasmUrl);
	const lua = await factory.createEngine();
	try {
		lua.global.set('print', (...values: unknown[]) => {
			stdout(`${values.map(formatLuaValue).join('\t')}\n`);
		});
		lua.global.set('__wasm_idle_read_stdin', createLuaStdinReader(options.stdin));
		await lua.doString(createLuaArgBootstrap(artifact.fileName, options.args || []));
		await lua.doString(`
if io then
  io.read = function(mode)
    if mode == nil then
      mode = "*l"
    end
    return __wasm_idle_read_stdin(mode)
  end
end
`);
		await lua.doString(artifact.source);
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
	} finally {
		lua.global.close();
	}
}

export default createLuaCompiler;
