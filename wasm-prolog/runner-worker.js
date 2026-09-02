const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });
const preflightProtocol = 'wasm-idle-prolog-preflight';
const preflightProtocolVersion = 1;
const manifestFormat = 'wasm-prolog-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:prolog-runtime-manifest:v2';
const hardMaxAssetBytes = 32 * 1024 * 1024;
const maxManifestBytes = 64 * 1024;
const preflightKeys = Object.freeze([
	'dataBytes',
	'javascriptBytes',
	'manifestBytes',
	'manifestFingerprint',
	'packageRevision',
	'profileId',
	'protocol',
	'protocolVersion',
	'swiplRevision',
	'wasmBytes'
]);
const manifestKeys = Object.freeze([
	'assets',
	'fingerprint',
	'format',
	'license',
	'metadata',
	'package',
	'profileId',
	'runtime',
	'storage',
	'toolchain'
]);
const expectedPackage = Object.freeze({
	integrity:
		'sha512-tP3bSRaMboFRWGD5cfBAGIzu2HH80yqRG+i/YL8BEgQ7xasvJAycwgx0DW16vqqRhUHyFOOPbzX4aXuy9s+b1g==',
	name: 'swipl-wasm',
	repository: 'https://github.com/SWI-Prolog/npm-swipl-wasm.git',
	revision: '18fa003833dd4fb2531195063291687255038372',
	tarball: 'https://registry.npmjs.org/swipl-wasm/-/swipl-wasm-8.0.1.tgz',
	version: '8.0.1'
});
const expectedToolchain = Object.freeze({
	emsdkRevision: 'd223ae73c6998296e3ab27cf81dc2c2c9fd383de',
	emsdkVersion: '6.0.0',
	pcre2Revision: 'f454e231fe5006dd7ff8f4693fd2b8eb94333429',
	pcre2Version: '10.47',
	swiplRevision: '6be143dbd030cc9ea621cde719a37f8385575453',
	swiplVersion: '10.1.9',
	zlibVersion: '1.3.2'
});
const expectedAssets = Object.freeze({
	'swipl-web.data': Object.freeze({ mediaType: 'application/octet-stream' }),
	'swipl-web.js': Object.freeze({ mediaType: 'text/javascript' }),
	'swipl-web.wasm': Object.freeze({ mediaType: 'application/wasm' })
});
const expectedStorage = Object.freeze({
	'swipl-web.data.gz.bin': Object.freeze({ logicalPath: 'swipl-web.data', encoding: 'gzip' }),
	'swipl-web.js': Object.freeze({ logicalPath: 'swipl-web.js', encoding: 'identity' }),
	'swipl-web.wasm.gz.bin': Object.freeze({ logicalPath: 'swipl-web.wasm', encoding: 'gzip' })
});

let verifiedRuntimePromise = null;
let verifiedRuntimeIdentity = '';

function hasExactKeys(value, expectedKeys) {
	const keys = Object.keys(value).sort();
	return (
		keys.length === expectedKeys.length &&
		keys.every((key, index) => key === expectedKeys[index])
	);
}

function isUint8Array(value) {
	return (
		ArrayBuffer.isView(value) &&
		value.buffer instanceof ArrayBuffer &&
		Object.prototype.toString.call(value) === '[object Uint8Array]'
	);
}

function requireRuntimePreflight(runtimePreflight, requestedMaxAssetBytes) {
	if (!Number.isSafeInteger(requestedMaxAssetBytes) || requestedMaxAssetBytes <= 0) {
		throw new Error('SWI-Prolog runtime asset byte limit is invalid.');
	}
	const maxAssetBytes = Math.min(requestedMaxAssetBytes, hardMaxAssetBytes);
	if (
		!runtimePreflight ||
		typeof runtimePreflight !== 'object' ||
		Array.isArray(runtimePreflight) ||
		!hasExactKeys(runtimePreflight, preflightKeys)
	) {
		throw new Error('SWI-Prolog runtime preflight payload has an invalid shape.');
	}
	if (
		runtimePreflight.protocol !== preflightProtocol ||
		runtimePreflight.protocolVersion !== preflightProtocolVersion ||
		typeof runtimePreflight.profileId !== 'string' ||
		!/^swipl-wasm-[A-Za-z0-9._+-]+$/u.test(runtimePreflight.profileId) ||
		typeof runtimePreflight.packageRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(runtimePreflight.packageRevision) ||
		typeof runtimePreflight.swiplRevision !== 'string' ||
		!/^[a-f0-9]{40}$/u.test(runtimePreflight.swiplRevision) ||
		typeof runtimePreflight.manifestFingerprint !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(runtimePreflight.manifestFingerprint) ||
		!isUint8Array(runtimePreflight.manifestBytes) ||
		!isUint8Array(runtimePreflight.javascriptBytes) ||
		!isUint8Array(runtimePreflight.wasmBytes) ||
		!isUint8Array(runtimePreflight.dataBytes)
	) {
		throw new Error('SWI-Prolog runtime preflight payload is invalid.');
	}
	for (const [label, bytes, limit] of [
		[
			'SWI-Prolog runtime manifest',
			runtimePreflight.manifestBytes,
			Math.min(maxManifestBytes, maxAssetBytes)
		],
		['SWI-Prolog runtime JavaScript', runtimePreflight.javascriptBytes, maxAssetBytes],
		['SWI-Prolog runtime Wasm', runtimePreflight.wasmBytes, maxAssetBytes],
		['SWI-Prolog runtime data', runtimePreflight.dataBytes, maxAssetBytes]
	]) {
		if (bytes.byteLength <= 0 || bytes.byteLength > limit) {
			throw new Error(`${label} exceeds its byte limit.`);
		}
	}
	return { runtimePreflight, maxAssetBytes };
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('SWI-Prolog runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function computeFingerprint(
	profileId,
	packageMetadata,
	toolchain,
	license,
	metadata,
	assets,
	storage
) {
	let canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\nruntime\0swipl-wasm\nprofileId\0${profileId}\n`;
	for (const [name, value] of Object.entries(packageMetadata).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `package\0${name}\0${value}\n`;
	}
	for (const [name, value] of Object.entries(toolchain).sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0
	)) {
		canonical += `toolchain\0${name}\0${value}\n`;
	}
	canonical += `license\0${license.path}\0${license.spdx}\0${license.size}\0${license.sha256}\n`;
	canonical += `metadata\0${metadata.path}\0${metadata.mediaType}\0${metadata.size}\0${metadata.sha256}\n`;
	for (const asset of [...assets].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `asset\0${asset.path}\0${asset.mediaType}\0${asset.size}\0${asset.sha256}\n`;
	}
	for (const asset of [...storage].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0
	)) {
		canonical += `storage\0${asset.path}\0${asset.logicalPath}\0${asset.encoding}\0${asset.size}\0${asset.sha256}\n`;
	}
	return await sha256Hex(encoder.encode(canonical));
}

function normalizeReceipt(candidate, expected, maxAssetBytes, label) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		!hasExactKeys(candidate, ['mediaType', 'path', 'sha256', 'size']) ||
		candidate.path !== expected.path ||
		candidate.mediaType !== expected.mediaType ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
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

function normalizeStorageReceipt(candidate, expected, maxAssetBytes) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		!hasExactKeys(candidate, ['encoding', 'logicalPath', 'path', 'sha256', 'size']) ||
		candidate.path !== expected.path ||
		candidate.logicalPath !== expected.logicalPath ||
		candidate.encoding !== expected.encoding ||
		!Number.isSafeInteger(candidate.size) ||
		candidate.size <= 0 ||
		candidate.size > maxAssetBytes ||
		typeof candidate.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(candidate.sha256)
	) {
		throw new Error(`SWI-Prolog runtime storage receipt is invalid for ${expected.path}.`);
	}
	return {
		path: expected.path,
		logicalPath: expected.logicalPath,
		encoding: expected.encoding,
		size: candidate.size,
		sha256: candidate.sha256
	};
}

function normalizeProvenanceObject(candidate, expected, label) {
	if (
		!candidate ||
		typeof candidate !== 'object' ||
		Array.isArray(candidate) ||
		JSON.stringify(Object.keys(candidate).sort()) !==
			JSON.stringify(Object.keys(expected).sort()) ||
		Object.entries(expected).some(([name, value]) => candidate[name] !== value)
	) {
		throw new Error(`SWI-Prolog runtime ${label} metadata is invalid.`);
	}
	return { ...candidate };
}

async function normalizeManifest(value, runtimePreflight, maxAssetBytes) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('SWI-Prolog runtime manifest must be an object.');
	}
	if (
		!hasExactKeys(value, manifestKeys) ||
		value.format !== manifestFormat ||
		value.runtime !== 'swipl-wasm'
	) {
		throw new Error('SWI-Prolog runtime manifest format is unsupported.');
	}
	if (
		value.profileId !== runtimePreflight.profileId ||
		value.fingerprint !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('SWI-Prolog runtime manifest identity is invalid.');
	}
	const packageMetadata = normalizeProvenanceObject(value.package, expectedPackage, 'package');
	const toolchain = normalizeProvenanceObject(value.toolchain, expectedToolchain, 'toolchain');
	if (
		packageMetadata.revision !== runtimePreflight.packageRevision ||
		toolchain.swiplRevision !== runtimePreflight.swiplRevision
	) {
		throw new Error('SWI-Prolog runtime provenance identity is invalid.');
	}
	if (
		!value.license ||
		typeof value.license !== 'object' ||
		Array.isArray(value.license) ||
		!hasExactKeys(value.license, ['path', 'sha256', 'size', 'spdx']) ||
		value.license.path !== 'LICENSE.txt' ||
		value.license.spdx !== 'BSD-2-Clause' ||
		!Number.isSafeInteger(value.license.size) ||
		value.license.size <= 0 ||
		value.license.size > maxAssetBytes ||
		typeof value.license.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(value.license.sha256)
	) {
		throw new Error('SWI-Prolog runtime license receipt is invalid.');
	}
	const license = {
		path: 'LICENSE.txt',
		spdx: 'BSD-2-Clause',
		size: value.license.size,
		sha256: value.license.sha256
	};
	const metadata = normalizeReceipt(
		value.metadata,
		{ path: 'runtime-build.json', mediaType: 'application/json' },
		maxAssetBytes,
		'SWI-Prolog runtime metadata'
	);
	if (!Array.isArray(value.assets) || value.assets.length !== 3) {
		throw new Error('SWI-Prolog runtime manifest must declare exactly three logical assets.');
	}
	if (!Array.isArray(value.storage) || value.storage.length !== 3) {
		throw new Error('SWI-Prolog runtime manifest must declare exactly three storage assets.');
	}
	const assetByPath = new Map();
	for (const candidate of value.assets) {
		const expected = expectedAssets[candidate?.path];
		if (!expected || assetByPath.has(candidate.path)) {
			throw new Error(
				'SWI-Prolog runtime manifest has an unexpected or duplicate logical asset.'
			);
		}
		assetByPath.set(
			candidate.path,
			normalizeReceipt(
				candidate,
				{ path: candidate.path, mediaType: expected.mediaType },
				maxAssetBytes,
				`SWI-Prolog runtime asset ${candidate.path}`
			)
		);
	}
	const storageByPath = new Map();
	for (const candidate of value.storage) {
		const expected = expectedStorage[candidate?.path];
		if (!expected || storageByPath.has(candidate.path)) {
			throw new Error(
				'SWI-Prolog runtime manifest has an unexpected or duplicate storage asset.'
			);
		}
		storageByPath.set(
			candidate.path,
			normalizeStorageReceipt(candidate, { path: candidate.path, ...expected }, maxAssetBytes)
		);
	}
	if (
		Object.keys(expectedAssets).some((path) => !assetByPath.has(path)) ||
		Object.keys(expectedStorage).some((path) => !storageByPath.has(path))
	) {
		throw new Error('SWI-Prolog runtime manifest is missing a required asset.');
	}
	const assets = [...assetByPath.values()];
	const storage = [...storageByPath.values()];
	if (
		(await computeFingerprint(
			value.profileId,
			packageMetadata,
			toolchain,
			license,
			metadata,
			assets,
			storage
		)) !== runtimePreflight.manifestFingerprint
	) {
		throw new Error('SWI-Prolog runtime receipt graph failed fingerprint verification.');
	}
	return { assetByPath, storageByPath };
}

async function verifyReceiptBytes(receipt, bytes, label) {
	if (bytes.byteLength !== receipt.size) throw new Error(`${label} has an unexpected byte size.`);
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`${label} failed SHA-256 verification.`);
	}
}

function importVerifiedRuntimeScript(bytes) {
	try {
		fatalDecoder.decode(bytes);
	} catch {
		throw new Error('SWI-Prolog runtime JavaScript is not valid UTF-8.');
	}
	if (
		typeof Blob !== 'function' ||
		typeof URL.createObjectURL !== 'function' ||
		typeof URL.revokeObjectURL !== 'function' ||
		typeof importScripts !== 'function'
	) {
		throw new Error('SWI-Prolog verified runtime evaluation is unavailable.');
	}
	const scriptUrl = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
	let swiplFactory;
	try {
		importScripts(scriptUrl);
		swiplFactory = globalThis.SWIPL;
	} finally {
		try {
			URL.revokeObjectURL(scriptUrl);
		} catch {
			// Blob cleanup must not replace the verified evaluation outcome.
		}
	}
	return swiplFactory;
}

async function createVerifiedSwiplFactory(runtimePreflightValue, requestedMaxAssetBytes) {
	const { runtimePreflight, maxAssetBytes } = requireRuntimePreflight(
		runtimePreflightValue,
		requestedMaxAssetBytes
	);
	const identity = [
		runtimePreflight.protocol,
		runtimePreflight.protocolVersion,
		runtimePreflight.profileId,
		runtimePreflight.packageRevision,
		runtimePreflight.swiplRevision,
		runtimePreflight.manifestFingerprint
	].join('\n');
	if (verifiedRuntimePromise) {
		if (verifiedRuntimeIdentity !== identity) {
			throw new Error('SWI-Prolog worker cannot replace an initialized runtime profile.');
		}
		return await verifiedRuntimePromise;
	}
	verifiedRuntimeIdentity = identity;
	verifiedRuntimePromise = (async () => {
		let parsed;
		try {
			parsed = JSON.parse(fatalDecoder.decode(runtimePreflight.manifestBytes));
		} catch {
			throw new Error('SWI-Prolog runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, runtimePreflight, maxAssetBytes);
		for (const [path, bytes] of [
			['swipl-web.js', runtimePreflight.javascriptBytes],
			['swipl-web.wasm', runtimePreflight.wasmBytes],
			['swipl-web.data', runtimePreflight.dataBytes]
		]) {
			const logicalReceipt = manifest.assetByPath.get(path);
			await verifyReceiptBytes(
				logicalReceipt,
				bytes,
				`SWI-Prolog runtime asset ${logicalReceipt.path}`
			);
		}
		const previousSwiplFactory = globalThis.SWIPL;
		let swiplFactory;
		try {
			globalThis.SWIPL = undefined;
			if (globalThis.SWIPL !== undefined) {
				throw new Error('SWI-Prolog runtime factory global could not be cleared.');
			}
			swiplFactory = importVerifiedRuntimeScript(runtimePreflight.javascriptBytes);
			if (typeof swiplFactory !== 'function') {
				throw new Error('SWI-Prolog runtime JavaScript did not initialize.');
			}
		} catch (error) {
			if (previousSwiplFactory === undefined) delete globalThis.SWIPL;
			else globalThis.SWIPL = previousSwiplFactory;
			throw error;
		}
		const dataBytes = runtimePreflight.dataBytes;
		const dataBuffer =
			dataBytes.byteOffset === 0 && dataBytes.byteLength === dataBytes.buffer.byteLength
				? dataBytes.buffer
				: dataBytes.slice().buffer;
		return (options) =>
			swiplFactory({
				...options,
				wasmBinary: runtimePreflight.wasmBytes,
				locateFile(path) {
					if (path !== 'swipl-web.wasm' && path !== 'swipl-web.data') {
						throw new Error(
							`SWI-Prolog requested an undeclared runtime asset: ${path}`
						);
					}
					return `wasm-idle-verified:${path}`;
				},
				getPreloadedPackage(packageName, packageSize) {
					if (
						packageName !== 'wasm-idle-verified:swipl-web.data' ||
						packageSize !== dataBytes.byteLength
					) {
						throw new Error('SWI-Prolog requested an unexpected preloaded package.');
					}
					return dataBuffer;
				}
			});
	})();
	try {
		return await verifiedRuntimePromise;
	} catch (error) {
		verifiedRuntimePromise = null;
		verifiedRuntimeIdentity = '';
		throw error;
	}
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

function createSharedStdinReader(channel) {
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
		throw new Error('Invalid SWI-Prolog streaming stdin channel.');
	}
	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1)
				throw new Error('SWI-Prolog streaming stdin was cancelled.');
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('SWI-Prolog streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function createStdinReader(stdin, channel) {
	const sharedReader = createSharedStdinReader(channel);
	if (sharedReader) return sharedReader;
	const bytes = encoder.encode(typeof stdin === 'string' ? stdin : '');
	let offset = 0;
	return () => (offset >= bytes.byteLength ? null : bytes[offset++]);
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
		runtimePreflight,
		maxAssetBytes,
		code,
		stdin,
		stdinChannel,
		activePath = 'main.prolog',
		workspaceFiles = [],
		diagnose = false,
		log
	} = event.data || {};
	let diagnosticOutput = '';
	const originalConsole = diagnose
		? {
				log: console.log.bind(console),
				warn: console.warn.bind(console),
				error: console.error.bind(console)
			}
		: null;
	const appendDiagnosticOutput = (...args) => {
		if (!diagnose) return;
		const output = args
			.map((value) => (typeof value === 'string' ? value : value?.message || String(value)))
			.join(' ');
		if (output) diagnosticOutput += output.endsWith('\n') ? output : `${output}\n`;
	};
	if (originalConsole) {
		console.log = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.log(...args);
		};
		console.warn = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.warn(...args);
		};
		console.error = (...args) => {
			appendDiagnosticOutput(...args);
			originalConsole.error(...args);
		};
	}
	let swipl = null;
	let terminalError = null;
	try {
		if (log) {
			console.log(`[wasm-idle:prolog-worker] ${diagnose ? 'diagnose' : 'run'} start`);
		}
		const createSwipl = await createVerifiedSwiplFactory(runtimePreflight, maxAssetBytes);
		swipl = await createSwipl({
			arguments: ['-q'],
			print(text) {
				const output = String(text);
				if (diagnose) diagnosticOutput += `${output}\n`;
				postOutput(output);
			},
			printErr(text) {
				const output = String(text);
				if (diagnose) diagnosticOutput += `${output}\n`;
				postOutput(output);
			},
			stdin: createStdinReader(stdin, stdinChannel)
		});
		for (const file of workspaceFiles) writeWorkspaceFile(swipl.FS, file.path, file.content);
		const mainPath = writeWorkspaceFile(swipl.FS, activePath, code);
		const query = diagnose
			? `setup_call_cleanup(open_string(${prologString(code)}, Stream), (repeat, read_term(Stream, Term, [syntax_errors(error)]), (Term == end_of_file -> ! ; fail)), close(Stream)).`
			: `consult(${prologString(mainPath)}), (current_predicate(main/0) -> main ; true).`;
		const goal = swipl.prolog.query(query);
		try {
			const result = goal.once();
			if (result === false) throw new Error('Prolog goal failed.');
		} finally {
			goal.close?.();
		}
		if (diagnose && /\b(?:error|warning)\b|syntax error/iu.test(diagnosticOutput)) {
			throw new Error(diagnosticOutput.trim());
		}
	} catch (error) {
		terminalError = error;
	} finally {
		if (swipl) {
			let cleanupError = null;
			if (typeof swipl._PL_cleanup !== 'function') {
				cleanupError = new Error('SWI-Prolog runtime does not expose PL_cleanup().');
			} else {
				try {
					const cleanupStatus = swipl._PL_cleanup(0);
					if (cleanupStatus !== 1) {
						cleanupError = new Error(
							`SWI-Prolog cleanup returned status ${cleanupStatus} instead of 1.`
						);
					}
				} catch (error) {
					cleanupError = error;
				}
			}
			if (cleanupError) {
				if (terminalError) {
					const primaryMessage = terminalError?.message || String(terminalError);
					const cleanupMessage = cleanupError?.message || String(cleanupError);
					terminalError = new Error(
						`${primaryMessage} SWI-Prolog cleanup also failed: ${cleanupMessage}`,
						{ cause: cleanupError }
					);
				} else {
					terminalError = cleanupError;
				}
			}
		}
		if (originalConsole) {
			console.log = originalConsole.log;
			console.warn = originalConsole.warn;
			console.error = originalConsole.error;
		}
	}
	if (terminalError) {
		if (log) console.error('[wasm-idle:prolog-worker] failed', terminalError);
		self.postMessage({ error: terminalError?.message || String(terminalError) });
		return;
	}
	if (log) console.log(`[wasm-idle:prolog-worker] ${diagnose ? 'diagnose' : 'run'} settled`);
	self.postMessage({ results: true });
};
