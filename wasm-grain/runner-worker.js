// Host services for the upstream js_of_ocaml Grain compiler and the WASI programs it emits.
// scripts/sync-wasm-grain.mjs inlines this file (without `export`) into the runner worker and
// also uses it in Node to precompile the bundled standard library with the same host.

const GRAIN_STDLIB_ROOT = '/grain/stdlib';
const GRAIN_WORK_ROOT = '/work';
const GRAIN_STDLIB_PACK_FORMAT = 'wasm-idle-grain-stdlib-pack-v1';
// Precompiled .gro objects must look newer than their .gr sources (Module_resolution.file_older).
const GRAIN_STDLIB_SOURCE_MTIME_MS = 1_000;
const GRAIN_STDLIB_OBJECT_MTIME_MS = 2_000;

/** Unpack `[u32 little-endian header length][UTF-8 JSON header][file bytes...]`. */
function readGrainStdlibPack(bytes) {
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
function createGrainCompilerHost({ files, argv, onStdout, onStderr }) {
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
function parseGrainDiagnostics(text) {
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
function createGrainWasi({ args, readStdin, onStdout, onStderr }) {
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

// scripts/sync-wasm-grain.mjs prepends grain-host.mjs and binds this worker to one Grain profile.
const grainProfile = {"profileId":"grain-0.7.2-jsoo-wasi-v1","grainVersion":"0.7.2","compilerJavaScript":{"bytes":20872240,"sha256":"0a85cf0120aafd873e41eb901a18090453010f8f819074b77c14e1c359cafd1e"},"compilerStorage":{"bytes":3417153,"sha256":"38cf8c42ed83447287e0bc54c768661a110b7becf1b93bdfdd6da30537c4e289"},"stdlibPack":{"bytes":5066092,"sha256":"c56e83cbea649be5dd94ce98ae648b8f98e40203761ef7b1ad0a799048ee08eb"},"stdlibStorage":{"bytes":1653344,"sha256":"7180475667a3129821be12aa787f449e58de62b0bb5c0e5472077b73b9e5cafa"}};
const GRAIN_WASM_PAGE_BYTES = 65_536;
const GRAIN_DEFAULT_INITIAL_PAGES = 64;
let grainConsumed = false;

async function grainDigest(bytes) {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) =>
		value.toString(16).padStart(2, '0')
	).join('');
}

async function grainVerify(bytes, receipt, label) {
	if (
		!(bytes instanceof Uint8Array) ||
		bytes.length !== receipt.bytes ||
		(await grainDigest(bytes)) !== receipt.sha256
	) {
		throw new Error(`Grain verified asset changed: ${label}`);
	}
	return bytes;
}

async function grainGunzip(bytes, receipt, label) {
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
	const decoded = new Uint8Array(await new Response(stream).arrayBuffer());
	return grainVerify(decoded, receipt, label);
}

function grainStdin(source, channel) {
	if (!channel) {
		const input = new TextEncoder().encode(source || '');
		let offset = 0;
		return (maxLength) => {
			const chunk = input.subarray(offset, offset + maxLength);
			offset += chunk.length;
			return chunk;
		};
	}
	if (
		channel.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel.protocolVersion !== 1 ||
		channel.controlBytes !== 16 ||
		!Number.isSafeInteger(channel.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== 16 + channel.capacity
	)
		throw new Error('Invalid Grain stdin ring');
	const control = new Int32Array(channel.buffer, 0, 4);
	const ring = new Uint8Array(channel.buffer, 16, channel.capacity);
	return (maxLength) => {
		while (true) {
			if (Atomics.load(control, 3)) throw new Error('Grain stdin cancelled');
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > ring.length)
				throw new Error('Invalid Grain stdin counters');
			if (available) {
				const count = Math.min(maxLength, available);
				const chunk = new Uint8Array(count);
				for (let index = 0; index < count; index++)
					chunk[index] = ring[(read + index) % ring.length];
				Atomics.store(control, 1, read + count);
				self.postMessage({ type: 'stdin-request' });
				return chunk;
			}
			if (Atomics.load(control, 2)) return new Uint8Array(0);
			self.postMessage({ type: 'stdin-request' });
			// EOF changes a different slot; recheck after a bounded wait if its notification raced.
			Atomics.wait(control, 0, write, 100);
		}
	};
}

function grainWorkspacePath(name) {
	if (
		typeof name !== 'string' ||
		name.startsWith('/') ||
		name.includes('\\') ||
		name.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new Error('Invalid Grain workspace path');
	}
	return `${GRAIN_WORK_ROOT}/${name}`;
}

function grainLimitError(message, code, actual, limit) {
	return Object.assign(new Error(message), { code, actual, limit });
}

self.onmessage = async ({ data }) => {
	if (data?.run !== true || grainConsumed) return;
	grainConsumed = true;
	const urls = [];
	let phase = 'compile';
	let programStderr = '';
	try {
		const { limits, runtimePreflight: assets, activePath, workspaceFiles, code } = data;
		if (
			!limits ||
			typeof code !== 'string' ||
			typeof activePath !== 'string' ||
			!assets ||
			assets.protocol !== 'wasm-idle-grain-preflight' ||
			assets.profileId !== grainProfile.profileId ||
			(data.args !== undefined &&
				(!Array.isArray(data.args) || data.args.some((value) => typeof value !== 'string')))
		)
			throw new Error('Invalid Grain execution payload');
		for (const key of ['maxWasmMemoryBytes', 'maxOutputBytes', 'maxWorkspaceBytes']) {
			if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0)
				throw new Error('Invalid Grain execution limit');
		}
		if (!activePath.endsWith('.gr'))
			throw new Error('Grain source files must use the .gr extension');
		self.postMessage({ progress: { percent: 5, stage: 'Verifying Grain compiler' } });
		const compilerBytes = await grainGunzip(
			await grainVerify(
				assets.compilerBytes,
				grainProfile.compilerStorage,
				'grainc.js.gz.bin'
			),
			grainProfile.compilerJavaScript,
			'grainc.js'
		);
		const stdlibBytes = await grainGunzip(
			await grainVerify(assets.stdlibBytes, grainProfile.stdlibStorage, 'stdlib.pack.gz.bin'),
			grainProfile.stdlibPack,
			'stdlib.pack'
		);
		const files = readGrainStdlibPack(stdlibBytes).map((file) => ({
			path: `${GRAIN_STDLIB_ROOT}/${file.path}`,
			data: file.data,
			mtimeMs: file.path.endsWith('.gro')
				? GRAIN_STDLIB_OBJECT_MTIME_MS
				: GRAIN_STDLIB_SOURCE_MTIME_MS
		}));
		const encoder = new TextEncoder();
		const sources = new Map();
		for (const file of workspaceFiles || []) {
			if (typeof file?.content !== 'string') throw new Error('Invalid Grain workspace file');
			sources.set(file.path, file.content);
		}
		sources.set(activePath, code);
		let workspaceBytes = 0;
		for (const [name, source] of sources) {
			const data = encoder.encode(source);
			workspaceBytes += data.length;
			if (workspaceBytes > limits.maxWorkspaceBytes)
				throw Object.assign(new Error('Grain workspace limit exceeded'), {
					code: 'runtime-configuration'
				});
			files.push({ path: grainWorkspacePath(name), data });
		}
		const maximumPages = Math.min(
			65_536,
			Math.floor(limits.maxWasmMemoryBytes / GRAIN_WASM_PAGE_BYTES)
		);
		if (maximumPages < 1)
			throw grainLimitError(
				'Grain programs need at least one Wasm memory page',
				'resource-limit',
				GRAIN_WASM_PAGE_BYTES,
				limits.maxWasmMemoryBytes
			);
		const source = grainWorkspacePath(activePath);
		const output = source.replace(/\.gr$/u, '.wasm');
		let compilerText = '';
		const decoder = new TextDecoder();
		const collect = (chunk) => {
			compilerText += decoder.decode(chunk, { stream: true });
			if (encoder.encode(compilerText).length > limits.maxOutputBytes)
				throw grainLimitError(
					'Grain compiler output limit exceeded',
					'output-limit',
					compilerText.length,
					limits.maxOutputBytes
				);
		};
		// These flags are not part of Grain's object digest, so the precompiled stdlib stays valid.
		const host = createGrainCompilerHost({
			files,
			argv: [
				'--stdlib',
				GRAIN_STDLIB_ROOT,
				'--no-color',
				`--initial-memory-pages=${Math.min(GRAIN_DEFAULT_INITIAL_PAGES, maximumPages)}`,
				`--maximum-memory-pages=${maximumPages}`,
				'-o',
				output,
				source
			],
			onStdout: collect,
			onStderr: collect
		});
		self.postMessage({ progress: { percent: 20, stage: 'Compiling Grain' } });
		const compilerUrl = URL.createObjectURL(
			new Blob([compilerBytes], { type: 'text/javascript' })
		);
		urls.push(compilerUrl);
		globalThis.process = host.process;
		globalThis.require = host.require;
		let failure;
		try {
			await import(compilerUrl);
		} catch (error) {
			failure = error;
		} finally {
			delete globalThis.process;
			delete globalThis.require;
		}
		compilerText += decoder.decode();
		const status = host.exitCode() ?? (failure ? null : 0);
		if (status === null) throw failure;
		for (const diagnostic of parseGrainDiagnostics(compilerText)) {
			self.postMessage({ diagnostic });
		}
		if (compilerText) self.postMessage({ output: compilerText, stream: 'stderr' });
		const program = host.readFile(output);
		if (status !== 0 || !program) {
			self.postMessage({ results: false });
			return;
		}
		self.postMessage({ progress: { percent: 80, stage: 'Starting Grain program' } });
		const module = await WebAssembly.compile(program);
		let outputBytes = 0;
		let pending = [];
		const outputDecoder = new TextDecoder();
		const flush = (final = false) => {
			const total = pending.reduce((sum, chunk) => sum + chunk.length, 0);
			const joined = new Uint8Array(total);
			let offset = 0;
			for (const chunk of pending) {
				joined.set(chunk, offset);
				offset += chunk.length;
			}
			pending = [];
			const text = outputDecoder.decode(joined, { stream: !final });
			if (text) self.postMessage({ output: text, stream: 'stdout' });
		};
		const write = (chunk) => {
			outputBytes += chunk.length;
			if (outputBytes > limits.maxOutputBytes)
				throw grainLimitError(
					'Grain output limit exceeded',
					'output-limit',
					outputBytes,
					limits.maxOutputBytes
				);
			pending.push(chunk);
			if (chunk.includes(10) || pending.length > 64) flush();
		};
		const readStdin = grainStdin(data.stdin, data.stdinChannel);
		const wasi = createGrainWasi({
			args: data.args || [],
			readStdin(maxLength) {
				flush();
				return readStdin(maxLength);
			},
			onStdout: write,
			onStderr(chunk) {
				programStderr = (programStderr + new TextDecoder().decode(chunk)).slice(-4096);
				write(chunk);
			}
		});
		const imports = wasi.imports(module);
		phase = 'execute';
		self.postMessage({ type: 'execution-ready' });
		const instance = await WebAssembly.instantiate(module, imports);
		wasi.setMemory(instance.exports.memory);
		let exitCode = 0;
		try {
			if (typeof instance.exports._start !== 'function')
				throw new Error('Grain program does not export _start');
			instance.exports._start();
		} catch (error) {
			const exitStatus = wasi.exitStatus(error);
			if (exitStatus === null) throw error;
			exitCode = exitStatus;
		} finally {
			flush(true);
		}
		self.postMessage({
			evidence: {
				protocol: 'wasm-idle-grain-evidence-v1',
				profileId: grainProfile.profileId,
				compilerSha256: grainProfile.compilerJavaScript.sha256,
				maximumMemoryBytes: maximumPages * GRAIN_WASM_PAGE_BYTES,
				finalMemoryBytes: instance.exports.memory.buffer.byteLength,
				exitCode
			}
		});
		self.postMessage({ results: exitCode === 0 });
	} catch (error) {
		const message = String(error?.message || error);
		// Grain's allocator reports OutOfMemory on stderr and then traps.
		const memoryFailure =
			error instanceof RangeError ||
			/out of memory|Maximum memory size exceeded|could not allocate memory/iu.test(
				message
			) ||
			(phase === 'execute' && /^OutOfMemory\b/mu.test(programStderr));
		const code =
			error?.code ||
			(memoryFailure ? 'resource-limit' : phase === 'compile' ? 'compile' : 'runtime');
		self.postMessage({
			error: message,
			failure: {
				name: error?.name || 'Error',
				message,
				code,
				phase,
				runtimeId: 'GRAIN',
				...(code === 'resource-limit'
					? {
							resource: 'wasm-memory',
							limit: error?.limit ?? data.limits?.maxWasmMemoryBytes
						}
					: {}),
				...(code === 'output-limit' ? { actual: error.actual, limit: error.limit } : {})
			}
		});
	} finally {
		for (const url of urls) URL.revokeObjectURL(url);
		self.close();
	}
};
