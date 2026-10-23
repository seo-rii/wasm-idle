export interface BashUpstreamModule {
	startBashLanguageServer(options: {
		scope: unknown;
		files?: Readonly<Record<string, string>>;
	}): Promise<void>;
}

interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	postMessage(message: unknown): void;
}

export type LoadBashLanguageServer = (url: string) => Promise<BashUpstreamModule>;

const loadUpstream: LoadBashLanguageServer = (url) => import(/* @vite-ignore */ url);

/** Upstream owns the JSON-RPC reader, document state, analyzer and LSP handlers. */
export function startBashLanguageServerWorker(
	scope: WorkerScope = globalThis as unknown as WorkerScope,
	load: LoadBashLanguageServer = loadUpstream
) {
	let initialized = false;
	scope.addEventListener('message', ({ data }) => {
		if (
			!data ||
			typeof data !== 'object' ||
			(data as { type?: string }).type !== 'init' ||
			initialized
		)
			return;
		initialized = true;
		void (async () => {
			const options = (
				data as {
					options?: { moduleUrl?: string; files?: Readonly<Record<string, string>> };
				}
			).options;
			if (!options?.moduleUrl) throw new Error('Bash LSP module URL is required');
			scope.postMessage({
				type: 'progress',
				stage: 'load-bash-language-server',
				loaded: 0,
				total: 1
			});
			const upstream = await load(options.moduleUrl);
			if (typeof upstream.startBashLanguageServer !== 'function')
				throw new Error('Bash LSP module does not export startBashLanguageServer');
			await upstream.startBashLanguageServer({ scope, files: options.files });
			scope.postMessage({ type: 'ready' });
		})().catch((error) =>
			scope.postMessage({
				type: 'error',
				message: error instanceof Error ? error.message : String(error)
			})
		);
	});
}
