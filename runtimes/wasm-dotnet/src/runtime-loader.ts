import type {
	DotnetLanguage,
	DotnetRuntimeCompileRequest,
	DotnetRuntimeCompileResponse,
	DotnetRuntimeRunRequest,
	DotnetRuntimeRunResponse
} from './types.js';

export interface DotnetCompilerRuntimeOptions {
	language?: DotnetLanguage;
	runtimeBaseUrl?: string | URL;
	dotnetJsUrl?: string | URL;
	mainAssemblyName?: string;
	dotnetModule?: unknown;
	diagnosticTracing?: boolean;
	onFatalError?: (error: Error) => void;
}

export interface DotnetCompilerRuntime {
	compile(request: DotnetRuntimeCompileRequest): Promise<DotnetRuntimeCompileResponse>;
	run(request: DotnetRuntimeRunRequest): Promise<DotnetRuntimeRunResponse>;
}

type DotnetBuilder = {
	withModuleConfig?: (config: {
		onAbort: (reason: unknown) => void;
		onExit: (code: number) => void;
	}) => DotnetBuilder;
	withConfig?: (config: Record<string, unknown>) => DotnetBuilder;
	withDiagnosticTracing?: (enabled: boolean) => DotnetBuilder;
	create: () => Promise<{
		getAssemblyExports?: (assemblyName: string) => Promise<Record<string, unknown>>;
		getConfig?: () => { mainAssemblyName?: string };
	}>;
};

type RuntimeBridge = {
	Compile?: (requestJson: string) => string | Promise<string>;
	compile?: (requestJson: string) => string | Promise<string>;
	Run?: (requestJson: string) => string | Promise<string>;
	run?: (requestJson: string) => string | Promise<string>;
};

const runtimePromises = new Map<string, Promise<DotnetCompilerRuntime>>();

export function resolveDotnetRuntimeBaseUrl(options: DotnetCompilerRuntimeOptions = {}) {
	if (options.runtimeBaseUrl) {
		return new URL(options.runtimeBaseUrl, globalThis.location?.href || import.meta.url);
	}
	return new URL(`./runtime/${options.language || 'fsharp'}/`, import.meta.url);
}

function resolveDotnetJsUrl(options: DotnetCompilerRuntimeOptions) {
	if (options.dotnetJsUrl) {
		return new URL(
			options.dotnetJsUrl,
			globalThis.location?.href || import.meta.url
		).toString();
	}
	return new URL('dotnet.js', resolveDotnetRuntimeBaseUrl(options)).toString();
}

function getDotnetBuilder(module: unknown): DotnetBuilder {
	const record = module as Record<string, unknown>;
	const dotnet =
		record?.dotnet || (record?.default as Record<string, unknown> | undefined)?.dotnet;
	if (!dotnet || typeof (dotnet as DotnetBuilder).create !== 'function') {
		throw new Error('wasm-dotnet expected a dotnet.js module exporting dotnet.create().');
	}
	return dotnet as DotnetBuilder;
}

function readPath(root: unknown, path: string[]) {
	let current = root;
	for (const part of path) {
		if (!current || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

function findBridge(exports: Record<string, unknown>): RuntimeBridge {
	const candidates = [
		readPath(exports, ['WasmDotnet', 'Compiler', 'CompilerHost']),
		readPath(exports, ['WasmDotnet.Compiler', 'CompilerHost']),
		readPath(exports, ['CompilerHost']),
		exports
	];
	for (const candidate of candidates) {
		const bridge = candidate as RuntimeBridge | undefined;
		if (
			bridge &&
			(typeof bridge.Compile === 'function' || typeof bridge.compile === 'function') &&
			(typeof bridge.Run === 'function' || typeof bridge.run === 'function')
		) {
			return bridge;
		}
	}
	throw new Error(
		'wasm-dotnet runtime did not export CompilerHost.Compile and CompilerHost.Run.'
	);
}

async function callJson<T>(
	method: (requestJson: string) => string | Promise<string>,
	payload: unknown
) {
	const response = await method(JSON.stringify(payload));
	return JSON.parse(response) as T;
}

export function resetDotnetCompilerRuntimeForTests() {
	runtimePromises.clear();
}

export async function loadDotnetCompilerRuntime(
	options: DotnetCompilerRuntimeOptions = {}
): Promise<DotnetCompilerRuntime> {
	const dotnetJsUrl = resolveDotnetJsUrl(options);
	const key = `${dotnetJsUrl}\n${options.mainAssemblyName || ''}\n${options.dotnetModule ? 'injected' : ''}\n${options.diagnosticTracing ? 'trace' : ''}`;
	const cached = runtimePromises.get(key);
	if (cached) return await cached;
	const promise: Promise<DotnetCompilerRuntime> = Promise.resolve().then(async () => {
		const dotnetModule = options.dotnetModule || (await import(/* @vite-ignore */ dotnetJsUrl));
		let builder = getDotnetBuilder(dotnetModule);
		let fatalError: Error | undefined;
		const pending = new Set<(error: Error) => void>();
		const abort = (reason: unknown) => {
			if (fatalError) return;
			fatalError = reason instanceof Error ? reason : new Error(String(reason));
			for (const reject of pending) reject(fatalError);
			pending.clear();
			if (runtimePromises.get(key) === promise) runtimePromises.delete(key);
			try {
				options.onFatalError?.(fatalError);
			} catch {
				// Notification errors must not replace the original runtime failure.
			}
		};
		const call = <T>(action: () => Promise<T>): Promise<T> => {
			if (fatalError) return Promise.reject(fatalError);
			return new Promise<T>((resolve, reject) => {
				pending.add(reject);
				void Promise.resolve()
					.then(() => {
						if (fatalError) throw fatalError;
						return action();
					})
					.then(resolve, reject)
					.finally(() => pending.delete(reject));
			});
		};
		if (builder.withModuleConfig) {
			builder = builder.withModuleConfig({
				onAbort: abort,
				onExit: (code) => abort(new Error(`.NET runtime exited with code ${code}`))
			});
		}
		if (builder.withConfig) {
			builder = builder.withConfig({
				jsThreadBlockingMode: 'DangerousAllowBlockingWait'
			});
		}
		if (builder.withDiagnosticTracing) {
			builder = builder.withDiagnosticTracing(Boolean(options.diagnosticTracing));
		}
		const runtime = await call(() => builder.create());
		if (typeof runtime.getAssemblyExports !== 'function') {
			throw new Error('wasm-dotnet runtime did not expose getAssemblyExports().');
		}
		const assemblyName =
			options.mainAssemblyName ||
			runtime.getConfig?.().mainAssemblyName ||
			'WasmDotnet.Compiler.dll';
		const getAssemblyExports = runtime.getAssemblyExports.bind(runtime);
		const exports = await call(() => getAssemblyExports(assemblyName));
		const bridge = findBridge(exports);
		const compile = bridge.Compile || bridge.compile;
		const run = bridge.Run || bridge.run;
		if (!compile || !run) {
			throw new Error('wasm-dotnet compiler bridge is incomplete.');
		}
		return {
			compile(request) {
				return call(() =>
					callJson<DotnetRuntimeCompileResponse>(compile.bind(bridge), request)
				);
			},
			run(request) {
				return call(() => callJson<DotnetRuntimeRunResponse>(run.bind(bridge), request));
			}
		};
	});
	runtimePromises.set(key, promise);
	try {
		return await promise;
	} catch (error) {
		if (runtimePromises.get(key) === promise) {
			runtimePromises.delete(key);
		}
		throw error;
	}
}
