import type { DebugWorkerInboundMessage, TargetWorkerInitializeMessage } from '../types.js';
import { SharedByteQueue } from '../shared-byte-queue.js';
import {
	createTransportBindings,
	loadEmscriptenModuleFactory,
	mountDebugFiles,
	postWorkerError,
	postWorkerMessage,
	startLinearMemoryTelemetry
} from './module-loader.js';

let activeGeneration: string | undefined;
let disposed = false;
let activeStdin: SharedByteQueue | undefined;
let activeOutputs: SharedByteQueue[] = [];

async function initialize(message: TargetWorkerInitializeMessage) {
	if (activeGeneration) throw new Error('target worker is already initialized');
	activeGeneration = message.generation;
	const transport = createTransportBindings({
		generation: message.generation,
		rspInput: message.rspInput,
		rspOutput: message.rspOutput
	});
	globalThis.__wasmIdleDebugTransport = transport;
	const stdoutQueue = new SharedByteQueue(message.stdout);
	const stderrQueue = new SharedByteQueue(message.stderr);
	activeOutputs = [stdoutQueue, stderrQueue];
	const stdout = (character: number | null) => {
		if (character === null) {
			if (!stdoutQueue.closed) stdoutQueue.close();
			return;
		}
		stdoutQueue.writeBlocking(Uint8Array.of(character));
	};
	const stderr = (character: number | null) => {
		if (character === null) {
			if (!stderrQueue.closed) stderrQueue.close();
			return;
		}
		stderrQueue.writeBlocking(Uint8Array.of(character));
	};
	const stdin = message.stdin ? new SharedByteQueue(message.stdin) : undefined;
	activeStdin = stdin;
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
	const factory = await loadEmscriptenModuleFactory(message.assets.js);
	const module = await factory({
		noInitialRun: true,
		wasmIdleDebugTransport: transport,
		mainScriptUrlOrBlob: message.assets.worker,
		locateFile: (path: string) =>
			path.endsWith('.wasm')
				? message.assets.wasm
				: path.endsWith('.worker.mjs')
					? message.assets.worker
					: new URL(path, message.assets.js).toString(),
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
	mountDebugFiles(module, message.module, message.workspaceFiles);
	const cwd = message.cwd ?? '/workspace';
	module.FS.chdir(cwd);
	const args = message.args ?? [];
	for (const argument of args) {
		if (argument.includes('\0')) {
			throw new Error('WAMR program arguments cannot contain NUL bytes');
		}
	}
	const environmentArgs = Object.entries(message.env ?? {}).map(([key, value]) => {
		if (!key || key.includes('=') || key.includes('\0') || value.includes('\0')) {
			throw new Error(`invalid WAMR environment variable: ${key || '<empty>'}`);
		}
		return `--env=${key}=${value}`;
	});
	const stopMemoryTelemetry = startLinearMemoryTelemetry(module, 'target', message.generation);
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
}

export function handleTargetWorkerMessage(message: DebugWorkerInboundMessage) {
	if (message.type === 'initialize-target') {
		void initialize(message).catch((error) => {
			for (const output of activeOutputs) {
				if (!output.closed) output.close();
			}
			postWorkerError('target', message.generation, error);
		});
		return;
	}
	if (!activeGeneration || message.generation !== activeGeneration) return;
	if (message.type === 'dispose') {
		disposed = true;
		globalThis.__wasmIdleDebugTransport?.rspInput.close();
		globalThis.__wasmIdleDebugTransport?.rspOutput.close();
		globalThis.__wasmIdleDebugTransport = undefined;
		activeStdin?.close();
		activeStdin = undefined;
		for (const output of activeOutputs) {
			if (!output.closed) output.close();
		}
		activeOutputs = [];
	}
}

const workerScope = globalThis as typeof globalThis & {
	addEventListener?: (
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerInboundMessage>) => void
	) => void;
};
workerScope.addEventListener?.('message', (event) => handleTargetWorkerMessage(event.data));
