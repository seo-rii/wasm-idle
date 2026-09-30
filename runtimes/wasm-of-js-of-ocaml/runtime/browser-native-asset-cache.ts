/** Optional host-owned storage; the producer never guesses a storage policy or asset receipt. */
export type BrowserNativeAssetIdentity = {
	url: string;
	sha256: string;
	bytes: number;
	validationKey?: string;
};

export type BrowserNativeAssetCache = {
	read(
		identity: BrowserNativeAssetIdentity,
		signal?: AbortSignal
	): Promise<Uint8Array | undefined>;
	write(
		identity: BrowserNativeAssetIdentity,
		bytes: Uint8Array,
		signal?: AbortSignal
	): Promise<boolean | void>;
};

function checkAbort(signal?: AbortSignal) {
	if (signal?.aborted)
		throw signal.reason ?? new DOMException('Asset cache request aborted', 'AbortError');
}

async function bestEffort<T>(
	operation: () => Promise<T>,
	signal?: AbortSignal
): Promise<T | undefined> {
	checkAbort(signal);
	let onAbort: (() => void) | undefined;
	try {
		const pending = operation();
		const result = signal
			? await Promise.race([
					pending,
					new Promise<never>((_resolve, reject) => {
						onAbort = () =>
							reject(
								signal.reason ??
									new DOMException('Asset cache request aborted', 'AbortError')
							);
						signal.addEventListener('abort', onAbort, { once: true });
						if (signal.aborted) onAbort();
					})
				])
			: await pending;
		checkAbort(signal);
		return result;
	} catch {
		checkAbort(signal);
		return undefined;
	} finally {
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	}
}

export async function readBrowserNativeAssetCache(
	cache: BrowserNativeAssetCache | undefined,
	identity: BrowserNativeAssetIdentity,
	signal?: AbortSignal
) {
	const bytes = cache ? await bestEffort(() => cache.read(identity, signal), signal) : undefined;
	return bytes instanceof Uint8Array && bytes.byteLength === identity.bytes ? bytes : undefined;
}

export async function writeBrowserNativeAssetCache(
	cache: BrowserNativeAssetCache | undefined,
	identity: BrowserNativeAssetIdentity,
	bytes: Uint8Array,
	signal?: AbortSignal
) {
	if (cache) await bestEffort(() => cache.write(identity, bytes, signal), signal);
}

const identityKey = (identity: BrowserNativeAssetIdentity) =>
	JSON.stringify([identity.url, identity.sha256, identity.bytes, identity.validationKey]);

/** The nested worker can access only receipts already authorized by this tool request. */
export function serveBrowserNativeAssetCache(
	port: MessagePort,
	cache: BrowserNativeAssetCache,
	allowed: BrowserNativeAssetIdentity[]
) {
	const identities = new Map(
		allowed.map((identity) => [identityKey(identity), Object.freeze({ ...identity })])
	);
	const controller = new AbortController();
	port.onmessage = async ({ data }) => {
		if (
			!data ||
			!Number.isSafeInteger(data.id) ||
			data.id <= 0 ||
			!data.identity ||
			typeof data.identity.url !== 'string' ||
			typeof data.identity.sha256 !== 'string' ||
			!Number.isSafeInteger(data.identity.bytes) ||
			(data.identity.validationKey !== undefined &&
				typeof data.identity.validationKey !== 'string') ||
			controller.signal.aborted
		)
			return;
		const identity = identities.get(identityKey(data.identity));
		let bytes: Uint8Array | undefined;
		let stored = false;
		if (identity && data.operation === 'read') {
			bytes = await readBrowserNativeAssetCache(cache, identity, controller.signal).catch(
				() => undefined
			);
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== identity.bytes)
				bytes = undefined;
		} else if (
			identity &&
			data.operation === 'write' &&
			data.bytes instanceof Uint8Array &&
			data.bytes.byteLength === identity.bytes
		) {
			stored =
				(await bestEffort(
					() => cache.write(identity, data.bytes, controller.signal),
					controller.signal
				).catch(() => false)) === true;
		}
		if (!controller.signal.aborted) {
			try {
				port.postMessage({ id: data.id, bytes, stored });
			} catch {
				/* A terminated nested worker no longer consumes the reply. */
			}
		}
	};
	port.start();
	return () => {
		controller.abort();
		port.onmessage = null;
		port.close();
	};
}

export function connectBrowserNativeAssetCache(
	port: MessagePort
): BrowserNativeAssetCache & { close(): void } {
	let nextId = 0;
	const pending = new Map<number, (value: { bytes?: Uint8Array; stored?: boolean }) => void>();
	let closed = false;
	port.onmessage = ({ data }) => pending.get(data?.id)?.(data);
	port.start();
	const request = (
		operation: 'read' | 'write',
		identity: BrowserNativeAssetIdentity,
		bytes?: Uint8Array
	) =>
		new Promise<{ bytes?: Uint8Array; stored?: boolean }>((resolve) => {
			if (closed) return resolve({});
			const id = ++nextId;
			const finish = (value: { bytes?: Uint8Array; stored?: boolean }) => {
				clearTimeout(timer);
				pending.delete(id);
				resolve(value);
			};
			const timer = setTimeout(() => finish({}), 10_000);
			pending.set(id, finish);
			try {
				port.postMessage({ id, operation, identity, bytes });
			} catch {
				finish({});
			}
		});
	return {
		async read(identity, signal) {
			return (await bestEffort(() => request('read', identity), signal))?.bytes;
		},
		async write(identity, bytes, signal) {
			return (
				(await bestEffort(() => request('write', identity, bytes), signal))?.stored === true
			);
		},
		close() {
			closed = true;
			for (const finish of pending.values()) finish({});
			port.onmessage = null;
			port.close();
		}
	};
}
