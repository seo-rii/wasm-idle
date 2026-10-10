import Runtime from './runtime.js';
import { createDwarfDebugDescriptor } from './dwarf.js';
import { normalizeDwarfWorkspacePath, normalizeWorkspacePath, resolveBuildArtifactNames } from './workspace.js';
import { resolveDebugMode, type BrowserClangArtifact, type BrowserClangDebugMode, type BrowserClangRuntimeRunOptions } from './types.js';
import type { ClangSourceLanguage } from './runtime.js';

const buildRoot = '__wasm_idle_build';
interface LinkedArtifact { key: string; bytes: Uint8Array; module?: WebAssembly.Module }
const translationUnitPattern = /\.(?:c|cc|cpp|cxx)$/;

/**
 * Public build orchestration. The legacy runtime continues to own compiler invocation,
 * verified assets, sysroots and tracing; this layer owns immutable linked artifacts.
 * It deliberately does not reuse mutable Clang instances or modify WebAssembly globals.
 */
export default class ArtifactRuntime extends Runtime {
	/** Compatibility escape hatch for callers that intentionally consume dynamic exports. */
	exportDynamic = false;
	private minimalLink = false;
	private linked?: LinkedArtifact;

	override async compile(options: any) {
		this.linked = undefined;
		this.lastBuildKey = '';
		this.wasm = undefined;
		return super.compile(options);
	}

	override async link(obj: string | readonly string[], wasm: string,
		debugModeOrLegacyDebug: BrowserClangDebugMode | boolean = 'none',
		language: ClangSourceLanguage = 'CPP') {
		this.linked = undefined;
		this.lastBuildKey = '';
		this.wasm = undefined;
		const mode = typeof debugModeOrLegacyDebug === 'boolean'
			? resolveDebugMode({ debug: debugModeOrLegacyDebug })
			: resolveDebugMode({ debugMode: debugModeOrLegacyDebug });
		const previous = this.minimalLink;
		this.minimalLink = mode === 'none' && !this.exportDynamic;
		try { return await super.link(obj, wasm, mode, language); }
		finally { this.minimalLink = previous; }
	}

	override async run(module: WebAssembly.Module, out: boolean, ...args: string[]) {
		// link() owns this scope; never filter user argv, compiler flags, or debug links.
		if (this.minimalLink && args[0] === 'wasm-ld') {
			args = args.filter((argument) => argument !== '--export-dynamic');
		}
		return super.run(module, out, ...args);
	}

	private async buildBytes(code: string, options: BrowserClangRuntimeRunOptions): Promise<LinkedArtifact> {
		const { language = 'CPP', fileName, activePath, workspaceFiles = [], args = [],
			compileArgs = args, cppVersion, cVersion, breakpoints = [], pauseOnEntry = false,
			debugBuffer, interruptBuffer, watchBuffer, watchResultBuffer, precompiledHeader } = options;
		const debugMode = resolveDebugMode(options);
		const normalize = debugMode === 'lldb' ? normalizeDwarfWorkspacePath : normalizeWorkspacePath;
		const files = workspaceFiles.map((file) => ({ ...file, path: normalize(file.path) }));
		const { input, obj, wasm } = resolveBuildArtifactNames(language,
			normalize(activePath || '') || normalize(fileName || '') || undefined);
		const byPath = new Map<string, { path: string; content: string }>();
		for (const file of [...files, { path: input, content: code }]) {
			if (!file.path) continue;
			if (file.path === buildRoot || file.path.startsWith(`${buildRoot}/`)) {
				throw new Error(`Workspace path uses reserved build namespace ${JSON.stringify(buildRoot)}`);
			}
			byPath.set(file.path, file);
		}
		const snapshot = [...byPath.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
		const units = snapshot.filter((file) => file.path === input || translationUnitPattern.test(file.path));
		if (debugMode === 'trace' && units.length > 1) {
			throw new Error('Trace debug mode does not support multiple C/C++ translation units');
		}
		const cOnly = language === 'C' && units.every((unit) => unit.path === input || unit.path.endsWith('.c'))
			&& !compileArgs.some((arg) => typeof arg !== 'string' || arg.startsWith('-x') || arg.startsWith('@'));
		this.beginTrace(debugMode === 'trace');
		this.debugBreakpoints = new Set(debugMode === 'trace' ? breakpoints : []);
		this.debugPauseOnEntry = debugMode === 'trace' && pauseOnEntry;
		this.debugBuffer = debugBuffer;
		this.debugInterruptBuffer = interruptBuffer;
		this.debugWatchBuffer = watchBuffer;
		this.debugWatchResultBuffer = watchResultBuffer;
		const key = JSON.stringify({ code, input, wasm, language, compileArgs, workspaceFiles: snapshot,
			cppVersion, cVersion, debugMode, exportDynamic: this.exportDynamic });
		if (this.linked?.key === key) {
			this.lastArtifactPath = wasm;
			this.trace(`reuse ${wasm}`);
			return this.linked;
		}
		// Invalidate before any operation that can fail; a previous program must not survive a failed rebuild.
		this.linked = undefined;
		this.wasm = undefined;
		this.lastBuildKey = '';
		this.precompiledHeaderPlan = undefined;
		this.usedPrecompiledHeader = false;
		void this.getModule(this.assetUrls.lld).catch(() => undefined);
		const common = { compileArgs, cppVersion, cVersion, debugMode, precompiledHeader,
			persistentCache: options.persistentCache };
		const objects: string[] = [];
		if (units.length === 1) {
			await this.compile({ ...common, input, code, obj, language, workspaceFiles: files });
			objects.push(obj);
		} else {
			await this.ready;
			this.addWorkspaceFiles(snapshot);
			this.memfs.addDirectory(buildRoot);
			this.memfs.addDirectory(`${buildRoot}/objects`);
			for (const [index, unit] of units.entries()) {
				const object = `${buildRoot}/objects/${index.toString().padStart(4, '0')}.o`;
				await this.compile({ ...common, input: unit.path, code: unit.content, obj: object,
					language: unit.path === input ? language : unit.path.endsWith('.c') ? 'C' : 'CPP',
					workspaceFiles: [], sourceAlreadyMounted: true });
				objects.push(object);
			}
		}
		// Clear the previous output so close-time/link failures cannot expose stale bytes.
		this.memfs.addFile(wasm, new Uint8Array(0));
		await this.link(objects, wasm, debugMode, cOnly ? 'C' : 'CPP');
		const bytes = Uint8Array.from(this.memfs.getFileContents(wasm));
		if (!bytes.length) throw new Error(`Linker produced an empty artifact: ${wasm}`);
		this.lastArtifactPath = wasm;
		this.lastBuildKey = key;
		return (this.linked = { key, bytes });
	}

	override async compileLink(code: string, options: BrowserClangRuntimeRunOptions = {}) {
		const linked = await this.buildBytes(code, options);
		if (!linked.module) {
			linked.module = await this.hostLogAsync(`Compiling ${this.lastArtifactPath}`,
				WebAssembly.compile(Uint8Array.from(linked.bytes)));
		}
		this.wasm = linked.module;
		return linked.module;
	}

	override async compileArtifact(code: string, options: BrowserClangRuntimeRunOptions = {}): Promise<BrowserClangArtifact> {
		const debugMode = resolveDebugMode(options);
		// WAMR consumes linked bytes, not a browser-compiled Module. Normal/trace callers retain
		// the existing ready-to-execute Module contract and can reuse its compilation.
		const linked = await this.buildBytes(code, options);
		const wasm = debugMode === 'lldb' ? undefined : await this.compileLink(code, options);
		const bytes = Uint8Array.from(linked.bytes);
		const language = options.language || 'CPP';
		return { bytes, ...(wasm ? { wasm } : {}), target: 'wasm32-wasi', format: 'wasi-core-wasm',
			fileName: this.lastArtifactPath, language,
			...(debugMode === 'trace' ? { debugMetadata: {
				variableMetadata: this.debugVariableMetadata, globalVariableMetadata: this.debugGlobalMetadata,
				functionMetadata: this.debugFunctionMetadata } } : {}),
			...(debugMode === 'lldb' ? { debug: await createDwarfDebugDescriptor({ code, language,
				fileName: options.fileName, activePath: options.activePath, workspaceFiles: options.workspaceFiles,
				compileArgs: options.compileArgs ?? options.args, cppVersion: options.cppVersion,
				cVersion: options.cVersion, debugMode }, bytes, this.compilerConfig?.provenance) } : {}) };
	}
}
