// Adapted from pgilliar/scala3-compiler-sjs, revision 357051c857d4ffd5d1e1bfc9a56f0cbf5943a325.
// Upstream compiler/browser-ide/memory-fs.js; Apache-2.0, see ../UPSTREAM-LICENSE.
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function normalizePath(inputPath) {
	const rawPath = String(inputPath ?? '').replace(/\\/g, '/');
	const absolutePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
	const parts = absolutePath.split('/');
	const normalized = [];

	for (const part of parts) {
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			normalized.pop();
			continue;
		}
		normalized.push(part);
	}

	return normalized.length === 0 ? '/' : `/${normalized.join('/')}`;
}

function dirname(path) {
	if (path === '/') {
		return null;
	}
	const index = path.lastIndexOf('/');
	return index <= 0 ? '/' : path.slice(0, index);
}

function basename(path) {
	if (path === '/') {
		return '/';
	}
	const index = path.lastIndexOf('/');
	return path.slice(index + 1);
}

function cloneBytes(bytes) {
	return new Uint8Array(bytes);
}

function toUint8Array(value) {
	if (value instanceof Uint8Array) {
		return cloneBytes(value);
	}
	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value.slice(0));
	}
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(
			value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
		);
	}
	if (typeof value === 'string') {
		return textEncoder.encode(value);
	}
	return Uint8Array.from(value ?? []);
}

function makeStat(entry) {
	return {
		size: entry.type === 'file' ? entry.bytes.length : 0,
		mtimeMs: entry.mtimeMs,
		isFile() {
			return entry.type === 'file';
		},
		isDirectory() {
			return entry.type === 'dir';
		}
	};
}

export function createMemoryFileSystem() {
	const entries = new Map();
	entries.set('/', {
		type: 'dir',
		children: new Set(),
		mtimeMs: Date.now()
	});

	function getEntry(path) {
		return entries.get(normalizePath(path)) ?? null;
	}

	function requireEntry(path) {
		const entry = getEntry(path);
		if (!entry) {
			throw new Error(`No such file or directory: ${normalizePath(path)}`);
		}
		return entry;
	}

	function touch(entry) {
		entry.mtimeMs = Date.now();
	}

	function ensureDirectory(path) {
		const normalized = normalizePath(path);
		if (normalized === '/') {
			return entries.get('/');
		}

		const existing = entries.get(normalized);
		if (existing) {
			if (existing.type !== 'dir') {
				throw new Error(`Not a directory: ${normalized}`);
			}
			return existing;
		}

		const parentPath = dirname(normalized) ?? '/';
		const parent = ensureDirectory(parentPath);
		const name = basename(normalized);
		const created = {
			type: 'dir',
			children: new Set(),
			mtimeMs: Date.now()
		};

		entries.set(normalized, created);
		parent.children.add(name);
		touch(parent);
		return created;
	}

	function writeFile(path, value) {
		const normalized = normalizePath(path);
		const parentPath = dirname(normalized) ?? '/';
		const parent = ensureDirectory(parentPath);
		const existing = entries.get(normalized);
		const nextBytes = toUint8Array(value);

		if (existing && existing.type === 'dir') {
			throw new Error(`Is a directory: ${normalized}`);
		}

		entries.set(normalized, {
			type: 'file',
			bytes: nextBytes,
			mtimeMs: Date.now()
		});
		parent.children.add(basename(normalized));
		touch(parent);
	}

	function deleteEntry(path, recursive, force) {
		const normalized = normalizePath(path);
		if (normalized === '/') {
			if (force) {
				const root = entries.get('/');
				for (const child of [...root.children]) {
					deleteEntry(`/${child}`, true, true);
				}
				return;
			}
			throw new Error('Cannot delete root directory');
		}

		const entry = entries.get(normalized);
		if (!entry) {
			if (force) {
				return;
			}
			throw new Error(`No such file or directory: ${normalized}`);
		}

		if (entry.type === 'dir' && entry.children.size > 0 && !recursive) {
			throw new Error(`Directory not empty: ${normalized}`);
		}

		if (entry.type === 'dir') {
			for (const child of [...entry.children]) {
				deleteEntry(`${normalized}/${child}`, true, force);
			}
		}

		entries.delete(normalized);
		const parent = entries.get(dirname(normalized) ?? '/');
		if (parent && parent.type === 'dir') {
			parent.children.delete(basename(normalized));
			touch(parent);
		}
	}

	function listFiles(path) {
		const normalized = normalizePath(path);
		const entry = getEntry(normalized);
		if (!entry) {
			return [];
		}
		if (entry.type === 'file') {
			return [normalized];
		}

		const files = [];
		for (const child of [...entry.children].sort()) {
			files.push(...listFiles(`${normalized === '/' ? '' : normalized}/${child}`));
		}
		return files;
	}

	const hostFS = {
		cwd() {
			return '/';
		},

		existsSync(path) {
			return entries.has(normalizePath(path));
		},

		statSync(path) {
			return makeStat(requireEntry(path));
		},

		readdirSync(path) {
			const entry = requireEntry(path);
			if (entry.type !== 'dir') {
				throw new Error(`Not a directory: ${normalizePath(path)}`);
			}
			return [...entry.children].sort();
		},

		readFileSync(path) {
			const entry = requireEntry(path);
			if (entry.type !== 'file') {
				throw new Error(`Is a directory: ${normalizePath(path)}`);
			}
			return cloneBytes(entry.bytes);
		},

		readBinary(path) {
			return this.readFileSync(path);
		},

		mkdirSync(path, options = {}) {
			if (options.recursive) {
				ensureDirectory(path);
				return;
			}

			const normalized = normalizePath(path);
			const parentPath = dirname(normalized) ?? '/';
			const parent = requireEntry(parentPath);
			if (parent.type !== 'dir') {
				throw new Error(`Not a directory: ${parentPath}`);
			}
			if (entries.has(normalized)) {
				throw new Error(`File exists: ${normalized}`);
			}
			ensureDirectory(normalized);
		},

		writeFileSync(path, value) {
			writeFile(path, value);
		},

		appendFileSync(path, value) {
			const normalized = normalizePath(path);
			const existing = getEntry(normalized);
			if (!existing) {
				writeFile(normalized, value);
				return;
			}
			if (existing.type !== 'file') {
				throw new Error(`Is a directory: ${normalized}`);
			}

			const appended = new Uint8Array(existing.bytes.length + toUint8Array(value).length);
			appended.set(existing.bytes, 0);
			appended.set(toUint8Array(value), existing.bytes.length);
			writeFile(normalized, appended);
		},

		rmSync(path, options = {}) {
			deleteEntry(path, Boolean(options.recursive), Boolean(options.force));
		},

		rmdirSync(path, options = {}) {
			deleteEntry(path, Boolean(options.recursive), false);
		},

		unlinkSync(path) {
			const entry = requireEntry(path);
			if (entry.type !== 'file') {
				throw new Error(`Not a file: ${normalizePath(path)}`);
			}
			deleteEntry(path, false, false);
		},

		truncateSync(path) {
			writeFile(path, new Uint8Array(0));
		}
	};

	return {
		hostFS,
		mkdir(path) {
			ensureDirectory(path);
		},
		writeText(path, text) {
			writeFile(path, textEncoder.encode(text));
		},
		writeBinary(path, bytes) {
			writeFile(path, bytes);
		},
		readText(path) {
			const entry = requireEntry(path);
			if (entry.type !== 'file') {
				throw new Error(`Not a file: ${normalizePath(path)}`);
			}
			return textDecoder.decode(entry.bytes);
		},
		readBinary(path) {
			const entry = requireEntry(path);
			if (entry.type !== 'file') {
				throw new Error(`Not a file: ${normalizePath(path)}`);
			}
			return cloneBytes(entry.bytes);
		},
		removeTree(path) {
			if (!entries.has(normalizePath(path))) {
				return;
			}
			deleteEntry(path, true, true);
		},
		listFiles
	};
}
