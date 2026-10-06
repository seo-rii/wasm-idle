import type { WasmFennelCompilerReceipt } from '$lib/playground/wasmFennelVersion';

/**
 * Fennel runs the official, receipt-verified `fennel.lua` compiler on the wasm-lua VM.
 * These helpers build the Lua entry chunks that load that compiler and hand it the user's
 * Fennel source; they never parse or translate Fennel themselves.
 */

export interface FennelCompilerAsset {
	url: string;
	receipt: WasmFennelCompilerReceipt;
}

export interface FennelDiagnostic {
	fileName: string | null;
	lineNumber: number;
	columnNumber?: number;
	severity: 'error';
	message: string;
}

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function luaQuotedString(value: string) {
	let quoted = '"';
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		if (character === '\\') quoted += '\\\\';
		else if (character === '"') quoted += '\\"';
		else if (codePoint < 0x20 || codePoint === 0x7f)
			quoted += `\\${String(codePoint).padStart(3, '0')}`;
		else quoted += character;
	}
	return `${quoted}"`;
}

function fennelLoaderChunk(fennelSource: string) {
	// fennel.lua is a single chunk ending in `return mod`; wrapping it in a vararg function
	// keeps it byte-for-byte unmodified while letting the entry chunk reuse the module.
	return `local fennel = (function(...)\n${fennelSource}\nend)("fennel")\npackage.loaded.fennel = fennel\n`;
}

function fennelOptions(fileName: string) {
	return `{ filename = ${luaQuotedString(fileName)}, ["error-pinpoint"] = false }`;
}

/** Lua chunk that only compiles the Fennel source, raising the compiler error on failure. */
export function buildFennelCompileChunk(fennelSource: string, code: string, fileName: string) {
	return (
		fennelLoaderChunk(fennelSource) +
		`local options = ${fennelOptions(fileName)}\n` +
		// Match fennel.eval, which rejects unknown globals against the current environment.
		`options.allowedGlobals = require("fennel.specials")["current-global-names"]()\n` +
		`local ok, err = pcall(fennel.compileString, ${luaQuotedString(code)}, options)\n` +
		`if not ok then error(tostring(err), 0) end\n`
	);
}

/** Lua chunk that evaluates the Fennel program through `fennel.eval`. */
export function buildFennelRunChunk(fennelSource: string, code: string, fileName: string) {
	return (
		fennelLoaderChunk(fennelSource) +
		`local ok, err = xpcall(fennel.eval, function(e) return tostring(e) end, ${luaQuotedString(code)}, ${fennelOptions(fileName)})\n` +
		`if not ok then error(err, 0) end\n`
	);
}

/** Drops the host Lua traceback that wasmoon appends to errors raised by the entry chunk. */
export function stripHostLuaTraceback(message: string) {
	const index = message.indexOf('\nstack traceback:');
	return (index === -1 ? message : message.slice(0, index)).trimEnd();
}

export function parseFennelDiagnostic(message: string, fileName: string): FennelDiagnostic {
	const clean = stripHostLuaTraceback(message.replace(/^Error:\s*/u, ''));
	const firstLine = clean.split('\n', 1)[0] ?? '';
	const match = /^([^:\n]+):(\d+):(?:(\d+):)?\s*([\s\S]*)$/u.exec(firstLine);
	return {
		fileName: match?.[1] || fileName,
		lineNumber: Math.max(1, Number(match?.[2] || 1)),
		columnNumber: match?.[3] ? Math.max(1, Number(match[3]) + 1) : undefined,
		severity: 'error',
		message: (match?.[4] || clean || message).trim()
	};
}

async function sha256Hex(bytes: Uint8Array) {
	const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
		''
	);
}

async function gunzip(bytes: Uint8Array) {
	const stream = new Blob([bytes as BlobPart])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function assertReceipt(receipt: WasmFennelCompilerReceipt) {
	if (
		!SHA256_PATTERN.test(receipt.sha256) ||
		!SHA256_PATTERN.test(receipt.uncompressedSha256) ||
		!Number.isSafeInteger(receipt.bytes) ||
		!Number.isSafeInteger(receipt.uncompressedBytes)
	) {
		throw new Error('Fennel compiler receipt is malformed');
	}
}

/**
 * Verifies the fetched fennel.lua asset against its pinned receipt. Accepts either the
 * gzip delivery bytes or bytes a server already decoded via Content-Encoding.
 */
export async function verifyFennelCompilerBytes(
	bytes: Uint8Array,
	receipt: WasmFennelCompilerReceipt
): Promise<string> {
	assertReceipt(receipt);
	let decoded = bytes;
	if (bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1) {
		if (bytes.byteLength !== receipt.bytes) {
			throw new Error(
				`Fennel compiler asset is ${bytes.byteLength} bytes; receipt expects ${receipt.bytes}`
			);
		}
		if ((await sha256Hex(bytes)) !== receipt.sha256) {
			throw new Error('Fennel compiler asset SHA-256 does not match its pinned receipt');
		}
		decoded = await gunzip(bytes);
	}
	if (decoded.byteLength !== receipt.uncompressedBytes) {
		throw new Error(
			`Fennel compiler source is ${decoded.byteLength} bytes; receipt expects ${receipt.uncompressedBytes}`
		);
	}
	if ((await sha256Hex(decoded)) !== receipt.uncompressedSha256) {
		throw new Error('Fennel compiler source SHA-256 does not match its pinned receipt');
	}
	return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
}

export async function loadFennelCompilerSource(asset: FennelCompilerAsset): Promise<string> {
	if (!asset?.url) throw new Error('Fennel compiler URL is not configured');
	const response = await fetch(asset.url);
	if (!response.ok) {
		throw new Error(`Failed to fetch Fennel compiler (${response.status})`);
	}
	const declaredLength = Number(response.headers.get('content-length'));
	const maxBytes = Math.max(asset.receipt.bytes, asset.receipt.uncompressedBytes);
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new Error(`Fennel compiler asset exceeds its ${maxBytes} byte receipt`);
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > maxBytes) {
		throw new Error(`Fennel compiler asset exceeds its ${maxBytes} byte receipt`);
	}
	return await verifyFennelCompilerBytes(bytes, asset.receipt);
}
