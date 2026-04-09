import {
	resolveOcamlManifestUrl,
	resolveOcamlModuleUrl,
	type PlaygroundRuntimeAssets
} from '$lib/playground/assets';
import {
	type CompilerDiagnostic,
	type OcamlBackend,
	type SandboxExecutionOptions
} from '$lib/playground/options';
import type { Sandbox } from '$lib/playground/sandbox';

class Ocaml implements Sandbox {
	output: any = null;
	worker?: Worker = <any>null;
	begin = 0;
	elapse = 0;
	uid = 0;
	exit = true;
	moduleUrl = '';
	manifestUrl = '';
	activeReject: ((reason: string) => void) | null = null;
	oncompilerdiagnostic?: (diagnostic: CompilerDiagnostic) => void;

	load(
		runtimeAssets: string | PlaygroundRuntimeAssets = '',
		_code = '',
		_log = true,
		_args: string[] = [],
		_options: SandboxExecutionOptions = {},
		progress?: { set?: (value: number) => void } | import('svelte/store').Writable<number>
	) {
		return new Promise<void>(async (resolve, reject) => {
			const currentUrl = typeof window !== 'undefined' ? window.location.href : '';
			const nextModuleUrl = resolveOcamlModuleUrl(runtimeAssets, currentUrl);
			const nextManifestUrl = resolveOcamlManifestUrl(runtimeAssets, currentUrl);
			if (!nextModuleUrl || !nextManifestUrl) {
				return reject(
					'OCaml runtime is not configured. Set runtimeAssets.ocaml.moduleUrl and runtimeAssets.ocaml.manifestUrl or sync the bundled wasm-of-js-of-ocaml assets.'
				);
			}
			const needsWorkerReset =
				!this.worker ||
				this.moduleUrl !== nextModuleUrl ||
				this.manifestUrl !== nextManifestUrl;
			this.moduleUrl = nextModuleUrl;
			this.manifestUrl = nextManifestUrl;
			if (needsWorkerReset && this.worker) {
				this.worker.terminate();
				delete this.worker;
			}
			if (!this.worker) {
				this.worker = new (await import('$lib/playground/worker/ocaml?worker')).default();
				this.worker.onerror = (event: ErrorEvent) => {
					const location =
						event.filename && event.lineno
							? ` (${event.filename}:${event.lineno}:${event.colno})`
							: '';
					reject(`OCaml worker script error: ${event.message || 'unknown error'}${location}`);
				};
				this.worker.onmessageerror = () => {
					reject('OCaml worker message deserialization failed');
				};
				this.worker.onmessage = (event: MessageEvent<any>) => {
					if (event.data?.load) {
						progress?.set?.(1);
						resolve();
					}
					if (event.data?.error) reject(event.data.error);
				};
				this.worker.postMessage({
					load: true,
					moduleUrl: this.moduleUrl,
					manifestUrl: this.manifestUrl
				});
			} else {
				progress?.set?.(1);
				resolve();
			}
		});
	}

	write() {}

	eof() {}

	run(
		code: string,
		prepare: boolean,
		_log = true,
		_prog?: { set?: (value: number) => void } | import('svelte/store').Writable<number>,
		_args: string[] = [],
		options: SandboxExecutionOptions = {}
	): Promise<boolean | string> {
		this.exit = false;
		return new Promise<boolean | string>((resolve, reject) => {
			if (!this.worker) return reject('Worker not loaded');
			const target: OcamlBackend = options.ocamlBackend || 'wasm';
			const _uid = ++this.uid;
			this.activeReject = reject;
			const handler = async (event: Event & { data: any }) => {
				if (!this.worker) return reject('Worker not loaded');
				if (_uid !== this.uid) return (this.worker.onmessage = null);
				const { output, results, error, diagnostic, progress, runtime } = event.data;
				if (progress && typeof progress.percent === 'number') {
					_prog?.set?.(Math.max(0, Math.min(progress.percent / 100, 1)));
				}
				if (output) this.output(output);
				if (diagnostic) this.oncompilerdiagnostic?.(diagnostic);
				if (runtime) {
					const createdObjectUrls: string[] = [];
					const originalConsole = window.console;
					const originalFetch = window.fetch.bind(window);
					const originalInstantiate = WebAssembly.instantiate.bind(
						WebAssembly
					) as typeof WebAssembly.instantiate;
					const originalInstantiateStreaming = WebAssembly.instantiateStreaming
						? (WebAssembly.instantiateStreaming.bind(
								WebAssembly
							) as typeof WebAssembly.instantiateStreaming)
						: undefined;
					const runtimePromiseKey = '__wasm_of_js_of_ocaml_runtime_promise';
					const assetResolverKey = '__wasm_of_js_of_ocaml_resolve_asset';
					const runtimeGlobal = window as typeof window & Record<string, unknown>;
					const hadProcess = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'process');
					const hadRequire = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'require');
					const hadModule = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'module');
					const hadExports = Object.prototype.hasOwnProperty.call(runtimeGlobal, 'exports');
					const originalProcess = runtimeGlobal.process;
					const originalRequire = runtimeGlobal.require;
					const originalModule = runtimeGlobal.module;
					const originalExports = runtimeGlobal.exports;
					originalConsole.log(
						`[wasm-idle:ocaml-runtime] start source=${String(runtime.sourcePath || '')} chars=${String(String(runtime.programSource || '').length)} assets=${String(Array.isArray(runtime.assetFiles) ? runtime.assetFiles.length : 0)}`
					);
					const sourceDir = String(runtime.sourcePath || '').replace(/\/[^/]+$/, '');
					const assetEntries = Array.isArray(runtime.assetFiles)
						? runtime.assetFiles.map((assetFile: { path: string; data: Uint8Array }) => {
								const copiedAssetData = new Uint8Array(assetFile.data.byteLength);
								copiedAssetData.set(assetFile.data);
								const objectUrl = URL.createObjectURL(
									new Blob([copiedAssetData], {
										type: assetFile.path.endsWith('.wasm')
											? 'application/wasm'
											: 'application/octet-stream'
									})
								);
								createdObjectUrls.push(objectUrl);
								return {
									path: assetFile.path,
									basename: assetFile.path.split('/').at(-1) || assetFile.path,
									relativeFromSourceDir: assetFile.path.startsWith(`${sourceDir}/`)
										? assetFile.path.slice(sourceDir.length + 1)
										: assetFile.path.replace(/^\/+/, ''),
									objectUrl
								};
							})
						: [];
					const emitOutput = (...args: unknown[]) => {
						const text = args.map((value) => String(value)).join(' ');
						this.output(text.endsWith('\n') ? text : `${text}\n`);
					};
					const resolveAssetUrl = (requestedAsset: string) =>
						assetEntries
							.map((assetEntry) => {
								const candidates = [String(requestedAsset)];
								try {
									candidates.push(new URL(String(requestedAsset), window.location.href).pathname);
								} catch {
									// ignore URL parse errors
								}
								return candidates.some(
									(candidate) =>
										candidate === assetEntry.path ||
										candidate === assetEntry.relativeFromSourceDir ||
										candidate.endsWith(`/${assetEntry.relativeFromSourceDir}`) ||
										candidate.endsWith(`/${assetEntry.basename}`)
								)
									? assetEntry.objectUrl
									: null;
							})
							.find((candidate) => !!candidate) || null;
					window.console = {
						...originalConsole,
						log: (...args: unknown[]) => {
							emitOutput(...args);
							originalConsole.log(...args);
						},
						info: (...args: unknown[]) => {
							emitOutput(...args);
							originalConsole.info(...args);
						},
						warn: (...args: unknown[]) => {
							emitOutput(...args);
							originalConsole.warn(...args);
						},
						error: (...args: unknown[]) => {
							emitOutput(...args);
							originalConsole.error(...args);
						}
					} as Console;
					window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
						const requestUrl =
							typeof input === 'string'
								? input
								: input instanceof URL
									? input.toString()
									: input.url;
						const resolvedAssetUrl = resolveAssetUrl(requestUrl);
						if (resolvedAssetUrl) {
							return await originalFetch(resolvedAssetUrl, init);
						}
						return await originalFetch(input, init);
					}) as typeof fetch;
					WebAssembly.instantiate = (async (
						source: BufferSource | WebAssembly.Module,
						importObject?: WebAssembly.Imports
					) => {
						return await originalInstantiate(source, importObject);
					}) as typeof WebAssembly.instantiate;
					if (originalInstantiateStreaming) {
						WebAssembly.instantiateStreaming = (async (
							source: Response | PromiseLike<Response>,
							importObject?: WebAssembly.Imports
						) => {
							return await originalInstantiateStreaming(source, importObject);
						}) as typeof WebAssembly.instantiateStreaming;
					}
					runtimeGlobal.process = undefined;
					runtimeGlobal.require = undefined;
					runtimeGlobal.module = undefined;
					runtimeGlobal.exports = undefined;
					runtimeGlobal[assetResolverKey] = resolveAssetUrl;
					try {
						const normalizedSource = String(runtime.programSource || '').includes('($=>async a=>{')
							? String(runtime.programSource).replace(
									'($=>async a=>{',
									`globalThis.${runtimePromiseKey}=($=>async a=>{`
								)
							: String(runtime.programSource || '');
						const sourceWithAssetResolver = normalizedSource.replace(
							/function ([A-Za-z$_][\w$]*)\(([A-Za-z$_][\w$]*)\)\{const ([A-Za-z$_][\w$]*)=([A-Za-z$_][\w$]*)\?new URL\(\2,\4\):\2;return fetch\(\3\)\}/,
							`function $1($2){if(globalThis.${assetResolverKey}){const resolvedAsset=globalThis.${assetResolverKey}($2);if(resolvedAsset)return fetch(resolvedAsset)}const $3=$4?new URL($2,$4):$2;return fetch($3)}`
						);
						new Function(
							`${sourceWithAssetResolver}\n//# sourceURL=${String(runtime.sourcePath || 'ocaml-runtime.js')}`
						)();
						originalConsole.log('[wasm-idle:ocaml-runtime] script invoked');
						const runtimePromise = runtimeGlobal[runtimePromiseKey];
						originalConsole.log(
							`[wasm-idle:ocaml-runtime] runtime promise=${String(runtimePromise instanceof Promise)}`
						);
						if (runtimePromise instanceof Promise) {
							await runtimePromise;
						}
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.activeReject = null;
						resolve(true);
					} catch (runtimeError: any) {
						this.elapse = Date.now() - this.begin;
						this.exit = true;
						this.activeReject = null;
						reject(runtimeError?.message || String(runtimeError));
					} finally {
						window.console = originalConsole;
						window.fetch = originalFetch;
						WebAssembly.instantiate = originalInstantiate;
						if (originalInstantiateStreaming) {
							WebAssembly.instantiateStreaming = originalInstantiateStreaming;
						}
						delete runtimeGlobal[runtimePromiseKey];
						delete runtimeGlobal[assetResolverKey];
						if (!hadProcess) {
							delete runtimeGlobal.process;
						} else {
							runtimeGlobal.process = originalProcess;
						}
						if (!hadRequire) {
							delete runtimeGlobal.require;
						} else {
							runtimeGlobal.require = originalRequire;
						}
						if (!hadModule) {
							delete runtimeGlobal.module;
						} else {
							runtimeGlobal.module = originalModule;
						}
						if (!hadExports) {
							delete runtimeGlobal.exports;
						} else {
							runtimeGlobal.exports = originalExports;
						}
						for (const objectUrl of createdObjectUrls) {
							URL.revokeObjectURL(objectUrl);
						}
					}
					return;
				}
				if (results) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					resolve(results as string);
				}
				if (error) {
					this.elapse = Date.now() - this.begin;
					this.exit = true;
					this.activeReject = null;
					reject(error);
				}
			};
			this.worker.onmessage = (event) => {
				void handler(event as Event & { data: any });
			};
			this.begin = Date.now();
			this.worker.postMessage({
				code,
				prepare,
				target,
				log: _log
			});
		});
	}

	kill() {
		this.terminate();
	}

	terminate() {
		this.activeReject?.('Process terminated');
		this.activeReject = null;
		this.uid += 1;
		this.worker?.terminate?.();
		delete this.worker;
		this.exit = true;
	}

	async clear() {
		if (this.worker) this.worker.onmessage = null;
		if (!this.exit) {
			this.terminate();
		}
	}
}

export default Ocaml;
