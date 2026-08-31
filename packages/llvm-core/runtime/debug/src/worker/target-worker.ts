import type { DebugWorkerInboundMessage, TargetWorkerInitializeMessage } from '../types.js';
import { assertDistinctSharedByteQueueBuffers, SharedByteQueue } from '../shared-byte-queue.js';
import { validateWamrDebugModule } from '../wasm-module-preflight.js';
import {
	createEmscriptenAssetUrls,
	createTransportBindings,
	loadEmscriptenModuleFactory,
	mountDebugFiles,
	postWorkerError,
	postWorkerMessage,
	startLinearMemoryTelemetry,
	validateDebugSessionGeneration
} from './module-loader.js';

let activeGeneration: string | undefined;
let disposed = false;
let activeStdin: SharedByteQueue | undefined;
let activeOutputs: SharedByteQueue[] = [];
let revokeActiveAssetUrls: (() => void) | undefined;

function revokeActiveTargetAssets() {
	const revoke = revokeActiveAssetUrls;
	revokeActiveAssetUrls = undefined;
	try {
		revoke?.();
	} catch {
		// Blob cleanup must not prevent transport shutdown or worker termination.
	}
}

function closeQueue(queue: SharedByteQueue | undefined) {
	if (!queue) return;
	try {
		if (!queue.closed) queue.close();
	} catch {
		// A stale queue must not prevent the worker from closing its other transports.
	}
}

function closeActiveTargetTransports() {
	closeQueue(globalThis.__wasmIdleDebugTransport?.rspInput);
	closeQueue(globalThis.__wasmIdleDebugTransport?.rspOutput);
	globalThis.__wasmIdleDebugTransport = undefined;
	closeQueue(activeStdin);
	activeStdin = undefined;
	for (const output of activeOutputs) closeQueue(output);
	activeOutputs = [];
}

async function initialize(message: TargetWorkerInitializeMessage) {
	validateDebugSessionGeneration(message.generation);
	if (activeGeneration) throw new Error('target worker is already initialized');
	validateWamrDebugModule(message.module);
	const cwdValue: unknown = message.cwd;
	if (cwdValue !== undefined && cwdValue !== '/workspace') {
		throw new RangeError('WAMR working directory must be /workspace');
	}
	const cwd = '/workspace';
	const argsValue: unknown = message.args;
	if (argsValue !== undefined && !Array.isArray(argsValue)) {
		throw new TypeError('WAMR program arguments must be an array');
	}
	const args = [...(argsValue ?? [])];
	for (const argument of args) {
		if (typeof argument !== 'string') {
			throw new TypeError('WAMR program arguments must be strings');
		}
		if (argument.includes('\0')) {
			throw new Error('WAMR program arguments cannot contain NUL bytes');
		}
	}
	const envValue: unknown = message.env;
	if (
		envValue !== undefined &&
		(typeof envValue !== 'object' || envValue === null || Array.isArray(envValue))
	) {
		throw new TypeError('WAMR environment must be an object');
	}
	const environmentArgs = Object.entries(envValue ?? {}).map(([key, value]) => {
		if (
			!key ||
			key.includes('=') ||
			key.includes('\0') ||
			typeof value !== 'string' ||
			value.includes('\0')
		) {
			throw new Error(`invalid WAMR environment variable: ${key || '<empty>'}`);
		}
		return `--env=${key}=${value}`;
	});
	const transport = createTransportBindings({
		generation: message.generation,
		rspInput: message.rspInput,
		rspOutput: message.rspOutput
	});
	const stdoutQueue = new SharedByteQueue(message.stdout);
	const stderrQueue = new SharedByteQueue(message.stderr);
	const stdin = message.stdin ? new SharedByteQueue(message.stdin) : undefined;
	assertDistinctSharedByteQueueBuffers(
		[
			transport.rspInput,
			transport.rspOutput,
			stdoutQueue,
			stderrQueue,
			...(stdin ? [stdin] : [])
		],
		'target debug channels must not reuse shared buffers'
	);
	activeGeneration = message.generation;
	globalThis.__wasmIdleDebugTransport = transport;
	activeOutputs = [stdoutQueue, stderrQueue];
	activeStdin = stdin;
	const stdout = (character: number | null) => {
		if (character === null) {
			closeQueue(stdoutQueue);
			return;
		}
		stdoutQueue.writeBlocking(Uint8Array.of(character));
	};
	const stderr = (character: number | null) => {
		if (character === null) {
			closeQueue(stderrQueue);
			return;
		}
		stderrQueue.writeBlocking(Uint8Array.of(character));
	};
	const inputByte = new Uint8Array(1);
	let resolveLifecycle!: () => void;
	let rejectLifecycle!: (error: Error) => void;
	const lifecycle = new Promise<void>((resolve, reject) => {
		resolveLifecycle = resolve;
		rejectLifecycle = reject;
	});
	let lifecycleSettled = false;
	const rejectTarget = (error: Error) => {
		if (lifecycleSettled) return;
		lifecycleSettled = true;
		stdout(null);
		stderr(null);
		rejectLifecycle(error);
	};
	const assetUrls = createEmscriptenAssetUrls(message.assets);
	let assetUrlsRevoked = false;
	const revokeAssetUrls = () => {
		if (assetUrlsRevoked) return;
		assetUrlsRevoked = true;
		assetUrls.revoke();
	};
	revokeActiveAssetUrls = revokeAssetUrls;
	try {
		const factory = await loadEmscriptenModuleFactory(assetUrls.js);
		if (disposed) return;
		const module = await factory({
			noInitialRun: true,
			wasmIdleDebugTransport: transport,
			mainScriptUrlOrBlob: assetUrls.worker,
			locateFile: (path: string) => {
				if (path.endsWith('.wasm')) return assetUrls.wasm;
				if (path.endsWith('.worker.mjs')) return assetUrls.worker;
				throw new Error(`WAMR requested an unverified runtime asset: ${path}`);
			},
			stdin: () => {
				if (!stdin) return null;
				const length = stdin.readBlocking(inputByte);
				return length === 0 ? null : inputByte[0];
			},
			stdout,
			stderr,
			onExit: (exitCode: unknown) => {
				if (lifecycleSettled) return;
				if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)) {
					rejectTarget(new Error('WAMR exited without a valid integer exit code'));
					return;
				}
				lifecycleSettled = true;
				stdout(null);
				stderr(null);
				if (!disposed) {
					postWorkerMessage({
						type: 'exit',
						exitCode,
						generation: message.generation
					});
				}
				resolveLifecycle();
			},
			onAbort: (reason: unknown) => {
				rejectTarget(new Error(`WAMR aborted: ${String(reason)}`));
			}
		});
		if (disposed) return;
		mountDebugFiles(module, message.module, message.workspaceFiles);
		module.FS.chdir(cwd);
		const stopMemoryTelemetry = startLinearMemoryTelemetry(
			module,
			'target',
			message.generation
		);
		try {
			postWorkerMessage({
				type: 'ready',
				worker: 'target',
				generation: message.generation
			});
			void Promise.resolve(
				module.callMain([
					...environmentArgs,
					'-v=0',
					'--heap-size=1048576',
					`--dir=${cwd}`,
					'-g=wasm-messageport:1',
					'/workspace/program.wasm',
					...args
				])
			).catch((error) =>
				rejectTarget(error instanceof Error ? error : new Error('WAMR main failed'))
			);
			await lifecycle;
		} finally {
			stopMemoryTelemetry();
		}
	} finally {
		if (revokeActiveAssetUrls === revokeAssetUrls) revokeActiveAssetUrls = undefined;
		revokeAssetUrls();
	}
}

export function handleTargetWorkerMessage(message: DebugWorkerInboundMessage) {
	if (message.type === 'initialize-target') {
		if (activeGeneration) {
			if (message.generation !== activeGeneration) {
				postWorkerError(
					'target',
					message.generation,
					new Error('target worker is already initialized')
				);
			}
			return;
		}
		void initialize(message).catch((error) => {
			closeActiveTargetTransports();
			if (activeGeneration === message.generation) activeGeneration = undefined;
			postWorkerError('target', message.generation, error);
		});
		return;
	}
	if (!activeGeneration || message.generation !== activeGeneration) return;
	if (message.type === 'dispose') {
		disposed = true;
		revokeActiveTargetAssets();
		closeActiveTargetTransports();
	}
}

const workerScope = globalThis as typeof globalThis & {
	addEventListener?: (
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerInboundMessage>) => void
	) => void;
};
workerScope.addEventListener?.('message', (event) => handleTargetWorkerMessage(event.data));
