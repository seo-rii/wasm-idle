export const bashFixtureFiles = {
	'lib.sh':
		'# Greeting helper.\nwasm_idle_greet() {\n  printf \'%s\\n\' "$1"\n}\nWASM_IDLE_GREETING=hello\n',
	'main.sh': 'source ./lib.sh\nwasm_idle_greet world\necho "$WASM_IDLE_GREETING"\n'
};

export interface BashTestClient {
	request(method: string, params: unknown): Promise<any>;
	notify(method: string, params: unknown): Promise<void>;
	diagnostics: any[];
}

/** The same protocol sequence runs against the original native CLI and browser port. */
export async function exerciseBashProtocol(client: BashTestClient, rootUri: string) {
	const mainUri = `${rootUri}/main.sh`;
	const libUri = `${rootUri}/lib.sh`;
	const waitFor = async (predicate: () => any) => {
		const deadline = Date.now() + 15_000;
		while (Date.now() < deadline) {
			const result = predicate();
			if (result) return result;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		throw new Error(`Bash diagnostics timed out: ${JSON.stringify(client.diagnostics)}`);
	};
	const initialized = await client.request('initialize', {
		processId: null,
		rootUri,
		capabilities: {},
		initializationOptions: {
			shellcheckPath: '',
			shfmt: { path: '' },
			enableSourceErrorDiagnostics: true
		}
	});
	await client.notify('initialized', {});
	await client.notify('textDocument/didOpen', {
		textDocument: {
			uri: mainUri,
			languageId: 'shellscript',
			version: 1,
			text: 'source ./missing.sh\n'
		}
	});
	const missingSource = await waitFor(() =>
		client.diagnostics.find(
			(entry) => entry.uri === mainUri && entry.version === 1 && entry.diagnostics.length
		)
	);
	await client.notify('textDocument/didChange', {
		textDocument: { uri: mainUri, version: 2 },
		contentChanges: [{ text: bashFixtureFiles['main.sh'] }]
	});
	const corrected = await waitFor(() =>
		client.diagnostics.find(
			(entry) => entry.uri === mainUri && entry.version === 2 && !entry.diagnostics.length
		)
	);
	const position = { line: 1, character: 3 };
	const completion = await client.request('textDocument/completion', {
		textDocument: { uri: mainUri },
		position: { line: 1, character: 15 }
	});
	const hover = await client.request('textDocument/hover', {
		textDocument: { uri: mainUri },
		position
	});
	const definition = await client.request('textDocument/definition', {
		textDocument: { uri: mainUri },
		position
	});
	const references = await client.request('textDocument/references', {
		textDocument: { uri: mainUri },
		position,
		context: { includeDeclaration: true }
	});
	const rename = await client.request('textDocument/rename', {
		textDocument: { uri: mainUri },
		position,
		newName: 'wasm_idle_welcome'
	});
	await client.notify('textDocument/didOpen', {
		textDocument: {
			uri: libUri,
			languageId: 'shellscript',
			version: 1,
			text: bashFixtureFiles['lib.sh']
		}
	});
	const symbols = await client.request('textDocument/documentSymbol', {
		textDocument: { uri: libUri }
	});
	const beforeClose = client.diagnostics.length;
	await client.notify('textDocument/didClose', { textDocument: { uri: mainUri } });
	await waitFor(() =>
		client.diagnostics
			.slice(beforeClose)
			.find((entry) => entry.uri === mainUri && !entry.diagnostics.length)
	);
	const shutdown = await client.request('shutdown', null);
	return {
		capabilities: initialized.capabilities,
		missingSource: missingSource.diagnostics,
		corrected: corrected.diagnostics,
		completion: completion.filter((item: any) => item.label === 'wasm_idle_greet'),
		hover,
		definition,
		references,
		rename,
		symbols,
		shutdown
	};
}
