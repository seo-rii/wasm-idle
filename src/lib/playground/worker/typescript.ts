import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import type { SandboxWorkspaceFile } from '$lib/playground/options';
import { fetchRuntimeAssetBytes } from '$lib/playground/worker/runtimeAssetFetch';
import { verifyRuntimeAssetIntegrity } from '@wasm-idle/core';

declare var self: any;

let stdinBufferTypeScript: Int32Array | null = null;
let moduleUrl = '';
let moduleReceipt: TypeScriptModuleReceipt | null = null;
let maxAssetBytes = 0;
let loadedModuleIdentity = '';
let runtimePromise: Promise<{
	compiler: any;
	executeBrowserTypeScriptArtifact: (
		artifact: any,
		options?: {
			args?: string[];
			env?: Record<string, string>;
			onReady?: () => void;
			stdin?: () => string | null;
			stdout?: (chunk: string) => void;
			stderr?: (chunk: string) => void;
			files?: SandboxWorkspaceFile[];
			activePath?: string;
		}
	) => Promise<{
		exitCode: number | null;
		stdout: string;
		stderr: string;
	}>;
}> | null = null;
let compiledArtifact: any = null;
let compiledCacheKey = '';

interface TypeScriptModuleReceipt {
	bytes: number;
	sha256: string;
}

function snapshotModuleReceipt(value: unknown): TypeScriptModuleReceipt {
	if (!value || typeof value !== 'object') {
		throw new Error('TypeScript runtime integrity receipt is required');
	}
	const bytes = (value as { bytes?: unknown }).bytes;
	const sha256 = (value as { sha256?: unknown }).sha256;
	if (!Number.isSafeInteger(bytes) || (bytes as number) <= 0) {
		throw new Error('TypeScript runtime integrity receipt has an invalid byte size');
	}
	if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
		throw new Error('TypeScript runtime integrity receipt has an invalid SHA-256 digest');
	}
	return Object.freeze({ bytes: bytes as number, sha256 });
}

function requireMaxAssetBytes(value: unknown) {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Error('TypeScript runtime maxAssetBytes must be a positive safe integer');
	}
	return value as number;
}

function requireModuleUrl(value: unknown) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(
			'TypeScript runtime is not configured. Set PUBLIC_WASM_TYPESCRIPT_MODULE_URL or runtimeAssets.typescript.moduleUrl.'
		);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`TypeScript runtime module URL is invalid: ${value}`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`TypeScript runtime module URL must use HTTP(S): ${value}`);
	}
	if (url.username || url.password || url.hash) {
		throw new Error(
			`TypeScript runtime module URL must not include credentials or a fragment: ${value}`
		);
	}
	if (/%2f|%5c/iu.test(url.pathname)) {
		throw new Error(
			`TypeScript runtime module URL must not include encoded path separators: ${value}`
		);
	}
	return url.href;
}

async function loadRuntime(urlValue: unknown, receiptValue: unknown, maxAssetBytesValue: unknown) {
	const url = requireModuleUrl(urlValue);
	const receipt = snapshotModuleReceipt(receiptValue);
	const byteLimit = requireMaxAssetBytes(maxAssetBytesValue);
	if (receipt.bytes > byteLimit) {
		throw new Error(`TypeScript runtime module exceeds the ${byteLimit} byte limit`);
	}
	const identity = JSON.stringify([url, receipt.bytes, receipt.sha256]);
	if (loadedModuleIdentity === identity && runtimePromise) {
		return await runtimePromise;
	}
	loadedModuleIdentity = identity;
	compiledArtifact = null;
	compiledCacheKey = '';
	runtimePromise = (async () => {
		const bytes = await fetchRuntimeAssetBytes({
			url,
			label: 'TypeScript runtime module',
			maxAssetBytes: receipt.bytes
		});
		await verifyRuntimeAssetIntegrity({
			asset: url,
			bytes,
			expected: receipt,
			runtimeId: 'TYPESCRIPT'
		});
		if (
			typeof URL.createObjectURL !== 'function' ||
			typeof URL.revokeObjectURL !== 'function'
		) {
			throw new Error('TypeScript runtime requires Blob URL support');
		}
		const revokeObjectURL = URL.revokeObjectURL.bind(URL);
		const verifiedModuleUrl = URL.createObjectURL(
			new Blob([bytes], { type: 'text/javascript' })
		);
		let module: Record<string, any>;
		try {
			module = await import(/* @vite-ignore */ verifiedModuleUrl);
		} finally {
			try {
				revokeObjectURL(verifiedModuleUrl);
			} catch {
				// Blob URL cleanup must not replace the verified module's import outcome.
			}
		}
		const factory =
			typeof module.createTypeScriptCompiler === 'function'
				? module.createTypeScriptCompiler
				: typeof module.default === 'function'
					? module.default
					: null;
		if (!factory) {
			throw new Error(
				'wasm-typescript module must export createTypeScriptCompiler or a default factory'
			);
		}
		if (typeof module.executeBrowserTypeScriptArtifact !== 'function') {
			throw new Error('wasm-typescript module must export executeBrowserTypeScriptArtifact');
		}
		return {
			compiler: await factory(),
			executeBrowserTypeScriptArtifact: module.executeBrowserTypeScriptArtifact
		};
	})();
	return await runtimePromise;
}

function normalizeDiagnostic(diagnostic: any) {
	return {
		fileName: diagnostic?.fileName ?? null,
		lineNumber: Math.max(1, Number(diagnostic?.lineNumber || 1)),
		columnNumber:
			typeof diagnostic?.columnNumber === 'number'
				? Math.max(1, diagnostic.columnNumber)
				: undefined,
		endColumnNumber:
			typeof diagnostic?.endColumnNumber === 'number'
				? Math.max(1, diagnostic.endColumnNumber)
				: undefined,
		severity:
			diagnostic?.severity === 'warning' || diagnostic?.severity === 'other'
				? diagnostic.severity
				: 'error',
		message: String(diagnostic?.message || '')
	};
}

self.onmessage = async (event: { data: any }) => {
	const {
		load,
		moduleUrl: nextModuleUrl,
		moduleReceipt: nextModuleReceipt,
		maxAssetBytes: nextMaxAssetBytes,
		buffer,
		code,
		prepare,
		args = [],
		stdin,
		language = 'typescript',
		activePath = language === 'typescript' ? 'main.ts' : 'main.js',
		workspaceFiles = [],
		log
	} = event.data;
	try {
		if (load) {
			const configuredModuleUrl = requireModuleUrl(nextModuleUrl);
			const configuredModuleReceipt = snapshotModuleReceipt(nextModuleReceipt);
			const configuredMaxAssetBytes = requireMaxAssetBytes(nextMaxAssetBytes);
			if (log) {
				console.log(`[wasm-idle:typescript-worker] load moduleUrl=${configuredModuleUrl}`);
			}
			await loadRuntime(
				configuredModuleUrl,
				configuredModuleReceipt,
				configuredMaxAssetBytes
			);
			moduleUrl = configuredModuleUrl;
			moduleReceipt = configuredModuleReceipt;
			maxAssetBytes = configuredMaxAssetBytes;
			postMessage({ load: true });
			return;
		}

		stdinBufferTypeScript = new Int32Array(buffer);
		const runtime = await loadRuntime(moduleUrl, moduleReceipt, maxAssetBytes);
		const compileCacheKey = `${language}\n${activePath}\n${code}`;
		if (!compiledArtifact || compiledCacheKey !== compileCacheKey) {
			if (log) {
				console.log(
					`[wasm-idle:typescript-worker] compile start language=${language} prepare=${String(prepare)} bytes=${code.length}`
				);
			}
			const result = await runtime.compiler.compile({
				code,
				language,
				fileName: activePath,
				log
			});
			if (log) {
				console.log(
					`[wasm-idle:typescript-worker] compile settled success=${String(result.success)} stdout=${String(Boolean(result.stdout))} stderr=${String(Boolean(result.stderr))}`
				);
			}
			for (const diagnostic of result.diagnostics || []) {
				postMessage({ diagnostic: normalizeDiagnostic(diagnostic) });
			}
			if (result.stdout) postMessage({ output: result.stdout });
			if (!result.success) {
				throw new Error(
					result.stderr ||
						result.diagnostics
							?.map((diagnostic: any) => diagnostic.message)
							.join('\n') ||
						'TypeScript compilation failed'
				);
			}
			if (result.stderr) postMessage({ output: result.stderr });
			if (!result.artifact?.javascript) {
				throw new Error('wasm-typescript did not return a JavaScript artifact');
			}
			compiledArtifact = result.artifact;
			compiledCacheKey = compileCacheKey;
		}

		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const hasInitialStdin = typeof stdin === 'string';
		let initialStdin: string | null = hasInitialStdin ? stdin : null;
		const execution = await runtime.executeBrowserTypeScriptArtifact(compiledArtifact, {
			args,
			env: {
				USER: 'jungol'
			},
			onReady: () =>
				postMessage({
					progress: {
						kind: 'ready',
						state: 'running',
						reason: 'started',
						label: `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} program started`
					}
				}),
			files: workspaceFiles,
			activePath,
			stdin: () => {
				if (hasInitialStdin) {
					const chunk = initialStdin;
					initialStdin = null;
					if (log) {
						console.log(
							chunk == null
								? '[wasm-idle:typescript-stdin] read(bytes=0, eof=true)'
								: `[wasm-idle:typescript-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
						);
					}
					return chunk;
				}
				const chunk = waitForBufferedStdin(stdinBufferTypeScript!, () =>
					postMessage({ buffer: true })
				);
				if (chunk == null) {
					if (log) {
						console.log('[wasm-idle:typescript-stdin] read(bytes=0, eof=true)');
					}
					return null;
				}
				if (log) {
					console.log(
						`[wasm-idle:typescript-stdin] read(bytes=${new TextEncoder().encode(chunk).byteLength}, text=${JSON.stringify(chunk)})`
					);
				}
				return chunk;
			},
			stdout: (output) => {
				if (output) postMessage({ output });
			},
			stderr: (output) => {
				if (output) postMessage({ output });
			}
		});
		if (execution.exitCode !== 0) {
			throw new Error(
				execution.stderr
					? `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} program exited with code ${execution.exitCode}\n${execution.stderr}`
					: `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} program exited with code ${execution.exitCode}`
			);
		}
		postMessage({ results: true });
	} catch (error: any) {
		if (log) {
			console.error('[wasm-idle:typescript-worker] failed', error);
		}
		postMessage({ error: error?.message || String(error) });
	}
};
