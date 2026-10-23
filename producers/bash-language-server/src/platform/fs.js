import path from 'path-browserify';
import { Buffer } from 'buffer/';

const files = new Map();
const directories = new Set(['/', '/workspace', '/bin', '/upstream', '/upstream/out']);

export function normalizePath(value) {
	const name = value instanceof URL ? decodeURIComponent(value.pathname) : String(value);
	return path.resolve(
		'/workspace',
		name.startsWith('file://') ? decodeURIComponent(new URL(name).pathname) : name
	);
}

function error(code, filename) {
	return Object.assign(new Error(`${code}: ${filename}`), { code, path: filename });
}

export function writeFileSync(filename, contents) {
	const key = normalizePath(filename);
	files.set(key, Buffer.from(contents));
	let parent = path.dirname(key);
	while (!directories.has(parent)) {
		directories.add(parent);
		parent = path.dirname(parent);
	}
}

export function initializeFiles(workspaceFiles, grammar, ini) {
	files.clear();
	directories.clear();
	for (const directory of ['/', '/workspace', '/bin', '/upstream', '/upstream/out'])
		directories.add(directory);
	writeFileSync('/upstream/tree-sitter-bash.wasm', grammar);
	if (ini) writeFileSync('/upstream/out/one_ini_bg.wasm', ini);
	for (const [filename, text] of Object.entries(workspaceFiles || {})) {
		const key = normalizePath(filename);
		if (!key.startsWith('/workspace/'))
			throw new Error('Bash workspace files must be under /workspace');
		writeFileSync(key, text);
	}
}

export function readFileSync(filename, options) {
	const key = normalizePath(filename);
	const contents = files.get(key);
	if (!contents) throw error('ENOENT', key);
	const encoding = typeof options === 'string' ? options : options?.encoding;
	return encoding ? contents.toString(encoding) : Buffer.from(contents);
}

export function existsSync(filename) {
	const key = normalizePath(filename);
	return files.has(key) || directories.has(key);
}

export function statSync(filename) {
	const key = normalizePath(filename);
	const directory = directories.has(key);
	if (!directory && !files.has(key)) throw error('ENOENT', key);
	return {
		size: files.get(key)?.length || 0,
		mode: directory ? 0o40755 : 0o100644,
		mtime: new Date(0),
		mtimeMs: 0,
		isFile: () => !directory,
		isDirectory: () => directory,
		isSymbolicLink: () => false,
		isBlockDevice: () => false,
		isCharacterDevice: () => false,
		isFIFO: () => false,
		isSocket: () => false
	};
}

export const lstatSync = statSync;

export function readdirSync(filename, options) {
	const key = normalizePath(filename);
	if (!statSync(key).isDirectory()) throw error('ENOTDIR', key);
	const children = new Set();
	for (const candidate of [...files.keys(), ...directories]) {
		if (candidate !== key && path.dirname(candidate) === key)
			children.add(path.basename(candidate));
	}
	return [...children]
		.sort()
		.map((name) =>
			options?.withFileTypes ? { name, ...statSync(path.join(key, name)) } : name
		);
}

export const realpathSync = Object.assign(
	(filename) => {
		const key = normalizePath(filename);
		if (!existsSync(key)) throw error('ENOENT', key);
		return key;
	},
	{ native: (filename) => realpathSync(filename) }
);

export function accessSync(filename, mode = 0) {
	const stats = statSync(filename);
	if (mode & 1 && !(stats.mode & 0o111)) throw error('EACCES', filename);
}

function callbackVersion(operation) {
	return (...args) => {
		const callback = args.pop();
		queueMicrotask(() => {
			let value;
			try {
				value = operation(...args);
			} catch (failure) {
				callback(failure);
				return;
			}
			callback(null, value);
		});
	};
}

export const readFile = callbackVersion(readFileSync);
export const readdir = callbackVersion(readdirSync);
export const stat = callbackVersion(statSync);
export const lstat = callbackVersion(lstatSync);
export const access = callbackVersion(accessSync);
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
export const promises = {
	async readFile(filename, options) {
		if (options?.signal?.aborted) throw options.signal.reason;
		return readFileSync(filename, options);
	},
	async readdir(...args) {
		return readdirSync(...args);
	},
	async stat(...args) {
		return statSync(...args);
	},
	async lstat(...args) {
		return lstatSync(...args);
	},
	async access(...args) {
		return accessSync(...args);
	}
};
