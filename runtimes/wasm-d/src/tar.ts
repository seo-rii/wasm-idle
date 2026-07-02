export interface TarEntry {
	path: string;
	type: 'file' | 'directory';
	bytes: Uint8Array;
}

const decoder = new TextDecoder();

function parseString(bytes: Uint8Array) {
	const end = bytes.indexOf(0);
	const view = end === -1 ? bytes : bytes.slice(0, end);
	return decoder.decode(view).trim();
}

function parseOctal(bytes: Uint8Array) {
	const text = parseString(bytes).replace(/\0/g, '').trim();
	return text ? Number.parseInt(text, 8) : 0;
}

function normalizePath(path: string) {
	const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
	const parts: string[] = [];
	for (const part of normalized.split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') throw new Error(`tar entry escapes runtime root: ${path}`);
		parts.push(part);
	}
	return parts.join('/');
}

export function parseTar(bytes: Uint8Array | ArrayBuffer): TarEntry[] {
	const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const entries: TarEntry[] = [];
	for (let offset = 0; offset + 512 <= buffer.byteLength; ) {
		const header = buffer.slice(offset, offset + 512);
		offset += 512;
		if (header.every((value) => value === 0)) break;
		const prefix = parseString(header.slice(345, 500));
		const name = parseString(header.slice(0, 100));
		const path = normalizePath(prefix ? `${prefix}/${name}` : name);
		const size = parseOctal(header.slice(124, 136));
		const typeflag = String.fromCharCode(header[156] || 0);
		const contents = buffer.slice(offset, offset + size);
		offset += Math.ceil(size / 512) * 512;
		if (!path) continue;
		if (typeflag === '5' || path.endsWith('/')) {
			entries.push({
				path: path.replace(/\/$/, ''),
				type: 'directory',
				bytes: new Uint8Array()
			});
			continue;
		}
		if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
			entries.push({ path, type: 'file', bytes: new Uint8Array(contents) });
		}
	}
	return entries;
}
