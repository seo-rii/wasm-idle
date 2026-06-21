const encoder = new TextEncoder();

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(text) {
	if (!text) return;
	self.postMessage({ output: text.endsWith('\n') ? text : `${text}\n` });
}

function normalizeWorkspacePath(path) {
	const parts = [];
	for (const part of String(path || '')
		.replace(/^\/+/, '')
		.split('/')) {
		if (!part || part === '.' || part === '..' || part.includes('\0')) continue;
		parts.push(part);
	}
	return parts.join('/') || 'main.prolog';
}

function dirname(path) {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

function prologString(value) {
	return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function createStdinReader(stdin) {
	const bytes = encoder.encode(typeof stdin === 'string' ? stdin : '');
	let offset = 0;
	return () => {
		if (offset >= bytes.byteLength) return null;
		const value = bytes[offset];
		offset += 1;
		return value;
	};
}

function mkdirp(fs, path) {
	if (!path) return;
	let current = '';
	for (const part of path.split('/')) {
		if (!part) continue;
		current += `/${part}`;
		if (!fs.analyzePath(current).exists) fs.mkdir(current);
	}
}

function writeWorkspaceFile(fs, path, content) {
	const normalized = normalizeWorkspacePath(path);
	const fullPath = `/${normalized}`;
	mkdirp(fs, dirname(normalized));
	fs.writeFile(fullPath, content);
	return fullPath;
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		code,
		stdin,
		activePath = 'main.prolog',
		workspaceFiles = [],
		diagnose = false,
		log
	} = event.data || {};
	let diagnosticOutput = '';
	const originalConsole = diagnose
		? {
				log: console.log.bind(console),
				warn: console.warn.bind(console),
				error: console.error.bind(console)
			}
		: null;
	const appendDiagnosticOutput = (...args) => {
		if (!diagnose) return;
		const output = args
			.map((value) => (typeof value === 'string' ? value : value?.message || String(value)))
			.join(' ');
		if (output) diagnosticOutput += output.endsWith('\n') ? output : `${output}\n`;
	};
	if (originalConsole) {
		console.log = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.log(...args);
		};
		console.warn = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.warn(...args);
		};
		console.error = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.error(...args);
		};
	}
	try {
		if (log) {
			console.log(
				`[wasm-idle:prolog-worker] ${diagnose ? 'diagnose' : 'run'} start baseUrl=${baseUrl}`
			);
		}
		importScripts(assetUrl(baseUrl, 'swipl-web.js'));
		const swipl = await self.SWIPL({
			arguments: ['-q'],
			locateFile(path) {
				return assetUrl(baseUrl, path);
			},
			print(text) {
				const output = String(text);
				if (diagnose) diagnosticOutput += `${output}\n`;
				postOutput(output);
			},
			printErr(text) {
				const output = String(text);
				if (diagnose) diagnosticOutput += `${output}\n`;
				postOutput(output);
			},
			stdin: createStdinReader(stdin)
		});

		for (const file of workspaceFiles) {
			writeWorkspaceFile(swipl.FS, file.path, file.content);
		}
		const mainPath = writeWorkspaceFile(swipl.FS, activePath, code);
		const query = diagnose
			? `setup_call_cleanup(open_string(${prologString(
					code
				)}, Stream), (repeat, read_term(Stream, Term, [syntax_errors(error)]), (Term == end_of_file -> ! ; fail)), close(Stream)).`
			: `consult(${prologString(mainPath)}), (current_predicate(main/0) -> main ; true).`;
		const goal = swipl.prolog.query(query);
		try {
			const result = goal.once();
			if (result === false) throw new Error('Prolog goal failed.');
		} finally {
			goal.close?.();
		}
		if (diagnose && /\b(?:error|warning)\b|syntax error/iu.test(diagnosticOutput)) {
			throw new Error(diagnosticOutput.trim());
		}
		if (log) {
			console.log(`[wasm-idle:prolog-worker] ${diagnose ? 'diagnose' : 'run'} settled`);
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:prolog-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	} finally {
		if (originalConsole) {
			console.log = originalConsole.log;
			console.warn = originalConsole.warn;
			console.error = originalConsole.error;
		}
	}
};
