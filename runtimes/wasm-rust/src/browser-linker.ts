import { componentizeCoreWasmToPreview2Component } from './browser-component-tools.js';
import { fetchRuntimeAssetBytes } from './runtime-asset.js';
import { clearRuntimeAssetPackCache, loadRuntimePackEntries } from './runtime-asset-store.js';
import {
	isIntegratedCompilerOutput,
	resolveRuntimeAssetUrl,
	type NormalizedRuntimeManifest,
	type RuntimeTargetConfig
} from './runtime-manifest.js';
import type { BrowserRustCompilerResult } from './types.js';

const linkAssetCache = new Map<string, Promise<Uint8Array>>();

export interface LinkBitcodeWithLlvmWasmOptions {
	onProgress?: (progress: {
		stage: 'link' | 'componentize';
		completed: number;
		total: number;
		message?: string;
		bytesCompleted?: number;
		bytesTotal?: number;
	}) => void;
	fetchImpl?: typeof fetch;
	importRuntimeModule?: <T>(assetUrl: string) => Promise<T>;
	componentizeCoreWasm?: typeof componentizeCoreWasmToPreview2Component;
}

function mkdirp(module: { FS: { mkdir(path: string): void } }, targetPath: string) {
	const segments = targetPath.replace(/^\/+/, '').split('/').filter(Boolean);
	let current = '';
	for (const segment of segments) {
		current += '/' + segment;
		try {
			module.FS.mkdir(current);
		} catch {}
	}
}

function formatToolFailure(
	label: string,
	stage: string,
	stderr: string[],
	stdout: string[],
	detail?: string
) {
	const parts = [`${label} ${stage} failed`];
	if (detail) {
		parts.push(detail);
	}
	if (stderr.length > 0) {
		parts.push(`stderr=${stderr.join('\n')}`);
	}
	if (stdout.length > 0) {
		parts.push(`stdout=${stdout.join('\n')}`);
	}
	return new Error(parts.join(' | '));
}

export function clearLinkAssetCache() {
	linkAssetCache.clear();
	clearRuntimeAssetPackCache();
}

export async function linkBitcodeWithLlvmWasm(
	bitcode: Uint8Array,
	manifest: NormalizedRuntimeManifest,
	target: RuntimeTargetConfig,
	runtimeBaseUrl: string,
	options: LinkBitcodeWithLlvmWasmOptions = {}
): Promise<NonNullable<BrowserRustCompilerResult['artifact']>> {
	const loadRuntimeModule =
		options.importRuntimeModule ||
		(<T>(assetUrl: string) => import(/* @vite-ignore */ assetUrl) as Promise<T>);
	const fetchImpl = options.fetchImpl || fetch;
	const componentizeCoreWasm =
		options.componentizeCoreWasm || componentizeCoreWasmToPreview2Component;
	const emitProgress = (
		stage: 'link' | 'componentize',
		completed: number,
		total: number,
		message?: string,
		bytesCompleted?: number,
		bytesTotal?: number
	) => {
		options.onProgress?.({
			stage,
			completed,
			total,
			...(message !== undefined ? { message } : {}),
			...(bytesCompleted !== undefined ? { bytesCompleted } : {}),
			...(bytesTotal !== undefined ? { bytesTotal } : {})
		});
	};
	if (isIntegratedCompilerOutput(target.compile)) {
		emitProgress('link', 1, 1, 'integrated rustc link finished');
		if (target.compile.kind === 'integrated-rustc+component-encoder') {
			emitProgress('componentize', 0, 1, 'encoding preview2 component');
			const component = await componentizeCoreWasm(bitcode, runtimeBaseUrl, (progress) =>
				emitProgress(
					'componentize',
					0,
					1,
					'encoding preview2 component',
					progress.loaded,
					progress.total
				)
			);
			emitProgress('componentize', 1, 1, 'preview2 component ready');
			return {
				wasm: component,
				targetTriple: target.targetTriple,
				format: 'component'
			};
		}
		return {
			wasm: bitcode,
			targetTriple: target.targetTriple,
			format: target.artifactFormat
		};
	}
	const llcWasmAsset = target.compile.llvm.llcWasm || 'llvm/llc.wasm';
	const llcWasmUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, llcWasmAsset);
	let cachedLlcWasm = linkAssetCache.get(llcWasmUrl);
	if (!cachedLlcWasm) {
		cachedLlcWasm = fetchRuntimeAssetBytes(
			llcWasmUrl,
			`wasm-rust llvm asset ${llcWasmAsset}`,
			fetchImpl,
			true,
			(progress) =>
				emitProgress(
					'link',
					0,
					2,
					'running llvm-wasm code generation',
					progress.loaded,
					progress.total
				)
		);
		linkAssetCache.set(llcWasmUrl, cachedLlcWasm);
		cachedLlcWasm.catch(() => {
			if (linkAssetCache.get(llcWasmUrl) === cachedLlcWasm) {
				linkAssetCache.delete(llcWasmUrl);
			}
		});
	}
	emitProgress('link', 0, 2, 'running llvm-wasm code generation');
	const { default: Llc } = await loadRuntimeModule<{
		default: (options: {
			locateFile(file: string): string;
			wasmBinary?: Uint8Array;
			print(text: string): void;
			printErr(text: string): void;
		}) => Promise<{
			FS: {
				mkdir(path: string): void;
				writeFile(path: string, contents: Uint8Array): void;
				readFile(path: string): Uint8Array;
			};
			callMain(args: string[]): Promise<void>;
		}>;
	}>(resolveRuntimeAssetUrl(runtimeBaseUrl, target.compile.llvm.llc));
	const llcStdout: string[] = [];
	const llcStderr: string[] = [];
	const llc = await Llc({
		locateFile(file: string) {
			if (file === 'llc.wasm') {
				return llcWasmUrl;
			}
			return resolveRuntimeAssetUrl(runtimeBaseUrl, `llvm/${file}`);
		},
		wasmBinary: await cachedLlcWasm,
		print(text: string) {
			llcStdout.push(String(text));
		},
		printErr(text: string) {
			llcStderr.push(String(text));
		}
	});
	const lldWasmAsset = target.compile.llvm.lldWasm || 'llvm/lld.wasm';
	const lldWasmUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, lldWasmAsset);
	let cachedLldWasm = linkAssetCache.get(lldWasmUrl);
	if (!cachedLldWasm) {
		cachedLldWasm = fetchRuntimeAssetBytes(
			lldWasmUrl,
			`wasm-rust llvm asset ${lldWasmAsset}`,
			fetchImpl,
			true,
			(progress) =>
				emitProgress(
					'link',
					0,
					2,
					'running llvm-wasm link',
					progress.loaded,
					progress.total
				)
		);
		linkAssetCache.set(lldWasmUrl, cachedLldWasm);
		cachedLldWasm.catch(() => {
			if (linkAssetCache.get(lldWasmUrl) === cachedLldWasm) {
				linkAssetCache.delete(lldWasmUrl);
			}
		});
	}
	const lldDataAsset = target.compile.llvm.lldData || 'llvm/lld.data';
	const lldDataUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, lldDataAsset);
	let cachedLldData = linkAssetCache.get(lldDataUrl);
	if (!cachedLldData) {
		cachedLldData = fetchRuntimeAssetBytes(
			lldDataUrl,
			`wasm-rust llvm asset ${lldDataAsset}`,
			fetchImpl,
			true,
			(progress) =>
				emitProgress(
					'link',
					0,
					2,
					'running llvm-wasm link',
					progress.loaded,
					progress.total
				)
		);
		linkAssetCache.set(lldDataUrl, cachedLldData);
		cachedLldData.catch(() => {
			if (linkAssetCache.get(lldDataUrl) === cachedLldData) {
				linkAssetCache.delete(lldDataUrl);
			}
		});
	}
	const lldModulePromise = loadRuntimeModule<{
		default: (options: {
			locateFile(file: string): string;
			wasmBinary?: Uint8Array;
			getPreloadedPackage?: (packageName: string, packageSize: number) => ArrayBuffer;
			print(text: string): void;
			printErr(text: string): void;
		}) => Promise<{
			FS: {
				mkdir(path: string): void;
				writeFile(path: string, contents: Uint8Array): void;
				readFile(path: string): Uint8Array;
			};
			callMain(args: string[]): Promise<void>;
		}>;
	}>(resolveRuntimeAssetUrl(runtimeBaseUrl, target.compile.llvm.lld));
	const prefetchedLinkAssets = new Map<string, Uint8Array>();
	let prefetchedLinkAssetsPromise: Promise<void> | null = null;
	let packedLinkEntriesPromise: Promise<
		Awaited<ReturnType<typeof loadRuntimePackEntries>>
	> | null = null;
	if (target.compile.link.pack) {
		packedLinkEntriesPromise = loadRuntimePackEntries(
			runtimeBaseUrl,
			target.compile.link.pack,
			fetchImpl,
			(progress) =>
				emitProgress(
					'link',
					0,
					2,
					'running llvm-wasm link',
					progress.loaded,
					progress.total
				)
		);
	} else if (
		target.compile.link.allocatorObjectRuntimePath &&
		target.compile.link.allocatorObjectAsset &&
		target.compile.link.files
	) {
		const assetPrefetches = new Map<string, Promise<Uint8Array>>();
		for (const assetPath of [
			target.compile.link.allocatorObjectAsset,
			...target.compile.link.files.map((entry) => entry.asset)
		]) {
			if (assetPrefetches.has(assetPath)) {
				continue;
			}
			assetPrefetches.set(
				assetPath,
				(async () => {
					const assetUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, assetPath);
					let cachedAsset = linkAssetCache.get(assetUrl);
					if (!cachedAsset) {
						cachedAsset = fetchRuntimeAssetBytes(
							assetUrl,
							`wasm-rust link asset ${assetPath}`,
							fetchImpl,
							true,
							(progress) =>
								emitProgress(
									'link',
									0,
									2,
									'running llvm-wasm link',
									progress.loaded,
									progress.total
								)
						);
						linkAssetCache.set(assetUrl, cachedAsset);
						cachedAsset.catch(() => {
							if (linkAssetCache.get(assetUrl) === cachedAsset) {
								linkAssetCache.delete(assetUrl);
							}
						});
					}
					const bytes = await cachedAsset;
					prefetchedLinkAssets.set(assetPath, bytes);
					return bytes;
				})()
			);
		}
		prefetchedLinkAssetsPromise = Promise.all(assetPrefetches.values()).then(() => {});
	}
	mkdirp(llc, '/work');
	llc.FS.writeFile('/work/main.bc', bitcode);
	try {
		await llc.callMain(['-filetype=obj', '-o', '/work/main.o', '/work/main.bc']);
	} catch (error) {
		throw formatToolFailure(
			'llc',
			'codegen',
			llcStderr,
			llcStdout,
			error instanceof Error ? error.message : String(error)
		);
	}
	let mainObject: Uint8Array;
	try {
		mainObject = llc.FS.readFile('/work/main.o');
	} catch (error) {
		throw formatToolFailure(
			'llc',
			'output-read',
			llcStderr,
			llcStdout,
			error instanceof Error ? error.message : String(error)
		);
	}
	options.onProgress?.({
		stage: 'link',
		completed: 1,
		total: 2,
		message: 'running lld link'
	});
	const { default: Lld } = await lldModulePromise;
	const lldStdout: string[] = [];
	const lldStderr: string[] = [];
	const lldDataBytes = await cachedLldData;
	const lld = await Lld({
		locateFile(file: string) {
			if (file === 'lld.wasm') {
				return lldWasmUrl;
			}
			if (file === 'lld.data') {
				return lldDataUrl;
			}
			return resolveRuntimeAssetUrl(runtimeBaseUrl, `llvm/${file}`);
		},
		wasmBinary: await cachedLldWasm,
		getPreloadedPackage() {
			return new Uint8Array(lldDataBytes).buffer;
		},
		print(text: string) {
			lldStdout.push(String(text));
		},
		printErr(text: string) {
			lldStderr.push(String(text));
		}
	});
	const addFile = async (runtimePath: string, assetPath: string, contents?: Uint8Array) => {
		mkdirp(lld, runtimePath.split('/').slice(0, -1).join('/'));
		if (contents) {
			lld.FS.writeFile(runtimePath, contents);
			return;
		}
		const assetUrl = resolveRuntimeAssetUrl(runtimeBaseUrl, assetPath);
		let cachedAsset = linkAssetCache.get(assetUrl);
		if (!cachedAsset) {
			cachedAsset = fetchRuntimeAssetBytes(
				assetUrl,
				`wasm-rust link asset ${assetPath}`,
				fetchImpl
			);
			linkAssetCache.set(assetUrl, cachedAsset);
			cachedAsset.catch(() => {
				if (linkAssetCache.get(assetUrl) === cachedAsset) {
					linkAssetCache.delete(assetUrl);
				}
			});
		}
		lld.FS.writeFile(runtimePath, await cachedAsset);
	};

	await addFile('/work/main.o', '', mainObject);
	if (target.compile.link.pack) {
		for (const entry of await (packedLinkEntriesPromise ||
			loadRuntimePackEntries(runtimeBaseUrl, target.compile.link.pack, fetchImpl))) {
			await addFile(entry.runtimePath, '', entry.bytes);
		}
	} else if (
		target.compile.link.allocatorObjectRuntimePath &&
		target.compile.link.allocatorObjectAsset &&
		target.compile.link.files
	) {
		await (prefetchedLinkAssetsPromise || Promise.resolve());
		await addFile(
			target.compile.link.allocatorObjectRuntimePath,
			target.compile.link.allocatorObjectAsset,
			prefetchedLinkAssets.get(target.compile.link.allocatorObjectAsset)
		);
		for (const entry of target.compile.link.files) {
			await addFile(entry.runtimePath, entry.asset, prefetchedLinkAssets.get(entry.asset));
		}
	} else {
		throw new Error(`missing link runtime assets for target ${target.targetTriple}`);
	}
	try {
		await lld.callMain([...target.compile.link.args]);
	} catch (error) {
		throw formatToolFailure(
			'lld',
			'link',
			lldStderr,
			lldStdout,
			error instanceof Error ? error.message : String(error)
		);
	}
	try {
		const coreWasm = lld.FS.readFile('/work/main.wasm');
		emitProgress('link', 2, 2, 'llvm-wasm link finished');
		if (target.compile.kind === 'llvm-wasm+component-encoder') {
			emitProgress('componentize', 0, 1, 'encoding preview2 component');
			const component = await componentizeCoreWasm(coreWasm, runtimeBaseUrl, (progress) =>
				emitProgress(
					'componentize',
					0,
					1,
					'encoding preview2 component',
					progress.loaded,
					progress.total
				)
			);
			emitProgress('componentize', 1, 1, 'preview2 component ready');
			return {
				wasm: component,
				targetTriple: target.targetTriple,
				format: 'component'
			};
		}
		return {
			wasm: coreWasm,
			targetTriple: target.targetTriple,
			format: target.artifactFormat
		};
	} catch (error) {
		throw formatToolFailure(
			'lld',
			'output-read',
			lldStderr,
			lldStdout,
			error instanceof Error ? error.message : String(error)
		);
	}
}
