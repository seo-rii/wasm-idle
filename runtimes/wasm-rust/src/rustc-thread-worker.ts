import { resolveVersionedAssetUrl } from './asset-url.js';
import { createModuleWorker } from './module-worker.js';
import type {
	RustcThreadPoolInitRequest,
	RustcThreadWorkerLogMessage,
	RustcThreadWorkerReadyMessage,
	RustcThreadWorkerRequest
} from './worker-protocol.js';
import { buildPreopenedDirectories, instantiateRustcInstance } from './rustc-runtime.js';
import { markWorkerFailure, recordWorkerFailureContext } from './worker-status.js';
import {
	dispatchThreadPoolSlotAndWait,
	reserveIdleThreadPoolSlot,
	THREAD_STARTUP_STATE_ENTERING,
	THREAD_STARTUP_STATE_INSTANTIATED,
	THREAD_STARTUP_STATE_STARTING,
	waitForThreadStartupState
} from './thread-startup.js';

const MIRRORED_BITCODE_LENGTH_INDEX = 0;

postMessage({
	type: 'thread-ready'
} satisfies RustcThreadWorkerReadyMessage);

function describeStartArgMemory(memory: WebAssembly.Memory, startArg: number) {
	try {
		const words = Array.from(new Uint32Array(memory.buffer, startArg, 4));
		return `startArg=${startArg} words=${words.join(',')}`;
	} catch (error) {
		return `startArg=${startArg} snapshot-error=${error instanceof Error ? error.message : String(error)}`;
	}
}

async function instantiateThreadWorkerRuntime(
	request: RustcThreadWorkerRequest | RustcThreadPoolInitRequest
) {
	const { fds } = await buildPreopenedDirectories(
		request.manifest,
		request.sysrootAssets,
		request.sourceCode,
		request.sharedBitcodeBuffer
	);
	if (request.log) {
		postMessage({
			type: 'thread-log',
			threadId: request.type === 'thread-start' ? request.threadId : request.slotIndex,
			phase: 'preopens-ready'
		} satisfies RustcThreadWorkerLogMessage);
	}
	return instantiateRustcInstance({
		rustcModule: request.rustcModule,
		memory: request.memory,
		args: request.args,
		fds,
		threadSpawner: (startArg) => {
			const threadCounter = new Int32Array(request.threadCounterBuffer);
			const nestedThreadId = Atomics.add(threadCounter, 0, 1) + 1;
			const spawnDedicatedWorker = () => {
				if (request.log) {
					postMessage({
						type: 'thread-log',
						threadId: nestedThreadId,
						phase: 'spawn-dedicated',
						detail:
							request.type === 'thread-start'
								? `parent=${request.threadId} startArg=${startArg}`
								: `parentSlot=${request.slotIndex} startArg=${startArg}`
					} satisfies RustcThreadWorkerLogMessage);
				}
				const nestedReadyBuffer = new SharedArrayBuffer(4);
				const nestedReadyState = new Int32Array(nestedReadyBuffer);
				const nestedThreadWorkerUrl = resolveVersionedAssetUrl(
					import.meta.url,
					'./rustc-thread-worker.js'
				);
				if (request.log) {
					nestedThreadWorkerUrl.searchParams.set('log', '1');
				}
				const nestedWorker = createModuleWorker(nestedThreadWorkerUrl);
				const markNestedStartupFailure = () => {
					if (Atomics.load(nestedReadyState, 0) < 0) {
						return;
					}
					Atomics.store(nestedReadyState, 0, -1);
					Atomics.notify(nestedReadyState, 0);
				};
				nestedWorker.addEventListener('error', markNestedStartupFailure);
				nestedWorker.addEventListener('messageerror', markNestedStartupFailure);
				nestedWorker.postMessage({
					type: 'thread-start',
					runtimeBaseUrl: request.runtimeBaseUrl,
					manifest: request.manifest,
					sourceCode: request.sourceCode,
					log: request.log,
					sharedBitcodeBuffer: request.sharedBitcodeBuffer,
					sharedStatusBuffer: request.sharedStatusBuffer,
					threadCounterBuffer: request.threadCounterBuffer,
					sysrootAssets: request.sysrootAssets,
					rustcModule: request.rustcModule,
					memory: request.memory,
					args: request.args,
					threadId: nestedThreadId,
					startArg,
					readyBuffer: nestedReadyBuffer
				} satisfies RustcThreadWorkerRequest);
				waitForThreadStartupState(
					nestedReadyState,
					THREAD_STARTUP_STATE_INSTANTIATED,
					30_000,
					`rustc dedicated helper thread ${nestedThreadId} failed to initialize`,
					`rustc dedicated helper thread ${nestedThreadId} timed out during startup`
				);
				return nestedThreadId;
			};
			if (request.type === 'thread-pool-init') {
				const slot = reserveIdleThreadPoolSlot(
					request.poolBuffers
					.map((buffer, index) => ({
						index,
						slotState: new Int32Array(buffer)
					}))
					.filter((entry) => entry.index !== request.slotIndex)
				);
				if (!slot) {
					return spawnDedicatedWorker();
				}
				if (request.log) {
					postMessage({
						type: 'thread-log',
						threadId: nestedThreadId,
						phase: 'spawn-pooled',
						detail: `slot=${slot.index} startArg=${startArg}`
					} satisfies RustcThreadWorkerLogMessage);
				}
				dispatchThreadPoolSlotAndWait(
					slot.slotState,
					nestedThreadId,
					startArg,
					THREAD_STARTUP_STATE_INSTANTIATED,
					30_000,
					`rustc pooled helper thread ${nestedThreadId} failed to initialize`,
					`rustc pooled helper thread ${nestedThreadId} timed out during startup`
				);
				return nestedThreadId;
			}
			return spawnDedicatedWorker();
		}
	});
}

async function startThreadWorker(request: RustcThreadWorkerRequest) {
	if (request.log) {
		postMessage({
			type: 'thread-log',
			threadId: request.threadId,
			phase: 'start',
			detail: `startArg=${request.startArg}`
		} satisfies RustcThreadWorkerLogMessage);
	}
	const readyState = new Int32Array(request.readyBuffer);
	Atomics.store(readyState, 0, THREAD_STARTUP_STATE_STARTING);
	Atomics.notify(readyState, 0);
	const instantiated = await instantiateThreadWorkerRuntime(request);
	if (request.log) {
		postMessage({
			type: 'thread-log',
			threadId: request.threadId,
			phase: 'instance-ready'
		} satisfies RustcThreadWorkerLogMessage);
	}
	Atomics.store(readyState, 0, THREAD_STARTUP_STATE_INSTANTIATED);
	Atomics.notify(readyState, 0);
	recordWorkerFailureContext(
		request.sharedStatusBuffer,
		'thread-enter',
		request.startArg,
		Array.from(new Uint32Array(request.memory.buffer, request.startArg, 4))
	);
	if (request.log) {
		postMessage({
			type: 'thread-log',
			threadId: request.threadId,
			phase: 'enter-wasi-thread-start'
			,
			detail: describeStartArgMemory(request.memory, request.startArg)
		} satisfies RustcThreadWorkerLogMessage);
	}
	Atomics.store(readyState, 0, THREAD_STARTUP_STATE_ENTERING);
	Atomics.notify(readyState, 0);
	(instantiated.instance.exports as any).wasi_thread_start(request.threadId, request.startArg);
}

async function startThreadPoolWorker(request: RustcThreadPoolInitRequest) {
	const slotState = new Int32Array(request.slotBuffer);
	if (request.log) {
		postMessage({
			type: 'thread-log',
			threadId: request.slotIndex,
			phase: 'pool-init-start'
		} satisfies RustcThreadWorkerLogMessage);
	}
	Atomics.store(slotState, 0, 0);
	Atomics.notify(slotState, 0);
	if (request.log) {
		postMessage({
			type: 'thread-log',
			threadId: request.slotIndex,
			phase: 'pool-init-ready'
		} satisfies RustcThreadWorkerLogMessage);
	}
	while (true) {
		const currentState = Atomics.load(slotState, 0);
		if (currentState === -2) {
			return;
		}
		if (currentState === 0) {
			Atomics.wait(slotState, 0, 0);
			continue;
		}
		if (currentState !== 1) {
			Atomics.wait(slotState, 0, currentState, 50);
			continue;
		}
		const threadId = Atomics.load(slotState, 1);
		const startArg = Atomics.load(slotState, 2);
		const instantiated = await instantiateThreadWorkerRuntime(request);
		Atomics.store(slotState, 0, THREAD_STARTUP_STATE_INSTANTIATED);
		Atomics.notify(slotState, 0);
		recordWorkerFailureContext(
			request.sharedStatusBuffer,
			'pool-enter',
			startArg,
			Array.from(new Uint32Array(request.memory.buffer, startArg, 4))
		);
		if (request.log) {
			postMessage({
				type: 'thread-log',
				threadId,
				phase: 'pool-run',
				detail: `slot=${request.slotIndex} ${describeStartArgMemory(request.memory, startArg)}`
			} satisfies RustcThreadWorkerLogMessage);
		}
		Atomics.store(slotState, 0, THREAD_STARTUP_STATE_ENTERING);
		Atomics.notify(slotState, 0);
		(instantiated.instance.exports as any).wasi_thread_start(threadId, startArg);
		Atomics.store(slotState, 0, 0);
		Atomics.notify(slotState, 0);
		if (request.log) {
			postMessage({
				type: 'thread-log',
				threadId,
				phase: 'pool-idle',
				detail: `slot=${request.slotIndex}`
			} satisfies RustcThreadWorkerLogMessage);
		}
	}
}

globalThis.addEventListener(
	'message',
	(event: MessageEvent<RustcThreadWorkerRequest | RustcThreadPoolInitRequest>) => {
		if (event.data?.type === 'thread-start') {
			const request = event.data;
			void startThreadWorker(request).catch((error) => {
				const detail = error instanceof Error ? error.message : String(error);
				const mirroredState = new Int32Array(request.sharedBitcodeBuffer, 0, 4);
				const mirroredLength = Atomics.load(mirroredState, MIRRORED_BITCODE_LENGTH_INDEX);
				const mirroredBitcodeReady = mirroredLength > 0;
				if (!mirroredBitcodeReady) {
					markWorkerFailure(request.sharedStatusBuffer, detail);
				}
				const readyState = new Int32Array(request.readyBuffer);
				Atomics.store(readyState, 0, -1);
				Atomics.notify(readyState, 0);
				if (request.log && !mirroredBitcodeReady) {
					postMessage({
						type: 'thread-log',
						threadId: request.threadId,
						phase: 'error',
						detail: `${detail}${error instanceof Error && error.stack ? ` stack=${error.stack.split('\n').slice(0, 6).join(' | ')}` : ''}`
					} satisfies RustcThreadWorkerLogMessage);
				}
			});
			return;
		}
		if (event.data?.type === 'thread-pool-init') {
			const request = event.data;
			void startThreadPoolWorker(request).catch((error) => {
				const detail = error instanceof Error ? error.message : String(error);
				const mirroredState = new Int32Array(request.sharedBitcodeBuffer, 0, 4);
				const mirroredLength = Atomics.load(mirroredState, MIRRORED_BITCODE_LENGTH_INDEX);
				const mirroredBitcodeReady = mirroredLength > 0;
				if (!mirroredBitcodeReady) {
					markWorkerFailure(request.sharedStatusBuffer, detail);
				}
				const slotState = new Int32Array(request.slotBuffer);
				Atomics.store(slotState, 0, -1);
				Atomics.notify(slotState, 0);
				if (request.log && !mirroredBitcodeReady) {
					postMessage({
						type: 'thread-log',
						threadId: request.slotIndex,
						phase: 'pool-error',
						detail: `${detail}${error instanceof Error && error.stack ? ` stack=${error.stack.split('\n').slice(0, 6).join(' | ')}` : ''}`
					} satisfies RustcThreadWorkerLogMessage);
				}
			});
		}
	}
);
