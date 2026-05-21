const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class MemoryFileSystem {
	private readonly directories = new Set<string>(['/']);
	private readonly files = new Map<string, Uint8Array>();
	private tempCounter = 0;

	private normalizePath(inputPath: string) {
		const normalized = inputPath.replace(/\\/g, '/');
		const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
		const parts: string[] = [];
		for (const segment of absolute.split('/')) {
			if (!segment || segment === '.') {
				continue;
			}
			if (segment === '..') {
				if (parts.length === 0) {
					throw new Error(`memory fs path escapes root: ${inputPath}`);
				}
				parts.pop();
				continue;
			}
			parts.push(segment);
		}
		return `/${parts.join('/')}`.replace(/\/+$/, '') || '/';
	}

	private ensureParentDirectory(filePath: string) {
		const normalized = this.normalizePath(filePath);
		const lastSlash = normalized.lastIndexOf('/');
		const parent = lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
		this.mkdirp(parent);
	}

	mkdirp(inputPath: string) {
		const normalized = this.normalizePath(inputPath);
		if (normalized === '/') {
			this.directories.add('/');
			return normalized;
		}
		const parts = normalized.split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current += `/${part}`;
			this.directories.add(current);
		}
		return normalized;
	}

	writeFile(inputPath: string, data: Uint8Array) {
		const normalized = this.normalizePath(inputPath);
		this.ensureParentDirectory(normalized);
		this.files.set(normalized, new Uint8Array(data));
		return normalized;
	}

	writeText(inputPath: string, text: string) {
		return this.writeFile(inputPath, encoder.encode(text));
	}

	readFile(inputPath: string) {
		const normalized = this.normalizePath(inputPath);
		const file = this.files.get(normalized);
		if (!file) {
			throw new Error(`memory fs file not found: ${normalized}`);
		}
		return new Uint8Array(file);
	}

	readText(inputPath: string) {
		return decoder.decode(this.readFile(inputPath));
	}

	exists(inputPath: string) {
		const normalized = this.normalizePath(inputPath);
		return this.files.has(normalized) || this.directories.has(normalized);
	}

	isDirectory(inputPath: string) {
		return this.directories.has(this.normalizePath(inputPath));
	}

	readdir(inputPath: string) {
		const normalized = this.normalizePath(inputPath);
		if (!this.directories.has(normalized)) {
			throw new Error(`memory fs directory not found: ${normalized}`);
		}
		const prefix = normalized === '/' ? '/' : `${normalized}/`;
		const entries = new Set<string>();
		for (const directory of this.directories) {
			if (directory === normalized || !directory.startsWith(prefix)) {
				continue;
			}
			const remainder = directory.slice(prefix.length);
			if (remainder && !remainder.includes('/')) {
				entries.add(remainder);
			}
		}
		for (const filePath of this.files.keys()) {
			if (!filePath.startsWith(prefix)) {
				continue;
			}
			const remainder = filePath.slice(prefix.length);
			if (remainder && !remainder.includes('/')) {
				entries.add(remainder);
			}
		}
		return [...entries].sort((left, right) => left.localeCompare(right));
	}

	listFiles(prefixPath = '/') {
		const normalized = this.normalizePath(prefixPath);
		const prefix = normalized === '/' ? '/' : `${normalized}/`;
		return [...this.files.keys()]
			.filter((path) => path === normalized || path.startsWith(prefix))
			.sort((left, right) => left.localeCompare(right));
	}

	rename(fromPath: string, toPath: string) {
		const normalizedFrom = this.normalizePath(fromPath);
		const file = this.files.get(normalizedFrom);
		if (!file) {
			throw new Error(`memory fs rename source not found: ${normalizedFrom}`);
		}
		const normalizedTo = this.normalizePath(toPath);
		this.ensureParentDirectory(normalizedTo);
		this.files.set(normalizedTo, new Uint8Array(file));
		this.files.delete(normalizedFrom);
		return normalizedTo;
	}

	createTempPath(prefix = 'tmp', extension = '') {
		this.tempCounter += 1;
		this.mkdirp('/tmp');
		return `/tmp/${prefix}-${this.tempCounter}${extension}`;
	}
}

