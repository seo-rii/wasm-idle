import type { DebugWorkerInboundMessage, LldbWorkerInitializeMessage } from '../types.js';
import {
	createByteOutput,
	createTransportBindings,
	loadEmscriptenModuleFactory,
	mountDebugFiles,
	postWorkerError,
	postWorkerMessage,
	startLinearMemoryTelemetry
} from './module-loader.js';

let activeGeneration: string | undefined;
let disposed = false;
let finishActiveLifecycle: (() => void) | undefined;

async function initialize(message: LldbWorkerInitializeMessage) {
	if (activeGeneration) throw new Error('LLDB worker is already initialized');
	activeGeneration = message.generation;
	let lifecycleSettled = false;
	let resolveLifecycle!: () => void;
	let rejectLifecycle!: (error: Error) => void;
	const lifecycle = new Promise<void>((resolve, reject) => {
		resolveLifecycle = resolve;
		rejectLifecycle = reject;
	});
	const finishLifecycle = () => {
		if (lifecycleSettled) return;
		lifecycleSettled = true;
		resolveLifecycle();
	};
	const failLifecycle = (error: Error) => {
		if (lifecycleSettled) return;
		lifecycleSettled = true;
		rejectLifecycle(error);
	};
	finishActiveLifecycle = finishLifecycle;
	const transport = createTransportBindings({
		generation: message.generation,
		rspInput: message.rspInput,
		rspOutput: message.rspOutput,
		dapInput: message.dapInput,
		dapOutput: message.dapOutput
	});
	globalThis.__wasmIdleDebugTransport = transport;
	const connectionBase =
		Array.from(message.generation).reduce(
			(hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619),
			2_166_136_261
		) & 0x1fffffff;
	const registry = {
		protocol: 'shared-ring-v1' as const,
		sessions: {
			[message.generation]: {
				dap: {
					connectionId: connectionBase * 2 + 1,
					rx: message.dapInput,
					tx: message.dapOutput
				},
				rsp: {
					connectionId: connectionBase * 2 + 2,
					rx: message.rspInput,
					tx: message.rspOutput
				}
			}
		}
	};
	globalThis.wasmLldbSharedRingV1 = registry;
	const emitOutput = (channel: 'stdout' | 'stderr') =>
		createByteOutput((data) =>
			postWorkerMessage({
				type: 'output',
				channel,
				data,
				generation: message.generation
			})
		);
	const factory = await loadEmscriptenModuleFactory(message.assets.js);
	const module = await factory({
		noInitialRun: true,
		wasmLldbSharedRingV1: registry,
		mainScriptUrlOrBlob: message.assets.worker,
		locateFile: (path: string) =>
			path.endsWith('.wasm')
				? message.assets.wasm
				: path.endsWith('.pthread.mjs')
					? message.assets.worker
					: new URL(path, message.assets.js).toString(),
		stdout: emitOutput('stdout'),
		stderr: emitOutput('stderr'),
		onAbort: (reason: unknown) => {
			if (!disposed) failLifecycle(new Error(`LLDB aborted: ${String(reason)}`));
		},
		onExit: (exitCode: unknown) => {
			if (disposed) {
				finishLifecycle();
				return;
			}
			const suffix =
				typeof exitCode === 'number' && Number.isSafeInteger(exitCode)
					? ` (exit code ${exitCode})`
					: '';
			failLifecycle(new Error(`LLDB debug adapter exited unexpectedly${suffix}`));
		}
	});
	mountDebugFiles(module, message.module, message.sources);
	const stopMemoryTelemetry = startLinearMemoryTelemetry(module, 'lldb', message.generation);
	try {
		postWorkerMessage({
			type: 'ready',
			worker: 'lldb',
			generation: message.generation
		});
		await module.callMain([message.generation]);
		await lifecycle;
	} finally {
		stopMemoryTelemetry();
		if (finishActiveLifecycle === finishLifecycle) finishActiveLifecycle = undefined;
	}
}

export function handleLldbWorkerMessage(message: DebugWorkerInboundMessage) {
	if (message.type === 'initialize-lldb') {
		void initialize(message).catch((error) =>
			postWorkerError('lldb', message.generation, error)
		);
		return;
	}
	if (!activeGeneration || message.generation !== activeGeneration) return;
	if (message.type === 'dispose') {
		disposed = true;
		finishActiveLifecycle?.();
		finishActiveLifecycle = undefined;
		globalThis.__wasmIdleDebugTransport?.dapInput?.close();
		globalThis.__wasmIdleDebugTransport?.dapOutput?.close();
		globalThis.__wasmIdleDebugTransport?.rspInput.close();
		globalThis.__wasmIdleDebugTransport?.rspOutput.close();
		globalThis.__wasmIdleDebugTransport = undefined;
		globalThis.wasmLldbSharedRingV1 = undefined;
	}
}

const workerScope = globalThis as typeof globalThis & {
	addEventListener?: (
		type: 'message',
		listener: (event: MessageEvent<DebugWorkerInboundMessage>) => void
	) => void;
};
workerScope.addEventListener?.('message', (event) => handleLldbWorkerMessage(event.data));
