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
	diagnosticsFromResult: (result: TResult, document: LspDocument) => readonly LspDiagnostic[];
	validateConfig?: (config: TConfig) => string | null | undefined;
	cacheKeyParts?: (config: TConfig) => readonly string[];
	activePathFromDocument?: (document: LspDocument) => string;
}

const defaultActivePathFromDocument = (document: LspDocument, fallback: string) =>
	document.uri.split('/').pop() || fallback;

// Neither a runner nor a caller owns the diagnostic objects retained by the cache.
const copyDiagnostics = (diagnostics: readonly LspDiagnostic[]): LspDiagnostic[] =>
	diagnostics.map((diagnostic) => ({
		...diagnostic,
		range: {
			start: { ...diagnostic.range.start },
			end: { ...diagnostic.range.end }
		}
	}));

export function createStaticWorkerDiagnostics<
	TConfig extends StaticWorkerDiagnosticConfig,
	TResult extends StaticWorkerDiagnosticResult = StaticWorkerDiagnosticResult
>(
	options: StaticWorkerDiagnosticsOptions<TConfig, TResult>
): Pick<WorkerLanguageService, 'initialize' | 'diagnostics'> {
	let config: TConfig | null = null;
	let generation = Symbol('initialization');
	let lastKey = '';
	let lastDiagnostics: readonly LspDiagnostic[] = [];
	let serializedDiagnostics: Promise<void> = Promise.resolve();
	const latestRequestByDocument = new Map<string, symbol>();
	const pendingDiagnosticsByKey = new Map<
		string,
		{
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
			generation = Symbol('initialization');
			lastKey = '';
			lastDiagnostics = [];
			latestRequestByDocument.clear();
			pendingDiagnosticsByKey.clear();
			// Keep the serialization chain: a previous generation may still own a worker.
		},
		async diagnostics(document: LspDocument, context: LspDocumentContext) {
			if (!config) return [];
			const requestGeneration = generation;
			const previousToken = latestRequestByDocument.get(document.uri);
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
			const key = JSON.stringify([
				document.uri,
				...(options.cacheKeyParts?.(requestConfig) || [
					requestConfig.baseUrl || '',
					requestConfig.workerUrl || ''
				]),
				activePath,
				document.text
			]);
			if (key === lastKey) {
				if (options.singleFlight && latestRequestByDocument.get(document.uri) === token) {
					latestRequestByDocument.delete(document.uri);
				}
				return copyDiagnostics(lastDiagnostics);
			}
			const pendingDiagnostics = pendingDiagnosticsByKey.get(key);
			if (
				pendingDiagnostics &&
				(!options.singleFlight || previousToken === pendingDiagnostics.token)
			) {
				// Share consecutive requests for the same document state, but never revive
				// a superseded operation when an edit returns from A to B to A.
				if (options.singleFlight) {
					latestRequestByDocument.set(document.uri, pendingDiagnostics.token);
				}
				return copyDiagnostics(await pendingDiagnostics.operation);
			}
			if (options.diagnosticsProgressStage) {
				context.reportProgress(options.diagnosticsProgressStage);
			}
			const execute = async () => {
				if (
					generation !== requestGeneration ||
					(options.singleFlight && latestRequestByDocument.get(document.uri) !== token)
				) {
					return [];
				}
				const result = await runDiagnostics({
					...requestConfig,
					code: document.text,
					activePath
				});
				if (
					generation !== requestGeneration ||
					(options.singleFlight && latestRequestByDocument.get(document.uri) !== token)
				) {
					return [];
				}
				const diagnostics = copyDiagnostics(
					options.diagnosticsFromResult(result, document)
				);
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
			pendingDiagnosticsByKey.set(key, { operation, token });
			try {
				return copyDiagnostics(await operation);
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
