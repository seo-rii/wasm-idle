export const RESCRIPT_REFERENCE_FILES = [
	{ path: 'Greeting.resi', content: 'let message: string\nlet twice: int => int\n' },
	{ path: 'Greeting.res', content: 'let message = "hello"\nlet twice = value => value * 2\n' },
	{
		path: 'Main.res',
		content:
			'let answer: int = Greeting.twice(21)\nlet same = answer\nlet text = Greeting.message\nlet formatted = Int.toString(42)\n'
	}
];

/** The same editor conversation is used with the original native IPC server and Chromium. */
export async function exerciseReScriptServer({
	request,
	notify,
	waitForDiagnostics,
	rootUri = 'file:///workspace',
	platformPath = '/rescript',
	runtimePath = '/workspace/node_modules/@rescript/runtime'
}) {
	const uri = rootUri + '/Main.res',
		text = RESCRIPT_REFERENCE_FILES.find((file) => file.path === 'Main.res').content;
	const config = {
		askToStartBuild: false,
		platformPath,
		runtimePath,
		logLevel: 'error',
		cache: { projectConfig: { enable: false } },
		incrementalTypechecking: { enable: true, acrossFiles: true }
	};
	const initialize = await request('initialize', {
		processId: null,
		rootUri,
		workspaceFolders: [{ uri: rootUri, name: 'browser' }],
		capabilities: {},
		initializationOptions: { extensionConfiguration: config }
	});
	await notify('initialized', {});
	await notify('textDocument/didOpen', {
		textDocument: { uri, languageId: 'rescript', version: 1, text }
	});
	const baseline = await waitForDiagnostics(
		(value) => value.uri === uri && value.diagnostics.length === 0
	);
	const document = { textDocument: { uri } };
	const hover = await request('textDocument/hover', {
		...document,
		position: { line: 0, character: 5 }
	});
	const definition = await request('textDocument/definition', {
		...document,
		position: { line: 2, character: 23 }
	});
	const completion = await request('textDocument/completion', {
		...document,
		position: { line: 2, character: 20 }
	});
	const references = await request('textDocument/references', {
		...document,
		position: { line: 0, character: 5 },
		context: { includeDeclaration: true }
	});
	const rename = await request('textDocument/rename', {
		...document,
		position: { line: 0, character: 5 },
		newName: 'renamedAnswer'
	});
	const stdlibDefinition = await request('textDocument/definition', {
		...document,
		position: { line: 3, character: 22 }
	});
	const symbols = await request('textDocument/documentSymbol', document);
	const signature = await request('textDocument/signatureHelp', {
		...document,
		position: { line: 0, character: 34 }
	});
	const formatting = await request('textDocument/formatting', {
		...document,
		options: { tabSize: 2, insertSpaces: true }
	});
	await notify('textDocument/didChange', {
		textDocument: { uri, version: 2 },
		contentChanges: [{ text: text.replace('answer: int', 'answer: string') }]
	});
	const error = await waitForDiagnostics(
		(value) =>
			value.uri === uri &&
			value.diagnostics.some((d) => d.message.includes('string') && d.message.includes('int'))
	);
	await notify('textDocument/didChange', {
		textDocument: { uri, version: 3 },
		contentChanges: [{ text }]
	});
	const cleared = await waitForDiagnostics(
		(value) => value.uri === uri && value.diagnostics.length === 0
	);
	await notify('textDocument/didClose', { textDocument: { uri } });
	const shutdown = await request('shutdown', null);
	await notify('exit', null);
	return {
		initialize,
		baseline,
		hover,
		definition,
		stdlibDefinition,
		completion,
		references,
		rename,
		symbols,
		signature,
		formatting,
		error,
		cleared,
		shutdown
	};
}
