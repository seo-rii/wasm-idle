import { getLean4LanguageServer } from '@wasm-idle/lsp/lean4';
import { createMessageConnection } from 'vscode-jsonrpc/browser';

export async function runLean4SdkBrowserProbe() {
	const started = performance.now();
	const phase = (value) => {
		globalThis.__lean4ProbePhase = value;
		console.log('lean-probe-phase', value);
	};
	phase('startup');
	const status = [];
	const handle = await getLean4LanguageServer({
		currentUrl: location.href,
		persistentCache: { enabled: true },
		startupTimeoutMs: 120000,
		onStatus: (value) => status.push(value)
	});
	const connection = createMessageConnection(handle.transport.reader, handle.transport.writer);
	const notifications = [];
	connection.onNotification((method, params) => notifications.push({ method, params }));
	for (const method of [
		'workspace/inlayHint/refresh',
		'workspace/semanticTokens/refresh',
		'client/registerCapability',
		'window/workDoneProgress/create'
	])
		connection.onRequest(method, () => null);
	connection.listen();
	const request = (method, params) =>
		Promise.race([
			connection.sendRequest(method, params),
			new Promise((_, reject) => setTimeout(() => reject(Error('Timeout: ' + method)), 90000))
		]);
	const waitFor = async (predicate) => {
		const until = Date.now() + 90000;
		while (Date.now() < until) {
			const result = predicate();
			if (result) return result;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		throw Error(
			'Expected original Lean notification did not arrive at ' +
				globalThis.__lean4ProbePhase +
				': ' +
				JSON.stringify(notifications.slice(-12))
		);
	};
	const uri = 'file:///workspace/Main.lean';
	try {
		phase('initialize');
		const initialized = await request('initialize', {
			processId: null,
			rootUri: 'file:///workspace',
			capabilities: {},
			initializationOptions: { hasWidgets: false }
		});
		if (
			!initialized.capabilities.hoverProvider ||
			!initialized.capabilities.completionProvider ||
			initialized.capabilities.workspaceSymbolProvider
		)
			throw Error('Unexpected original server capability profile.');
		await connection.sendNotification('initialized', {});
		// Monaco can send requests before its deferred didOpen. They must reach the real file process later.
		const earlySymbols = request('textDocument/documentSymbol', {
			textDocument: { uri: uri.toLowerCase() }
		});
		await connection.sendNotification('textDocument/didOpen', {
			textDocument: {
				uri,
				languageId: 'lean4',
				version: 1,
				text: 'def answer : Nat := 42\n#check answer\n'
			}
		});
		phase('hover');
		const hover = await request('textDocument/hover', {
			textDocument: { uri },
			position: { line: 1, character: 9 }
		});
		if (!JSON.stringify(hover).includes('answer : Nat'))
			throw Error('Original hover missing Nat.');
		const completion = await request('textDocument/completion', {
			textDocument: { uri },
			position: { line: 1, character: 9 }
		});
		if (!completion.items?.some((item) => item.label === 'answer'))
			throw Error('Original completion missing answer.');
		const definition = await request('textDocument/definition', {
			textDocument: { uri },
			position: { line: 1, character: 9 }
		});
		if (
			!definition?.some(
				(item) => item.targetUri === uri && item.targetSelectionRange?.start.line === 0
			)
		)
			throw Error('Original definition missing local declaration.');
		const symbols = await earlySymbols;
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri, version: 2 },
			contentChanges: [{ text: 'def answer : Nat := "bad"\n#check answer\n' }]
		});
		phase('invalid-diagnostic');
		const diagnostic = await waitFor(() =>
			notifications.find(
				(m) =>
					m.method === 'textDocument/publishDiagnostics' &&
					m.params.version === 2 &&
					m.params.diagnostics.some(
						(d) => d.severity === 1 && /Type mismatch/.test(d.message)
					)
			)
		);
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri, version: 3 },
			contentChanges: [{ text: 'def answer : Nat := 43\n#check answer\n' }]
		});
		await waitFor(() =>
			notifications.find(
				(m) =>
					m.method === 'textDocument/publishDiagnostics' &&
					m.params.version === 3 &&
					!m.params.diagnostics.some((d) => d.severity === 1)
			)
		);
		phase('import-restart');
		// Changing the import header causes upstream FileWorker exit 2; the browser process host restarts it.
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri, version: 4 },
			contentChanges: [{ text: 'import Init\ndef answer : Nat := 44\n#check answer\n' }]
		});
		await waitFor(() =>
			notifications.find(
				(m) =>
					m.method === 'textDocument/publishDiagnostics' &&
					m.params.version === 4 &&
					!m.params.diagnostics.some((d) => d.severity === 1)
			)
		);
		phase('restarted-hover');
		const restartedHover = await request('textDocument/hover', {
			textDocument: { uri },
			position: { line: 2, character: 9 }
		});
		if (!JSON.stringify(restartedHover).includes('answer : Nat'))
			throw Error('Original restarted hover missing Nat.');
		phase('repeated-edits');
		for (let version = 5; version <= 16; version++) {
			await connection.sendNotification('textDocument/didChange', {
				textDocument: { uri, version },
				contentChanges: [
					{ text: `import Init\ndef answer : Nat := ${version}\n#check answer\n` }
				]
			});
			await waitFor(() =>
				notifications.find(
					(m) =>
						m.method === 'textDocument/publishDiagnostics' &&
						m.params.version === version &&
						!m.params.diagnostics.some((d) => d.severity === 1)
				)
			);
			const editedHover = await request('textDocument/hover', {
				textDocument: { uri },
				position: { line: 2, character: 9 }
			});
			if (!JSON.stringify(editedHover).includes('answer : Nat'))
				throw Error(`Original hover failed after edit ${version}.`);
		}
		phase('unicode');
		const unicodeLine = 'def «답» : Nat := 42 -- 안녕 👋';
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri, version: 17 },
			contentChanges: [{ text: `import Init\n${unicodeLine}\n#check «답»\n` }]
		});
		const emoji = unicodeLine.indexOf('👋');
		await connection.sendNotification('textDocument/didChange', {
			textDocument: { uri: uri.toLowerCase(), version: 18 },
			contentChanges: [
				{
					range: {
						start: { line: 1, character: emoji },
						end: { line: 1, character: emoji + 2 }
					},
					text: '🌟'
				}
			]
		});
		const unicodeDiagnostics = await waitFor(() =>
			notifications.find(
				(m) => m.method === 'textDocument/publishDiagnostics' && m.params.version === 18
			)
		);
		if (unicodeDiagnostics.params.diagnostics.some((d) => d.severity === 1))
			throw Error('Original Unicode diagnostics: ' + JSON.stringify(unicodeDiagnostics));
		const unicodeHover = await request('textDocument/hover', {
			textDocument: { uri },
			position: { line: 2, character: 8 }
		});
		if (
			!JSON.stringify(unicodeHover).includes('답') ||
			!JSON.stringify(unicodeHover).includes('Nat')
		)
			throw Error(
				'Original Unicode identifier hover failed: ' + JSON.stringify(unicodeHover)
			);
		const unsupported = await connection
			.sendRequest('workspace/symbol', { query: 'answer' })
			.then(
				() => false,
				(e) => e.code === -32601
			);
		if (!unsupported)
			throw Error('Native-only workspace operation must be reported as unsupported.');
		return {
			initialized,
			hover,
			definition,
			completion: {
				count: completion.items.length,
				answer: completion.items.find((item) => item.label === 'answer')
			},
			earlySymbols: symbols,
			diagnostic,
			restartedHover,
			repeatedEdits: 12,
			unicodeHover,
			status,
			elapsedMs: performance.now() - started
		};
	} finally {
		connection.dispose();
		handle.dispose();
		handle.dispose();
	}
}

export async function runLean4LifecycleProbe() {
	// Reopen the same verified distribution from the persistent cache, then dispose before initialize.
	const reused = await getLean4LanguageServer({
		currentUrl: location.href,
		persistentCache: { enabled: true },
		startupTimeoutMs: 120000
	});
	reused.dispose();
	reused.dispose();
	let creations = 0;
	const controller = new AbortController();
	controller.abort();
	const aborted = await getLean4LanguageServer({
		currentUrl: location.href,
		signal: controller.signal,
		createWorker: () => {
			creations++;
			throw Error('Must not create an aborted worker');
		}
	}).then(
		() => false,
		(e) => e.name === 'AbortError'
	);
	const timedOut = await getLean4LanguageServer({
		currentUrl: location.href,
		startupTimeoutMs: 1
	}).then(
		(h) => {
			h.dispose();
			return false;
		},
		(e) => e.name === 'LanguageServerStartupTimeoutError'
	);
	if (!aborted || creations || !timedOut) throw Error('Lean lifecycle contract failed.');
	return { cacheReopened: true, aborted, creations, timedOut };
}
