import atomVmWasmUrl from '../../../../node_modules/@swmansion/popcorn/dist/AtomVM.wasm?url';
import initAtomVm from '../../../../node_modules/@swmansion/popcorn/dist/AtomVM.mjs';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;

const workerDocument = {
	querySelectorAll() {
		return [];
	}
};
const workerHost = {
	document: workerDocument,
	postMessage(message: unknown) {
		postMessage(message);
	}
};
const popcornBrowserGlobal = ['globalThis', 'window'].join('.');
const popcornParentGlobal = [popcornBrowserGlobal, 'parent'].join('.');
const workerHostGlobal = 'globalThis.__wasmIdleElixirWorkerHost';

self.document = workerDocument;
(globalThis as any).__wasmIdleElixirWorkerHost = workerHost;

class TrackedValue {
	key: number;
	value: unknown;

	constructor({ key, value }: { key: number; value: unknown }) {
		if (typeof key !== 'number') {
			throw new Error('key property in TrackedValue must be a number');
		}
		this.key = key;
		this.value = value;
	}
}

(globalThis as any).TrackedValue = TrackedValue;

type AtomVmModule = {
	FS: {
		mkdir(path: string): void;
		writeFile(path: string, data: Int8Array): void;
	};
	call(process: string, args: unknown): Promise<string>;
	cast(process: string, args: unknown): void;
	serialize: (value: unknown) => string;
	deserialize: (value: string) => unknown;
	cleanupFunctions: Map<number, (() => void) | undefined>;
	onAbort?: () => void;
	onElixirReady?: ((process: string | null) => void) | null;
	onGetTrackedObjects?: (keys: number[]) => string[];
	onRunTrackedJs?: (scriptString: string, isDebug: boolean) => number[] | null;
	onTrackedObjectDelete?: (key: number) => void;
	sendEvent?: (eventName: string, payload: unknown) => void;
	trackedObjectsMap: Map<number, unknown>;
	nextTrackedObjectKey: () => number;
};

let bundleUrl = '';
let loadedBundleUrl = '';
let runtimePromise: Promise<{ module: AtomVmModule; process: string | null }> | null = null;
let stdinBufferElixir: Int32Array | null = null;
const elixirStdinCallNames = [
	'IO.gets',
	'IO.read',
	'IO.binread',
	'IO.getn',
	':io.get_line',
	':io.get_chars'
] as const;

function skipQuotedLiteral(source: string, start: number) {
	const heredoc = source.slice(start, start + 3);
	if (heredoc === '"""' || heredoc === "'''") {
		const end = source.indexOf(heredoc, start + 3);
		return end === -1 ? source.length : end + 3;
	}
	const quote = source[start];
	let index = start + 1;
	while (index < source.length) {
		if (source[index] === '\\') {
			index += 2;
			continue;
		}
		if (source[index] === quote) {
			return index + 1;
		}
		index += 1;
	}
	return source.length;
}

function findClosingParen(source: string, openParenIndex: number) {
	let depth = 1;
	let index = openParenIndex + 1;
	while (index < source.length) {
		const current = source[index];
		if (current === '"' || current === "'") {
			index = skipQuotedLiteral(source, index);
			continue;
		}
		if (current === '#') {
			const newlineIndex = source.indexOf('\n', index);
			if (newlineIndex === -1) {
				return -1;
			}
			index = newlineIndex + 1;
			continue;
		}
		if (current === '(') {
			depth += 1;
		} else if (current === ')') {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
		index += 1;
	}
	return -1;
}

function splitTopLevelArgs(source: string) {
	const parts: string[] = [];
	let start = 0;
	let parenDepth = 0;
	let braceDepth = 0;
	let bracketDepth = 0;
	let index = 0;
	while (index < source.length) {
		const current = source[index];
		if (current === '"' || current === "'") {
			index = skipQuotedLiteral(source, index);
			continue;
		}
		if (current === '#') {
			const newlineIndex = source.indexOf('\n', index);
			if (newlineIndex === -1) break;
			index = newlineIndex + 1;
			continue;
		}
		if (current === '(') parenDepth += 1;
		if (current === ')') parenDepth -= 1;
		if (current === '{') braceDepth += 1;
		if (current === '}') braceDepth -= 1;
		if (current === '[') bracketDepth += 1;
		if (current === ']') bracketDepth -= 1;
		if (current === ',' && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
			parts.push(source.slice(start, index).trim());
			start = index + 1;
		}
		index += 1;
	}
	const trailing = source.slice(start).trim();
	if (trailing) {
		parts.push(trailing);
	}
	return parts;
}

function parseLiteralCount(source: string) {
	const normalized = source.trim().replaceAll('_', '');
	if (/^\d+$/.test(normalized)) {
		const parsed = Number.parseInt(normalized, 10);
		if (Number.isSafeInteger(parsed)) {
			return parsed;
		}
	}
	return null;
}

function deserialize(module: AtomVmModule, message: string) {
	return JSON.parse(message, (_key, value) => {
		const isRef =
			typeof value === 'object' &&
			value !== null &&
			Object.hasOwn(value, 'popcorn_ref') &&
			Object.getOwnPropertyNames(value).length === 1;
		if (!isRef) {
			return value;
		}
		return module.trackedObjectsMap.get((value as { popcorn_ref: number }).popcorn_ref);
	});
}

function ensureFunctionEval(maybeFunction: unknown) {
	if (typeof maybeFunction !== 'function') {
		throw new Error('Script passed to onRunTrackedJs() is not wrapped in a function');
	}
}

function ensureResultKeyList(result: unknown) {
	if (!Array.isArray(result) && result !== undefined) {
		throw new Error(
			'Script passed to onRunTrackedJs() returned invalid value, accepted values are arrays and undefined'
		);
	}
}

function configureTrackedObjectBridge(
	module: AtomVmModule,
	resolveReadyProcess: (process: string | null) => void
) {
	let appReadyProcess: string | null | undefined;
	let elixirReady = false;
	module.serialize = JSON.stringify;
	module.deserialize = (message: string) => deserialize(module, message);
	module.cleanupFunctions = new Map();
	module.sendEvent = (eventName, payload) => {
		if (eventName === 'popcorn_app_ready') {
			const readyPayload =
				typeof payload === 'object' && payload !== null && Object.hasOwn(payload, 'name')
					? (payload as { name: unknown }).name
					: payload;
			appReadyProcess =
				readyPayload === null || readyPayload === undefined ? null : String(readyPayload);
			if (elixirReady) {
				resolveReadyProcess(appReadyProcess);
			}
			return;
		}
		if (eventName === 'popcorn_elixir_ready') {
			elixirReady = true;
			if (appReadyProcess !== undefined) {
				resolveReadyProcess(appReadyProcess);
			}
		}
	};
	module.onElixirReady = (process) => {
		module.onElixirReady = null;
		resolveReadyProcess(process);
	};
	module.onTrackedObjectDelete = (key) => {
		const cleanup = module.cleanupFunctions.get(key);
		module.cleanupFunctions.delete(key);
		try {
			cleanup?.();
		} catch (error) {
			console.error(error);
		} finally {
			module.trackedObjectsMap.delete(key);
		}
	};
	module.onRunTrackedJs = (scriptString, isDebug) => {
		const trackValue = (tracked: unknown) => {
			if (tracked instanceof TrackedValue) {
				module.trackedObjectsMap.set(tracked.key, tracked.value);
				return tracked.key;
			}
			const key = module.nextTrackedObjectKey();
			module.trackedObjectsMap.set(key, tracked);
			return key;
		};
		let fn;
		try {
			const indirectEval = globalThis.eval;
			const workerScript = scriptString
				.replaceAll(`${popcornParentGlobal}.document`, `${workerHostGlobal}.document`)
				.replaceAll(popcornParentGlobal, workerHostGlobal)
				.replaceAll(popcornBrowserGlobal, workerHostGlobal);
			fn = indirectEval(workerScript);
		} catch (error) {
			console.error(error);
			return null;
		}
		if (isDebug) {
			ensureFunctionEval(fn);
		}
		let result;
		try {
			result = fn?.(module);
		} catch (error) {
			console.error(error);
			return null;
		}
		if (isDebug) {
			ensureResultKeyList(result);
		}
		return result?.map(trackValue) ?? [];
	};
	module.onGetTrackedObjects = (keys) =>
		keys.map((key) => module.serialize(module.trackedObjectsMap.get(key)));
}

function configureMessagingBridge(module: AtomVmModule) {
	const originalCast = module.cast.bind(module);
	const originalCall = module.call.bind(module);
	module.cast = (process, args) => {
		originalCast(process, module.serialize(args));
	};
	module.call = (process, args) => originalCall(process, module.serialize(args));
}

async function startVm(avmBundle: Int8Array, log: boolean) {
	let resolveProcess: ((process: string | null) => void) | null = null;
	const processPromise = new Promise<string | null>((resolve, reject) => {
		const timeout = setTimeout(() => {
			resolveProcess = null;
			reject(new Error('Elixir runtime did not become ready'));
		}, 30_000);
		resolveProcess = (process) => {
			clearTimeout(timeout);
			resolveProcess = null;
			resolve(process);
		};
	});
	const module = (await initAtomVm({
		locateFile(path: string) {
			if (path === 'AtomVM.wasm') {
				return atomVmWasmUrl;
			}
			return path;
		},
		preRun: [
			({ FS }: AtomVmModule) => {
				FS.mkdir('/data');
				FS.writeFile('/data/bundle.avm', avmBundle);
			}
		],
		arguments: ['/data/bundle.avm'],
		print(text: string) {
			postMessage({ output: text });
		},
		printErr(text: string) {
			postMessage({ output: text });
		},
		onAbort() {
			if (log) {
				console.error('[wasm-idle:elixir-worker] AtomVM aborted');
			}
			setTimeout(() => postMessage({ error: 'Elixir runtime aborted' }), 100);
		}
	})) as AtomVmModule;
	configureTrackedObjectBridge(module, (process) => resolveProcess?.(process));
	configureMessagingBridge(module);
	return {
		module,
		process: await processPromise
	};
}

async function loadRuntime(nextBundleUrl: string, log: boolean) {
	if (!nextBundleUrl) {
		throw new Error(
			'Elixir runtime is not configured. Set PUBLIC_WASM_ELIXIR_BUNDLE_URL or runtimeAssets.elixir.bundleUrl.'
		);
	}
	if (loadedBundleUrl === nextBundleUrl && runtimePromise) {
		return await runtimePromise;
	}
	loadedBundleUrl = nextBundleUrl;
	runtimePromise = (async () => {
		if (log) {
			console.log(`[wasm-idle:elixir-worker] load bundleUrl=${nextBundleUrl}`);
		}
		const bundleBuffer = await fetch(nextBundleUrl).then((response) => {
			if (!response.ok) {
				throw new Error(
					`Failed to fetch Elixir bundle: ${response.status} ${response.statusText}`
				);
			}
			return response.arrayBuffer();
		});
		return await startVm(new Int8Array(bundleBuffer), log);
	})();
	return await runtimePromise;
}

function normalizeCallError(module: AtomVmModule, error: unknown) {
	if (error === 'noproc') {
		runtimePromise = null;
		loadedBundleUrl = '';
		return 'Elixir runtime process is unavailable';
	}
	if (typeof error === 'string') {
		try {
			const value = module.deserialize(error);
			return typeof value === 'string' ? value : JSON.stringify(value);
		} catch {
			return error;
		}
	}
	if (error instanceof Error) {
		return error.message;
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

self.onmessage = async (event: { data: any }) => {
	const { load, bundleUrl: nextBundleUrl, buffer, code, prepare, log = true } = event.data;
	try {
		if (load) {
			bundleUrl = nextBundleUrl;
			await loadRuntime(bundleUrl, log);
			postMessage({ load: true });
			return;
		}

		if (!bundleUrl) {
			throw new Error('Elixir runtime not loaded');
		}
		stdinBufferElixir = buffer ? new Int32Array(buffer) : null;
		if (prepare) {
			postMessage({ results: true });
			return;
		}

		const runtime = await loadRuntime(bundleUrl, log);
		if (!runtime.process) {
			throw new Error('Elixir runtime did not expose a default process');
		}
		if (log) {
			console.log(`[wasm-idle:elixir-worker] eval bytes=${code.length}`);
		}
		let evalCode = code;
		if (stdinBufferElixir && /(?:\bIO\.|\:io\.)/.test(code)) {
			let bufferedInput = '';
			let reachedEof = false;
			const pullStdinChunk = () => {
				if (reachedEof) return false;
				const nextChunk = waitForBufferedStdin(stdinBufferElixir, () =>
					postMessage({ buffer: true })
				);
				if (nextChunk === null) {
					reachedEof = true;
					return false;
				}
				bufferedInput += nextChunk;
				return true;
			};
			const readLineLiteral = (eofLiteral: 'nil' | ':eof') => {
				while (true) {
					const newlineIndex = bufferedInput.indexOf('\n');
					if (newlineIndex !== -1) {
						const line = bufferedInput.slice(0, newlineIndex + 1);
						bufferedInput = bufferedInput.slice(newlineIndex + 1);
						return JSON.stringify(line);
					}
					if (!pullStdinChunk()) {
						if (!bufferedInput) {
							return eofLiteral;
						}
						const remainder = bufferedInput;
						bufferedInput = '';
						return JSON.stringify(remainder);
					}
				}
			};
			const readCountLiteral = (count: number, eofLiteral: ':eof') => {
				if (count === 0) {
					return JSON.stringify('');
				}
				while (bufferedInput.length < count && pullStdinChunk()) {
					// Keep requesting chunks until the requested count or EOF is available.
				}
				if (!bufferedInput) {
					return eofLiteral;
				}
				const consumed = bufferedInput.slice(0, Math.min(count, bufferedInput.length));
				bufferedInput = bufferedInput.slice(consumed.length);
				return JSON.stringify(consumed);
			};
			const readAllLiteral = (eofLiteral: ':eof') => {
				while (pullStdinChunk()) {
					// Drain stdin until EOF for :all reads.
				}
				if (!bufferedInput) {
					return eofLiteral;
				}
				const consumed = bufferedInput;
				bufferedInput = '';
				return JSON.stringify(consumed);
			};
			const wrapWithDeviceEvaluation = (deviceArg: string | undefined, valueExpr: string) =>
				deviceArg
					? `((fn __wasm_idle_device__ -> _ = __wasm_idle_device__; ${valueExpr} end).(${deviceArg}))`
					: valueExpr;
			const wrapWithPromptOutput = (
				promptArg: string,
				valueExpr: string,
				deviceArg?: string
			) =>
				deviceArg
					? `((fn __wasm_idle_device__, __wasm_idle_prompt__ -> _ = __wasm_idle_device__; IO.write(__wasm_idle_prompt__); ${valueExpr} end).(${deviceArg}, ${promptArg}))`
					: `((fn __wasm_idle_prompt__ -> IO.write(__wasm_idle_prompt__); ${valueExpr} end).(${promptArg}))`;
			let rewritten = '';
			let cursor = 0;
			while (cursor < code.length) {
				const current = code[cursor];
				if (current === '"' || current === "'") {
					const nextCursor = skipQuotedLiteral(code, cursor);
					rewritten += code.slice(cursor, nextCursor);
					cursor = nextCursor;
					continue;
				}
				if (current === '#') {
					const newlineIndex = code.indexOf('\n', cursor);
					if (newlineIndex === -1) {
						rewritten += code.slice(cursor);
						break;
					}
					rewritten += code.slice(cursor, newlineIndex + 1);
					cursor = newlineIndex + 1;
					continue;
				}
				const callName = elixirStdinCallNames.find((candidate) => {
					if (!code.startsWith(candidate, cursor)) {
						return false;
					}
					const previous = code[cursor - 1] || '';
					return !/[A-Za-z0-9_:.?!]/.test(previous);
				});
				if (!callName) {
					rewritten += current;
					cursor += 1;
					continue;
				}
				let openParenIndex = cursor + callName.length;
				while (/\s/.test(code[openParenIndex] || '')) {
					openParenIndex += 1;
				}
				if (code[openParenIndex] !== '(') {
					rewritten += current;
					cursor += 1;
					continue;
				}
				const closeParenIndex = findClosingParen(code, openParenIndex);
				if (closeParenIndex === -1) {
					rewritten += code.slice(cursor);
					break;
				}
				const originalCall = code.slice(cursor, closeParenIndex + 1);
				const args = splitTopLevelArgs(code.slice(openParenIndex + 1, closeParenIndex));
				let replacement = originalCall;
				if (callName === 'IO.gets' && (args.length === 1 || args.length === 2)) {
					replacement =
						args.length === 2
							? wrapWithPromptOutput(args[1], readLineLiteral('nil'), args[0])
							: wrapWithPromptOutput(args[0], readLineLiteral('nil'));
				} else if (
					(callName === 'IO.read' || callName === 'IO.binread') &&
					(args.length === 1 || args.length === 2)
				) {
					const deviceArg = args.length === 2 ? args[0] : undefined;
					const modeArg = args[args.length - 1];
					if (modeArg === ':line') {
						replacement = wrapWithDeviceEvaluation(deviceArg, readLineLiteral(':eof'));
					} else if (modeArg === ':all') {
						replacement = wrapWithDeviceEvaluation(deviceArg, readAllLiteral(':eof'));
					} else {
						const count = parseLiteralCount(modeArg);
						if (count === null) {
							throw new Error(
								`${callName} stdin bridge requires a literal non-negative count`
							);
						}
						replacement = wrapWithDeviceEvaluation(
							deviceArg,
							readCountLiteral(count, ':eof')
						);
					}
				} else if (callName === 'IO.getn' && (args.length === 2 || args.length === 3)) {
					const count = parseLiteralCount(args[args.length - 1]);
					if (count === null) {
						throw new Error('IO.getn stdin bridge requires a literal non-negative count');
					}
					replacement =
						args.length === 3
							? wrapWithPromptOutput(args[1], readCountLiteral(count, ':eof'), args[0])
							: wrapWithPromptOutput(args[0], readCountLiteral(count, ':eof'));
				} else if (callName === ':io.get_line' && (args.length === 1 || args.length === 2)) {
					replacement =
						args.length === 2
							? wrapWithPromptOutput(args[1], readLineLiteral(':eof'), args[0])
							: wrapWithPromptOutput(args[0], readLineLiteral(':eof'));
				} else if (
					callName === ':io.get_chars' &&
					(args.length === 2 || args.length === 3)
				) {
					const count = parseLiteralCount(args[args.length - 1]);
					if (count === null) {
						throw new Error(
							':io.get_chars stdin bridge requires a literal non-negative count'
						);
					}
					replacement =
						args.length === 3
							? wrapWithPromptOutput(args[1], readCountLiteral(count, ':eof'), args[0])
							: wrapWithPromptOutput(args[0], readCountLiteral(count, ':eof'));
				}
				rewritten += replacement;
				cursor = closeParenIndex + 1;
			}
			evalCode = rewritten;
		}
		const response = await runtime.module.call(runtime.process, ['eval_elixir', evalCode]);
		const rendered = runtime.module.deserialize(response);
		if (typeof rendered === 'string') {
			postMessage({ results: rendered });
			return;
		}
		if (rendered === undefined) {
			postMessage({ results: true });
			return;
		}
		postMessage({ results: JSON.stringify(rendered) });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:elixir-worker] failed', error);
		}
		if (runtimePromise) {
			try {
				const runtime = await runtimePromise;
				postMessage({ error: normalizeCallError(runtime.module, error) });
				return;
			} catch {
				// Ignore secondary runtime load errors and surface the original failure instead.
			}
		}
		postMessage({
			error: error instanceof Error ? error.message : String(error)
		});
	}
};
