import type { LspDocumentContext, WorkerLanguageService } from './lsp.js';
import type { TypeScriptLanguage } from './typescript/service.js';

type TypeScriptLibLoader = () => Promise<Record<string, string>>;

const createDeferredWorkerService = (
	name: string,
	load: () => Promise<WorkerLanguageService>
): WorkerLanguageService => {
	let servicePromise: Promise<WorkerLanguageService> | null = null;
	const getService = () => (servicePromise ??= load());
	const call = async (method: keyof WorkerLanguageService, args: unknown[]) => {
		const service = await getService();
		const handler = service[method];
		if (typeof handler !== 'function') return undefined;
		return await (handler as (...values: unknown[]) => unknown).apply(service, args);
	};

	const deferred = {
		name,
		async initialize(options: unknown, context: LspDocumentContext) {
			const service = await getService();
			Object.assign(deferred, service);
			await service.initialize?.(options, context);
		},
		diagnostics: (...args: unknown[]) => call('diagnostics', args),
		completion: (...args: unknown[]) => call('completion', args),
		hover: (...args: unknown[]) => call('hover', args),
		definition: (...args: unknown[]) => call('definition', args),
		signatureHelp: (...args: unknown[]) => call('signatureHelp', args),
		documentSymbols: (...args: unknown[]) => call('documentSymbols', args),
		formatting: (...args: unknown[]) => call('formatting', args),
		close: (...args: unknown[]) => call('close', args),
		dispose: (...args: unknown[]) => call('dispose', args)
	} as WorkerLanguageService;

	return deferred;
};

export const createTypeScriptWorkerService = (
	defaultLanguage: TypeScriptLanguage,
	loadLibs?: TypeScriptLibLoader
) =>
	createDeferredWorkerService(`wasm-idle-${defaultLanguage}-lsp`, async () => {
		const { createTypeScriptWorkerService: createService } =
			await import('./typescript/service.js');
		return createService(defaultLanguage, loadLibs);
	});

export const createWatWorkerService = () =>
	createDeferredWorkerService('wasm-idle-wat-lsp', async () => {
		const { createWatWorkerService: createService } = await import('./wat/service.js');
		return createService();
	});

export const createGraphqlWorkerService = () =>
	createDeferredWorkerService('wasm-idle-graphql-lsp', async () => {
		const { createGraphqlWorkerService: createService } = await import('./graphql/service.js');
		return createService();
	});

export const createDocumentWorkerService = () =>
	createDeferredWorkerService('wasm-idle-document-lsp', async () => {
		const { createDocumentWorkerService: createService } =
			await import('./document/service.js');
		return createService();
	});
