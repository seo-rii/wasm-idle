const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const hostConsole = globalThis.console;
const preflightProtocol = 'wasm-idle-rescript-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-rescript-runtime-manifest-v1';
const fingerprintDomain = 'wasm-idle:rescript-runtime-manifest:v1';
const runtimeGlobal = '__wasmIdleReScriptRuntime';
const hardMaxAssetBytes = 16 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const verifiedCompilerStoragePath = 'compiler.js.gz.bin';
const expectedSource = Object.freeze({
	repository: 'https://github.com/rescript-lang/rescript',
	revision: 'v12.3.1',
	commit: '679406560d169f1124653ab50795d5077570f078'
});
const expectedBuild = Object.freeze({
	compilerBuild:
		'js_of_ocaml 6.0.1 playground bundle built and uploaded by upstream CI (make playground)',
	moduleSystem: 'commonjs',
	rescriptVersion: '12.3.1'
});
const expectedLicenseSpdx = 'LGPL-3.0-or-later AND MIT';

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('ReScript runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(profileId, source, build, license, metadata, assets, storage) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0rescript-playground\nprofileId\0${profileId}\n`;
	canonical += `source\0${source.repository}\0${source.revision}\0${source.commit}\n`;
	for (const [name, value] of Object.entries(build).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `build\0${name}\0${value}\n`;
	}
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	canonical += `metadata\0${metadata.path}\0${metadata.mediaType}\0${metadata.size}\0${metadata.sha256}\n`;
	for (const asset of assets) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of storage) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(textEncoder.encode(canonical));
}

function isPlainObject(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validReceiptFields(candidate, maxAssetBytes) {
	return (
		Number.isSafeInteger(candidate.size) &&
		candidate.size > 0 &&
		candidate.size <= maxAssetBytes &&
		typeof candidate.sha256 === 'string' &&
		/^[a-f0-9]{64}$/u.test(candidate.sha256)
	);
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
	if (
		!isPlainObject(candidate) ||
		candidate.path !== expected.path ||
		candidate.mediaType !== expected.mediaType ||
		!validReceiptFields(candidate, maxAssetBytes)
	) {
		throw new Error(`${label} receipt is invalid or exceeds its byte limit.`);
	}
	return {
		path: expected.path,
		mediaType: expected.mediaType,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

async function normalizeManifest(value, expectedFingerprint, expectedProfileId, maxAssetBytes) {
	if (!isPlainObject(value)) throw new Error('ReScript runtime manifest must be an object.');
	if (value.format !== manifestFormat || value.runtime !== 'rescript-playground') {
		throw new Error('ReScript runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== expectedProfileId ||
		!isPlainObject(value.source) ||
		JSON.stringify(Object.keys(value.source).sort()) !==
			JSON.stringify(Object.keys(expectedSource).sort()) ||
		Object.entries(expectedSource).some(
			([name, expected]) => value.source[name] !== expected
		) ||
		!isPlainObject(value.build) ||
		JSON.stringify(Object.keys(value.build).sort()) !==
			JSON.stringify(Object.keys(expectedBuild).sort()) ||
		Object.entries(expectedBuild).some(([name, expected]) => value.build[name] !== expected)
	) {
		throw new Error(
			'ReScript runtime manifest profile, source, or build metadata is invalid or mismatched.'
		);
	}
	if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('ReScript runtime expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('ReScript runtime manifest fingerprint does not match the pinned runtime.');
	}
	if (!Array.isArray(value.assets) || value.assets.length !== 1) {
		throw new Error('ReScript runtime manifest must declare exactly one logical asset.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 1) {
		throw new Error('ReScript runtime manifest must declare exactly one storage asset.');
	}
	const license = value.license;
	if (
		!isPlainObject(license) ||
		license.path !== 'LICENSE.txt' ||
		license.spdx !== expectedLicenseSpdx ||
		!validReceiptFields(license, maxAssetBytes)
	) {
		throw new Error('ReScript runtime license receipt is invalid.');
	}
	const storageCandidate = value.storage[0];
	if (
		!isPlainObject(storageCandidate) ||
		storageCandidate.path !== verifiedCompilerStoragePath ||
		storageCandidate.logicalPath !== 'compiler.js' ||
		storageCandidate.encoding !== 'gzip' ||
		!validReceiptFields(storageCandidate, maxAssetBytes)
	) {
		throw new Error('ReScript runtime storage receipt is invalid or exceeds its byte limit.');
	}
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'ReScript runtime metadata'
	);
	const asset = normalizeReceipt(
		value.assets[0],
		{ path: 'compiler.js', mediaType: 'text/javascript' },
		maxAssetBytes,
		'ReScript runtime asset compiler.js'
	);
	const storage = {
		path: verifiedCompilerStoragePath,
		logicalPath: 'compiler.js',
		encoding: 'gzip',
		size: storageCandidate.size,
		sha256: storageCandidate.sha256
	};
	const fingerprint = await computeFingerprint(
		value.profileId,
		{ ...expectedSource },
		{ ...value.build },
		{ path: license.path, spdx: license.spdx, size: license.size, sha256: license.sha256 },
		metadata,
		[asset],
		[storage]
	);
	if (fingerprint !== expectedFingerprint) {
		throw new Error('ReScript runtime receipt graph failed fingerprint verification.');
	}
	return { asset };
}

function importVerifiedRuntimeScript(bytes) {
	try {
		fatalTextDecoder.decode(bytes);
	} catch {
		throw new Error('ReScript compiler JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('ReScript verified compiler evaluation is unavailable.');
	}
	const scriptUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
	try {
		importScripts(scriptUrl);
	} finally {
		try {
			URL.revokeObjectURL(scriptUrl);
		} catch {
			// Blob cleanup must not replace the verified evaluation outcome.
		}
	}
}

async function loadRuntime(runtimePreflight, manifestFingerprint, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('ReScript runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	const expectedKeys = [
		'compilerBytes',
		'manifestBytes',
		'manifestFingerprint',
		'profileId',
		'protocol',
		'protocolVersion',
		'sourceRevision'
	];
	const actualKeys = isPlainObject(runtimePreflight) ? Object.keys(runtimePreflight).sort() : [];
	if (
		!isPlainObject(runtimePreflight) ||
		actualKeys.length !== expectedKeys.length ||
		actualKeys.some((key, index) => key !== expectedKeys[index]) ||
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		typeof runtimePreflight.profileId !== 'string' ||
		!/^rescript-[A-Za-z0-9._+-]+$/u.test(runtimePreflight.profileId) ||
		runtimePreflight.sourceRevision !== expectedSource.revision ||
		runtimePreflight.manifestFingerprint !== manifestFingerprint ||
		Object.prototype.toString.call(runtimePreflight.manifestBytes) !== '[object Uint8Array]' ||
		Object.prototype.toString.call(runtimePreflight.compilerBytes) !== '[object Uint8Array]'
	) {
		throw new Error('ReScript runtime requires a valid host-preflighted asset payload.');
	}
	if (
		runtimePreflight.manifestBytes.byteLength <= 0 ||
		runtimePreflight.manifestBytes.byteLength > Math.min(maxManifestBytes, maxAssetBytes) ||
		runtimePreflight.compilerBytes.byteLength <= 0 ||
		runtimePreflight.compilerBytes.byteLength > maxAssetBytes
	) {
		throw new Error('ReScript host-preflighted assets exceed their active byte limits.');
	}
	let parsed;
	try {
		parsed = JSON.parse(fatalTextDecoder.decode(runtimePreflight.manifestBytes));
	} catch {
		throw new Error('ReScript runtime manifest is not valid UTF-8 JSON.');
	}
	const manifest = await normalizeManifest(
		parsed,
		runtimePreflight.manifestFingerprint,
		runtimePreflight.profileId,
		maxAssetBytes
	);
	const bytes = runtimePreflight.compilerBytes;
	if (
		bytes.byteLength !== manifest.asset.size ||
		(await sha256Hex(bytes)) !== manifest.asset.sha256
	) {
		throw new Error('ReScript runtime asset compiler.js failed size/SHA-256 verification.');
	}
	importVerifiedRuntimeScript(bytes);
	const compilerFactory = globalThis.rescript_compiler;
	const runtime = globalThis[runtimeGlobal];
	if (
		typeof compilerFactory?.make !== 'function' ||
		!runtime ||
		typeof runtime.modules !== 'object' ||
		runtime.version !== expectedBuild.rescriptVersion
	) {
		throw new Error('ReScript compiler runtime did not initialize.');
	}
	return { compilerFactory, runtimeModules: runtime.modules };
}

function normalizePath(value) {
	return String(value || '')
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '');
}

function stripAnsi(text) {
	return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function toDiagnostic(entry, fileName, severity) {
	const lineNumber = Number.isSafeInteger(entry?.row) && entry.row > 0 ? entry.row : 1;
	const column = Number.isSafeInteger(entry?.column) && entry.column >= 0 ? entry.column : 0;
	const diagnostic = {
		fileName,
		lineNumber,
		columnNumber: column + 1,
		severity,
		message: stripAnsi(entry?.shortMsg || entry?.fullMsg || 'ReScript compiler error').trim()
	};
	if (
		entry?.endRow === entry?.row &&
		Number.isSafeInteger(entry?.endColumn) &&
		entry.endColumn >= column
	) {
		diagnostic.endColumnNumber = entry.endColumn + 1;
	}
	return diagnostic;
}

function compileReScript(compilerFactory, source, fileName) {
	const compiler = compilerFactory.make();
	if (compiler.setModuleSystem('commonjs') !== true) {
		throw new Error('ReScript compiler rejected the CommonJS module system.');
	}
	compiler.setFilename(fileName);
	return compiler.rescript.compile(source);
}

function formatCompileFailure(result) {
	if (result?.type === 'unexpected_error') {
		return `ReScript compiler error: ${stripAnsi(result.msg || 'unexpected error')}`;
	}
	if (result?.type === 'warning_flag_error') {
		return `ReScript warning flag error: ${stripAnsi(result.msg || '')}`;
	}
	const errors = Array.isArray(result?.errors) ? result.errors : [];
	const text = errors
		.map((entry) => stripAnsi(entry?.fullMsg || entry?.shortMsg || '').replace(/^\n+/, ''))
		.filter(Boolean)
		.join('\n');
	return text.trimEnd() || 'ReScript compilation failed.';
}

function createSharedByteReader(channel) {
	if (channel === undefined) return null;
	if (
		channel?.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel?.protocolVersion !== 1 ||
		channel?.controlBytes !== 16 ||
		!Number.isSafeInteger(channel?.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== channel.controlBytes + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('Invalid ReScript streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('ReScript streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('ReScript streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			// Closing changes a different slot, so its notification can race this wait.
			Atomics.wait(control, 0, write, 100);
		}
	};
}

/** Node-style stdin reader matching the JavaScript/TypeScript playground `fs` convention. */
function createStdinReader(stdin, channel) {
	const readByte = createSharedByteReader(channel);
	if (!readByte) {
		let remainder = typeof stdin === 'string' ? stdin : '';
		return {
			readLine() {
				const newline = remainder.indexOf('\n');
				const raw = newline === -1 ? remainder : remainder.slice(0, newline);
				remainder = newline === -1 ? '' : remainder.slice(newline + 1);
				return raw.endsWith('\r') ? raw.slice(0, -1) : raw;
			},
			readAll() {
				const all = remainder;
				remainder = '';
				return all;
			}
		};
	}
	const decoder = new TextDecoder();
	return {
		readLine() {
			const bytes = [];
			while (true) {
				const value = readByte();
				if (value === null || value === 10) break;
				bytes.push(value);
			}
			if (bytes.at(-1) === 13) bytes.pop();
			return decoder.decode(Uint8Array.from(bytes));
		},
		readAll() {
			const bytes = [];
			while (true) {
				const value = readByte();
				if (value === null) break;
				bytes.push(value);
			}
			return decoder.decode(Uint8Array.from(bytes));
		}
	};
}

function inspectValue(value) {
	if (typeof value === 'string') return value;
	if (typeof value === 'bigint') return `${value}n`;
	if (value instanceof Error) return value.stack || value.message;
	if (typeof value === 'undefined') return 'undefined';
	try {
		const json = JSON.stringify(value);
		return json === undefined ? String(value) : json;
	} catch {
		return String(value);
	}
}

function formatConsoleArgs(args) {
	if (!args.length) return '';
	if (typeof args[0] !== 'string') return args.map(inspectValue).join(' ');
	let index = 1;
	const first = args[0].replace(/%[sdifoOj%]/g, (match) => {
		if (match === '%%') return '%';
		if (index >= args.length) return match;
		const value = args[index++];
		if (match === '%d' || match === '%i' || match === '%f') return String(Number(value));
		return inspectValue(value);
	});
	return [first, ...args.slice(index).map(inspectValue)].join(' ');
}

class ProcessExit {
	constructor(code) {
		this.code = code;
	}
}

function makeNodeError(code, syscall, target) {
	return Object.assign(new Error(`${code}: ${syscall} '${target}'`), { code, syscall });
}

function formatThrown(error) {
	if (error instanceof Error) return error.stack || error.message;
	if (error && typeof error === 'object' && typeof error.RE_EXN_ID === 'string') {
		const payload = Object.entries(error)
			.filter(([key]) => key !== 'RE_EXN_ID' && key !== 'Error')
			.map(([, value]) => inspectValue(value));
		return `Uncaught ReScript exception ${error.RE_EXN_ID}${payload.length ? `(${payload.join(', ')})` : ''}`;
	}
	return `Uncaught ${inspectValue(error)}`;
}

function createModuleSystem({ runtimeModules, stdinReader, files, args, activePath, write }) {
	const runtimeCache = new Map();
	const loadRuntimeModule = (name) => {
		if (runtimeCache.has(name)) return runtimeCache.get(name).exports;
		const factory = Object.prototype.hasOwnProperty.call(runtimeModules, name)
			? runtimeModules[name]
			: undefined;
		if (typeof factory !== 'function') {
			throw makeNodeError('MODULE_NOT_FOUND', 'require', name);
		}
		const module = { exports: {} };
		runtimeCache.set(name, module);
		factory.call(module.exports, module.exports, requireFromRuntime, module);
		return module.exports;
	};
	const requireFromRuntime = (specifier) => {
		const match = /^\.\/([A-Za-z0-9_]+\.js)$/u.exec(String(specifier));
		if (!match) throw makeNodeError('MODULE_NOT_FOUND', 'require', specifier);
		return loadRuntimeModule(match[1]);
	};
	const lookupFile = (pathLike) => {
		const raw = String(pathLike);
		if (raw === '0' || raw === '/dev/stdin' || raw === 'dev/stdin')
			return stdinReader.readAll();
		const normalized = normalizePath(raw);
		if (Object.prototype.hasOwnProperty.call(files, normalized)) return files[normalized];
		throw makeNodeError('ENOENT', 'open', raw);
	};
	const fsModule = Object.freeze({
		readFileSync: (pathLike) => lookupFile(pathLike),
		readLineSync(pathLike = 0) {
			const raw = String(pathLike);
			if (raw !== '0' && raw !== '/dev/stdin' && raw !== 'dev/stdin') {
				throw makeNodeError('EINVAL', 'read', raw);
			}
			return stdinReader.readLine();
		},
		existsSync(pathLike) {
			const raw = String(pathLike);
			if (raw === '0' || raw === '/dev/stdin' || raw === 'dev/stdin') return true;
			return Object.prototype.hasOwnProperty.call(files, normalizePath(raw));
		}
	});
	const processModule = Object.freeze({
		argv: ['node', activePath, ...args],
		env: Object.freeze({ USER: 'jungol' }),
		platform: 'browser',
		browser: true,
		cwd: () => '/',
		exit(code = 0) {
			throw new ProcessExit(Number(code) || 0);
		},
		stdout: Object.freeze({ write: (chunk) => (write('stdout', String(chunk)), true) }),
		stderr: Object.freeze({ write: (chunk) => (write('stderr', String(chunk)), true) })
	});
	const builtins = {
		fs: fsModule,
		'node:fs': fsModule,
		process: processModule,
		'node:process': processModule
	};
	const requireFromUser = (specifier) => {
		const value = String(specifier);
		if (Object.prototype.hasOwnProperty.call(builtins, value)) return builtins[value];
		const match =
			/^\.\/stdlib\/([A-Za-z0-9_]+\.js)$/u.exec(value) ||
			/^@rescript\/runtime\/lib\/js\/([A-Za-z0-9_]+\.js)$/u.exec(value);
		if (match) return loadRuntimeModule(match[1]);
		throw makeNodeError('MODULE_NOT_FOUND', 'require', value);
	};
	return { requireFromUser, processModule };
}

function buildWorkspaceFiles(code, activePath, workspaceFiles) {
	const files = Object.create(null);
	for (const file of workspaceFiles || []) {
		if (!file || typeof file.content !== 'string') continue;
		const path = normalizePath(file.path);
		if (path) files[path] = file.content;
	}
	files[activePath] = String(code || '');
	return files;
}

self.onmessage = async (event) => {
	const {
		runtimePreflight,
		manifestFingerprint,
		maxAssetBytes,
		code,
		args = [],
		stdin = '',
		stdinChannel,
		activePath: requestedActivePath = 'Main.res',
		workspaceFiles = [],
		log
	} = event.data || {};
	const activePath = normalizePath(requestedActivePath) || 'Main.res';
	try {
		const stdinReader = createStdinReader(stdin, stdinChannel);
		if (log) hostConsole.log('[wasm-idle:rescript-worker] run start');
		self.postMessage({ progress: { percent: 5, stage: 'Loading ReScript compiler' } });
		const { compilerFactory, runtimeModules } = await loadRuntime(
			runtimePreflight,
			manifestFingerprint,
			maxAssetBytes
		);
		self.postMessage({ progress: { percent: 35, stage: 'Compiling ReScript' } });
		const result = compileReScript(compilerFactory, String(code || ''), activePath);
		for (const warning of Array.isArray(result?.warnings) ? result.warnings : []) {
			self.postMessage({
				diagnostic: toDiagnostic(
					warning,
					activePath,
					warning?.isError ? 'error' : 'warning'
				)
			});
		}
		if (result?.type !== 'success' || typeof result.js_code !== 'string') {
			for (const error of Array.isArray(result?.errors) ? result.errors : []) {
				self.postMessage({ diagnostic: toDiagnostic(error, activePath, 'error') });
			}
			throw new Error(formatCompileFailure(result));
		}
		self.postMessage({ progress: { percent: 60, stage: 'Running ReScript' } });

		const write = (stream, text) => {
			if (!text) return;
			self.postMessage(stream === 'stderr' ? { output: text, stream } : { output: text });
		};
		const localConsole = {
			log: (...values) => write('stdout', `${formatConsoleArgs(values)}\n`),
			info: (...values) => write('stdout', `${formatConsoleArgs(values)}\n`),
			debug: (...values) => write('stdout', `${formatConsoleArgs(values)}\n`),
			warn: (...values) => write('stderr', `${formatConsoleArgs(values)}\n`),
			error: (...values) => write('stderr', `${formatConsoleArgs(values)}\n`)
		};
		const { requireFromUser, processModule } = createModuleSystem({
			runtimeModules,
			stdinReader,
			files: buildWorkspaceFiles(code, activePath, workspaceFiles),
			args: Array.isArray(args) ? args.map(String) : [],
			activePath,
			write
		});
		globalThis.console = localConsole;
		const module = { exports: {} };
		let exitCode = 0;
		try {
			const execute = new Function(
				'require',
				'module',
				'exports',
				'process',
				'console',
				'__filename',
				'__dirname',
				`${result.js_code}\n//# sourceURL=${activePath.replace(/\.res$/u, '.res.js')}`
			);
			self.postMessage({
				progress: {
					kind: 'ready',
					state: 'running',
					reason: 'started',
					label: 'ReScript program started'
				}
			});
			execute(
				requireFromUser,
				module,
				module.exports,
				processModule,
				localConsole,
				activePath,
				'/'
			);
			// Let promise continuations scheduled by the program settle before reporting success.
			await new Promise((resolve) => setTimeout(resolve, 0));
		} catch (error) {
			if (!(error instanceof ProcessExit)) throw new Error(formatThrown(error));
			exitCode = error.code;
		} finally {
			globalThis.console = hostConsole;
		}
		if (exitCode !== 0) throw new Error(`ReScript program exited with code ${exitCode}`);
		self.postMessage({ progress: { percent: 100, stage: 'Finished' } });
		if (log) hostConsole.log('[wasm-idle:rescript-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		globalThis.console = hostConsole;
		if (log) hostConsole.error('[wasm-idle:rescript-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
