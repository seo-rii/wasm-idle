import {
	type LspDiagnostic,
	type LspDocument,
	type LspDocumentContext,
	type WorkerLanguageService
} from './lsp.js';
import { runRuntimeWorkerDiagnostics } from './runtime-worker.js';
import type { LanguageToolAssetRuntime } from './assets.js';
import type { RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export interface StaticWorkerDiagnosticConfig {
	baseUrl?: string;
	workerUrl?: string;
	workerReceipt?: RuntimeAssetIntegrityEntry;
	runnerWorkerBytes?: Uint8Array;
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
	runtime?: LanguageToolAssetRuntime;
	workerAsset?: string;
	singleFlight?: boolean;
	runDiagnostics?: StaticWorkerDiagnosticRunner<TConfig, TResult>;
	createMessage: (request: StaticWorkerDiagnosticRequest<TConfig>) => Record<string, unknown>;
	messageTransfer?: (
		message: Record<string, unknown>,
		request: StaticWorkerDiagnosticRequest<TConfig>
	) => readonly Transferable[];
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
	let serializedDiagnostics: Promise<void> = Promise.resolve();
	const latestRequestByDocument = new Map<string, symbol>();
	const pendingDiagnosticsByKey = new Map<
		string,
		{
			documentUri: string;
			operation: Promise<LspDiagnostic[]>;
			token: symbol;
		}
	>();
	const runDiagnostics =
		options.runDiagnostics ||
		(((request: StaticWorkerDiagnosticRequest<TConfig>) => {
			const message = options.createMessage(request);
			return runRuntimeWorkerDiagnostics({
				...(options.runtime ? { runtime: options.runtime } : {}),
				...(options.workerAsset ? { workerAsset: options.workerAsset } : {}),
				workerUrl: request.workerUrl,
				workerReceipt: request.workerReceipt,
				workerBytes: request.runnerWorkerBytes,
				timeoutMessage: options.timeoutMessage,
				message,
				...(options.messageTransfer
					? { messageTransfer: options.messageTransfer(message, request) }
					: {})
			}) as Promise<TResult>;
		}) satisfies StaticWorkerDiagnosticRunner<TConfig, TResult>);

	return {
		initialize(workerOptions: unknown, context: LspDocumentContext) {
			const nextConfig = (workerOptions || {}) as TConfig;
			const hasDirectWorker = nextConfig.runnerWorkerBytes instanceof Uint8Array;
			const errorMessage =
				options.validateConfig?.(nextConfig) ||
				(!hasDirectWorker && (!nextConfig.baseUrl || !nextConfig.workerUrl)
					? `${options.languageName} language server requires baseUrl and workerUrl`
					: null);
			if (errorMessage) throw new Error(errorMessage);
			context.reportProgress(options.loadProgressStage);
			config = nextConfig;
		},
		async diagnostics(document: LspDocument, context: LspDocumentContext) {
			if (!config) return [];
			const token = Symbol(document.uri);
			if (options.singleFlight) latestRequestByDocument.set(document.uri, token);
			if (!document.text.trim()) {
				if (options.singleFlight && latestRequestByDocument.get(document.uri) === token) {
					latestRequestByDocument.delete(document.uri);
				}
				return [];
			}
			const requestConfig = config;
			const activePath =
				options.activePathFromDocument?.(document) ||
				defaultActivePathFromDocument(document, options.defaultActivePath);
			const key = [
				...(options.cacheKeyParts?.(requestConfig) || [
					requestConfig.baseUrl || '',
					requestConfig.workerUrl || ''
				]),
				activePath,
				document.text
			].join('\n');
			if (key === lastKey) {
				if (options.singleFlight && latestRequestByDocument.get(document.uri) === token) {
					latestRequestByDocument.delete(document.uri);
				}
				return lastDiagnostics;
			}
			const pendingDiagnostics = pendingDiagnosticsByKey.get(key);
			if (pendingDiagnostics) {
				if (options.singleFlight && pendingDiagnostics.documentUri === document.uri) {
					latestRequestByDocument.set(document.uri, pendingDiagnostics.token);
				} else if (
					options.singleFlight &&
					latestRequestByDocument.get(document.uri) === token
				) {
					latestRequestByDocument.delete(document.uri);
				}
				return await pendingDiagnostics.operation;
			}
			if (options.diagnosticsProgressStage) {
				context.reportProgress(options.diagnosticsProgressStage);
			}
			const execute = async () => {
				if (options.singleFlight && latestRequestByDocument.get(document.uri) !== token) {
					return [];
				}
				const result = await runDiagnostics({
					...requestConfig,
					code: document.text,
					activePath
				});
				if (options.singleFlight && latestRequestByDocument.get(document.uri) !== token) {
					return [];
				}
				const diagnostics = options.diagnosticsFromResult(result, document);
				lastKey = key;
				lastDiagnostics = diagnostics;
				return diagnostics;
			};
			const operation = options.singleFlight
				? serializedDiagnostics.then(execute, execute)
				: execute();
			if (options.singleFlight) {
				serializedDiagnostics = operation.then(
					() => undefined,
					() => undefined
				);
			}
			pendingDiagnosticsByKey.set(key, { documentUri: document.uri, operation, token });
			try {
				return await operation;
			} finally {
				if (pendingDiagnosticsByKey.get(key)?.operation === operation) {
					pendingDiagnosticsByKey.delete(key);
				}
				if (options.singleFlight && latestRequestByDocument.get(document.uri) === token) {
					latestRequestByDocument.delete(document.uri);
				}
			}
		}
	};
}
