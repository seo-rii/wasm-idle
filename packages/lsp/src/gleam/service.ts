import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';

import { positionAt, type LspDiagnostic, type WorkerLanguageService } from '../lsp.js';
import { DEFAULT_MAX_EXTERNAL_ASSET_BYTES, fetchBoundedExternalAsset } from '../external-asset.js';

export interface GleamWorkerOptions {
	baseUrl: string;
	manifestUrl?: string;
	manifestFingerprint: string;
}

export interface GleamCompilerAssets {
	manifestFingerprint: string;
	moduleBytes: Uint8Array<ArrayBuffer>;
	wasmBytes: Uint8Array<ArrayBuffer>;
}

export interface GleamCompiler {
	reset_filesystem(projectId: number): void;
	delete_project?(projectId: number): void;
	write_file(projectId: number, path: string, content: string): void;
	write_module(projectId: number, moduleName: string, code: string): void;
	compile_package(projectId: number, target: string): void;
	default?(wasm: string | Uint8Array<ArrayBuffer>): Promise<void>;
}

export type LoadGleamCompiler = (
	baseUrl: string,
	assets: GleamCompilerAssets
) => Promise<GleamCompiler>;

const GLEAM_KEYWORDS = [
	'as',
	'assert',
	'case',
	'const',
	'echo',
	'fn',
	'if',
	'import',
	'let',
	'opaque',
	'panic',
	'pub',
	'todo',
	'type',
	'use'
] as const;

const stdinModuleSource = `@external(javascript, "./stdin_ffi.mjs", "read_line")
pub fn read_line() -> String
`;

const stdinFfiSource = `export function read_line() {
  return "";
}
`;

let nextProjectId = 0;
const GLEAM_MANIFEST_FORMAT = 'wasm-gleam-runtime-manifest-v2';
const GLEAM_FINGERPRINT_DOMAIN = 'wasm-idle:gleam-runtime-manifest:v2';
const MAX_GLEAM_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_GLEAM_RUNTIME_ASSETS = 8_192;
const MAX_GLEAM_STDLIB_SOURCE_FILES = 4_096;
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const textEncoder = new TextEncoder();

function assetUrl(baseUrl: string, path: string) {
	return new URL(path, baseUrl).href;
}

export function resolveGleamCompilerUrl(baseUrl: string) {
	return assetUrl(baseUrl, 'compiler/gleam_wasm.js');
}

async function defaultLoadGleamCompiler(
	_baseUrl: string,
	assets: GleamCompilerAssets
): Promise<GleamCompiler> {
	if (typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') {
		throw new Error('Gleam compiler verification requires Blob URL support');
	}
	const moduleUrl = URL.createObjectURL(
		new Blob([assets.moduleBytes], { type: 'text/javascript' })
	);
	let compiler: GleamCompiler;
	try {
		compiler = (await import(/* @vite-ignore */ moduleUrl)) as GleamCompiler;
	} finally {
		try {
			URL.revokeObjectURL(moduleUrl);
		} catch {
			// Blob URL cleanup must not replace the verified import outcome.
		}
	}
	if (typeof compiler.default !== 'function') {
		throw new Error('Gleam compiler module does not export an initializer');
	}
	await compiler.default(assets.wasmBytes);
	return compiler;
}

async function fetchJson(url: string) {
	const bytes = await fetchBoundedExternalAsset({
		url,
		label: 'Gleam source manifest',
		cache: 'no-store',
		maxBytes: MAX_GLEAM_MANIFEST_BYTES
	});
	try {
		return JSON.parse(fatalTextDecoder.decode(bytes)) as unknown;
	} catch {
		throw new Error('Gleam source manifest is not valid UTF-8 JSON');
	}
}

function normalizeWorkspacePath(path: string) {
	const parts: string[] = [];
	for (const part of String(path || '')
		.replace(/^\/+/, '')
		.split('/')) {
		if (!part || part === '.' || part === '..' || part.includes('\0')) continue;
		parts.push(part);
	}
	return parts.join('/');
}

function moduleNameFromUri(uri: string) {
	let path = uri;
	try {
		path = decodeURIComponent(new URL(uri).pathname);
	} catch {
		path = uri;
	}
	const normalized = normalizeWorkspacePath(path.replace(/^\/?workspace\//u, ''));
	const withoutPrefix = normalized.startsWith('src/') ? normalized.slice(4) : normalized;
	const fileName = withoutPrefix.split('/').pop() || 'main.gleam';
	if (withoutPrefix.endsWith('.gleam')) return withoutPrefix.slice(0, -'.gleam'.length);
	if (fileName.endsWith('.gleam')) return fileName.slice(0, -'.gleam'.length);
	return 'main';
}

interface GleamAssetReceipt {
	path: string;
	size: number;
	sha256: string;
}

interface VerifiedGleamRuntimePack {
	compilerAssets: GleamCompilerAssets;
	sources: Map<string, string>;
}

async function collectStdlibSources(
	baseUrl: string,
	manifest: unknown,
	expectedFingerprint: string
): Promise<VerifiedGleamRuntimePack> {
	if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
		throw new Error('Gleam source manifest must be an object');
	}
	const value = manifest as Record<string, unknown>;
	if (value.format !== GLEAM_MANIFEST_FORMAT) {
		throw new Error('Gleam source manifest format is unsupported');
	}
	if (
		typeof value.compilerVersion !== 'string' ||
		!/^[A-Za-z0-9._-]{1,64}$/u.test(value.compilerVersion)
	) {
		throw new Error('Gleam source manifest compiler version is invalid');
	}
	if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('Gleam language server requires a valid manifest fingerprint');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('Gleam source manifest does not match the pinned fingerprint');
	}
	if (
		!Array.isArray(value.assets) ||
		value.assets.length === 0 ||
		value.assets.length > MAX_GLEAM_RUNTIME_ASSETS
	) {
		throw new Error('Gleam source manifest assets are invalid');
	}

	const receipts: GleamAssetReceipt[] = [];
	for (const [index, entry] of value.assets.entries()) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error(`Gleam runtime asset ${index} receipt is invalid`);
		}
		const { path, size, sha256 } = entry as Record<string, unknown>;
		if (
			typeof path !== 'string' ||
			!path ||
			path.length > 512 ||
			!/^[A-Za-z0-9._/-]+$/u.test(path) ||
			path.startsWith('/') ||
			path
				.split('/')
				.some((part) => !part || part === '.' || part === '..' || part.length > 128)
		) {
			throw new Error(`Gleam runtime asset ${index} path is invalid`);
		}
		if (!Number.isSafeInteger(size) || Number(size) <= 0) {
			throw new Error(`Gleam runtime asset ${path} size is invalid`);
		}
		if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
			throw new Error(`Gleam runtime asset ${path} SHA-256 is invalid`);
		}
		receipts.push({ path, size: Number(size), sha256 });
	}
	receipts.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	const receiptByPath = new Map<string, GleamAssetReceipt>();
	let declaredBytes = 0;
	for (const receipt of receipts) {
		if (receiptByPath.has(receipt.path)) {
			throw new Error(`Gleam source manifest contains a duplicate asset: ${receipt.path}`);
		}
		declaredBytes += receipt.size;
		if (
			!Number.isSafeInteger(declaredBytes) ||
			declaredBytes > DEFAULT_MAX_EXTERNAL_ASSET_BYTES
		) {
			throw new Error('Gleam source manifest exceeds the aggregate asset byte limit');
		}
		receiptByPath.set(receipt.path, receipt);
	}
	const canonical = `${GLEAM_FINGERPRINT_DOMAIN}\nformat\0${GLEAM_MANIFEST_FORMAT}\ncompilerVersion\0${value.compilerVersion}\n${receipts
		.map((receipt) => `${receipt.path}\0${receipt.size}\0${receipt.sha256}\n`)
		.join('')}`;
	await verifyRuntimeAssetIntegrity({
		asset: 'Gleam runtime receipt graph',
		bytes: textEncoder.encode(canonical),
		expected: expectedFingerprint,
		runtimeId: 'gleam-lsp',
		profileId: expectedFingerprint
	});

	if (!Array.isArray(value.files) || value.files.length > MAX_GLEAM_STDLIB_SOURCE_FILES) {
		throw new Error(
			`Gleam source manifest exceeds the ${MAX_GLEAM_STDLIB_SOURCE_FILES} file limit`
		);
	}
	const sourceReceipts: GleamAssetReceipt[] = [];
	const sourcePaths = new Set<string>();
	const requiredPaths = new Set(['compiler/gleam_wasm.js', 'compiler/gleam_wasm_bg.wasm']);
	for (const entry of value.files) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
			throw new Error('Gleam source manifest receipt is invalid');
		}
		const { path, size, sha256 } = entry as Record<string, unknown>;
		const pathParts = typeof path === 'string' ? path.split('/') : [];
		if (
			typeof path !== 'string' ||
			!path ||
			path.length > 512 ||
			!/^[A-Za-z0-9._/-]+$/u.test(path) ||
			path.startsWith('/') ||
			pathParts.some((part) => !part || part === '.' || part === '..' || part.length > 128) ||
			(!path.endsWith('.gleam') && !path.endsWith('.mjs'))
		) {
			throw new Error(`Gleam source manifest contains an unsafe path: ${String(path)}`);
		}
		if (sourcePaths.has(path)) {
			throw new Error(`Gleam source manifest contains a duplicate path: ${path}`);
		}
		if (
			!Number.isSafeInteger(size) ||
			Number(size) <= 0 ||
			typeof sha256 !== 'string' ||
			!/^[a-f0-9]{64}$/u.test(sha256)
		) {
			throw new Error(`Gleam source manifest receipt is invalid for ${path}`);
		}
		const receipt = { path, size: Number(size), sha256 };
		const assetPath = `src/${path}`;
		const assetReceipt = receiptByPath.get(assetPath);
		if (
			!assetReceipt ||
			assetReceipt.size !== receipt.size ||
			assetReceipt.sha256 !== receipt.sha256
		) {
			throw new Error(`Gleam source receipt does not match asset ${assetPath}`);
		}
		sourcePaths.add(path);
		requiredPaths.add(assetPath);
		sourceReceipts.push(receipt);
	}

	if (!Array.isArray(value.javascriptFiles) || value.javascriptFiles.length > 4_096) {
		throw new Error('Gleam JavaScript source manifest is invalid');
	}
	const javascriptPaths = new Set<string>();
	for (const entry of value.javascriptFiles) {
		if (
			typeof entry !== 'string' ||
			!entry ||
			entry.length > 512 ||
			!/^[A-Za-z0-9._/-]+$/u.test(entry) ||
			entry.startsWith('/') ||
			entry
				.split('/')
				.some((part) => !part || part === '.' || part === '..' || part.length > 128) ||
			!entry.endsWith('.mjs')
		) {
			throw new Error('Gleam JavaScript source manifest path is invalid');
		}
		if (javascriptPaths.has(entry)) {
			throw new Error(`Gleam JavaScript source manifest contains a duplicate path: ${entry}`);
		}
		const assetPath = `javascript/${entry}`;
		if (!receiptByPath.has(assetPath)) {
			throw new Error(`Gleam JavaScript source receipt is missing for ${assetPath}`);
		}
		javascriptPaths.add(entry);
		requiredPaths.add(assetPath);
	}
	if (
		requiredPaths.size !== receiptByPath.size ||
		[...requiredPaths].some((path) => !receiptByPath.has(path))
	) {
		throw new Error('Gleam source manifest asset allowlist is inconsistent');
	}

	const bytesByPath = new Map<string, Uint8Array<ArrayBuffer>>();
	for (const assetPath of [
		'compiler/gleam_wasm.js',
		'compiler/gleam_wasm_bg.wasm',
		...sourceReceipts.map((receipt) => `src/${receipt.path}`)
	]) {
		const receipt = receiptByPath.get(assetPath)!;
		const url = new URL(assetPath, baseUrl);
		url.searchParams.set('v', expectedFingerprint);
		const bytes = await fetchBoundedExternalAsset({
			url,
			label: `Gleam runtime asset ${assetPath}`,
			maxBytes: receipt.size
		});
		await verifyRuntimeAssetIntegrity({
			asset: assetPath,
			bytes,
			expected: { bytes: receipt.size, sha256: receipt.sha256 },
			runtimeId: 'gleam-lsp',
			profileId: expectedFingerprint
		});
		bytesByPath.set(assetPath, bytes);
	}

	const sources = new Map<string, string>();
	for (const receipt of sourceReceipts) {
		const bytes = bytesByPath.get(`src/${receipt.path}`)!;
		try {
			sources.set(receipt.path, fatalTextDecoder.decode(bytes));
		} catch {
			throw new Error(`Gleam source ${receipt.path} is not valid UTF-8`);
		}
	}
	return {
		compilerAssets: {
			manifestFingerprint: expectedFingerprint,
			moduleBytes: bytesByPath.get('compiler/gleam_wasm.js')!,
			wasmBytes: bytesByPath.get('compiler/gleam_wasm_bg.wasm')!
		},
		sources
	};
}

function diagnosticFromError(error: unknown, text: string): LspDiagnostic {
	const message =
		error instanceof Error ? error.message : String(error || 'Gleam compilation failed');
	const match = /(?:^|\n)[^\n]*?([\w./-]+\.gleam):(\d+):(\d+)/u.exec(message);
	if (!match) {
		return {
			range: {
				start: positionAt(text, 0),
				end: positionAt(text, Math.min(text.length, 1))
			},
			severity: 1,
			source: 'gleam',
			message
		};
	}
	const line = Math.max(0, Number(match[2]) - 1);
	const character = Math.max(0, Number(match[3]) - 1);
	return {
		range: {
			start: { line, character },
			end: { line, character: character + 1 }
		},
		severity: 1,
		source: 'gleam',
		message
	};
}

export function createGleamWorkerService(
	loadCompiler: LoadGleamCompiler = defaultLoadGleamCompiler
): WorkerLanguageService {
	let compiler: GleamCompiler | null = null;
	let baseUrl = '';
	let manifestUrl = '';
	let manifestFingerprint = '';
	let stdlibSources = new Map<string, string>();
	let lastKey = '';
	let lastDiagnostics: LspDiagnostic[] = [];

	return {
		name: 'wasm-idle-gleam-lsp',
		diagnosticDelay: 700,
		capabilities: {
			completionProvider: { triggerCharacters: ['.', ' '] }
		},
		async initialize(options, context) {
			const config = (options || {}) as GleamWorkerOptions;
			if (!config.baseUrl) throw new Error('Gleam language server requires a baseUrl');
			if (!/^[a-f0-9]{64}$/u.test(config.manifestFingerprint)) {
				throw new Error('Gleam language server requires a valid manifest fingerprint');
			}
			const nextBaseUrl = config.baseUrl;
			const nextManifestUrl =
				config.manifestUrl || assetUrl(nextBaseUrl, 'source-manifest.v2.json');
			const nextManifestFingerprint = config.manifestFingerprint;
			context.reportProgress('load-gleam-compiler');
			const manifest = await fetchJson(nextManifestUrl);
			const runtime = await collectStdlibSources(
				nextBaseUrl,
				manifest,
				nextManifestFingerprint
			);
			const nextCompiler = await loadCompiler(nextBaseUrl, runtime.compilerAssets);
			baseUrl = nextBaseUrl;
			manifestUrl = nextManifestUrl;
			manifestFingerprint = nextManifestFingerprint;
			compiler = nextCompiler;
			stdlibSources = runtime.sources;
			lastKey = '';
			lastDiagnostics = [];
		},
		async diagnostics(document, context) {
			if (!compiler) return [];
			if (!document.text.trim()) return [];
			const key = `${baseUrl}\n${manifestUrl}\n${manifestFingerprint}\n${document.uri}\n${document.text}`;
			if (key === lastKey) return lastDiagnostics;
			context.reportProgress('gleam-diagnostics');
			const projectId = ++nextProjectId;
			try {
				compiler.reset_filesystem(projectId);
				compiler.write_file(
					projectId,
					'/gleam.toml',
					'name = "wasm_idle"\\nversion = "0.1.0"\\ntarget = "javascript"\\n'
				);
				for (const [path, source] of stdlibSources) {
					compiler.write_file(projectId, `/src/${path}`, source);
				}
				compiler.write_file(projectId, '/src/wasm_idle/stdin.gleam', stdinModuleSource);
				compiler.write_file(projectId, '/src/wasm_idle/stdin_ffi.mjs', stdinFfiSource);
				compiler.write_module(projectId, moduleNameFromUri(document.uri), document.text);
				compiler.compile_package(projectId, 'javascript');
				lastDiagnostics = [];
			} catch (error) {
				lastDiagnostics = [diagnosticFromError(error, document.text)];
			} finally {
				compiler.delete_project?.(projectId);
			}
			lastKey = key;
			return lastDiagnostics;
		},
		completion() {
			return {
				isIncomplete: false,
				items: GLEAM_KEYWORDS.map((keyword) => ({
					label: keyword,
					kind: 14
				}))
			};
		}
	};
}
