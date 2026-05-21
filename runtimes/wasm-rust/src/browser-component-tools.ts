import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { resolveRuntimeAssetUrl } from './runtime-manifest.js';

export const JCO_BROWSER_MODULE = '../vendor/jco/src/browser.js';
export const JCO_WASM_TOOLS_MODULE = '../vendor/jco/obj/wasm-tools.js';
export const PREVIEW1_COMMAND_ADAPTER = '../vendor/jco/lib/wasi_snapshot_preview1.command.wasm';
export const PREVIEW2_CLI_MODULE = '../vendor/preview2-shim/lib/browser/cli.js';
export const PREVIEW2_CLOCKS_MODULE = '../vendor/preview2-shim/lib/browser/clocks.js';
export const PREVIEW2_FILESYSTEM_MODULE = '../vendor/preview2-shim/lib/browser/filesystem.js';
export const PREVIEW2_HTTP_MODULE = '../vendor/preview2-shim/lib/browser/http.js';
export const PREVIEW2_IO_MODULE = '../vendor/preview2-shim/lib/browser/io.js';
export const PREVIEW2_RANDOM_MODULE = '../vendor/preview2-shim/lib/browser/random.js';
export const PREVIEW2_SOCKETS_MODULE = '../vendor/preview2-shim/lib/browser/sockets.js';
export const PREVIEW2_COMPONENT_RUNTIME_ASSETS = [
	JCO_BROWSER_MODULE,
	JCO_WASM_TOOLS_MODULE,
	PREVIEW1_COMMAND_ADAPTER,
	PREVIEW2_CLI_MODULE,
	PREVIEW2_CLOCKS_MODULE,
	PREVIEW2_FILESYSTEM_MODULE,
	PREVIEW2_HTTP_MODULE,
	PREVIEW2_IO_MODULE,
	PREVIEW2_RANDOM_MODULE,
	PREVIEW2_SOCKETS_MODULE
] as const;
const symbolDispose = Symbol.dispose ?? Symbol.for('dispose');

async function importRuntimeModule<T>(runtimeBaseUrl: string, assetPath: string): Promise<T> {
	return (await import(
		/* @vite-ignore */ resolveRuntimeAssetUrl(runtimeBaseUrl, assetPath)
	)) as T;
}

export async function componentizeCoreWasmToPreview2Component(
	coreWasm: Uint8Array,
	runtimeBaseUrl: string,
	onProgress?: (progress: { loaded: number; total?: number }) => void
) {
	const wasmToolsModule = await importRuntimeModule<{
		$init: Promise<void>;
		tools: {
			componentNew: (
				binary: Uint8Array,
				adapters: Array<[string, Uint8Array]>
			) => Uint8Array;
		};
	}>(runtimeBaseUrl, JCO_WASM_TOOLS_MODULE);
	const adapterUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, PREVIEW1_COMMAND_ADAPTER);
	const adapterBytes = await fetchRuntimeAssetBytes(
		adapterUrl,
		'wasm-rust preview1 adapter',
		fetch,
		true,
		onProgress
	);
	await wasmToolsModule.$init;
	return wasmToolsModule.tools.componentNew(coreWasm, [['wasi_snapshot_preview1', adapterBytes]]);
}

export async function transpilePreview2Component(
	componentBytes: Uint8Array,
	runtimeBaseUrl: string,
	name = 'component'
) {
	const browserModule = await importRuntimeModule<{
		generate: (
			component: Uint8Array,
			options: {
				name: string;
				instantiation: { tag: 'async' };
				noTypescript: boolean;
				noNodejsCompat: boolean;
				map: string[][];
			}
		) => Promise<{
			files: Array<[string, Uint8Array]>;
			imports: string[];
			exports: Array<[string, 'function' | 'instance']>;
		}>;
	}>(runtimeBaseUrl, JCO_BROWSER_MODULE);
	const generated = await browserModule.generate(componentBytes, {
		name,
		instantiation: { tag: 'async' },
		noTypescript: true,
		noNodejsCompat: true,
		map: []
	});
	return {
		files: new Map(generated.files),
		imports: generated.imports,
		exports: generated.exports
	};
}

export interface CreatePreview2ImportObjectDependencies {
	importRuntimeModule?: <T>(runtimeBaseUrl: string, assetPath: string) => Promise<T>;
}

interface Preview2CliModule {
	_setStdin: (handler: {
		blockingRead: (contents: bigint) => Uint8Array;
		subscribe?: () => unknown;
		[key: symbol]: () => void;
	}) => void;
	_setStdout: (handler: {
		write: (contents: Uint8Array) => bigint;
		blockingFlush: () => void;
	}) => void;
	_setStderr: (handler: {
		write: (contents: Uint8Array) => bigint;
		blockingFlush: () => void;
	}) => void;
	environment: {
		getEnvironment: () => Array<[string, string]>;
		getArguments: () => string[];
		initialCwd: () => string;
	};
	exit: unknown;
	stderr: unknown;
	stdin: unknown;
	stdout: unknown;
	terminalInput: unknown;
	terminalOutput: unknown;
	terminalStderr: unknown;
	terminalStdin: unknown;
	terminalStdout: unknown;
}

interface Preview2FilesystemModule {
	preopens: unknown;
	types: {
		Descriptor: unknown;
	};
}

interface Preview2IoModule {
	error: unknown;
	poll: unknown;
	streams: unknown;
}

interface Preview2RandomModule {
	random: unknown;
	insecure: unknown;
	insecureSeed: unknown;
}

interface Preview2ClocksModule {
	monotonicClock: unknown;
	wallClock: unknown;
}

interface Preview2SocketsModule {
	instanceNetwork: unknown;
	ipNameLookup: unknown;
	network: unknown;
	tcp: unknown;
	tcpCreateSocket: unknown;
	udp: unknown;
	udpCreateSocket: unknown;
}

interface Preview2HttpModule {
	types: unknown;
	outgoingHandler: unknown;
}

export async function createPreview2ImportObject(
	runtimeBaseUrl: string,
	options: {
		args?: string[];
		env?: Record<string, string>;
		requiredImports?: string[];
		stdin?: {
			blockingRead: (length: number) => Uint8Array;
		};
		stdout?: (chunk: Uint8Array) => void;
		stderr?: (chunk: Uint8Array) => void;
	} = {},
	dependencies: CreatePreview2ImportObjectDependencies = {}
) {
	const loadModule = dependencies.importRuntimeModule || importRuntimeModule;
	let cliModule: Preview2CliModule | null = null;
	let filesystemModule: Preview2FilesystemModule | null = null;
	let ioModule: Preview2IoModule | null = null;
	let randomModule: Preview2RandomModule | null = null;
	let clocksModule: Preview2ClocksModule | null = null;
	let socketsModule: Preview2SocketsModule | null = null;
	let httpModule: Preview2HttpModule | null = null;
	const requestedVersionSuffixes = new Set<string>(['', '@0.2.3']);

	const requiredFamilies = new Set<
		'cli' | 'filesystem' | 'io' | 'random' | 'clocks' | 'sockets' | 'http'
	>();
	if (options.requiredImports && options.requiredImports.length > 0) {
		for (const requestedImport of options.requiredImports) {
			const versionMatch = requestedImport.match(/(@.+)$/);
			if (versionMatch) {
				const versionSuffix = versionMatch[1];
				if (!versionSuffix) {
					continue;
				}
				if (!/^@0\.2(?:\.|$)/.test(versionSuffix)) {
					throw new Error(
						`wasm-rust browser runtime currently provides only WASIp2 browser shims; unsupported component import ${requestedImport}. wasm32-wasip3 works in-browser only while emitted components stay on transitional WASIp2 imports.`
					);
				}
				requestedVersionSuffixes.add(versionSuffix);
			}
			const normalizedImport = requestedImport.replace(/@\d+(?:\.\d+)*$/, '');
			if (normalizedImport.startsWith('wasi:cli/')) {
				requiredFamilies.add('cli');
				continue;
			}
			if (normalizedImport.startsWith('wasi:filesystem/')) {
				requiredFamilies.add('filesystem');
				continue;
			}
			if (normalizedImport.startsWith('wasi:io/')) {
				requiredFamilies.add('io');
				continue;
			}
			if (normalizedImport.startsWith('wasi:random/')) {
				requiredFamilies.add('random');
				continue;
			}
			if (normalizedImport.startsWith('wasi:clocks/')) {
				requiredFamilies.add('clocks');
				continue;
			}
			if (normalizedImport.startsWith('wasi:sockets/')) {
				requiredFamilies.add('sockets');
				continue;
			}
			if (normalizedImport.startsWith('wasi:http/')) {
				requiredFamilies.add('http');
			}
		}
	}
	if (requiredFamilies.size === 0) {
		requiredFamilies.add('cli');
		requiredFamilies.add('filesystem');
		requiredFamilies.add('io');
		requiredFamilies.add('random');
		requiredFamilies.add('clocks');
		requiredFamilies.add('sockets');
		requiredFamilies.add('http');
	}

	const moduleLoads: Array<Promise<void>> = [];
	if (requiredFamilies.has('cli')) {
		moduleLoads.push(
			loadModule<Preview2CliModule>(runtimeBaseUrl, PREVIEW2_CLI_MODULE).then((module) => {
				cliModule = module;
			})
		);
	}
	if (requiredFamilies.has('filesystem')) {
		moduleLoads.push(
			loadModule<Preview2FilesystemModule>(runtimeBaseUrl, PREVIEW2_FILESYSTEM_MODULE).then(
				(module) => {
					filesystemModule = module;
				}
			)
		);
	}
	if (requiredFamilies.has('io')) {
		moduleLoads.push(
			loadModule<Preview2IoModule>(runtimeBaseUrl, PREVIEW2_IO_MODULE).then((module) => {
				ioModule = module;
			})
		);
	}
	if (requiredFamilies.has('random')) {
		moduleLoads.push(
			loadModule<Preview2RandomModule>(runtimeBaseUrl, PREVIEW2_RANDOM_MODULE).then((module) => {
				randomModule = module;
			})
		);
	}
	if (requiredFamilies.has('clocks')) {
		moduleLoads.push(
			loadModule<Preview2ClocksModule>(runtimeBaseUrl, PREVIEW2_CLOCKS_MODULE).then((module) => {
				clocksModule = module;
			})
		);
	}
	if (requiredFamilies.has('sockets')) {
		moduleLoads.push(
			loadModule<Preview2SocketsModule>(runtimeBaseUrl, PREVIEW2_SOCKETS_MODULE).then(
				(module) => {
					socketsModule = module;
				}
			)
		);
	}
	if (requiredFamilies.has('http')) {
		moduleLoads.push(
			loadModule<Preview2HttpModule>(runtimeBaseUrl, PREVIEW2_HTTP_MODULE).then((module) => {
				httpModule = module;
			})
		);
	}
	await Promise.all(moduleLoads);

	if (!cliModule) {
		throw new Error('preview2 cli shim is required to create a runnable import object');
	}
	const resolvedCliModule = cliModule as Preview2CliModule;
	const resolvedFilesystemModule = filesystemModule as Preview2FilesystemModule | null;
	const resolvedIoModule = ioModule as Preview2IoModule | null;
	const resolvedRandomModule = randomModule as Preview2RandomModule | null;
	const resolvedClocksModule = clocksModule as Preview2ClocksModule | null;
	const resolvedSocketsModule = socketsModule as Preview2SocketsModule | null;
	const resolvedHttpModule = httpModule as Preview2HttpModule | null;

	if (options.stdin) {
		resolvedCliModule._setStdin({
			blockingRead(contents: bigint) {
				return options.stdin?.blockingRead(Number(contents)) || new Uint8Array(0);
			},
			[symbolDispose]() {}
		});
	}
	if (options.stdout) {
		resolvedCliModule._setStdout({
			write(contents: Uint8Array) {
				options.stdout?.(contents);
				return BigInt(contents.byteLength);
			},
			blockingFlush() {}
		});
	}
	if (options.stderr) {
		resolvedCliModule._setStderr({
			write(contents: Uint8Array) {
				options.stderr?.(contents);
				return BigInt(contents.byteLength);
			},
			blockingFlush() {}
		});
	}

	const importObject: Record<string, unknown> = {};
	const environment = {
		...resolvedCliModule.environment,
		getEnvironment() {
			return options.env
				? Object.entries(options.env)
				: resolvedCliModule.environment.getEnvironment();
		},
		getArguments() {
			return options.args || ['component.wasm'];
		},
		initialCwd() {
			return resolvedCliModule.environment.initialCwd();
		}
	};
	const preopens =
		resolvedFilesystemModule === null
			? null
			: {
					Descriptor: resolvedFilesystemModule.types.Descriptor,
					getDirectories() {
						return [];
					}
				};

	for (const versionSuffix of requestedVersionSuffixes) {
		if (requiredFamilies.has('cli')) {
			importObject[`wasi:cli/environment${versionSuffix}`] = environment;
			importObject[`wasi:cli/exit${versionSuffix}`] = resolvedCliModule.exit;
			importObject[`wasi:cli/stderr${versionSuffix}`] = resolvedCliModule.stderr;
			importObject[`wasi:cli/stdin${versionSuffix}`] = resolvedCliModule.stdin;
			importObject[`wasi:cli/stdout${versionSuffix}`] = resolvedCliModule.stdout;
			importObject[`wasi:cli/terminal-input${versionSuffix}`] = resolvedCliModule.terminalInput;
			importObject[`wasi:cli/terminal-output${versionSuffix}`] = resolvedCliModule.terminalOutput;
			importObject[`wasi:cli/terminal-stderr${versionSuffix}`] = resolvedCliModule.terminalStderr;
			importObject[`wasi:cli/terminal-stdin${versionSuffix}`] = resolvedCliModule.terminalStdin;
			importObject[`wasi:cli/terminal-stdout${versionSuffix}`] = resolvedCliModule.terminalStdout;
		}
		if (requiredFamilies.has('filesystem') && resolvedFilesystemModule && preopens) {
			importObject[`wasi:filesystem/preopens${versionSuffix}`] = preopens;
			importObject[`wasi:filesystem/types${versionSuffix}`] = resolvedFilesystemModule.types;
		}
		if (requiredFamilies.has('io') && resolvedIoModule) {
			importObject[`wasi:io/error${versionSuffix}`] = resolvedIoModule.error;
			importObject[`wasi:io/poll${versionSuffix}`] = resolvedIoModule.poll;
			importObject[`wasi:io/streams${versionSuffix}`] = resolvedIoModule.streams;
		}
		if (requiredFamilies.has('random') && resolvedRandomModule) {
			importObject[`wasi:random/random${versionSuffix}`] = resolvedRandomModule.random;
			importObject[`wasi:random/insecure${versionSuffix}`] = resolvedRandomModule.insecure;
			importObject[`wasi:random/insecure-seed${versionSuffix}`] = resolvedRandomModule.insecureSeed;
		}
		if (requiredFamilies.has('clocks') && resolvedClocksModule) {
			importObject[`wasi:clocks/monotonic-clock${versionSuffix}`] = resolvedClocksModule.monotonicClock;
			importObject[`wasi:clocks/wall-clock${versionSuffix}`] = resolvedClocksModule.wallClock;
		}
		if (requiredFamilies.has('sockets') && resolvedSocketsModule) {
			importObject[`wasi:sockets/instance-network${versionSuffix}`] = resolvedSocketsModule.instanceNetwork;
			importObject[`wasi:sockets/ip-name-lookup${versionSuffix}`] = resolvedSocketsModule.ipNameLookup;
			importObject[`wasi:sockets/network${versionSuffix}`] = resolvedSocketsModule.network;
			importObject[`wasi:sockets/tcp${versionSuffix}`] = resolvedSocketsModule.tcp;
			importObject[`wasi:sockets/tcp-create-socket${versionSuffix}`] = resolvedSocketsModule.tcpCreateSocket;
			importObject[`wasi:sockets/udp${versionSuffix}`] = resolvedSocketsModule.udp;
			importObject[`wasi:sockets/udp-create-socket${versionSuffix}`] = resolvedSocketsModule.udpCreateSocket;
		}
		if (requiredFamilies.has('http') && resolvedHttpModule) {
			importObject[`wasi:http/types${versionSuffix}`] = resolvedHttpModule.types;
			importObject[`wasi:http/outgoing-handler${versionSuffix}`] = resolvedHttpModule.outgoingHandler;
		}
	}

	return importObject;
}
