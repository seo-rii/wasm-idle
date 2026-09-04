import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { importRuntimeModule } from '$lib/playground/runtimeModule';

declare var self: any;

const encoder = new TextEncoder();

let stdinBufferPhp: Int32Array | null = null;
let runtimeModuleUrl = '';
let phpPromise: Promise<PhpRuntime> | null = null;
let workspaceDirty = false;

interface PhpRuntime {
	mkdir(path: string): void;
	rmdir(path: string, options?: { recursive?: boolean }): void;
	writeFile(path: string, content: string): void;
	run(options: Record<string, unknown>): Promise<{
		text: string;
		errors: string;
		exitCode: number;
	}>;
}

interface PhpRuntimeModule {
	createPhp84(): Promise<PhpRuntime>;
}

function postProgress(percent: number) {
	postMessage({ progress: { percent: Math.max(0, Math.min(100, percent)) } });
}

async function loadPhp(moduleUrl: string, log = true) {
	if (!moduleUrl) throw new Error('PHP runtime module URL is not configured.');
	if (runtimeModuleUrl !== moduleUrl) {
		runtimeModuleUrl = moduleUrl;
		phpPromise = null;
		workspaceDirty = false;
	}
	if (phpPromise) return await phpPromise;
	phpPromise = (async () => {
		postProgress(5);
		const runtime = await importRuntimeModule<PhpRuntimeModule>(moduleUrl);
		const php = await runtime.createPhp84();
		postProgress(95);
		php.mkdir('/workspace');
		if (log) {
			console.log('[wasm-idle:php-worker] PHP 8.4 ready');
		}
		postProgress(100);
		return php;
	})();
	return await phpPromise;
}

function prepareWorkspace(php: PhpRuntime) {
	if (workspaceDirty) {
		php.rmdir('/workspace', { recursive: true });
		php.mkdir('/workspace');
	}
	workspaceDirty = true;
}

function normalizeWorkspacePath(path: string) {
	return path
		.replace(/^\/+/, '')
		.split('/')
		.filter((part) => part && part !== '.' && part !== '..' && !part.includes('\0'))
		.join('/');
}

function dirname(path: string) {
	const slashIndex = path.lastIndexOf('/');
	return slashIndex === -1 ? '' : path.slice(0, slashIndex);
}

function mkdirp(php: PhpRuntime, path: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) return;
	let current = '';
	for (const part of normalized.split('/')) {
		current += `/${part}`;
		try {
			php.mkdir(current);
		} catch {
			// Existing directories throw from the Emscripten FS API.
		}
	}
}

function writeWorkspaceFile(php: PhpRuntime, path: string, content: string) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized) return;
	const fullPath = `/workspace/${normalized}`;
	mkdirp(php, dirname(`workspace/${normalized}`));
	php.writeFile(fullPath, content);
}

function phpString(value: string) {
	return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function skipPhpTrivia(code: string, offset: number) {
	let cursor = offset;
	while (cursor < code.length) {
		if (/\s/u.test(code[cursor])) {
			cursor += 1;
			continue;
		}
		if (
			code.startsWith('//', cursor) ||
			(code[cursor] === '#' && !code.startsWith('#[', cursor))
		) {
			const newline = code.indexOf('\n', cursor + 1);
			cursor = newline === -1 ? code.length : newline + 1;
			continue;
		}
		if (code.startsWith('/*', cursor)) {
			const commentEnd = code.indexOf('*/', cursor + 2);
			cursor = commentEnd === -1 ? code.length : commentEnd + 2;
			continue;
		}
		break;
	}
	return cursor;
}

function startsWithPhpKeyword(code: string, offset: number, keyword: string) {
	if (code.slice(offset, offset + keyword.length).toLowerCase() !== keyword) return false;
	return !/[A-Za-z0-9_\u0080-\uffff]/u.test(code[offset + keyword.length] || '');
}

function findPhpHeaderDelimiter(code: string, offset: number, delimiters: Set<string>) {
	let quote = '';
	let parentheses = 0;
	let brackets = 0;
	for (let cursor = offset; cursor < code.length; cursor += 1) {
		const character = code[cursor];
		if (quote) {
			if (character === '\\') cursor += 1;
			else if (character === quote) quote = '';
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (
			code.startsWith('//', cursor) ||
			(character === '#' && !code.startsWith('#[', cursor))
		) {
			const newline = code.indexOf('\n', cursor + 1);
			if (newline === -1) return -1;
			cursor = newline;
			continue;
		}
		if (code.startsWith('/*', cursor)) {
			const commentEnd = code.indexOf('*/', cursor + 2);
			if (commentEnd === -1) return -1;
			cursor = commentEnd + 1;
			continue;
		}
		if (character === '(') parentheses += 1;
		else if (character === ')') parentheses = Math.max(0, parentheses - 1);
		else if (character === '[') brackets += 1;
		else if (character === ']') brackets = Math.max(0, brackets - 1);
		else if (parentheses === 0 && brackets === 0 && delimiters.has(character)) return cursor;
	}
	return -1;
}

function argvPreludeInsertionOffset(code: string, openingTagEnd: number) {
	let cursor = skipPhpTrivia(code, openingTagEnd);
	while (startsWithPhpKeyword(code, cursor, 'declare')) {
		const declarationEnd = findPhpHeaderDelimiter(
			code,
			cursor + 'declare'.length,
			new Set([';'])
		);
		if (declarationEnd === -1) return cursor;
		cursor = skipPhpTrivia(code, declarationEnd + 1);
	}
	if (
		startsWithPhpKeyword(code, cursor, 'namespace') &&
		(/\s/u.test(code[cursor + 'namespace'.length] || '') ||
			code[cursor + 'namespace'.length] === '{')
	) {
		const namespaceEnd = findPhpHeaderDelimiter(
			code,
			cursor + 'namespace'.length,
			new Set([';', '{'])
		);
		if (namespaceEnd !== -1) return namespaceEnd + 1;
	}
	return cursor;
}

function injectArgv(code: string, activePath: string, args: string[]) {
	const argv = [activePath, ...args].map(phpString).join(', ');
	const prelude = `$argv = array(${argv});\n$argc = count($argv);\n$_SERVER['argv'] = $argv;\n$_SERVER['argc'] = $argc;\n`;
	const openingTag = code.match(/^\s*<\?php\b/i);
	if (openingTag) {
		const insertAt = argvPreludeInsertionOffset(code, openingTag[0].length);
		return `${code.slice(0, insertAt)}\n${prelude}${code.slice(insertAt)}`;
	}
	return `<?php\n${prelude}\n?>\n${code}`;
}

function codeMightReadStdin(code: string) {
	return /php:\/\/input|STDIN|stream_get_contents|file_get_contents|fgets\s*\(/.test(code);
}

function readInitialStdin(code: string, initialStdin: unknown, log = true) {
	if (typeof initialStdin === 'string') return initialStdin;
	if (!codeMightReadStdin(code)) return '';
	const chunk = waitForBufferedStdin(stdinBufferPhp!, () => postMessage({ buffer: true }));
	if (log) {
		console.log(
			chunk == null
				? '[wasm-idle:php-stdin] read(bytes=0, eof=true)'
				: `[wasm-idle:php-stdin] read(bytes=${encoder.encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
		);
	}
	return chunk || '';
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		activePath = 'main.php',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			const moduleUrl = nextModuleUrl || runtimeModuleUrl;
			if (log) console.log(`[wasm-idle:php-worker] load PHP 8.4 module=${moduleUrl}`);
			await loadPhp(moduleUrl, log);
			postMessage({ load: true });
			return;
		}

		stdinBufferPhp = new Int32Array(buffer);
		const php = await loadPhp(runtimeModuleUrl, log);

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		prepareWorkspace(php);
		for (const file of workspaceFiles as SandboxWorkspaceFile[]) {
			await writeWorkspaceFile(php, file.path, file.content);
		}
		const normalizedActivePath = normalizeWorkspacePath(activePath) || 'main.php';
		const scriptPath = `/workspace/${normalizedActivePath}`;
		writeWorkspaceFile(php, normalizedActivePath, injectArgv(code, normalizedActivePath, args));

		if (log) {
			console.log(
				`[wasm-idle:php-worker] run start bytes=${code.length} activePath=${activePath}`
			);
		}
		const body = readInitialStdin(code, stdin, log);
		postMessage({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'PHP program started'
			}
		});
		const response = await php.run({
			scriptPath,
			body,
			env: {
				USER: 'jungol'
			},
			$_SERVER: {
				SCRIPT_FILENAME: scriptPath,
				SCRIPT_NAME: `/${normalizedActivePath}`
			}
		});
		if (response.text) postMessage({ output: response.text });
		if (response.errors) postMessage({ output: response.errors });
		if (response.exitCode !== 0) {
			throw new Error(
				response.errors
					? `PHP program exited with code ${response.exitCode}\n${response.errors}`
					: `PHP program exited with code ${response.exitCode}`
			);
		}
		if (log) {
			console.log(`[wasm-idle:php-worker] run settled exitCode=${response.exitCode}`);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:php-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
