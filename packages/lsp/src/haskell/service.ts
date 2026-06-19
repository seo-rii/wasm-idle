import {
	ConsoleStdout,
	File,
	OpenFile,
	PreopenDirectory,
	WASI,
	wasi
} from '@bjorn3/browser_wasi_shim';
import {
	positionAt,
	uriToPath,
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type LspPosition,
	type WorkerLanguageService
} from '../lsp.js';

const DEFAULT_HASKELL_MAIN_SO_PATH = '/tmp/libplayground001.so';
const DEFAULT_HASKELL_SEARCH_DIRS = [
	'/tmp/clib',
	'/tmp/hslib/lib/wasm32-wasi-ghc-9.14.0.20251031-inplace'
];
const DEFAULT_HASKELL_DIAGNOSTIC_ARGS = '-fno-code -Wall';

export interface HaskellWorkerOptions {
	moduleUrl: string;
	rootfsUrl: string;
	bsdtarUrl: string;
	mainSoPath?: string;
	searchDirs?: string[];
	ghcArgs?: string;
}

interface HaskellRuntime {
	mainFunc: (ghcArgs: string, source: string) => Promise<void> | void;
}

interface HaskellRuntimeModule {
	main(options: {
		rpc: unknown;
		searchDirs: string[];
		mainSoPath: string;
		args: string[];
		isIserv: boolean;
	}): Promise<{
		exportFuncs?: {
			myMain?: (
				libPath: string
			) => Promise<HaskellRuntime['mainFunc']> | HaskellRuntime['mainFunc'];
		};
	}>;
	DyLDBrowserHost: new (options: {
		rootfs: PreopenDirectory;
		stdout: (line: string) => void;
		stderr: (line: string) => void;
	}) => unknown;
}

interface PendingSymlink {
	target: string;
	path: string;
}

interface HaskellWorkspaceFile {
	path: string;
	content: string;
}

interface HaskellCompilerDiagnostic {
	fileName?: string | null;
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface HaskellCompilerResult {
	success: boolean;
	diagnostics?: HaskellCompilerDiagnostic[];
	stdout?: string;
	stderr?: string;
}

interface HaskellCompilerHost {
	compile(request: {
		code: string;
		activePath: string;
		workspaceFiles: HaskellWorkspaceFile[];
		ghcArgs: string;
		log: boolean;
		onProgress?: (progress: { stage?: string; completed?: number; total?: number }) => void;
	}): Promise<HaskellCompilerResult>;
}

type LoadHaskellCompilerHost = (
	options: HaskellWorkerOptions,
	context: LspDocumentContext
) => Promise<HaskellCompilerHost>;

const HASKELL_KEYWORDS = [
	'as',
	'case',
	'class',
	'data',
	'default',
	'deriving',
	'do',
	'else',
	'family',
	'forall',
	'foreign',
	'hiding',
	'if',
	'import',
	'in',
	'infix',
	'infixl',
	'infixr',
	'instance',
	'let',
	'module',
	'newtype',
	'of',
	'qualified',
	'then',
	'type',
	'where'
] as const;

const HASKELL_MODULES = [
	'Control.Applicative',
	'Control.Monad',
	'Data.Bool',
	'Data.Char',
	'Data.Either',
	'Data.List',
	'Data.Map',
	'Data.Maybe',
	'Data.Set',
	'Data.Text',
	'Debug.Trace',
	'Prelude',
	'System.Environment',
	'Text.Printf'
] as const;

const HASKELL_HOVER: Record<string, string> = {
	module: 'Declares a module name and export list.',
	import: 'Imports declarations from another module.',
	where: 'Introduces local declarations for a binding or module.',
	let: 'Introduces local bindings in an expression.',
	case: 'Pattern matches an expression.',
	data: 'Declares an algebraic data type.',
	newtype: 'Declares a single-constructor wrapper type.',
	type: 'Declares a type synonym or type family.',
	class: 'Declares a type class.',
	instance: 'Declares a type class instance.',
	do: 'Sequences monadic actions.',
	Prelude: 'Default standard definitions.',
	'Data.List': 'List functions.',
	'Data.Maybe': 'Optional value helpers.',
	'Control.Monad': 'Monadic control helpers.',
	'Text.Printf': 'Formatted output functions.'
};

const appendLine = (line: string) => (line.endsWith('\n') ? line : `${line}\n`);

const normalizeWorkspacePath = (value: string, fallback = 'main.hs') => {
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

const diagnosticSeverity = (severity: HaskellCompilerDiagnostic['severity']): 1 | 2 | 3 =>
	severity === 'warning' ? 2 : severity === 'other' ? 3 : 1;

const diagnosticFor = (diagnostic: HaskellCompilerDiagnostic): LspDiagnostic => {
	const line = Math.max(0, Number(diagnostic.lineNumber || 1) - 1);
	const character = Math.max(0, Number(diagnostic.columnNumber || 1) - 1);
	const endCharacter = Math.max(
		character + 1,
		Number(diagnostic.endColumnNumber || diagnostic.columnNumber || character + 2) - 1
	);
	return {
		range: {
			start: { line, character },
			end: { line, character: endCharacter }
		},
		severity: diagnosticSeverity(diagnostic.severity),
		source: 'haskell',
		message: String(diagnostic.message || 'Haskell diagnostic')
	};
};

export function parseHaskellDiagnostics(output: string): HaskellCompilerDiagnostic[] {
	const diagnostics: HaskellCompilerDiagnostic[] = [];
	const lines = output.split(/\r\n|\r|\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const match = /^(.*?):(\d+):(\d+):\s+(error|warning):\s*(.*)$/iu.exec(lines[index] || '');
		if (!match) continue;
		let message = (match[5] || '').trim();
		if (!message) {
			for (const extraLine of lines.slice(index + 1)) {
				const trimmed = extraLine.trim();
				if (!trimmed || trimmed === '|' || /^\d+\s+\|/u.test(trimmed)) continue;
				message = trimmed;
				break;
			}
		}
		diagnostics.push({
			fileName: match[1] || null,
			lineNumber: Math.max(1, Number(match[2] || 1)),
			columnNumber: Math.max(1, Number(match[3] || 1)),
			severity: match[4]?.toLowerCase() === 'warning' ? 'warning' : 'error',
			message: message || lines[index]
		});
	}
	return diagnostics;
}

async function fetchBytes(
	url: string,
	stage: string,
	reportProgress: LspDocumentContext['reportProgress'],
	progressStart = 0,
	progressEnd = 100
) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`failed to load ${stage} from ${url}: ${response.status}`);
	}
	const total = Number(response.headers.get('content-length') || 0) || undefined;
	const body = response.body?.getReader();
	if (!body) {
		const data = new Uint8Array(await response.arrayBuffer());
		reportProgress(stage, data.byteLength, total);
		return data;
	}
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	while (true) {
		const { done, value } = await body.read();
		if (done) break;
		if (!value) continue;
		chunks.push(value);
		loaded += value.byteLength;
		const progress =
			total && total > 0
				? progressStart + ((progressEnd - progressStart) * loaded) / total
				: undefined;
		reportProgress(stage, progress, total ? 100 : undefined);
	}
	const data = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	reportProgress(stage, progressEnd, 100);
	return data;
}

const instantiateResult = (
	result: WebAssembly.Instance | WebAssembly.WebAssemblyInstantiatedSource
) => (result instanceof WebAssembly.Instance ? result : result.instance);

const normalizeRootfsPath = (path: string) => {
	const parts: string[] = [];
	for (const part of path.replace(/^\/+/u, '').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join('/');
};

const dirname = (path: string) => {
	const normalized = normalizeRootfsPath(path);
	const slashIndex = normalized.lastIndexOf('/');
	return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
};

const resolveSymlinkTarget = (target: string, linkPath: string) => {
	if (target.startsWith('/')) return normalizeRootfsPath(target);
	const parent = dirname(linkPath);
	return normalizeRootfsPath(parent ? `${parent}/${target}` : target);
};

const readWasiString = (tarWasi: WASI, pointer: number, length: number) => {
	const bytes = new Uint8Array(tarWasi.inst.exports.memory.buffer, pointer, length);
	return new TextDecoder('utf-8').decode(bytes);
};

function installRootfsExtractionWasiPatches(tarWasi: WASI, pendingSymlinks: PendingSymlink[]) {
	tarWasi.wasiImport.fd_filestat_set_times = () => wasi.ERRNO_SUCCESS;
	tarWasi.wasiImport.path_filestat_set_times = () => wasi.ERRNO_SUCCESS;
	tarWasi.wasiImport.path_symlink = (
		oldPathPointer: number,
		oldPathLength: number,
		fd: number,
		newPathPointer: number,
		newPathLength: number
	) => {
		if (!tarWasi.fds[fd]) return wasi.ERRNO_BADF;
		pendingSymlinks.push({
			target: readWasiString(tarWasi, oldPathPointer, oldPathLength),
			path: readWasiString(tarWasi, newPathPointer, newPathLength)
		});
		return wasi.ERRNO_SUCCESS;
	};
}

function materializeRootfsSymlinks(rootfs: PreopenDirectory, pendingSymlinks: PendingSymlink[]) {
	for (const symlink of pendingSymlinks) {
		const linkPath = normalizeRootfsPath(symlink.path);
		const targetPath = resolveSymlinkTarget(symlink.target, linkPath);
		const { ret, inode_obj: inode } = rootfs.path_lookup(targetPath, 0);
		if (ret !== wasi.ERRNO_SUCCESS || !inode) {
			throw new Error(
				`failed to resolve Haskell rootfs symlink ${linkPath} -> ${symlink.target}`
			);
		}
		const linkRet = rootfs.path_link(linkPath, inode, false);
		if (linkRet !== wasi.ERRNO_SUCCESS) {
			throw new Error(`failed to materialize Haskell rootfs symlink ${linkPath}`);
		}
	}
}

async function unpackRootfs(
	options: HaskellWorkerOptions,
	context: LspDocumentContext
): Promise<PreopenDirectory> {
	const rootfs = new PreopenDirectory('/', new Map());
	const pendingSymlinks: PendingSymlink[] = [];
	let tarOutput = '';
	const tarStdout = ConsoleStdout.lineBuffered((line) => {
		tarOutput += appendLine(line);
	});
	const tarStderr = ConsoleStdout.lineBuffered((line) => {
		tarOutput += appendLine(line);
	});
	const tarWasi = new WASI(
		['bsdtar.wasm', '-x'],
		[],
		[
			new OpenFile(new File(new Uint8Array(), { readonly: true })),
			tarStdout,
			tarStderr,
			rootfs
		],
		{ debug: false }
	);
	installRootfsExtractionWasiPatches(tarWasi, pendingSymlinks);
	const [bsdtarBytes, rootfsBytes] = await Promise.all([
		fetchBytes(
			options.bsdtarUrl,
			'load-haskell-rootfs-extractor',
			context.reportProgress,
			5,
			15
		),
		fetchBytes(options.rootfsUrl, 'load-haskell-rootfs', context.reportProgress, 15, 70)
	]);
	context.reportProgress('extract-haskell-rootfs', 75, 100);
	const tarInstance = instantiateResult(
		await WebAssembly.instantiate(bsdtarBytes, {
			wasi_snapshot_preview1: tarWasi.wasiImport
		})
	);
	tarWasi.fds[0] = new OpenFile(new File(rootfsBytes, { readonly: true }));
	const exitCode = tarWasi.start(tarInstance as unknown as Parameters<WASI['start']>[0]);
	if (typeof exitCode === 'number' && exitCode !== 0) {
		throw new Error(tarOutput || `bsdtar exited with code ${exitCode}`);
	}
	materializeRootfsSymlinks(rootfs, pendingSymlinks);
	context.reportProgress('extract-haskell-rootfs', 90, 100);
	return rootfs;
}

async function loadDefaultHaskellCompilerHost(
	options: HaskellWorkerOptions,
	context: LspDocumentContext
): Promise<HaskellCompilerHost> {
	let activeStdoutCollector: ((line: string) => void) | null = null;
	let activeStderrCollector: ((line: string) => void) | null = null;

	context.reportProgress('load-haskell-runtime');
	const rootfs = await unpackRootfs(options, context);
	const dyldModule = (await import(
		/* @vite-ignore */ options.moduleUrl
	)) as Partial<HaskellRuntimeModule>;
	if (typeof dyldModule.main !== 'function' || typeof dyldModule.DyLDBrowserHost !== 'function') {
		throw new Error('wasm-haskell module must export main and DyLDBrowserHost');
	}
	const searchDirs =
		Array.isArray(options.searchDirs) && options.searchDirs.length
			? options.searchDirs
			: DEFAULT_HASKELL_SEARCH_DIRS;
	const mainSoPath = options.mainSoPath || DEFAULT_HASKELL_MAIN_SO_PATH;
	const host = new dyldModule.DyLDBrowserHost({
		rootfs,
		stdout(line: string) {
			activeStdoutCollector?.(line);
		},
		stderr(line: string) {
			activeStderrCollector?.(line);
		}
	});
	const dyld = await dyldModule.main({
		rpc: host,
		searchDirs,
		mainSoPath,
		args: [mainSoPath.split('/').pop() || 'libplayground001.so', '+RTS', '-c', '-RTS'],
		isIserv: false
	});
	const exportedMain = dyld?.exportFuncs?.myMain;
	if (typeof exportedMain !== 'function') {
		throw new Error('wasm-haskell runtime did not export myMain');
	}
	const mainFunc = await exportedMain('/tmp/hslib/lib');
	if (typeof mainFunc !== 'function') {
		throw new Error('wasm-haskell myMain did not return a callable function');
	}
	context.reportProgress('load-haskell-runtime', 100, 100);

	return {
		async compile(request) {
			let stdout = '';
			let stderr = '';
			activeStdoutCollector = (line: string) => {
				stdout += appendLine(line);
			};
			activeStderrCollector = (line: string) => {
				stderr += appendLine(line);
			};
			try {
				request.onProgress?.({ stage: 'haskell-diagnostics' });
				await mainFunc(
					String(request.ghcArgs || DEFAULT_HASKELL_DIAGNOSTIC_ARGS),
					request.code
				);
				return {
					success: true,
					diagnostics: parseHaskellDiagnostics(stderr),
					stdout,
					stderr
				};
			} catch (error) {
				return {
					success: false,
					diagnostics: parseHaskellDiagnostics(stderr),
					stdout,
					stderr:
						stderr.trim() || (error instanceof Error ? error.message : String(error))
				};
			} finally {
				activeStdoutCollector = null;
				activeStderrCollector = null;
			}
		}
	};
}

const wordAt = (text: string, position: LspPosition) => {
	const line = text.split('\n')[position.line] || '';
	const character = Math.max(0, Math.min(position.character, line.length));
	return (
		(line
			.slice(0, character)
			.match(/[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*$/u)?.[0] || '') +
		(line.slice(character).match(/^[A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*/u)?.[0] || '')
	);
};

export function createHaskellWorkerService(
	loadCompilerHost: LoadHaskellCompilerHost = loadDefaultHaskellCompilerHost
): WorkerLanguageService {
	let compiler: HaskellCompilerHost | null = null;
	let ghcArgs = DEFAULT_HASKELL_DIAGNOSTIC_ARGS;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	const collectWorkspaceFiles = (document: LspDocument, context: LspDocumentContext) => {
		const activePath = normalizeWorkspacePath(uriToPath(document.uri));
		const files = new Map<string, string>();
		for (const nextDocument of context.documents.values()) {
			const path = normalizeWorkspacePath(uriToPath(nextDocument.uri));
			if (!/\.(?:hs|lhs)$/u.test(path)) continue;
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
		diagnostic: HaskellCompilerDiagnostic,
		activePath: string
	) => {
		if (!diagnostic.fileName || diagnostic.fileName.startsWith('<')) return true;
		const normalized = normalizeWorkspacePath(diagnostic.fileName);
		return normalized === activePath || basename(normalized) === basename(activePath);
	};

	return {
		name: 'wasm-idle-haskell-lsp',
		diagnosticDelay: 1200,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ':'] },
			hoverProvider: true
		},
		async initialize(options, context) {
			const config = (options || {}) as HaskellWorkerOptions;
			if (!config.moduleUrl || !config.rootfsUrl || !config.bsdtarUrl) {
				throw new Error(
					'Haskell language server requires moduleUrl, rootfsUrl, and bsdtarUrl'
				);
			}
			ghcArgs = config.ghcArgs || ghcArgs;
			compiler = await loadCompilerHost(
				{
					...config,
					ghcArgs
				},
				context
			);
		},
		async diagnostics(document, context) {
			if (!compiler || !document.text.trim()) return [];
			const { activePath, workspaceFiles } = collectWorkspaceFiles(document, context);
			const key = JSON.stringify({ ghcArgs, activePath, workspaceFiles });
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('haskell-diagnostics');
			const result = await compiler.compile({
				code: document.text,
				activePath,
				workspaceFiles,
				ghcArgs,
				log: false,
				onProgress(progress) {
					context.reportProgress(
						progress.stage || 'haskell-diagnostics',
						progress.completed,
						progress.total
					);
				}
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
								source: 'haskell',
								message:
									result.stderr || result.stdout || 'Haskell compilation failed'
							}
						];
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: [
					...HASKELL_KEYWORDS.map((label) => ({ label, kind: 14 })),
					...HASKELL_MODULES.map((label) => ({
						label,
						kind: 9,
						detail: HASKELL_HOVER[label] || 'Haskell module'
					}))
				]
			};
		},
		hover(document, position) {
			const word = wordAt(document.text, position);
			const description = HASKELL_HOVER[word];
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
