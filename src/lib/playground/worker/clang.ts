import type {
	BrowserClangPrecompiledHeader,
	BrowserClangRuntime as Clang
} from '@wasm-idle/llvm-core/clang';
import { normalizeDwarfWorkspacePath } from '@wasm-idle/llvm-core/clang';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';
import { isSharedBufferBackedView } from '$lib/playground/sharedBuffer';
import {
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage,
	type WorkerRuntimeAssetConfig
} from '$lib/playground/worker/assets';

import { withVerifiedStreaming } from './clangStreaming';
import { BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES } from '../clangAssetIntegrity';

declare var self: any;
// Preserve native Worker globals: a partial document makes dev loaders misdetect a DOM.
let stdinBufferClang: Int32Array,
	debugBufferClang: Int32Array,
	watchBufferClang: Int32Array,
	watchResultBufferClang: Int32Array,
	interruptBufferClang: Uint8Array,
	clang: Clang;
let hasInitialStdinClang = false;
let initialStdinClang: string | null = null;
// Sent once per worker by the host; the runtime mounts it only for matching compiles.
let precompiledHeaderClang: BrowserClangPrecompiledHeader | undefined;

/** Ask the host to build the header in a helper worker when this compile could have used one. */
function missingPrecompiledHeader() {
	return clang?.precompiledHeaderPlan && !clang.usedPrecompiledHeader
		? { precompiledHeaderKey: clang.precompiledHeaderPlan.key }
		: {};
}

function postProgress(percent: number, stage: string) {
	postMessage({ progress: { percent, stage } });
}

async function loadClang(
	path: string,
	log: boolean,
	maxAssetBytes: number | undefined,
	verifiedStreaming = false,
	languageSysrootProfiles = false
) {
	const { BrowserClangRuntime, loadRuntimeManifest, resolveRuntimeManifestUrl } =
		await import('@wasm-idle/llvm-core/clang');
	const manifest = await loadRuntimeManifest(
		resolveRuntimeManifestUrl(path),
		fetch,
		undefined,
		maxAssetBytes
	);
	const runtimeManifest = languageSysrootProfiles
		? {
				...manifest,
				compiler: {
					...manifest.compiler,
					sysroot: {
						...manifest.compiler.sysroot,
						profiles: BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES
					}
				}
			}
		: manifest;
	const Runtime = withVerifiedStreaming(
		BrowserClangRuntime,
		path,
		maxAssetBytes,
		verifiedStreaming
	);
	clang = new Runtime({
		stdout: (output) => postMessage({ output }),
		onDebugEvent: (debugEvent) => postMessage({ debugEvent }),
		stdin: () => {
			if (hasInitialStdinClang) {
				const chunk = initialStdinClang;
				initialStdinClang = null;
				return chunk ?? '';
			}
			return (
				waitForBufferedStdin(stdinBufferClang, () => postMessage({ buffer: true })) ?? ''
			);
		},
		progress: (value) => postMessage({ progress: value }),
		log,
		maxAssetBytes,
		runtimeBaseUrl: path,
		manifest: runtimeManifest
	});
	await clang.ready;
}

self.onmessage = async (event: { data: any }) => {
	if (handleWorkerAssetMessage(event.data)) return;
	const {
		code,
		buffer,
		debugBuffer,
		watchBuffer,
		watchResultBuffer,
		load,
		interrupt,
		log,
		path,
		assets,
		prepare,
		language,
		compileArgs,
		programArgs,
		activePath,
		workspaceFiles,
		cppVersion,
		cVersion,
		debugMode,
		debug,
		breakpoints,
		pauseOnEntry,
		stdin,
		maxAssetBytes
	} = event.data;
	const resolvedDebugMode = debugMode || (debug ? 'trace' : 'none');
	if (event.data.precompiledHeader) precompiledHeaderClang = event.data.precompiledHeader;
	if (load) {
		try {
			const runtimeAssets = assets as WorkerRuntimeAssetConfig | undefined;
			configureWorkerRuntimeAssets(runtimeAssets || null);
			await loadClang(
				runtimeAssets?.baseUrl || path || '',
				log,
				maxAssetBytes,
				event.data.verifiedStreaming === true,
				event.data.languageSysrootProfiles === true
			);
			postMessage({ load: true });
		} catch (error: any) {
			self.postMessage({ error: error.message || 'Unable to load the C/C++ runtime.' });
		}
	} else if (event.data.precompileHeader) {
		const header = await clang
			.buildPrecompiledHeaderFor(code, {
				language,
				compileArgs,
				activePath,
				cppVersion,
				cVersion,
				debugMode: resolvedDebugMode
			})
			.catch(() => undefined);
		self.postMessage(
			{ precompiledHeader: header ?? null },
			header ? [header.bytes.buffer] : []
		);
	} else if (prepare) {
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		watchBufferClang = new Int32Array(watchBuffer);
		watchResultBufferClang = new Int32Array(watchResultBuffer);
		interruptBufferClang = new Uint8Array(interrupt);
		hasInitialStdinClang = typeof stdin === 'string';
		initialStdinClang = hasInitialStdinClang ? stdin : null;
		if (resolvedDebugMode === 'trace' && !isSharedBufferBackedView(debugBufferClang)) {
			self.postMessage({ error: 'C/C++ debugging requires SharedArrayBuffer.' });
			return;
		}

		try {
			postProgress(5, `Compiling ${language === 'C' ? 'C' : 'C++'} source`);
			await clang.compileArtifact(code, {
				language,
				compileArgs,
				programArgs,
				activePath,
				workspaceFiles,
				cppVersion,
				cVersion,
				debugMode: resolvedDebugMode,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang,
				watchBuffer: watchBufferClang,
				watchResultBuffer: watchResultBufferClang,
				precompiledHeader: precompiledHeaderClang
			});
			if (clang.usedPrecompiledHeader)
				postProgress(95, 'Compiled with precompiled <bits/stdc++.h>');
			postProgress(100, `${language === 'C' ? 'C' : 'C++'} program ready`);
			self.postMessage({ results: true, ...missingPrecompiledHeader() });
		} catch (error: any) {
			self.postMessage({ error: error.message, ...missingPrecompiledHeader() });
		}
	} else if (code) {
		clang.log = log;
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		watchBufferClang = new Int32Array(watchBuffer);
		watchResultBufferClang = new Int32Array(watchResultBuffer);
		interruptBufferClang = new Uint8Array(interrupt);
		hasInitialStdinClang = typeof stdin === 'string';
		initialStdinClang = hasInitialStdinClang ? stdin : null;
		if (resolvedDebugMode === 'trace' && !isSharedBufferBackedView(debugBufferClang)) {
			self.postMessage({ error: 'C/C++ debugging requires SharedArrayBuffer.' });
			return;
		}

		try {
			if (resolvedDebugMode === 'lldb') {
				const artifact = await clang.compileArtifact(code, {
					language,
					compileArgs,
					programArgs,
					activePath,
					workspaceFiles,
					cppVersion,
					cVersion,
					debugMode: 'lldb',
					precompiledHeader: precompiledHeaderClang
				});
				if (!artifact.debug) {
					throw new Error('wasm-clang did not return an LLDB DWARF descriptor');
				}
				const inputPath =
					normalizeDwarfWorkspacePath(
						activePath || (language === 'C' ? 'main.c' : 'main.cc')
					) || (language === 'C' ? 'main.c' : 'main.cc');
				const sources = new Map<string, string>();
				for (const file of workspaceFiles || []) {
					const sourcePath = normalizeDwarfWorkspacePath(file.path);
					if (sourcePath) sources.set(`/workspace/${sourcePath}`, file.content);
				}
				sources.set(`/workspace/${inputPath}`, code);
				self.postMessage({
					lldbArtifact: {
						bytes: new Uint8Array(artifact.bytes),
						descriptor: artifact.debug,
						sources: artifact.debug.files.map(({ path, contentSha256 }) => {
							const content = sources.get(path);
							if (content === undefined) {
								throw new Error(`Missing LLDB source content for ${path}`);
							}
							return { path, content, contentSha256 };
						})
					}
				});
				return;
			}
			await clang.compileLinkRun(code, {
				language,
				compileArgs,
				programArgs,
				activePath,
				workspaceFiles,
				cppVersion,
				cVersion,
				debugMode: resolvedDebugMode,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang,
				watchBuffer: watchBufferClang,
				watchResultBuffer: watchResultBufferClang,
				precompiledHeader: precompiledHeaderClang
			});
			self.postMessage({ results: true, ...missingPrecompiledHeader() });
		} catch (error: any) {
			self.postMessage({ error: error.message, ...missingPrecompiledHeader() });
		}
	}
};
