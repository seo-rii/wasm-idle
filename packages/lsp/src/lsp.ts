export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspDiagnostic {
	range: LspRange;
	severity?: 1 | 2 | 3 | 4;
	code?: string | number;
	source?: string;
	message: string;
}

export interface LspTextEdit {
	range: LspRange;
	newText: string;
}

export interface LspDocument {
	uri: string;
	languageId: string;
	version: number;
	text: string;
}

export interface LspDocumentContext {
	documents: ReadonlyMap<string, LspDocument>;
	publishDiagnostics: (uri: string, diagnostics: LspDiagnostic[]) => void;
	reportProgress: (stage: string, loaded?: number, total?: number) => void;
}

export interface WorkerLanguageService {
	name: string;
	version?: string;
	diagnosticDelay?: number;
	capabilities?: Record<string, unknown>;
	initialize?: (options: unknown, context: LspDocumentContext) => void | Promise<void>;
	diagnostics?: (
		document: LspDocument,
		context: LspDocumentContext
	) => LspDiagnostic[] | Promise<LspDiagnostic[]>;
	completion?: (
		document: LspDocument,
		position: LspPosition,
		context: LspDocumentContext
	) => unknown | Promise<unknown>;
	hover?: (
		document: LspDocument,
		position: LspPosition,
		context: LspDocumentContext
	) => unknown | Promise<unknown>;
	definition?: (
		document: LspDocument,
		position: LspPosition,
		context: LspDocumentContext
	) => unknown | Promise<unknown>;
	signatureHelp?: (
		document: LspDocument,
		position: LspPosition,
		context: LspDocumentContext
	) => unknown | Promise<unknown>;
	documentSymbols?: (
		document: LspDocument,
		context: LspDocumentContext
	) => unknown | Promise<unknown>;
	formatting?: (
		document: LspDocument,
		options: Record<string, unknown>,
		context: LspDocumentContext
	) => LspTextEdit[] | Promise<LspTextEdit[]>;
	close?: (document: LspDocument, context: LspDocumentContext) => void | Promise<void>;
	dispose?: () => void | Promise<void>;
}

interface WorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
	postMessage(message: unknown): void;
}

interface JsonRpcMessage {
	jsonrpc?: string;
	id?: string | number | null;
	method?: string;
	params?: Record<string, any>;
}

interface ContentChange {
	range?: LspRange | null;
	text: string;
}

export function positionAt(text: string, offset: number): LspPosition {
	const bounded = Math.max(0, Math.min(offset, text.length));
	let line = 0;
	let lineStart = 0;
	for (let index = 0; index < bounded; index += 1) {
		if (text.charCodeAt(index) === 10) {
			line += 1;
			lineStart = index + 1;
		}
	}
	return { line, character: bounded - lineStart };
}

export function offsetAt(text: string, position: LspPosition): number {
	const targetLine = Math.max(0, position.line);
	let line = 0;
	let offset = 0;
	while (line < targetLine && offset < text.length) {
		const next = text.indexOf('\n', offset);
		if (next === -1) return text.length;
		offset = next + 1;
		line += 1;
	}
	const lineEnd = text.indexOf('\n', offset);
	const end = lineEnd === -1 ? text.length : lineEnd;
	return Math.min(offset + Math.max(0, position.character), end);
}

export function applyContentChanges(text: string, changes: ContentChange[]) {
	let next = text;
	for (const change of changes) {
		if (!change.range) {
			next = change.text;
			continue;
		}
		const start = offsetAt(next, change.range.start);
		const end = offsetAt(next, change.range.end);
		next = `${next.slice(0, start)}${change.text}${next.slice(end)}`;
	}
	return next;
}

export function uriToPath(uri: string) {
	try {
		const parsed = new URL(uri);
		return decodeURIComponent(parsed.pathname || uri);
	} catch {
		return uri;
	}
}

export function pathToUri(path: string) {
	const normalized = path.startsWith('/') ? path : `/${path}`;
	return `file://${normalized}`;
}

export function fullDocumentRange(text: string): LspRange {
	return {
		start: { line: 0, character: 0 },
		end: positionAt(text, text.length)
	};
}

export function startWorkerLanguageServer(
	service: WorkerLanguageService,
	scope: WorkerScope = globalThis as unknown as WorkerScope
) {
	const documents = new Map<string, LspDocument>();
	const diagnosticVersions = new Map<string, number>();
	let initialized = false;
	let ready = false;
	let shutdown = false;
	let debug = false;

	const send = (message: unknown) => scope.postMessage(message);
	const respond = (id: string | number | null, result: unknown) =>
		send({ jsonrpc: '2.0', id, result });
	const respondError = (
		id: string | number | null,
		code: number,
		message: string,
		data?: unknown
	) =>
		send({
			jsonrpc: '2.0',
			id,
			error: { code, message, ...(data === undefined ? {} : { data }) }
		});
	const publishDiagnostics = (uri: string, diagnostics: LspDiagnostic[]) =>
		send({
			jsonrpc: '2.0',
			method: 'textDocument/publishDiagnostics',
			params: { uri, diagnostics }
		});
	const context: LspDocumentContext = {
		documents,
		publishDiagnostics,
		reportProgress(stage, loaded, total) {
			if (ready) return;
			send({
				type: 'progress',
				stage,
				...(loaded === undefined ? {} : { loaded }),
				...(total === undefined ? {} : { total })
			});
		}
	};

	const scheduleDiagnostics = (document: LspDocument) => {
		if (!service.diagnostics) return;
		const version = (diagnosticVersions.get(document.uri) || 0) + 1;
		diagnosticVersions.set(document.uri, version);
		if (debug) {
			console.debug(
				`[wasm-idle:lsp-worker:${service.name}] schedule diagnostics uri=${document.uri} version=${document.version} bytes=${document.text.length}`
			);
		}
		setTimeout(
			async () => {
				try {
					if (
						diagnosticVersions.get(document.uri) !== version ||
						documents.get(document.uri)?.version !== document.version
					) {
						if (debug) {
							console.debug(
								`[wasm-idle:lsp-worker:${service.name}] diagnostics skipped stale uri=${document.uri} version=${document.version}`
							);
						}
						return;
					}
					if (debug) {
						console.debug(
							`[wasm-idle:lsp-worker:${service.name}] diagnostics start uri=${document.uri} version=${document.version}`
						);
					}
					const diagnostics = await service.diagnostics?.(document, context);
					if (debug) {
						console.debug(
							`[wasm-idle:lsp-worker:${service.name}] diagnostics done uri=${document.uri} version=${document.version} count=${diagnostics?.length || 0}`
						);
					}
					if (
						diagnosticVersions.get(document.uri) === version &&
						documents.get(document.uri)?.version === document.version
					) {
						publishDiagnostics(document.uri, diagnostics || []);
					}
				} catch (error) {
					if (debug) {
						console.error(
							`[wasm-idle:lsp-worker:${service.name}] diagnostics failed`,
							error
						);
					}
					if (diagnosticVersions.get(document.uri) !== version) return;
					publishDiagnostics(document.uri, [
						{
							range: {
								start: { line: 0, character: 0 },
								end: { line: 0, character: 1 }
							},
							severity: 1,
							source: service.name,
							message: error instanceof Error ? error.message : String(error)
						}
					]);
				}
			},
			Math.max(0, service.diagnosticDelay || 0)
		);
	};

	const getDocument = (params: Record<string, any> | undefined) => {
		const uri = params?.textDocument?.uri;
		return typeof uri === 'string' ? documents.get(uri) : undefined;
	};

	const handleRequest = async (message: JsonRpcMessage) => {
		const id = message.id ?? null;
		const params = message.params || {};
		try {
			switch (message.method) {
				case 'initialize':
					respond(id, {
						capabilities: {
							textDocumentSync: {
								openClose: true,
								change: 2,
								save: { includeText: true }
							},
							...(service.capabilities || {})
						},
						serverInfo: {
							name: service.name,
							...(service.version ? { version: service.version } : {})
						}
					});
					return;
				case 'shutdown':
					shutdown = true;
					respond(id, null);
					return;
			}

			const document = getDocument(params);
			if (!document) {
				switch (message.method) {
					case 'textDocument/completion':
					case 'textDocument/hover':
					case 'textDocument/definition':
					case 'textDocument/signatureHelp':
						respond(id, null);
						return;
					case 'textDocument/documentSymbol':
					case 'textDocument/formatting':
						respond(id, []);
						return;
				}
				respondError(id, -32602, 'Text document is not open');
				return;
			}
			const position = params.position as LspPosition;
			switch (message.method) {
				case 'textDocument/completion':
					respond(id, (await service.completion?.(document, position, context)) ?? null);
					return;
				case 'textDocument/hover':
					respond(id, (await service.hover?.(document, position, context)) ?? null);
					return;
				case 'textDocument/definition':
					respond(id, (await service.definition?.(document, position, context)) ?? null);
					return;
				case 'textDocument/signatureHelp':
					respond(
						id,
						(await service.signatureHelp?.(document, position, context)) ?? null
					);
					return;
				case 'textDocument/documentSymbol':
					respond(id, (await service.documentSymbols?.(document, context)) ?? []);
					return;
				case 'textDocument/formatting':
					respond(
						id,
						(await service.formatting?.(document, params.options || {}, context)) ?? []
					);
					return;
				default:
					respondError(id, -32601, `Method not found: ${message.method}`);
			}
		} catch (error) {
			respondError(id, -32603, error instanceof Error ? error.message : String(error));
		}
	};

	const handleNotification = async (message: JsonRpcMessage) => {
		const params = message.params || {};
		switch (message.method) {
			case 'initialized':
				return;
			case 'exit':
				if (!shutdown) {
					await service.dispose?.();
				}
				return;
			case 'textDocument/didOpen': {
				const textDocument = params.textDocument;
				const document: LspDocument = {
					uri: textDocument.uri,
					languageId: textDocument.languageId || '',
					version: Number(textDocument.version || 0),
					text: textDocument.text || ''
				};
				if (debug) {
					console.debug(
						`[wasm-idle:lsp-worker:${service.name}] didOpen uri=${document.uri} version=${document.version} bytes=${document.text.length}`
					);
				}
				documents.set(document.uri, document);
				scheduleDiagnostics(document);
				return;
			}
			case 'textDocument/didChange': {
				const current = getDocument(params);
				const textDocument = params.textDocument || {};
				const uri = textDocument.uri;
				if (!current && typeof uri !== 'string') return;
				const document: LspDocument = {
					...(current || { uri, languageId: '', version: 0, text: '' }),
					version: Number(textDocument.version ?? (current?.version ?? 0) + 1),
					text: applyContentChanges(current?.text || '', params.contentChanges || [])
				};
				if (debug) {
					console.debug(
						`[wasm-idle:lsp-worker:${service.name}] didChange uri=${document.uri} version=${document.version} bytes=${document.text.length}`
					);
				}
				documents.set(document.uri, document);
				scheduleDiagnostics(document);
				return;
			}
			case 'textDocument/didSave': {
				const current = getDocument(params);
				if (!current) return;
				const document =
					typeof params.text === 'string' ? { ...current, text: params.text } : current;
				documents.set(document.uri, document);
				scheduleDiagnostics(document);
				return;
			}
			case 'textDocument/didClose': {
				const document = getDocument(params);
				if (!document) return;
				documents.delete(document.uri);
				diagnosticVersions.delete(document.uri);
				publishDiagnostics(document.uri, []);
				await service.close?.(document, context);
			}
		}
	};

	scope.addEventListener('message', (event) => {
		const message = event.data as JsonRpcMessage & {
			type?: string;
			options?: unknown;
		};
		if (!message || typeof message !== 'object') return;
		if (message.type === 'init') {
			if (initialized) return;
			initialized = true;
			const initOptions = message.options as { debug?: unknown } | null | undefined;
			debug =
				!!initOptions && typeof initOptions === 'object' && initOptions.debug === true;
			if (debug) {
				console.debug(`[wasm-idle:lsp-worker:${service.name}] init`);
			}
			void Promise.resolve(service.initialize?.(message.options, context))
				.then(() => {
					ready = true;
					send({ type: 'ready' });
				})
				.catch((error) =>
					send({
						type: 'error',
						message: error instanceof Error ? error.message : String(error)
					})
				);
			return;
		}
		if (message.jsonrpc !== '2.0' || !message.method) return;
		if (message.id !== undefined) {
			void handleRequest(message);
		} else {
			void handleNotification(message);
		}
	});
}
