export function positionAt(text, offset) {
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
export function offsetAt(text, position) {
    const targetLine = Math.max(0, position.line);
    let line = 0;
    let offset = 0;
    while (line < targetLine && offset < text.length) {
        const next = text.indexOf('\n', offset);
        if (next === -1)
            return text.length;
        offset = next + 1;
        line += 1;
    }
    const lineEnd = text.indexOf('\n', offset);
    const end = lineEnd === -1 ? text.length : lineEnd;
    return Math.min(offset + Math.max(0, position.character), end);
}
export function applyContentChanges(text, changes) {
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
export function uriToPath(uri) {
    try {
        const parsed = new URL(uri);
        return decodeURIComponent(parsed.pathname || uri);
    }
    catch {
        return uri;
    }
}
export function pathToUri(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `file://${normalized}`;
}
export function fullDocumentRange(text) {
    return {
        start: { line: 0, character: 0 },
        end: positionAt(text, text.length)
    };
}
export function startWorkerLanguageServer(service, scope = globalThis) {
    const documents = new Map();
    const diagnosticVersions = new Map();
    let initialized = false;
    let ready = false;
    let shutdown = false;
    const send = (message) => scope.postMessage(message);
    const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
    const respondError = (id, code, message, data) => send({
        jsonrpc: '2.0',
        id,
        error: { code, message, ...(data === undefined ? {} : { data }) }
    });
    const publishDiagnostics = (uri, diagnostics) => send({
        jsonrpc: '2.0',
        method: 'textDocument/publishDiagnostics',
        params: { uri, diagnostics }
    });
    const context = {
        documents,
        publishDiagnostics,
        reportProgress(stage, loaded, total) {
            if (ready)
                return;
            send({
                type: 'progress',
                stage,
                ...(loaded === undefined ? {} : { loaded }),
                ...(total === undefined ? {} : { total })
            });
        }
    };
    const scheduleDiagnostics = (document) => {
        if (!service.diagnostics)
            return;
        const version = (diagnosticVersions.get(document.uri) || 0) + 1;
        diagnosticVersions.set(document.uri, version);
        setTimeout(async () => {
            try {
                const diagnostics = await service.diagnostics?.(document, context);
                if (diagnosticVersions.get(document.uri) === version &&
                    documents.get(document.uri)?.version === document.version) {
                    publishDiagnostics(document.uri, diagnostics || []);
                }
            }
            catch (error) {
                if (diagnosticVersions.get(document.uri) !== version)
                    return;
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
        }, Math.max(0, service.diagnosticDelay || 0));
    };
    const getDocument = (params) => {
        const uri = params?.textDocument?.uri;
        return typeof uri === 'string' ? documents.get(uri) : undefined;
    };
    const handleRequest = async (message) => {
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
                respondError(id, -32602, 'Text document is not open');
                return;
            }
            const position = params.position;
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
                    respond(id, (await service.signatureHelp?.(document, position, context)) ?? null);
                    return;
                case 'textDocument/documentSymbol':
                    respond(id, (await service.documentSymbols?.(document, context)) ?? []);
                    return;
                case 'textDocument/formatting':
                    respond(id, (await service.formatting?.(document, params.options || {}, context)) ?? []);
                    return;
                default:
                    respondError(id, -32601, `Method not found: ${message.method}`);
            }
        }
        catch (error) {
            respondError(id, -32603, error instanceof Error ? error.message : String(error));
        }
    };
    const handleNotification = async (message) => {
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
                const document = {
                    uri: textDocument.uri,
                    languageId: textDocument.languageId || '',
                    version: Number(textDocument.version || 0),
                    text: textDocument.text || ''
                };
                documents.set(document.uri, document);
                scheduleDiagnostics(document);
                return;
            }
            case 'textDocument/didChange': {
                const current = getDocument(params);
                if (!current)
                    return;
                const document = {
                    ...current,
                    version: Number(params.textDocument?.version ?? current.version + 1),
                    text: applyContentChanges(current.text, params.contentChanges || [])
                };
                documents.set(document.uri, document);
                scheduleDiagnostics(document);
                return;
            }
            case 'textDocument/didSave': {
                const current = getDocument(params);
                if (!current)
                    return;
                const document = typeof params.text === 'string' ? { ...current, text: params.text } : current;
                documents.set(document.uri, document);
                scheduleDiagnostics(document);
                return;
            }
            case 'textDocument/didClose': {
                const document = getDocument(params);
                if (!document)
                    return;
                documents.delete(document.uri);
                diagnosticVersions.delete(document.uri);
                publishDiagnostics(document.uri, []);
                await service.close?.(document, context);
            }
        }
    };
    scope.addEventListener('message', (event) => {
        const message = event.data;
        if (!message || typeof message !== 'object')
            return;
        if (message.type === 'init') {
            if (initialized)
                return;
            initialized = true;
            void Promise.resolve(service.initialize?.(message.options, context))
                .then(() => {
                ready = true;
                send({ type: 'ready' });
            })
                .catch((error) => send({
                type: 'error',
                message: error instanceof Error ? error.message : String(error)
            }));
            return;
        }
        if (message.jsonrpc !== '2.0' || !message.method)
            return;
        if ('id' in message) {
            void handleRequest(message);
        }
        else {
            void handleNotification(message);
        }
    });
}
//# sourceMappingURL=lsp.js.map