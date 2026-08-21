import {
	BASH_WORKER_PROTOCOL_VERSION,
	isBashHostToWorkerMessage,
	type BashHostToWorkerMessage,
	type BashSerializedError,
	type BashWorkerErrorPhase,
	type BashWorkerLoadMessage,
	type BashWorkerRunMessage,
	type BashWorkerToHostMessage
} from '$lib/playground/bashWorkerProtocol';
import BashWorkerRuntime from '$lib/playground/worker/bashRuntime';

interface BashWorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void | Promise<void>) | null;
	postMessage(message: BashWorkerToHostMessage, transfer?: Transferable[]): void;
}

interface RequestIdentity {
	readonly sessionId: number;
	readonly requestId: number;
}

interface ActiveRun extends RequestIdentity {
	readonly stdinDecoder: TextDecoder;
}

class BashBridgeProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ProtocolError';
	}
}

const workerSelf = globalThis as unknown as BashWorkerScope;
const runtime = new BashWorkerRuntime();

let activeOperation: ({ readonly type: 'load' | 'run' } & RequestIdentity) | null = null;
let activeRun: ActiveRun | null = null;
let loadedSessionId: number | null = null;

function postMessage(message: BashWorkerToHostMessage, transfer?: Transferable[]) {
	if (transfer) {
		workerSelf.postMessage(message, transfer);
		return;
	}
	workerSelf.postMessage(message);
}

function copyStringProperty(
	value: unknown,
	key: 'name' | 'message' | 'stack' | 'code' | 'profileId' | 'resource' | 'feature' | 'languageId'
) {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return undefined;
	}
	try {
		const property = (value as Record<string, unknown>)[key];
		return typeof property === 'string' ? property : undefined;
	} catch {
		return undefined;
	}
}

function copyBooleanProperty(value: unknown, key: 'recoverable') {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return undefined;
	}
	try {
		const property = (value as Record<string, unknown>)[key];
		return typeof property === 'boolean' ? property : undefined;
	} catch {
		return undefined;
	}
}

function copySafeIntegerProperty(value: unknown, key: 'actual' | 'limit' | 'timeoutMs') {
	if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
		return undefined;
	}
	try {
		const property = (value as Record<string, unknown>)[key];
		return Number.isSafeInteger(property) && (property as number) >= 0
			? (property as number)
			: undefined;
	} catch {
		return undefined;
	}
}

function safelyStringify(value: unknown) {
	try {
		return String(value);
	} catch {
		return 'Unknown Bash worker error';
	}
}

function serializeError(error: unknown): BashSerializedError {
	const name = copyStringProperty(error, 'name') || 'Error';
	const message =
		copyStringProperty(error, 'message') ||
		(typeof error === 'string' ? error : safelyStringify(error));
	const stack = copyStringProperty(error, 'stack');
	const code = copyStringProperty(error, 'code');
	const recoverable = copyBooleanProperty(error, 'recoverable');
	const profileId = copyStringProperty(error, 'profileId');
	const actual = copySafeIntegerProperty(error, 'actual');
	const limit = copySafeIntegerProperty(error, 'limit');
	const timeoutMs = copySafeIntegerProperty(error, 'timeoutMs');
	const resource = copyStringProperty(error, 'resource');
	const feature = copyStringProperty(error, 'feature');
	const languageId = copyStringProperty(error, 'languageId');
	return {
		name,
		message,
		...(stack ? { stack } : {}),
		...(code ? { code } : {}),
		...(recoverable === undefined ? {} : { recoverable }),
		...(profileId ? { profileId } : {}),
		...(actual === undefined ? {} : { actual }),
		...(limit === undefined ? {} : { limit }),
		...(timeoutMs === undefined ? {} : { timeoutMs }),
		...(resource === 'wasm-memory' || resource === 'nested-workers' || resource === 'threads'
			? { resource }
			: {}),
		...(feature ? { feature } : {}),
		...(languageId ? { languageId } : {})
	};
}

function errorPhase(error: unknown, fallback: BashWorkerErrorPhase): BashWorkerErrorPhase {
	if (error instanceof BashBridgeProtocolError) return 'protocol';
	if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
		return fallback;
	}
	try {
		const phase = (error as { phase?: unknown }).phase;
		if (phase === 'asset' || phase === 'startup' || phase === 'execute') return phase;
	} catch {
		// An untrusted error getter must not prevent clone-safe reporting.
	}
	return fallback;
}

function postError(identity: RequestIdentity, error: unknown, fallbackPhase: BashWorkerErrorPhase) {
	postMessage({
		protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
		type: 'error',
		sessionId: identity.sessionId,
		requestId: identity.requestId,
		phase: errorPhase(error, fallbackPhase),
		error: serializeError(error)
	});
}

function requestIdentity(value: unknown): RequestIdentity | null {
	if (typeof value !== 'object' || value === null) return null;
	try {
		const { sessionId, requestId } = value as Record<string, unknown>;
		if (
			!Number.isSafeInteger(sessionId) ||
			(sessionId as number) <= 0 ||
			!Number.isSafeInteger(requestId) ||
			(requestId as number) <= 0
		) {
			return null;
		}
		return { sessionId: sessionId as number, requestId: requestId as number };
	} catch {
		return null;
	}
}

function assertIdle(message: BashWorkerLoadMessage | BashWorkerRunMessage) {
	if (!activeOperation) return;
	throw new BashBridgeProtocolError(
		`Cannot ${message.type} Bash while ${activeOperation.type} request ${activeOperation.requestId} is active`
	);
}

function ownsOperation(message: BashWorkerLoadMessage | BashWorkerRunMessage) {
	return (
		activeOperation?.type === message.type &&
		activeOperation.sessionId === message.sessionId &&
		activeOperation.requestId === message.requestId
	);
}

async function handleLoad(message: BashWorkerLoadMessage) {
	assertIdle(message);
	activeOperation = {
		type: 'load',
		sessionId: message.sessionId,
		requestId: message.requestId
	};
	try {
		await runtime.loadVerified(
			message.runtimePreflight,
			message.log ?? false,
			{ limits: { ...message.limits } },
			{
				set(value, stage) {
					if (!ownsOperation(message)) return;
					postMessage({
						protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
						type: 'progress',
						sessionId: message.sessionId,
						requestId: message.requestId,
						value,
						...(stage === undefined ? {} : { stage })
					});
				}
			}
		);
		if (!ownsOperation(message)) return;
		loadedSessionId = message.sessionId;
		postMessage({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'loaded',
			sessionId: message.sessionId,
			requestId: message.requestId
		});
	} finally {
		if (ownsOperation(message)) activeOperation = null;
	}
}

async function handleRun(message: BashWorkerRunMessage) {
	assertIdle(message);
	if (loadedSessionId !== message.sessionId) {
		throw new BashBridgeProtocolError(
			`Bash worker session ${message.sessionId} has not loaded a runtime`
		);
	}
	const run: ActiveRun = {
		sessionId: message.sessionId,
		requestId: message.requestId,
		stdinDecoder: new TextDecoder()
	};
	activeOperation = {
		type: 'run',
		sessionId: message.sessionId,
		requestId: message.requestId
	};
	activeRun = run;
	try {
		const runPromise = runtime.run(
			message.code,
			false,
			message.log ?? false,
			undefined,
			[...message.programArgs],
			{
				activePath: message.activePath,
				workspaceFiles: message.workspaceFiles.map(({ path, content }) => ({
					path,
					content
				})),
				programArgs: [...message.programArgs],
				...(message.stdin === undefined ? {} : { stdin: message.stdin }),
				limits: { ...message.limits },
				workspaceLimits: { ...message.workspaceLimits }
			}
		);
		if (message.stdin === undefined && ownsOperation(message)) {
			postMessage({
				protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
				type: 'stdin-ready',
				sessionId: message.sessionId,
				requestId: message.requestId
			});
		}
		const result = await runPromise;
		if (!ownsOperation(message)) return;
		postMessage({
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'result',
			sessionId: message.sessionId,
			requestId: message.requestId,
			result
		});
	} finally {
		if (activeRun === run) activeRun = null;
		if (ownsOperation(message)) activeOperation = null;
	}
}

function handleStdin(message: Extract<BashHostToWorkerMessage, { type: 'stdin' }>) {
	const run = activeRun;
	if (!run || run.sessionId !== message.sessionId || run.requestId !== message.requestId) {
		return;
	}
	const input = run.stdinDecoder.decode(message.bytes, { stream: true });
	if (input) runtime.write(input);
}

function handleStdinEof(message: Extract<BashHostToWorkerMessage, { type: 'stdin-eof' }>) {
	const run = activeRun;
	if (!run || run.sessionId !== message.sessionId || run.requestId !== message.requestId) {
		return;
	}
	const finalInput = run.stdinDecoder.decode();
	if (finalInput) runtime.write(finalInput);
	runtime.eof();
}

runtime.outputBytes = (stream, output) => {
	const run = activeRun;
	if (!run) return;
	const bytes = Uint8Array.from(output);
	postMessage(
		{
			protocolVersion: BASH_WORKER_PROTOCOL_VERSION,
			type: 'output',
			sessionId: run.sessionId,
			requestId: run.requestId,
			stream,
			bytes
		},
		[bytes.buffer]
	);
};

async function dispatch(message: BashHostToWorkerMessage) {
	switch (message.type) {
		case 'load':
			await handleLoad(message);
			return;
		case 'run':
			await handleRun(message);
			return;
		case 'stdin':
			handleStdin(message);
			return;
		case 'stdin-eof':
			handleStdinEof(message);
	}
}

workerSelf.onmessage = async (event) => {
	const identity = requestIdentity(event.data);
	if (!isBashHostToWorkerMessage(event.data)) {
		if (identity) {
			postError(
				identity,
				new BashBridgeProtocolError('Invalid Bash worker protocol message'),
				'protocol'
			);
		}
		return;
	}
	try {
		await dispatch(event.data);
	} catch (error) {
		postError(
			event.data,
			error,
			event.data.type === 'load'
				? 'startup'
				: event.data.type === 'run' ||
					  event.data.type === 'stdin' ||
					  event.data.type === 'stdin-eof'
					? 'execute'
					: 'protocol'
		);
	}
};

export {};
