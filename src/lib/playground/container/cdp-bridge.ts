import { createBrowserCdpTransport, type CdpEvent, type CdpTransport } from '@wasm-idle/debug';

const CHANNEL = 'wasm-idle-owner-cdp-v1';
interface Endpoint {
	postMessage(message: unknown): void;
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
interface Message {
	channel: typeof CHANNEL;
	owner: string;
	type: 'request' | 'response' | 'event';
	id: string;
	connection: string;
	op?: 'connect' | 'command' | 'disconnect' | 'cancel';
	workerName?: string;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: string;
	event?: CdpEvent;
}
const matches = (message: Message | undefined, owner: string): message is Message =>
	message?.channel === CHANNEL && message.owner === owner;

/** Keep extension access in the document while the sandbox belongs to its owner Worker. */
export function installContainerCdpRelay(
	worker: Endpoint,
	owner: string,
	connect: (workerName: string) => Promise<CdpTransport> = createBrowserCdpTransport
) {
	let disposed = false;
	const sessions = new Map<string, { transport: CdpTransport; unsubscribe(): void }>();
	const connecting = new Set<string>();
	const cancelled = new Set<string>();
	const reply = (request: Message, result?: unknown, error?: unknown) => {
		if (disposed) return;
		worker.postMessage({
			channel: CHANNEL,
			owner,
			type: 'response',
			id: request.id,
			connection: request.connection,
			result,
			...(error === undefined
				? {}
				: { error: error instanceof Error ? error.message : String(error) })
		});
	};
	const handle = async (request: Message) => {
		if (request.op === 'cancel') {
			if (connecting.has(request.connection)) cancelled.add(request.connection);
			const session = sessions.get(request.connection);
			if (session) {
				sessions.delete(request.connection);
				session.unsubscribe();
				await session.transport.disconnect();
			}
			return;
		}
		if (request.op === 'connect') {
			if (
				sessions.has(request.connection) ||
				connecting.has(request.connection) ||
				sessions.size + connecting.size >= 8 ||
				typeof request.workerName !== 'string'
			) {
				throw new Error('Invalid native debugger connection');
			}
			connecting.add(request.connection);
			try {
				const transport = await connect(request.workerName);
				if (disposed || cancelled.has(request.connection)) {
					await transport.disconnect();
					return;
				}
				const unsubscribe = transport.onEvent((event) => {
					if (!disposed)
						worker.postMessage({
							channel: CHANNEL,
							owner,
							type: 'event',
							id: '',
							connection: request.connection,
							event
						});
				});
				sessions.set(request.connection, { transport, unsubscribe });
				reply(request);
			} finally {
				connecting.delete(request.connection);
				cancelled.delete(request.connection);
			}
			return;
		}
		const session = sessions.get(request.connection);
		if (!session) throw new Error('Native debugger connection is closed');
		if (request.op === 'disconnect') {
			sessions.delete(request.connection);
			session.unsubscribe();
			await session.transport.disconnect();
			reply(request);
		} else if (request.op === 'command' && typeof request.method === 'string') {
			reply(request, await session.transport.request(request.method, request.params));
		} else throw new Error('Invalid native debugger operation');
	};
	const receive = (event: MessageEvent<Message>) => {
		const message = event.data;
		if (disposed || !matches(message, owner) || message.type !== 'request') return;
		void handle(message).catch((error) => reply(message, undefined, error));
	};
	worker.addEventListener('message', receive);
	return () => {
		if (disposed) return;
		disposed = true;
		worker.removeEventListener('message', receive);
		for (const session of sessions.values()) {
			session.unsubscribe();
			void session.transport.disconnect().catch(() => undefined);
		}
		sessions.clear();
	};
}

export function createContainerCdpTransportFactory(scope: Endpoint, owner: string) {
	let disposed = false;
	const pending = new Map<
		string,
		{
			resolve(value: any): void;
			reject(error: Error): void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const events = new Map<string, Set<(event: CdpEvent) => void>>();
	const send = (connection: string, fields: Partial<Message>) => {
		if (disposed) return Promise.reject(new Error('Container debugger owner is closed'));
		return new Promise<any>((resolve, reject) => {
			const id = crypto.randomUUID();
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(new Error('Container debugger request timed out'));
			}, 15_000);
			pending.set(id, { resolve, reject, timer });
			try {
				scope.postMessage({
					channel: CHANNEL,
					owner,
					type: 'request',
					id,
					connection,
					...fields
				});
			} catch (error) {
				pending.delete(id);
				clearTimeout(timer);
				reject(error);
			}
		});
	};
	const receive = (event: MessageEvent<Message>) => {
		const message = event.data;
		if (disposed || !matches(message, owner)) return;
		if (message.type === 'event' && message.event) {
			for (const listener of events.get(message.connection) ?? []) listener(message.event);
		} else if (message.type === 'response') {
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (message.error) request.reject(new Error(message.error));
			else request.resolve(message.result);
		}
	};
	scope.addEventListener('message', receive);
	return {
		async connect(workerName: string): Promise<CdpTransport> {
			const connection = crypto.randomUUID();
			try {
				await send(connection, { op: 'connect', workerName });
			} catch (error) {
				try {
					scope.postMessage({
						channel: CHANNEL,
						owner,
						type: 'request',
						id: '',
						connection,
						op: 'cancel'
					});
				} catch {
					/* The document may already have retired this owner. */
				}
				throw error;
			}
			let closed = false;
			const listeners = new Set<(event: CdpEvent) => void>();
			events.set(connection, listeners);
			return {
				request: (method, params) =>
					closed
						? Promise.reject(new Error('Debugger connection is closed'))
						: send(connection, { op: 'command', method, params }),
				onEvent(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				async disconnect() {
					if (closed) return;
					closed = true;
					events.delete(connection);
					listeners.clear();
					await send(connection, { op: 'disconnect' });
				}
			};
		},
		dispose() {
			disposed = true;
			scope.removeEventListener('message', receive);
			events.clear();
			for (const request of pending.values()) {
				clearTimeout(request.timer);
				request.reject(new Error('Container debugger owner is closed'));
			}
			pending.clear();
		}
	};
}
