export interface CdpEvent {
	method: string;
	params?: Record<string, any>;
}

export interface CdpTransport {
	request<T = Record<string, any>>(method: string, params?: Record<string, unknown>): Promise<T>;
	onEvent(listener: (event: CdpEvent) => void): () => void;
	disconnect(): Promise<void>;
}

const CHANNEL = 'wasm-idle-cdp-v1';
const INSTALL_MESSAGE =
	'Enable the wasm-idle Native Debugger extension on this tab, then retry Debug. See extensions/debugger/README.md.';

/** Checks this tab's opt-in bridge without attaching to an execution Worker. */
export function isBrowserCdpDebuggerAvailable(
	options: { window?: Window; timeoutMs?: number } = {}
): Promise<boolean> {
	const host = options.window ?? (typeof window !== 'undefined' ? window : undefined);
	if (!host) return Promise.resolve(false);
	return new Promise((resolve) => {
		const id = crypto.randomUUID();
		const origin = host.location.origin;
		const finish = (available: boolean) => {
			clearTimeout(timer);
			host.removeEventListener('message', receive);
			resolve(available);
		};
		const receive = (event: MessageEvent) => {
			const message = event.data;
			if (
				event.source === host &&
				event.origin === origin &&
				message?.channel === CHANNEL &&
				message.direction === 'response' &&
				message.id === id
			)
				finish(message.result?.version === 1 && !message.error);
		};
		const timer = setTimeout(() => finish(false), options.timeoutMs ?? 1500);
		host.addEventListener('message', receive);
		try {
			host.postMessage({ channel: CHANNEL, direction: 'request', id, op: 'ping' }, origin);
		} catch {
			finish(false);
		}
	});
}

/** The extension owns CDP permissions; this transport never opens a remote debugging port. */
export async function createBrowserCdpTransport(
	workerName: string,
	options: { window?: Window; timeoutMs?: number } = {}
): Promise<CdpTransport> {
	const host = options.window ?? window;
	const origin = host.location.origin;
	const timeoutMs = options.timeoutMs ?? 10_000;
	let closed = false;
	let connection = '';
	const pending = new Map<
		string,
		{
			resolve(value: any): void;
			reject(error: Error): void;
			timer: ReturnType<typeof setTimeout>;
		}
	>();
	const listeners = new Set<(event: CdpEvent) => void>();
	const onMessage = (event: MessageEvent) => {
		const message = event.data;
		if (event.source !== host || event.origin !== origin || message?.channel !== CHANNEL)
			return;
		if (message.direction === 'response' && typeof message.id === 'string') {
			const request = pending.get(message.id);
			if (!request) return;
			pending.delete(message.id);
			clearTimeout(request.timer);
			if (typeof message.error === 'string') request.reject(new Error(message.error));
			else request.resolve(message.result);
		} else if (
			message.direction === 'event' &&
			message.connection === connection &&
			typeof message.method === 'string'
		) {
			for (const listener of [...listeners])
				listener({ method: message.method, params: message.params });
		}
	};
	host.addEventListener('message', onMessage);
	const send = (request: Record<string, unknown>, timeout = timeoutMs) => {
		if (closed) return Promise.reject(new Error('Debugger connection is closed'));
		return new Promise<any>((resolve, reject) => {
			const id = crypto.randomUUID();
			const timer = setTimeout(() => {
				pending.delete(id);
				reject(
					new Error(
						request.op === 'ping' ? INSTALL_MESSAGE : 'Debugger request timed out'
					)
				);
			}, timeout);
			pending.set(id, { resolve, reject, timer });
			host.postMessage(
				{ channel: CHANNEL, direction: 'request', id, connection, ...request },
				origin
			);
		});
	};
	const dispose = () => {
		closed = true;
		host.removeEventListener('message', onMessage);
		for (const request of pending.values()) {
			clearTimeout(request.timer);
			request.reject(new Error('Debugger connection is closed'));
		}
		pending.clear();
		listeners.clear();
	};
	try {
		await send({ op: 'ping' }, Math.min(1500, timeoutMs));
		const response = await send({ op: 'connect', workerName });
		if (typeof response?.connection !== 'string')
			throw new Error('Invalid debugger connection response');
		connection = response.connection;
	} catch (error) {
		dispose();
		throw error;
	}
	return {
		request: (method, params) => send({ op: 'command', method, params }),
		onEvent(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async disconnect() {
			if (closed) return;
			try {
				await send({ op: 'disconnect' });
			} finally {
				dispose();
			}
		}
	};
}
