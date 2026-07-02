import {
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type WorkerLanguageService
} from './lsp.js';
import { runRuntimeWorkerDiagnostics } from './runtime-worker.js';

export interface StaticWorkerDiagnosticConfig {
	baseUrl: string;
	workerUrl: string;
}

export type StaticWorkerDiagnosticRequest<TConfig extends StaticWorkerDiagnosticConfig> =
	TConfig & {
		code: string;
		activePath: string;
	};

export interface StaticWorkerDiagnosticResult {
	error?: string;
	output?: string;
}

export type StaticWorkerDiagnosticRunner<
	TConfig extends StaticWorkerDiagnosticConfig,
	TResult extends StaticWorkerDiagnosticResult = StaticWorkerDiagnosticResult
> = (request: StaticWorkerDiagnosticRequest<TConfig>) => Promise<TResult>;

export interface StaticWorkerDiagnosticsOptions<
	TConfig extends StaticWorkerDiagnosticConfig,
	TResult extends StaticWorkerDiagnosticResult = StaticWorkerDiagnosticResult
> {
	languageName: string;
	loadProgressStage: string;
	diagnosticsProgressStage?: string;
	defaultActivePath: string;
	timeoutMessage: string;
	runDiagnostics?: StaticWorkerDiagnosticRunner<TConfig, TResult>;
	createMessage: (request: StaticWorkerDiagnosticRequest<TConfig>) => Record<string, unknown>;
	diagnosticsFromResult: (result: TResult, document: LspDocument) => LspDiagnostic[];
	validateConfig?: (config: TConfig) => string | null | undefined;
	cacheKeyParts?: (config: TConfig) => readonly string[];
	activePathFromDocument?: (document: LspDocument) => string;
}

const defaultActivePathFromDocument = (document: LspDocument, fallback: string) =>
	document.uri.split('/').pop() || fallback;

export function createStaticWorkerDiagnostics<
	TConfig extends StaticWorkerDiagnosticConfig,
	TResult extends StaticWorkerDiagnosticResult = StaticWorkerDiagnosticResult
>(
	options: StaticWorkerDiagnosticsOptions<TConfig, TResult>
): Pick<WorkerLanguageService, 'initialize' | 'diagnostics'> {
	let config: TConfig | null = null;
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];
	const runDiagnostics =
		options.runDiagnostics ||
		(((request: StaticWorkerDiagnosticRequest<TConfig>) =>
			runRuntimeWorkerDiagnostics({
				workerUrl: request.workerUrl,
				timeoutMessage: options.timeoutMessage,
				message: options.createMessage(request)
			}) as Promise<TResult>) satisfies StaticWorkerDiagnosticRunner<TConfig, TResult>);

	return {
		initialize(workerOptions: unknown, context: LspDocumentContext) {
			const nextConfig = (workerOptions || {}) as TConfig;
			const errorMessage =
				options.validateConfig?.(nextConfig) ||
				(!nextConfig.baseUrl || !nextConfig.workerUrl
					? `${options.languageName} language server requires baseUrl and workerUrl`
					: null);
			if (errorMessage) throw new Error(errorMessage);
			context.reportProgress(options.loadProgressStage);
			config = nextConfig;
		},
		async diagnostics(document: LspDocument, context: LspDocumentContext) {
			if (!config || !document.text.trim()) return [];
			const activePath =
				options.activePathFromDocument?.(document) ||
				defaultActivePathFromDocument(document, options.defaultActivePath);
			const key = [
				...(options.cacheKeyParts?.(config) || [config.baseUrl, config.workerUrl]),
				activePath,
				document.text
			].join('\n');
			if (key === lastKey) return lastDiagnostics;
			if (options.diagnosticsProgressStage) {
				context.reportProgress(options.diagnosticsProgressStage);
			}
			lastKey = key;
			const result = await runDiagnostics({
				...config,
				code: document.text,
				activePath
			});
			lastDiagnostics = options.diagnosticsFromResult(result, document);
			return lastDiagnostics;
		}
	};
}
