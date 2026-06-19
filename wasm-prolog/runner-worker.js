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
		log
	} = event.data || {};
	try {
		if (log) {
			console.log(`[wasm-idle:prolog-worker] run start baseUrl=${baseUrl}`);
		}
		importScripts(assetUrl(baseUrl, 'swipl-web.js'));
		const swipl = await self.SWIPL({
			arguments: ['-q'],
			locateFile(path) {
				return assetUrl(baseUrl, path);
			},
			print(text) {
				postOutput(String(text));
			},
			printErr(text) {
				postOutput(String(text));
			},
			stdin: createStdinReader(stdin)
		});

		for (const file of workspaceFiles) {
			writeWorkspaceFile(swipl.FS, file.path, file.content);
		}
		const mainPath = writeWorkspaceFile(swipl.FS, activePath, code);
		const query = `consult(${prologString(mainPath)}), (current_predicate(main/0) -> main ; true).`;
		const goal = swipl.prolog.query(query);
		try {
			const result = goal.once();
			if (result === false) throw new Error('Prolog goal failed.');
		} finally {
			goal.close?.();
		}
		if (log) {
			console.log('[wasm-idle:prolog-worker] run settled');
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:prolog-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	}
};
