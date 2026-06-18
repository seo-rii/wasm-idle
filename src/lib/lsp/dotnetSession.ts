import type { LanguageServerStatus } from '@wasm-idle/lsp';
import type * as Monaco from 'monaco-editor';

import { installMonacoLanguageServices } from '$lib/lsp/monacoServices';

const DOTNET_FILE_URI = {
	csharp: 'file:///workspace/Program.cs',
	fsharp: 'file:///workspace/Program.fs',
	vbnet: 'file:///workspace/Program.vb'
} as const;

export type DotnetLspLanguage = 'csharp' | 'fsharp' | 'vbnet';
export type DotnetLspStatus = LanguageServerStatus;

interface DotnetDiagnostic {
	lineNumber?: number;
	columnNumber?: number;
	endColumnNumber?: number;
	severity?: 'error' | 'warning' | 'other';
	message?: string;
}

interface DotnetCompilerResult {
	success: boolean;
	stderr?: string;
	diagnostics?: DotnetDiagnostic[];
}

interface DotnetCompiler {
	compile(request: {
		code: string;
		language: DotnetLspLanguage;
		target: 'browser-wasm';
		prepare?: boolean;
		onProgress?: (progress: { stage?: string; completed?: number; total?: number }) => void;
	}): Promise<DotnetCompilerResult>;
}

interface DotnetRuntimeModule {
	createDotnetCompiler(): DotnetCompiler;
}

type LoadDotnetModule = (moduleUrl: string) => Promise<DotnetRuntimeModule>;

const defaultLoadDotnetModule: LoadDotnetModule = async (moduleUrl) =>
	(await import(/* @vite-ignore */ moduleUrl)) as DotnetRuntimeModule;

function diagnosticSource(language: DotnetLspLanguage) {
	return language === 'csharp' ? 'roslyn-csharp' : language === 'fsharp' ? 'fsharp' : 'roslyn-vb';
}

export class DotnetLspSession {
	Monaco: typeof Monaco;
	moduleUrl: string;
	language: DotnetLspLanguage;
	onStatus?: (status: DotnetLspStatus) => void;
	loadModule: LoadDotnetModule;
	model: Monaco.editor.ITextModel | null = null;
	compiler: DotnetCompiler | null = null;
	changeDisposable: Monaco.IDisposable | null = null;
	diagnosticTimer: ReturnType<typeof setTimeout> | null = null;
	diagnosticVersion = 0;
	disposed = false;

	constructor(
		MonacoModule: typeof Monaco,
		moduleUrl: string,
		language: DotnetLspLanguage,
		onStatus?: (status: DotnetLspStatus) => void,
		loadModule: LoadDotnetModule = defaultLoadDotnetModule
	) {
		this.Monaco = MonacoModule;
		this.moduleUrl = moduleUrl;
		this.language = language;
		this.onStatus = onStatus;
		this.loadModule = loadModule;
		installMonacoLanguageServices(MonacoModule);
	}

	private get modelLanguage() {
		return this.language === 'vbnet' ? 'vb' : this.language;
	}

	createModel(value: string) {
		const uri = this.Monaco.Uri.parse(DOTNET_FILE_URI[this.language]);
		this.Monaco.editor.getModel(uri)?.dispose();
		this.model = this.Monaco.editor.createModel(value, this.modelLanguage, uri);
		return this.model;
	}

	async start() {
		if (this.compiler) return;
		this.onStatus?.({ state: 'loading', stage: 'load-dotnet-runtime' });
		const runtimeModule = await this.loadModule(this.moduleUrl);
		if (this.disposed) return;
		if (typeof runtimeModule.createDotnetCompiler !== 'function') {
			throw new Error('wasm-dotnet module must export createDotnetCompiler');
		}
		this.compiler = runtimeModule.createDotnetCompiler();
		this.changeDisposable =
			this.model?.onDidChangeContent(() => this.scheduleDiagnostics()) ?? null;
		this.onStatus?.({ state: 'ready' });
		this.scheduleDiagnostics(0);
	}

	private scheduleDiagnostics(delay = 500) {
		if (this.diagnosticTimer) clearTimeout(this.diagnosticTimer);
		this.diagnosticTimer = setTimeout(() => {
			this.diagnosticTimer = null;
			void this.updateDiagnostics();
		}, delay);
	}

	private async updateDiagnostics() {
		const model = this.model;
		const compiler = this.compiler;
		if (!model || !compiler || this.disposed) return;

		const code = model.getValue();
		if (!code.trim()) {
			this.Monaco.editor.setModelMarkers(model, diagnosticSource(this.language), []);
			return;
		}

		const version = ++this.diagnosticVersion;
		const result = await compiler.compile({
			code,
			language: this.language,
			target: 'browser-wasm',
			prepare: true,
			onProgress: (progress) => {
				this.onStatus?.({
					state: 'loading',
					stage: progress.stage || 'compile',
					loaded: progress.completed,
					total: progress.total
				});
			}
		});
		if (this.disposed || version !== this.diagnosticVersion) return;

		const severity = this.Monaco.MarkerSeverity;
		const markers = (result.diagnostics || []).map((diagnostic) => {
			const line = Math.max(1, Number(diagnostic.lineNumber || 1));
			const column = Math.max(1, Number(diagnostic.columnNumber || 1));
			const endColumn = Math.max(
				column + 1,
				Number(diagnostic.endColumnNumber || column + 1)
			);
			return {
				startLineNumber: line,
				startColumn: column,
				endLineNumber: line,
				endColumn,
				severity:
					diagnostic.severity === 'warning'
						? severity.Warning
						: diagnostic.severity === 'other'
							? severity.Info
							: severity.Error,
				source: diagnosticSource(this.language),
				message: String(diagnostic.message || 'Compilation error')
			};
		});
		if (!result.success && markers.length === 0 && result.stderr) {
			markers.push({
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 1,
				endColumn: 2,
				severity: severity.Error,
				source: diagnosticSource(this.language),
				message: result.stderr
			});
		}
		this.Monaco.editor.setModelMarkers(model, diagnosticSource(this.language), markers);
		this.onStatus?.({ state: 'ready' });
	}

	dispose() {
		this.disposed = true;
		if (this.diagnosticTimer) clearTimeout(this.diagnosticTimer);
		this.diagnosticTimer = null;
		this.changeDisposable?.dispose();
		this.changeDisposable = null;
		if (this.model) {
			this.Monaco.editor.setModelMarkers(this.model, diagnosticSource(this.language), []);
		}
		this.compiler = null;
	}
}
