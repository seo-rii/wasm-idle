// Host services for the upstream js_of_ocaml Grain compiler and the WASI programs it emits.
// scripts/sync-wasm-grain.mjs inlines this file (without `export`) into the runner worker and
// also uses it in Node to precompile the bundled standard library with the same host.

export const GRAIN_STDLIB_ROOT = '/grain/stdlib';
export const GRAIN_WORK_ROOT = '/work';
export const GRAIN_STDLIB_PACK_FORMAT = 'wasm-idle-grain-stdlib-pack-v1';
// Precompiled .gro objects must look newer than their .gr sources (Module_resolution.file_older).
export const GRAIN_STDLIB_SOURCE_MTIME_MS = 1_000;
export const GRAIN_STDLIB_OBJECT_MTIME_MS = 2_000;

/** Unpack `[u32 little-endian header length][UTF-8 JSON header][file bytes...]`. */
export function readGrainStdlibPack(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
		throw new Error('Grain stdlib pack is truncated');
	}
	const headerLength = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
	if (headerLength <= 0 || 4 + headerLength > bytes.length) {
		throw new Error('Grain stdlib pack header is invalid');
	}
	const header = JSON.parse(
		new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + headerLength))
	);
	if (header?.format !== GRAIN_STDLIB_PACK_FORMAT || !Array.isArray(header.files)) {
		throw new Error('Grain stdlib pack format is unsupported');
	}
	let offset = 4 + headerLength;
	const files = [];
	for (const file of header.files) {
		if (
			typeof file?.path !== 'string' ||
			!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.gro?$/u.test(file.path) ||
			!Number.isSafeInteger(file.size) ||
			file.size < 0 ||
			offset + file.size > bytes.length
		) {
			throw new Error('Grain stdlib pack entry is invalid');
		}
		files.push({ path: file.path, data: bytes.subarray(offset, offset + file.size) });
		offset += file.size;
	}
	if (offset !== bytes.length) throw new Error('Grain stdlib pack has trailing bytes');
	return files;
}

/**
 * The upstream grainc.bc.js uses js_of_ocaml's Node filesystem backend. This provides the small
 * synchronous `node:fs` subset it calls, backed by memory, plus a `process` object whose `exit`
 * stops compilation. Nothing here interprets Grain source.
 */
export function createGrainCompilerHost({ files, argv, onStdout, onStderr }) {
	const constants = {
		O_RDONLY: 0,
		O_WRONLY: 1,
		O_RDWR: 2,
		O_CREAT: 64,
		O_EXCL: 128,
		O_TRUNC: 512,
		O_APPEND: 1024
	};
	const errnos = {
		EACCES: -13,
		EBADF: -9,
		EEXIST: -17,
		EINVAL: -22,
		EISDIR: -21,
		ENOENT: -2,
		ENOTDIR: -20,
		ENOTEMPTY: -39
	};
	const nodes = new Map();
	let clock = 1_700_000_000_000;
	const tick = () => (clock += 1_000);
	const normalize = (value) => {
		let path = String(value);
		if (!path.startsWith('/')) path = `${GRAIN_WORK_ROOT}/${path}`;
		const parts = [];
		for (const part of path.split('/')) {
			if (!part || part === '.') continue;
			if (part === '..') parts.pop();
			else parts.push(part);
		}
		return `/${parts.join('/')}`;
	};
	const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
	const fsError = (code, syscall, path) => {
		const error = new Error(`${code}: ${syscall}${path === undefined ? '' : ` '${path}'`}`);
		error.code = code;
		error.errno = errnos[code] ?? -1;
		error.syscall = syscall;
		if (path !== undefined) error.path = path;
		return error;
	};
	const makeDirectories = (path) => {
		if (nodes.has(path)) return;
		if (path !== '/') makeDirectories(parentOf(path));
		nodes.set(path, { type: 'dir', mtimeMs: tick() });
	};
	makeDirectories(GRAIN_WORK_ROOT);
	for (const file of files) {
		const path = normalize(file.path);
		makeDirectories(parentOf(path));
		nodes.set(path, { type: 'file', data: file.data, mtimeMs: file.mtimeMs ?? tick() });
	}
	const statOf = (node) => {
		const directory = node.type === 'dir';
		const terminal = node.type === 'tty';
		const time = node.mtimeMs ?? 0;
		return {
			dev: 1,
			ino: 1,
			mode: directory ? 0o40755 : terminal ? 0o20620 : 0o100644,
			nlink: 1,
			uid: 0,
			gid: 0,
			rdev: 0,
			size: node.type === 'file' ? node.data.length : 0,
			atimeMs: time,
			mtimeMs: time,
			ctimeMs: time,
			isFile: () => node.type === 'file',
			isDirectory: () => directory,
			isCharacterDevice: () => terminal,
			isBlockDevice: () => false,
			isSymbolicLink: () => false,
			isFIFO: () => false,
			isSocket: () => false
		};
	};
	const lookup = (path, syscall) => {
		const node = nodes.get(normalize(path));
		if (!node) throw fsError('ENOENT', syscall, path);
		return node;
	};
	const descriptors = new Map([
		[0, { node: { type: 'tty' }, std: 0 }],
		[1, { node: { type: 'tty' }, std: 1 }],
		[2, { node: { type: 'tty' }, std: 2 }]
	]);
	let nextDescriptor = 3;
	const descriptor = (fd, syscall) => {
		const entry = descriptors.get(fd);
		if (!entry) throw fsError('EBADF', syscall);
		return entry;
	};
	const resize = (node, size) => {
		if (node.data.length >= size) return;
		const grown = new Uint8Array(size);
		grown.set(node.data);
		node.data = grown;
	};
	let exitCode = null;
	const fs = {
		existsSync: (path) => nodes.has(normalize(path)),
		statSync: (path) => statOf(lookup(path, 'stat')),
		lstatSync: (path) => statOf(lookup(path, 'lstat')),
		fstatSync: (fd) => statOf(descriptor(fd, 'fstat').node),
		readdirSync(path) {
			const directory = normalize(path);
			if (lookup(path, 'scandir').type !== 'dir') throw fsError('ENOTDIR', 'scandir', path);
			const prefix = directory === '/' ? '/' : `${directory}/`;
			const names = [];
			for (const key of nodes.keys()) {
				const rest = key.slice(prefix.length);
				if (key.startsWith(prefix) && rest && !rest.includes('/')) names.push(rest);
			}
			return names.sort();
		},
		mkdirSync(path) {
			const target = normalize(path);
			if (nodes.has(target)) throw fsError('EEXIST', 'mkdir', path);
			if (nodes.get(parentOf(target))?.type !== 'dir') throw fsError('ENOENT', 'mkdir', path);
			nodes.set(target, { type: 'dir', mtimeMs: tick() });
		},
		rmdirSync(path) {
			if (lookup(path, 'rmdir').type !== 'dir') throw fsError('ENOTDIR', 'rmdir', path);
			if (fs.readdirSync(path).length) throw fsError('ENOTEMPTY', 'rmdir', path);
			nodes.delete(normalize(path));
		},
		unlinkSync(path) {
			if (lookup(path, 'unlink').type === 'dir') throw fsError('EISDIR', 'unlink', path);
			nodes.delete(normalize(path));
		},
		renameSync(from, to) {
			const node = lookup(from, 'rename');
			if (node.type === 'dir') throw fsError('EACCES', 'rename', from);
			nodes.delete(normalize(from));
			nodes.set(normalize(to), node);
		},
		utimesSync(path, _accessTime, modifiedTime) {
			lookup(path, 'utime').mtimeMs = Number(modifiedTime) * 1_000;
		},
		truncateSync(path, length = 0) {
			const node = lookup(path, 'truncate');
			node.data = node.data.slice(0, length);
		},
		ftruncateSync(fd, length = 0) {
			const node = descriptor(fd, 'ftruncate').node;
			if (node.type !== 'file') throw fsError('EINVAL', 'ftruncate');
			node.data = node.data.slice(0, length);
		},
		readlinkSync(path) {
			throw fsError('EINVAL', 'readlink', path);
		},
		symlinkSync(_target, path) {
			throw fsError('EACCES', 'symlink', path);
		},
		opendirSync(path) {
			throw fsError('EACCES', 'opendir', path);
		},
		openSync(path, flags = 0) {
			const target = normalize(path);
			let node = nodes.get(target);
			if (typeof flags !== 'number') throw fsError('EINVAL', 'open', path);
			if (node && flags & constants.O_CREAT && flags & constants.O_EXCL)
				throw fsError('EEXIST', 'open', path);
			if (!node) {
				if (!(flags & constants.O_CREAT)) throw fsError('ENOENT', 'open', path);
				if (nodes.get(parentOf(target))?.type !== 'dir')
					throw fsError('ENOENT', 'open', path);
				node = { type: 'file', data: new Uint8Array(0), mtimeMs: tick() };
				nodes.set(target, node);
			} else if (node.type === 'dir' && flags & 3) {
				throw fsError('EISDIR', 'open', path);
			}
			if (flags & constants.O_TRUNC && node.type === 'file') {
				node.data = new Uint8Array(0);
				node.mtimeMs = tick();
			}
			const fd = nextDescriptor++;
			descriptors.set(fd, {
				node,
				position: 0,
				append: Boolean(flags & constants.O_APPEND)
			});
			return fd;
		},
		closeSync(fd) {
			descriptor(fd, 'close');
			descriptors.delete(fd);
		},
		readSync(fd, buffer, offset, length, position) {
			const entry = descriptor(fd, 'read');
			if (entry.std !== undefined) return 0;
			if (entry.node.type !== 'file') throw fsError('EISDIR', 'read');
			const data = entry.node.data;
			const start = position ?? entry.position;
			const count = Math.max(0, Math.min(length, data.length - start));
			buffer.set(data.subarray(start, start + count), offset);
			if (position === undefined || position === null) entry.position += count;
			return count;
		},
		writeSync(fd, buffer, offset = 0, length = buffer.length - offset, position) {
			const entry = descriptor(fd, 'write');
			const chunk = buffer.subarray(offset, offset + length);
			if (entry.std === 1 || entry.std === 2) {
				// Output after the first exit request is an OCaml handler reporting our exit signal.
				if (exitCode === null) (entry.std === 1 ? onStdout : onStderr)(chunk.slice());
				return length;
			}
			if (entry.std === 0) throw fsError('EBADF', 'write');
			const start = position ?? (entry.append ? entry.node.data.length : entry.position);
			resize(entry.node, start + length);
			entry.node.data.set(chunk, start);
			entry.node.mtimeMs = tick();
			if (position === undefined || position === null) entry.position = start + length;
			return length;
		}
	};
	class GrainCompilerExit extends Error {
		constructor(code) {
			super(`Grain compiler exited with status ${code}`);
			this.name = 'GrainCompilerExit';
			this.status = code;
		}
	}
	const process = Object.freeze({
		versions: Object.freeze({ node: '22.0.0' }),
		platform: 'linux',
		argv: Object.freeze(['node', 'grainc', ...argv]),
		env: Object.freeze({}),
		cwd: () => GRAIN_WORK_ROOT,
		exit(code) {
			if (exitCode === null) exitCode = Number.isInteger(code) ? code : 0;
			throw new GrainCompilerExit(exitCode);
		}
	});
	const require = (name) => {
		if (name === 'node:fs') return fs;
		if (name === 'node:constants') return constants;
		// Sys.command is not available to the browser compiler.
		if (name === 'node:child_process') return {};
		throw new Error(`The Grain compiler host does not provide ${name}`);
	};
	return {
		process,
		require,
		exitCode: () => exitCode,
		isExit: (error) => error instanceof GrainCompilerExit,
		readFile: (path) => nodes.get(normalize(path))?.data,
		files: () =>
			[...nodes]
				.filter(([, node]) => node.type === 'file')
				.map(([path, node]) => ({ path, data: node.data, mtimeMs: node.mtimeMs }))
	};
}

/** Parse grainc's OCaml-style `File "...", line N, characters A-B:` diagnostics. */
export function parseGrainDiagnostics(text) {
	const diagnostics = [];
	const lines = String(text).split(/\r?\n/u);
	for (let index = 0; index < lines.length; index++) {
		const location = /^File "([^"]+)", lines? (\d+)(?:-(\d+))?, characters (\d+)-(\d+):$/u.exec(
			lines[index]
		);
		if (!location) continue;
		const messageLines = [];
		let severity = 'error';
		for (index++; index < lines.length; index++) {
			if (/^File "/u.test(lines[index])) {
				index--;
				break;
			}
			if (!messageLines.length) {
				const head = /^(Error|Warning(?: \d+)?)(?: \([^)]*\))?: ?(.*)$/u.exec(lines[index]);
				if (!head) continue;
				severity = head[1] === 'Error' ? 'error' : 'warning';
				messageLines.push(head[2]);
			} else if (lines[index].trim()) {
				messageLines.push(lines[index].trim());
			} else {
				break;
			}
		}
		if (!messageLines.length) continue;
		const lineNumber = Number(location[2]);
		const endLineNumber = Number(location[3] || location[2]);
		diagnostics.push({
			fileName: location[1].startsWith(`${GRAIN_WORK_ROOT}/`)
				? location[1].slice(GRAIN_WORK_ROOT.length + 1)
				: location[1],
			lineNumber,
			columnNumber: Number(location[4]) + 1,
			endLineNumber,
			endColumnNumber: Number(location[5]) + 1,
			severity,
			message: messageLines.join(' ').trim()
		});
	}
	return diagnostics;
}

/** Minimal WASI preview1 host for one Grain program: stdio only, no preopened directories. */
export function createGrainWasi({ args, readStdin, onStdout, onStderr }) {
	const ESUCCESS = 0;
	const EBADF = 8;
	const EINVAL = 28;
	const ENOSYS = 52;
	const encoder = new TextEncoder();
	let memory = null;
	class GrainProcessExit extends Error {
		constructor(code) {
			super(`Grain program exited with status ${code}`);
			this.name = 'GrainProcessExit';
			this.status = code;
		}
	}
	const view = () => new DataView(memory.buffer);
	const bytes = () => new Uint8Array(memory.buffer);
	const strings = (values) => values.map((value) => encoder.encode(`${value}\0`));
	const sizes = (values, countPtr, sizePtr) => {
		const encoded = strings(values);
		view().setUint32(countPtr, encoded.length, true);
		view().setUint32(
			sizePtr,
			encoded.reduce((total, value) => total + value.length, 0),
			true
		);
		return ESUCCESS;
	};
	const table = (values, pointerPtr, bufferPtr) => {
		let cursor = bufferPtr;
		strings(values).forEach((value, index) => {
			view().setUint32(pointerPtr + index * 4, cursor, true);
			bytes().set(value, cursor);
			cursor += value.length;
		});
		return ESUCCESS;
	};
	const iovecs = (pointer, count) => {
		const result = [];
		for (let index = 0; index < count; index++) {
			result.push({
				pointer: view().getUint32(pointer + index * 8, true),
				length: view().getUint32(pointer + index * 8 + 4, true)
			});
		}
		return result;
	};
	const argv = ['main.wasm', ...args];
	const implementations = {
		args_sizes_get: (countPtr, sizePtr) => sizes(argv, countPtr, sizePtr),
		args_get: (pointerPtr, bufferPtr) => table(argv, pointerPtr, bufferPtr),
		environ_sizes_get: (countPtr, sizePtr) => sizes([], countPtr, sizePtr),
		environ_get: () => ESUCCESS,
		fd_write(fd, iovsPtr, iovsLength, writtenPtr) {
			if (fd !== 1 && fd !== 2) return EBADF;
			let total = 0;
			for (const { pointer, length } of iovecs(iovsPtr, iovsLength)) {
				if (!length) continue;
				(fd === 1 ? onStdout : onStderr)(bytes().slice(pointer, pointer + length));
				total += length;
			}
			view().setUint32(writtenPtr, total, true);
			return ESUCCESS;
		},
		fd_read(fd, iovsPtr, iovsLength, readPtr) {
			if (fd !== 0) return EBADF;
			const vectors = iovecs(iovsPtr, iovsLength);
			const requested = vectors.reduce((total, vector) => total + vector.length, 0);
			const chunk = requested ? readStdin(requested) : new Uint8Array(0);
			let offset = 0;
			for (const { pointer, length } of vectors) {
				const count = Math.min(length, chunk.length - offset);
				if (count <= 0) break;
				bytes().set(chunk.subarray(offset, offset + count), pointer);
				offset += count;
			}
			view().setUint32(readPtr, offset, true);
			return ESUCCESS;
		},
		fd_fdstat_get(fd, statPtr) {
			if (fd < 0 || fd > 2) return EBADF;
			view().setUint8(statPtr, 2);
			view().setUint16(statPtr + 2, 0, true);
			view().setBigUint64(statPtr + 8, 0xffffffffffffffffn, true);
			view().setBigUint64(statPtr + 16, 0xffffffffffffffffn, true);
			return ESUCCESS;
		},
		fd_prestat_get: () => EBADF,
		fd_prestat_dir_name: () => EBADF,
		fd_close: (fd) => (fd >= 0 && fd <= 2 ? ESUCCESS : EBADF),
		fd_sync: (fd) => (fd >= 0 && fd <= 2 ? ESUCCESS : EBADF),
		fd_datasync: (fd) => (fd >= 0 && fd <= 2 ? ESUCCESS : EBADF),
		clock_time_get(clock, _precision, timePtr) {
			if (clock < 0 || clock > 3) return EINVAL;
			const now =
				clock === 0
					? BigInt(Date.now()) * 1_000_000n
					: BigInt(Math.round(performance.now() * 1_000_000));
			view().setBigUint64(timePtr, now, true);
			return ESUCCESS;
		},
		random_get(pointer, length) {
			const target = bytes().subarray(pointer, pointer + length);
			for (let offset = 0; offset < length; offset += 65_536) {
				crypto.getRandomValues(target.subarray(offset, Math.min(length, offset + 65_536)));
			}
			return ESUCCESS;
		},
		sched_yield: () => ESUCCESS,
		proc_exit(code) {
			throw new GrainProcessExit(code);
		}
	};
	return {
		imports(module) {
			const wasi = {};
			for (const entry of WebAssembly.Module.imports(module)) {
				if (entry.module !== 'wasi_snapshot_preview1' || entry.kind !== 'function') {
					throw new Error(
						`Grain program import ${entry.module}.${entry.name} (${entry.kind}) is unsupported`
					);
				}
				// Filesystem, socket and signal calls have no capability here: no fd is preopened.
				wasi[entry.name] = implementations[entry.name] ?? (() => ENOSYS);
			}
			return { wasi_snapshot_preview1: wasi };
		},
		setMemory(value) {
			if (!(value instanceof WebAssembly.Memory)) {
				throw new Error('Grain program does not export its memory');
			}
			memory = value;
		},
		exitStatus: (error) => (error instanceof GrainProcessExit ? error.status : null)
	};
}
