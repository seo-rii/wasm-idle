// Runs unchanged upstream MoonBit compiler bytes. Only the host filesystem/IO ABI is supplied here.
const distribution = {
	schemaVersion: 1,
	implementation: 'Original MoonBit Wasm compiler and matching core',
	version: '0.10.19+97801ee1b',
	coreVersion: '0.1.20261030+97801ee1b',
	revision: 'd4ada10d212b5376f7f8bf49cd2fbaa275a395df',
	archive: {
		url: 'https://github.com/moonbitlang/moonbit-compiler/releases/download/v0.10.19%2B97801ee1b/moonbit-wasm.tar.gz',
		bytes: 4176888,
		sha256: 'ab55f4d92206916308922c768033d8a1b0eef5a2a3ea4c3ba8569c52cd40e2a9'
	},
	coreArchive: {
		member: 'core.tar.gz',
		bytes: 2253163,
		sha256: 'b2426aa085b3c7bf31af07e2c652701461cd9fe5c7b79dd7a8578f124e87e5c1'
	},
	source: {
		repository: 'https://github.com/moonbitlang/moonbit-compiler',
		revision: 'd4ada10d212b5376f7f8bf49cd2fbaa275a395df',
		license: 'LicenseRef-MoonBit-Public-Source-License',
		modified: false
	},
	coreLicense: 'Apache-2.0',
	packages: [
		'abort',
		'archive/zip',
		'argparse',
		'array',
		'bench',
		'bigint',
		'bool',
		'buffer',
		'builtin',
		'byte',
		'bytes',
		'bytes/internal/regex_engine',
		'bytes/internal/regex_engine/ast',
		'bytes/internal/regex_engine/shared_types',
		'bytes/internal/regex_engine/shared_types/byte_set',
		'bytes/internal/regex_engine/symbol_map',
		'bytes/internal/regex_parser',
		'char',
		'cmp',
		'compress/flate',
		'compress/gzip',
		'compress/zlib',
		'coverage',
		'debug',
		'deque',
		'diff',
		'double',
		'encoding/ascii',
		'encoding/base64',
		'encoding/hex',
		'encoding/percent',
		'encoding/utf16',
		'encoding/utf8',
		'env',
		'error',
		'float',
		'hashmap',
		'hashset',
		'immut/hashmap',
		'immut/hashset',
		'immut/internal/path',
		'immut/internal/sparse_array',
		'immut/priority_queue',
		'immut/sorted_map',
		'immut/sorted_set',
		'immut/vector',
		'immut/vector_map',
		'int',
		'int16',
		'int64',
		'internal/checksum',
		'internal/edit_distance',
		'internal/os_string',
		'internal/strconv',
		'json',
		'lazy',
		'lazy_list',
		'lexbuf',
		'list',
		'math',
		'option',
		'path',
		'path/error',
		'path/internal/ffi',
		'path/internal/posix',
		'path/internal/unicode',
		'path/internal/win32',
		'prelude',
		'priority_queue',
		'queue',
		'quickcheck',
		'quickcheck/shrink',
		'quickcheck/splitmix',
		'random',
		'random/internal/random_source',
		'range',
		'ref',
		'result',
		'set',
		'sorted_map',
		'sorted_set',
		'strconv',
		'string',
		'string/internal/regex_engine',
		'string/internal/regex_engine/ast',
		'string/internal/regex_engine/shared_types',
		'string/internal/regex_engine/shared_types/rechar_set',
		'string/internal/regex_engine/symbol_map',
		'string/internal/regex_parser',
		'test',
		'tuple',
		'uint',
		'uint16',
		'uint64',
		'unit',
		'v128'
	],
	assets: {
		'moonc.js': {
			bytes: 10250,
			sha256: '3fcd7b44506ee8b60264a4e4972adafae8f31dedc7e91879d419dd006ef83ec4'
		},
		'moonc.assets/code-172607e03e4760bd9001.wasm': {
			bytes: 5525140,
			sha256: '8e345f26b77901f4cbc7f7c1ee9aff3f68821e38682dd32da39e17e545a2fac2'
		},
		'stdlib.tar': {
			bytes: 8273920,
			sha256: 'c4f7c594c6e900395ec7afe0b1fcbb01452b65587a7303f63710e6db74598500'
		}
	},
	notices: {
		'COMPILER-LICENSE.txt': {
			bytes: 31060,
			sha256: 'c4ed4d95e9fcbd1334ca52054177520833bd0453a87d7cf535a1b2762d515be5'
		},
		'CORE-LICENSE.txt': {
			bytes: 11367,
			sha256: '86460c45017ffacb9aa9e18850fa9fdb036339dc8851125465f4a3f3442fc894'
		},
		'CORE-NOTICE.txt': {
			bytes: 7992,
			sha256: 'a20a618afc132a32e340f567fc2fb4296cfbefda7284422b6085afcd394e478d'
		}
	}
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let consumed = false;

async function boundedBytes(stream, limit, name) {
	const reader = stream.getReader();
	const chunks = [];
	let length = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > limit) throw new Error(`MoonBit asset exceeds receipt: ${name}`);
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const result = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	return result;
}

async function verifiedAssets(baseUrl, maxBytes) {
	return new Map(
		await Promise.all(
			Object.entries(distribution.assets).map(async ([name, pin]) => {
				if (pin.bytes > maxBytes)
					throw new Error(`MoonBit asset exceeds maxAssetBytes: ${name}`);
				let response = await fetch(new URL(name, baseUrl));
				if (response.status === 404) {
					await response.body?.cancel().catch(() => {});
					response = await fetch(new URL(name + '.gz', baseUrl));
				}
				if (!response.ok || !response.body)
					throw new Error(`MoonBit asset unavailable: ${name}`);
				let bytes = await boundedBytes(
					response.body,
					Math.min(maxBytes, pin.bytes + 4096),
					name
				);
				if (bytes[0] === 0x1f && bytes[1] === 0x8b)
					bytes = await boundedBytes(
						new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),
						pin.bytes,
						name
					);
				if (bytes.length !== pin.bytes)
					throw new Error(`MoonBit asset byte length mismatch: ${name}`);
				const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
					.map((x) => x.toString(16).padStart(2, '0'))
					.join('');
				if (sha256 !== pin.sha256)
					throw new Error(`MoonBit asset SHA-256 mismatch: ${name}`);
				return [name, bytes];
			})
		)
	);
}

function unpackStdlib(bytes) {
	const files = new Map();
	for (let offset = 0; offset + 512 <= bytes.length;) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every((value) => value === 0)) break;
		const field = (start, length) =>
			decoder.decode(header.subarray(start, start + length)).split('\0')[0];
		const prefix = field(345, 155);
		const name = (prefix ? prefix + '/' : '') + field(0, 100);
		const size = parseInt(field(124, 12).trim(), 8);
		const checksum = [...header].reduce(
			(sum, value, index) => sum + (index >= 148 && index < 156 ? 32 : value),
			0
		);
		if (
			!/^std\/[a-z0-9_/]+\.(?:mi|core)$/.test(name) ||
			!Number.isSafeInteger(size) ||
			size <= 0 ||
			offset + 512 + size > bytes.length ||
			checksum !== parseInt(field(148, 8).trim(), 8) ||
			![0, 48].includes(header[156]) ||
			files.has('/' + name)
		)
			throw new Error('Invalid verified MoonBit standard-library archive');
		files.set('/' + name, bytes.subarray(offset + 512, offset + 512 + size));
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	if (files.size !== distribution.packages.length + 1 || !files.has('/std/core.core'))
		throw new Error('Incomplete MoonBit standard-library archive');
	return files;
}

function virtualCompiler(files, assets, emit) {
	const directories = new Set(['/']);
	let cwd = '/work';
	const normalize = (path) => {
		const parts = [];
		for (const part of (path.startsWith('/') ? path : cwd + '/' + path).split('/')) {
			if (!part || part === '.') continue;
			if (part === '..') parts.pop();
			else parts.push(part);
		}
		return '/' + parts.join('/');
	};
	for (const path of files.keys()) {
		let parent = path.slice(0, path.lastIndexOf('/'));
		while (parent) {
			directories.add(parent);
			parent = parent.slice(0, parent.lastIndexOf('/'));
		}
	}
	directories.add('/work/.wasm-idle');
	const missing = (path) =>
		Object.assign(new Error('ENOENT: ' + path), { code: 'ENOENT', errno: -2 });
	const handles = new Map();
	let nextFd = 3;
	let totalBytes = [...files.values()].reduce((sum, value) => sum + value.length, 0);
	const setFile = (path, bytes) => {
		const next = totalBytes - (files.get(path)?.length || 0) + bytes.length;
		if (next > 64 * 1024 * 1024) throw new Error('MoonBit compiler filesystem exceeds 64 MiB');
		totalBytes = next;
		files.set(path, bytes);
	};
	const stat = (path) => {
		path = normalize(path);
		const directory = directories.has(path),
			bytes = files.get(path);
		if (!directory && !bytes) throw missing(path);
		return {
			dev: 0,
			ino: 1,
			mode: directory ? 16877 : 33188,
			nlink: 1,
			uid: 0,
			gid: 0,
			rdev: 0,
			size: bytes?.length || 0,
			atimeMs: 0,
			mtimeMs: 0,
			ctimeMs: 0,
			isFile: () => !directory,
			isDirectory: () => directory,
			isCharacterDevice: () => false,
			isBlockDevice: () => false,
			isSymbolicLink: () => false,
			isFIFO: () => false,
			isSocket: () => false
		};
	};
	const outputDecoders = [new TextDecoder(), new TextDecoder()];
	const fs = {
		constants: {
			O_RDONLY: 0,
			O_WRONLY: 1,
			O_RDWR: 2,
			O_APPEND: 1024,
			O_CREAT: 64,
			O_TRUNC: 512,
			O_EXCL: 128,
			O_NONBLOCK: 2048,
			O_NOCTTY: 256,
			O_DSYNC: 4096,
			O_SYNC: 1052672
		},
		existsSync: (path) => files.has(normalize(path)) || directories.has(normalize(path)),
		statSync: stat,
		lstatSync: stat,
		fstatSync: (fd, options) => {
			const value = stat(handles.get(fd).path);
			return options?.bigint ? { ...value, size: BigInt(value.size) } : value;
		},
		openSync: (path, flags) => {
			path = normalize(path);
			if (!files.has(path)) {
				if (!(flags & 64)) throw missing(path);
				setFile(path, new Uint8Array());
			}
			if (flags & 512) setFile(path, new Uint8Array());
			const fd = nextFd++;
			handles.set(fd, { path, position: flags & 1024 ? files.get(path).length : 0 });
			return fd;
		},
		closeSync: (fd) => handles.delete(fd),
		readSync: (fd, buffer, offset, length, position) => {
			const handle = handles.get(fd),
				start = position == null ? handle.position : Number(position);
			const chunk = files.get(handle.path).subarray(start, start + length);
			buffer.set(chunk, offset);
			if (position == null) handle.position += chunk.length;
			return chunk.length;
		},
		writeSync: (fd, buffer, offset, length, position) => {
			const chunk =
				typeof buffer === 'string'
					? encoder.encode(buffer)
					: buffer.subarray(offset, offset + length);
			if (fd === 1 || fd === 2) {
				emit(
					outputDecoders[fd - 1].decode(chunk, { stream: true }),
					fd === 2 ? 'stderr' : 'stdout'
				);
				return chunk.length;
			}
			const handle = handles.get(fd),
				start = position == null ? handle.position : Number(position),
				old = files.get(handle.path);
			if (
				!Number.isSafeInteger(start) ||
				start < 0 ||
				start + chunk.length > 64 * 1024 * 1024
			)
				throw new Error('MoonBit compiler file exceeds its limit');
			const result = new Uint8Array(Math.max(old.length, start + chunk.length));
			result.set(old);
			result.set(chunk, start);
			setFile(handle.path, result);
			if (position == null) handle.position += chunk.length;
			return chunk.length;
		},
		readdirSync: (path) => {
			path = normalize(path).replace(/\/$/, '') + '/';
			return [
				...new Set(
					[...files.keys(), ...directories]
						.filter((key) => key.startsWith(path) && key !== path)
						.map((key) => key.slice(path.length).split('/')[0])
				)
			];
		},
		mkdirSync: (path) => directories.add(normalize(path)),
		rmdirSync: (path) => directories.delete(normalize(path)),
		unlinkSync: (path) => {
			path = normalize(path);
			totalBytes -= files.get(path)?.length || 0;
			files.delete(path);
		},
		renameSync: (from, to) => {
			from = normalize(from);
			to = normalize(to);
			if (!files.has(from)) throw missing(from);
			const bytes = files.get(from);
			fs.unlinkSync(from);
			setFile(to, bytes);
		},
		truncateSync: (path, length) => {
			path = normalize(path);
			if (length > 64 * 1024 * 1024)
				throw new Error('MoonBit compiler file exceeds its limit');
			const bytes = new Uint8Array(Number(length));
			bytes.set(files.get(path).subarray(0, bytes.length));
			setFile(path, bytes);
		},
		ftruncateSync: (fd, length) => fs.truncateSync(handles.get(fd).path, length),
		utimesSync: () => {}
	};
	class CompilerExit extends Error {
		constructor(code) {
			super('Compiler exit ' + code);
			this.code = code;
		}
	}
	const process = {
		versions: { node: 'virtual' },
		platform: 'linux',
		argv: [],
		env: {},
		cwd: () => cwd,
		chdir: (path) => {
			cwd = normalize(path);
		},
		on: () => {},
		exit: (code) => {
			throw new CompilerExit(code);
		}
	};
	globalThis.process = process;
	globalThis.require = Object.assign(
		(name) => {
			if (name === 'node:fs') return fs;
			if (name === 'node:fs/promises')
				return {
					readFile: async (path) => {
						const key = normalize(path).slice(1);
						if (!assets.has(key)) throw missing(path);
						return assets.get(key);
					}
				};
			if (name === 'node:path')
				return {
					dirname: (path) => path.slice(0, path.lastIndexOf('/')) || '/',
					join: (...parts) => normalize(parts.join('/'))
				};
			if (name === 'node:tty') return { isatty: () => false };
			throw new Error('Unsupported MoonBit compiler host module: ' + name);
		},
		{ main: { filename: '/moonc.js' } }
	);
	return async (args) => {
		process.argv = ['node', '/moonc.js', ...args];
		try {
			await (0, eval)(decoder.decode(assets.get('moonc.js')));
			return 0;
		} catch (error) {
			if (error instanceof CompilerExit) return error.code;
			throw error;
		}
	};
}

function stdinReader(data, flush) {
	const channel = data.stdinChannel;
	if (
		channel &&
		(channel.protocolVersion !== 2 ||
			channel.controlBytes !== 16 ||
			!(channel.buffer instanceof SharedArrayBuffer) ||
			!Number.isSafeInteger(channel.capacity) ||
			channel.capacity <= 0 ||
			channel.buffer.byteLength !== 16 + channel.capacity)
	)
		throw new Error('Invalid MoonBit stdin channel');
	const control = channel ? new Int32Array(channel.buffer, 0, 4) : null;
	const buffer = channel
		? new Uint8Array(channel.buffer, 16, channel.capacity)
		: encoder.encode(data.stdin || '');
	const range = channel ? Math.floor(2 ** 32 / channel.capacity) * channel.capacity : 0;
	let offset = 0;
	const readByte = () => {
		flush();
		if (!channel) return offset < buffer.length ? buffer[offset++] : -1;
		while (true) {
			if (Atomics.load(control, 3) === 1) throw new Error('MoonBit stdin cancelled');
			const write = Atomics.load(control, 0) >>> 0,
				read = Atomics.load(control, 1) >>> 0,
				available = (write - read + range) % range;
			if (write >= range || read >= range || available > buffer.length)
				throw new Error('Invalid MoonBit stdin counters');
			if (available) {
				const byte = buffer[read % buffer.length];
				Atomics.store(control, 1, (read + 1) % range);
				return byte;
			}
			if (Atomics.load(control, 2) === 1) return -1;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write, 100);
		}
	};
	const utf8 = new TextDecoder();
	const pending = [];
	const readChar = () => {
		if (pending.length) return pending.shift();
		while (true) {
			const byte = readByte();
			for (const char of utf8.decode(byte < 0 ? new Uint8Array() : new Uint8Array([byte]), {
				stream: byte >= 0
			}))
				pending.push(char.codePointAt(0));
			if (pending.length) return pending.shift();
			if (byte < 0) return -1;
		}
	};
	return { readByte, readChar };
}

function importsForProgram(data, printChar, emit, flush) {
	const { readByte, readChar } = stdinReader(data, flush);
	const environment = new Map();
	const readString = (value) => ({
		chars: [...String(value)].map((c) => c.codePointAt(0)),
		index: 0
	});
	class ProgramExit extends Error {
		constructor(code) {
			super('MoonBit exited with code ' + code);
			this.exitCode = code;
		}
	}
	const exit = (code) => {
		throw new ProgramExit(code);
	};
	return {
		spectest: { print_char: printChar },
		wasm_idle: {
			read_byte: readByte,
			read_char: readChar,
			write_char: (code) => emit(String.fromCodePoint(code)),
			exit
		},
		__moonbit_fs_unstable: {
			begin_create_string: () => [],
			string_append_char: (value, code) => value.push(String.fromCharCode(code)),
			finish_create_string: (value) => value.join(''),
			begin_read_string: readString,
			string_read_char: (value) =>
				value.index < value.chars.length ? value.chars[value.index++] : -1,
			finish_read_string: () => {},
			begin_read_string_array: (value) => ({ value, index: 0 }),
			string_array_read_string: (value) =>
				value.index < value.value.length
					? value.value[value.index++]
					: 'ffi_end_of_/string_array',
			finish_read_string_array: () => {},
			args_get: () => [data.activePath || 'main.mbt', ...(data.args || [])],
			current_dir: () => '/work',
			get_env_var_exists: (key) => environment.has(key),
			get_env_var: (key) => environment.get(key) || '',
			get_env_vars: () => [...environment].flat(),
			set_env_var: (key, value) => environment.set(key, value),
			unset_env_var: (key) => environment.delete(key)
		},
		__moonbit_time_unstable: { now: () => BigInt(Date.now()) },
		__moonbit_sys_unstable: { exit }
	};
}

self.postMessage({ __wasmIdleStaticWorkerReady: true });
self.onmessage = async ({ data }) => {
	if (!data.run || consumed) return;
	consumed = true;
	let outputBytes = 0;
	let queued = '',
		queuedStream = 'stdout',
		highSurrogate = '';
	const flush = () => {
		if (queued) self.postMessage({ output: queued, stream: queuedStream });
		queued = '';
	};
	const emit = (text, stream = 'stdout') => {
		if (!text) return;
		outputBytes += encoder.encode(text).length;
		if (outputBytes > (data.limits?.maxOutputBytes || 1024 * 1024)) {
			flush();
			throw new Error('MoonBit output exceeded its byte limit');
		}
		if (stream !== queuedStream) flush();
		queuedStream = stream;
		queued += text;
		if (queued.length >= 256 || text.includes('\n')) flush();
	};
	const printChar = (value) => {
		const char = String.fromCharCode(value);
		if (highSurrogate) {
			const previous = highSurrogate;
			highSurrogate = '';
			if (value >= 0xdc00 && value <= 0xdfff) {
				emit(previous + char);
				return;
			}
			emit(previous);
		}
		if (value >= 0xd800 && value <= 0xdbff) highSurrogate = char;
		else emit(char);
	};
	let compilerOutput = [],
		compilerBytes = 0;
	const compileOutput = (text, stream) => {
		compilerBytes += encoder.encode(text).length;
		if (compilerBytes > (data.limits?.maxOutputBytes || 1024 * 1024))
			throw new Error('MoonBit compiler diagnostics exceeded the output limit');
		compilerOutput.push({ text, stream });
	};
	const drainCompiler = () => {
		const pending = compilerOutput;
		compilerOutput = [];
		for (const item of pending) emit(item.text, item.stream);
	};
	try {
		self.postMessage({ progress: { percent: 5, stage: 'Loading verified MoonBit compiler' } });
		const assets = await verifiedAssets(
			new URL(data.baseUrl),
			Math.min(data.maxAssetBytes || 32 * 1024 * 1024, 32 * 1024 * 1024)
		);
		const files = unpackStdlib(assets.get('stdlib.tar'));
		const active = data.activePath || 'main.mbt';
		if (active.startsWith('.wasm-idle/'))
			throw new Error('The .wasm-idle directory is reserved');
		const directory = active.includes('/') ? active.slice(0, active.lastIndexOf('/') + 1) : '';
		for (const file of data.workspaceFiles || []) {
			if (file.path.startsWith('.wasm-idle/'))
				throw new Error('The .wasm-idle directory is reserved');
			files.set('/work/' + file.path, encoder.encode(file.content));
		}
		files.set('/work/' + active, encoder.encode(String(data.code)));
		const sources = [...files.keys()]
			.filter(
				(path) =>
					path.startsWith('/work/' + directory) &&
					!path.slice(('/work/' + directory).length).includes('/') &&
					path.endsWith('.mbt')
			)
			.sort();
		const configuration = files.get('/work/' + directory + 'moon.pkg.json');
		const packageConfiguration = configuration ? JSON.parse(decoder.decode(configuration)) : {};
		if (
			!packageConfiguration ||
			typeof packageConfiguration !== 'object' ||
			Array.isArray(packageConfiguration) ||
			Object.keys(packageConfiguration).some((key) => !['import', 'is-main'].includes(key))
		)
			throw new Error('MoonBit browser package metadata supports import and is-main only');
		const imports = packageConfiguration.import || [];
		if (!Array.isArray(imports))
			throw new Error('MoonBit moon.pkg.json import must be an array');
		const argumentsForImports = [];
		for (const entry of imports) {
			const path = typeof entry === 'string' ? entry : entry?.path;
			const packageName =
				typeof path === 'string' && path.startsWith('moonbitlang/core/')
					? path.slice('moonbitlang/core/'.length)
					: '';
			const alias =
				typeof entry === 'string'
					? packageName.split('/').pop()
					: entry?.alias || packageName.split('/').pop();
			if (
				!distribution.packages.includes(packageName) ||
				!/^[a-zA-Z_][a-zA-Z0-9_/]*$/.test(alias || '')
			)
				throw new Error('Unavailable MoonBit package import: ' + path);
			argumentsForImports.push(
				'-i',
				`/std/${packageName}/${packageName.split('/').pop()}.mi:${alias}`
			);
		}
		const compile = virtualCompiler(files, assets, compileOutput);
		self.postMessage({ progress: { percent: 40, stage: 'Compiling MoonBit source' } });
		const result = await compile([
			'build-package',
			...sources,
			'-pkg',
			'wasm-idle/main',
			'-target',
			'wasm-gc',
			'-std-path',
			'/std',
			'-o',
			'/work/.wasm-idle/main.core',
			'-is-main',
			...argumentsForImports
		]);
		if (result !== 0) {
			drainCompiler();
			flush();
			self.postMessage({ results: false });
			return;
		}
		const linked = await compile([
			'link-core',
			'/std/core.core',
			'/work/.wasm-idle/main.core',
			'-main',
			'wasm-idle/main',
			'-target',
			'wasm-gc',
			'-o',
			'/work/.wasm-idle/main.wasm'
		]);
		if (linked !== 0) {
			drainCompiler();
			flush();
			self.postMessage({ results: false });
			return;
		}
		const module = await WebAssembly.compile(files.get('/work/.wasm-idle/main.wasm'));
		const importsObject = importsForProgram(data, printChar, emit, flush);
		for (const entry of WebAssembly.Module.imports(module))
			if (
				entry.kind !== 'function' ||
				typeof importsObject[entry.module]?.[entry.name] !== 'function'
			)
				throw new Error(
					`Unsupported MoonBit browser host import: ${entry.module}.${entry.name}`
				);
		const instance = await WebAssembly.instantiate(module, importsObject);
		self.postMessage({
			progress: {
				kind: 'ready',
				state: 'running',
				reason: 'started',
				label: 'MoonBit program started'
			}
		});
		drainCompiler();
		instance.exports._start();
		if (highSurrogate) {
			emit(highSurrogate);
			highSurrogate = '';
		}
		flush();
		self.postMessage({ results: true });
	} catch (error) {
		try {
			drainCompiler();
		} catch {}
		flush();
		if (error.exitCode === 0) self.postMessage({ results: true });
		else {
			self.postMessage({ output: `${error.message || String(error)}\n`, stream: 'stderr' });
			self.postMessage({ results: false });
		}
	}
};
