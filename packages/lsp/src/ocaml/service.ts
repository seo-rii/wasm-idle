import {
	positionAt,
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

export type OcamlLanguageServerTarget = 'js' | 'wasm';
export type OcamlLanguageServerEffectsMode = 'cps' | 'jspi';
export type OcamlLanguageServerBinaryenMode = 'fast' | 'full';

export interface OcamlWorkerOptions {
	moduleUrl: string;
	manifestUrl: string;
	target?: OcamlLanguageServerTarget;
	effectsMode?: OcamlLanguageServerEffectsMode;
	wasmBinaryenMode?: OcamlLanguageServerBinaryenMode;
	packages?: string[];
}

interface BrowserNativeManifestFile {
	path: string;
	url?: string;
	size?: number;
}

interface BrowserNativeManifestPackage {
	files?: BrowserNativeManifestFile[];
	[key: string]: unknown;
}

interface BrowserNativeManifest {
	findlibConf?: string;
	tools?: Record<string, string>;
	binaryenTools?: Record<string, string>;
	runtimePack?: {
		asset?: string;
		index?: string;
		[key: string]: unknown;
	};
	ocamlLibFiles?: BrowserNativeManifestFile[];
	packages?: BrowserNativeManifestPackage[];
	[key: string]: unknown;
}

interface OcamlCompilerDiagnostic {
	file?: string | null;
	fileName?: string | null;
	line?: number;
	lineNumber?: number;
	column?: number;
	columnNumber?: number;
	endColumn?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface OcamlCompilerResult {
	success: boolean;
	stdout?: string;
	stderr?: string;
	diagnostics?: OcamlCompilerDiagnostic[];
}

interface OcamlCompilerModule {
	compile(
		request: {
			files: Record<string, string>;
			entry: string;
			target: OcamlLanguageServerTarget;
			effectsMode?: OcamlLanguageServerEffectsMode;
			wasmBinaryenMode?: OcamlLanguageServerBinaryenMode;
			packages?: string[];
		},
		options: {
			system: unknown;
			toolchainRoot: string;
		}
	): Promise<OcamlCompilerResult>;
	createBrowserWorkerSystemDispatcher(options: { manifest: BrowserNativeManifest }): unknown;
}

interface OcamlWorkspaceFile {
	path: string;
	content: string;
}

interface OcamlCompilerHost {
	compile(request: {
		activePath: string;
		workspaceFiles: OcamlWorkspaceFile[];
		target: OcamlLanguageServerTarget;
		effectsMode: OcamlLanguageServerEffectsMode;
		wasmBinaryenMode: OcamlLanguageServerBinaryenMode;
		packages: string[];
	}): Promise<OcamlCompilerResult>;
}

type LoadOcamlCompilerHost = (
	options: OcamlWorkerOptions,
	context: LspDocumentContext
) => Promise<OcamlCompilerHost>;

const OCAML_KEYWORDS = [
	'and',
	'as',
	'assert',
	'begin',
	'class',
	'constraint',
	'do',
	'done',
	'downto',
	'else',
	'end',
	'exception',
	'external',
	'false',
	'for',
	'fun',
	'function',
	'functor',
	'if',
	'in',
	'include',
	'inherit',
	'initializer',
	'lazy',
	'let',
	'match',
	'method',
	'module',
	'mutable',
	'new',
	'nonrec',
	'object',
	'of',
	'open',
	'or',
	'private',
	'rec',
	'sig',
	'struct',
	'then',
	'to',
	'true',
	'try',
	'type',
	'val',
	'virtual',
	'when',
	'while',
	'with'
] as const;

const OCAML_MODULES = [
	'Array',
	'Bool',
	'Bytes',
	'Char',
	'Digest',
	'Either',
	'Float',
	'Format',
	'Fun',
	'Hashtbl',
	'Int',
	'Lazy',
	'List',
	'Map',
	'Option',
	'Printf',
	'Queue',
	'Random',
	'Result',
	'Seq',
	'Set',
	'String',
	'Sys'
] as const;

const OCAML_HOVER: Record<string, string> = {
	let: 'Binds a value or function.',
	rec: 'Allows a let binding to refer to itself.',
	fun: 'Creates an anonymous function.',
	function: 'Creates a pattern-matching function.',
	match: 'Pattern matches an expression.',
	module: 'Declares or references a module.',
	type: 'Declares a type.',
	open: 'Brings a module into scope.',
	Printf: 'Formatted output functions.',
	List: 'List operations.',
	Option: 'Optional value helpers.',
	Result: 'Success/error value helpers.',
	String: 'String operations.',
	Array: 'Mutable array operations.'
};

const normalizeWorkspacePath = (value: string, fallback = 'main.ml') => {
	const normalized = value
		.trim()
		.replaceAll('\\', '/')
		.replace(/^\/workspace\//u, '')
		.replace(/^\/+/u, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..')
		.join('/');
	return normalized || fallback;
};

const basename = (value: string) => {
	const normalized = normalizeWorkspacePath(value);
	const slashIndex = normalized.lastIndexOf('/');
	return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
};

const diagnosticSeverity = (severity: OcamlCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: OcamlCompilerDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber ?? diagnostic.line ?? 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber ?? diagnostic.column ?? 1) - 1);
	const endCharacter = Math.max(
		character + 1,
		Number(
			diagnostic.endColumnNumber ??
				diagnostic.endColumn ??
				diagnostic.columnNumber ??
				diagnostic.column ??
				character + 2
		) - 1
	);
	return {
		range: {
			start: { line, character },
			end: { line, character: endCharacter }
		},
		severity: diagnosticSeverity(diagnostic.severity),
		source: 'ocaml',
		message: String(diagnostic.message || 'OCaml diagnostic')
	};
};

const rewriteAbsoluteBundleUrl = (url: string | undefined, manifestUrl: string) => {
	if (!url || /^[a-z]+:/iu.test(url)) return url;
	const manifestLocation = new URL(manifestUrl, globalThis.location?.href || undefined);
	const basePath = manifestLocation.pathname.replace(
		/\/wasm-of-js-of-ocaml\/browser-native-bundle\/browser-native-manifest\.v1\.json$/u,
		''
	);
	return new URL(`${basePath}${url}`, manifestLocation.origin).toString();
};

const rewriteManifest = (manifest: BrowserNativeManifest, manifestUrl: string) => ({
	...manifest,
	...(manifest.findlibConf
		? { findlibConf: rewriteAbsoluteBundleUrl(manifest.findlibConf, manifestUrl) }
		: {}),
	...(manifest.tools
		? {
				tools: Object.fromEntries(
					Object.entries(manifest.tools).map(([key, value]) => [
						key,
						rewriteAbsoluteBundleUrl(value, manifestUrl) || value
					])
				)
			}
		: {}),
	...(manifest.binaryenTools
		? {
				binaryenTools: Object.fromEntries(
					Object.entries(manifest.binaryenTools).map(([key, value]) => [
						key,
						rewriteAbsoluteBundleUrl(value, manifestUrl) || value
					])
				)
			}
		: {}),
	...(manifest.runtimePack
		? {
				runtimePack: {
					...manifest.runtimePack,
					...(manifest.runtimePack.asset
						? {
								asset: rewriteAbsoluteBundleUrl(
									manifest.runtimePack.asset,
									manifestUrl
								)
							}
						: {}),
					...(manifest.runtimePack.index
						? {
								index: rewriteAbsoluteBundleUrl(
									manifest.runtimePack.index,
									manifestUrl
								)
							}
						: {})
				}
			}
		: {}),
	ocamlLibFiles: (manifest.ocamlLibFiles || []).map((file) => ({
		...file,
		...(file.url ? { url: rewriteAbsoluteBundleUrl(file.url, manifestUrl) } : {})
	})),
	packages: (manifest.packages || []).map((manifestPackage) => ({
		...manifestPackage,
		files: (manifestPackage.files || []).map((file) => ({
			...file,
			...(file.url ? { url: rewriteAbsoluteBundleUrl(file.url, manifestUrl) } : {})
		}))
	}))
});

async function loadDefaultOcamlCompilerHost(
	options: OcamlWorkerOptions,
	context: LspDocumentContext
): Promise<OcamlCompilerHost> {
	const [compilerModule, manifest] = await Promise.all([
		(async () => {
			context.reportProgress('load-ocaml-compiler');
			const module = (await import(
				/* @vite-ignore */ options.moduleUrl
			)) as Partial<OcamlCompilerModule>;
			if (typeof module.compile !== 'function') {
				throw new Error('wasm-of-js-of-ocaml bundle must export compile');
			}
			if (typeof module.createBrowserWorkerSystemDispatcher !== 'function') {
				throw new Error(
					'wasm-of-js-of-ocaml bundle must export createBrowserWorkerSystemDispatcher'
				);
			}
			return module as OcamlCompilerModule;
		})(),
		(async () => {
			context.reportProgress('load-ocaml-manifest');
			const response = await fetch(options.manifestUrl, { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`failed to fetch OCaml manifest: ${response.status}`);
			}
			return rewriteManifest(
				(await response.json()) as BrowserNativeManifest,
				options.manifestUrl
			);
		})()
	]);

	return {
		async compile(request) {
			return await compilerModule.compile(
				{
					files: Object.fromEntries(
						request.workspaceFiles.map((file) => [file.path, file.content])
					),
					entry: request.activePath,
					target: request.target,
					effectsMode: request.effectsMode,
					wasmBinaryenMode: request.wasmBinaryenMode,
					...(request.packages.length ? { packages: request.packages } : {})
				},
				{
					system: compilerModule.createBrowserWorkerSystemDispatcher({
						manifest
					}),
					toolchainRoot: '/static/toolchain'
				}
			);
		}
	};
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line.slice(0, character).match(/[A-Za-z_][A-Za-z0-9_']*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_']*/u)?.[0] || '')
	);
};

export function createOcamlWorkerService(
	loadCompilerHost: LoadOcamlCompilerHost = loadDefaultOcamlCompilerHost
): WorkerLanguageService {
	let compiler: OcamlCompilerHost | null = null;
	let target: OcamlLanguageServerTarget = 'js';
	let effectsMode: OcamlLanguageServerEffectsMode = 'cps';
	let wasmBinaryenMode: OcamlLanguageServerBinaryenMode = 'fast';
	let packages: string[] = [];
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	const collectWorkspaceFiles = (document: LspDocument, context: LspDocumentContext) => {
		const activePath = normalizeWorkspacePath(uriToPath(document.uri));
		const files = new Map<string, string>();
		for (const nextDocument of context.documents.values()) {
			const path = normalizeWorkspacePath(uriToPath(nextDocument.uri));
			if (!/\.(?:ml|mli)$/u.test(path)) continue;
			files.set(path, path === activePath ? document.text : nextDocument.text);
		}
		files.set(activePath, document.text);
		return {
			activePath,
			workspaceFiles: Array.from(files, ([path, content]) => ({ path, content })).sort(
				(a, b) => a.path.localeCompare(b.path)
			)
		};
	};

	const isCurrentDocumentDiagnostic = (
		diagnostic: OcamlCompilerDiagnostic,
		activePath: string
	) => {
		const fileName = diagnostic.fileName ?? diagnostic.file;
		if (!fileName) return true;
		const normalized = normalizeWorkspacePath(fileName);
		return normalized === activePath || basename(normalized) === basename(activePath);
	};

	return {
		name: 'wasm-idle-ocaml-lsp',
		diagnosticDelay: 900,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', '#'] },
			hoverProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as OcamlWorkerOptions;
			if (!config.moduleUrl || !config.manifestUrl) {
				throw new Error('OCaml language server requires moduleUrl and manifestUrl');
			}
			target = config.target || target;
			effectsMode = config.effectsMode || effectsMode;
			wasmBinaryenMode = config.wasmBinaryenMode || wasmBinaryenMode;
			packages = config.packages || [];
			compiler = await loadCompilerHost(
				{
					...config,
					target,
					effectsMode,
					wasmBinaryenMode,
					packages
				},
				context
			);
		},
		async diagnostics(document, context) {
			if (!compiler || !document.text.trim()) return [];
			const { activePath, workspaceFiles } = collectWorkspaceFiles(document, context);
			const key = JSON.stringify({
				target,
				effectsMode,
				wasmBinaryenMode,
				packages,
				activePath,
				workspaceFiles
			});
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('ocaml-diagnostics');
			const result = await compiler.compile({
				activePath,
				workspaceFiles,
				target,
				effectsMode,
				wasmBinaryenMode,
				packages
			});
			const diagnostics = (result.diagnostics || [])
				.filter((diagnostic) => isCurrentDocumentDiagnostic(diagnostic, activePath))
				.map(diagnosticFor);
			lastKey = key;
			lastDiagnostics =
				diagnostics.length || result.success
					? diagnostics
					: [
							{
								range: {
									start: positionAt(document.text, 0),
									end: positionAt(
										document.text,
										Math.min(document.text.length, 1)
									)
								},
								severity: 1,
								source: 'ocaml',
								message:
									result.stderr || result.stdout || 'OCaml compilation failed'
							}
						];
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...OCAML_KEYWORDS.map((label) => ({ label, kind: 14 })),
					...OCAML_MODULES.map((label) => ({
						label,
						kind: 9,
						detail: OCAML_HOVER[label] || 'OCaml module'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = OCAML_HOVER[word];
			if (!description) return null;
			return {
				contents: {
					kind: 'markdown',
					value: `\`${word}\`\n\n${description}`
				}
			};
		}
	};
}
