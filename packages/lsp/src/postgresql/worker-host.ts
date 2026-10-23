/** The upstream server owns document state, capabilities, analysis and JSON-RPC handling. */
export interface PostgresqlUpstreamServer {
	handleMessage(message: Record<string, unknown>): unknown[];
}

export interface PostgresqlUpstreamModule {
	createLanguageServer(): Promise<PostgresqlUpstreamServer>;
}

interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	postMessage(message: unknown): void;
}

export type LoadPostgresqlLanguageServer = (url: string) => Promise<PostgresqlUpstreamModule>;

const loadUpstream: LoadPostgresqlLanguageServer = (url) => import(/* @vite-ignore */ url);

export function startPostgresqlLanguageServerWorker(
	scope: WorkerScope = globalThis as unknown as WorkerScope,
	load: LoadPostgresqlLanguageServer = loadUpstream
) {
	let startup: Promise<PostgresqlUpstreamServer> | undefined;
	let queue = Promise.resolve();
	const send = (messages: unknown[]) => {
		for (const message of messages) scope.postMessage(message);
	};
	scope.addEventListener('message', ({ data }) => {
		if (!data || typeof data !== 'object') return;
		const message = data as Record<string, unknown>;
		if (message.type === 'init') {
			if (startup) return;
			startup = (async () => {
				const options = message.options as
					{ moduleUrl?: string; schema?: string } | undefined;
				if (!options?.moduleUrl) throw new Error('PostgreSQL LSP module URL is required');
				scope.postMessage({
					type: 'progress',
					stage: 'load-postgresql-lsp',
					loaded: 0,
					total: 1
				});
				const upstream = await load(options.moduleUrl);
				if (typeof upstream.createLanguageServer !== 'function') {
					throw new Error('PostgreSQL LSP module does not export createLanguageServer');
				}
				const server = await upstream.createLanguageServer();
				if (options.schema !== undefined) {
					send(
						server.handleMessage({
							jsonrpc: '2.0',
							method: 'pgls/setSchema',
							params: { schema: options.schema }
						})
					);
				}
				scope.postMessage({ type: 'ready' });
				return server;
			})();
			void startup.catch((error) =>
				scope.postMessage({
					type: 'error',
					message: error instanceof Error ? error.message : String(error)
				})
			);
			return;
		}
		if (message.jsonrpc !== '2.0' || !startup) return;
		// Preserve receive order even when a client sends messages during initialization.
		queue = queue
			.then(async () => {
				const server = await startup;
				if (server) send(server.handleMessage(message));
			})
			.catch((error) => {
				if (message.id !== undefined) {
					scope.postMessage({
						jsonrpc: '2.0',
						id: message.id,
						error: {
							code: -32603,
							message: error instanceof Error ? error.message : String(error)
						}
					});
				}
			});
	});
}
