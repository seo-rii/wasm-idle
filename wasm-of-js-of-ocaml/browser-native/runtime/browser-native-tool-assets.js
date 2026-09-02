export const DEFAULT_MAX_BROWSER_TOOL_ASSET_BYTES = 32 * 1024 * 1024;
export const DEFAULT_MAX_BROWSER_TOOL_INPUT_BYTES = 128 * 1024 * 1024;
const DEFAULT_BROWSER_TOOL_ASSET_BUFFER_BYTES = 64 * 1024;
function requirePositiveSafeInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${label} must be a positive safe integer`);
    }
    return value;
}
export function validateBrowserToolAssetReceipt(value, label, maxBytes = DEFAULT_MAX_BROWSER_TOOL_ASSET_BYTES) {
    if (typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        !Number.isSafeInteger(value.bytes) ||
        value.bytes <= 0 ||
        value.bytes > maxBytes ||
        typeof value.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/u.test(value.sha256)) {
        throw new Error(`${label} has an invalid or oversized asset receipt`);
    }
    return value;
}
export function createBrowserToolInputBudget(limits = {}) {
    const maxAssetBytes = requirePositiveSafeInteger(limits.maxAssetBytes ?? DEFAULT_MAX_BROWSER_TOOL_ASSET_BYTES, 'maxAssetBytes');
    const maxTotalBytes = requirePositiveSafeInteger(limits.maxTotalBytes ?? DEFAULT_MAX_BROWSER_TOOL_INPUT_BYTES, 'maxTotalBytes');
    if (maxAssetBytes > maxTotalBytes) {
        throw new TypeError('maxAssetBytes must not exceed maxTotalBytes');
    }
    return { maxAssetBytes, maxTotalBytes, usedBytes: 0 };
}
export function accountBrowserToolInputBytes(budget, label, byteLength) {
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new TypeError(`${label} has an invalid byte length`);
    }
    if (byteLength > budget.maxAssetBytes) {
        throw new Error(`${label} exceeds the ${budget.maxAssetBytes} byte asset limit`);
    }
    const nextUsedBytes = budget.usedBytes + byteLength;
    if (!Number.isSafeInteger(nextUsedBytes) || nextUsedBytes > budget.maxTotalBytes) {
        throw new Error(`browser-native tool inputs exceed the ${budget.maxTotalBytes} byte aggregate limit`);
    }
    budget.usedBytes = nextUsedBytes;
}
function abortReason(signal) {
    return (signal.reason ?? new DOMException('browser-native tool asset load aborted', 'AbortError'));
}
function throwIfAborted(signal) {
    if (signal?.aborted)
        throw abortReason(signal);
}
function resolveBrowserToolAssetUrl(value, baseUrl) {
    const configuredBase = baseUrl instanceof URL ? baseUrl.href : baseUrl;
    let resolved;
    try {
        resolved = configuredBase
            ? new URL(value, configuredBase)
            : new URL(value, globalThis.location?.href);
    }
    catch {
        throw new Error(`invalid browser-native tool asset URL: ${value}`);
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
        throw new Error(`unsupported browser-native tool asset URL scheme: ${resolved.protocol}`);
    }
    if (resolved.username || resolved.password || resolved.hash) {
        throw new Error('browser-native tool asset URLs must not include credentials or fragments');
    }
    return resolved;
}
function cancelResponse(response, reason) {
    try {
        void Promise.resolve(response.body?.cancel(reason)).catch(() => { });
    }
    catch {
        // Preserve the boundary failure that caused cancellation.
    }
}
function parseContentLength(response, label) {
    const raw = response.headers.get('content-length');
    if (raw === null)
        return undefined;
    const normalized = raw.trim();
    const parsed = Number(normalized);
    if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
        throw new Error(`${label} has an invalid Content-Length`);
    }
    return parsed;
}
async function readBrowserToolAssetBody(response, label, budget, contentLength, signal) {
    if (!response.body) {
        if (contentLength === 0)
            return new Uint8Array();
        throw new Error(`${label} has no readable response body`);
    }
    const abortSignal = signal;
    const reader = response.body.getReader();
    let readerCancelled = false;
    const cancelReader = (reason) => {
        if (readerCancelled)
            return;
        readerCancelled = true;
        try {
            void Promise.resolve(reader.cancel(reason)).catch(() => { });
        }
        catch { }
    };
    if (abortSignal?.aborted) {
        const reason = abortReason(abortSignal);
        cancelReader(reason);
        try {
            reader.releaseLock();
        }
        catch { }
        throw reason;
    }
    let cancelOnAbort;
    const aborted = abortSignal
        ? new Promise((_resolve, reject) => {
            cancelOnAbort = () => {
                const reason = abortReason(abortSignal);
                cancelReader(reason);
                reject(reason);
            };
            abortSignal.addEventListener('abort', cancelOnAbort, { once: true });
        })
        : undefined;
    let bytes;
    let receivedBytes = 0;
    let accountedBytes = contentLength ?? 0;
    let loadedBytes;
    let releaseFailure;
    try {
        bytes = new Uint8Array(Math.min(budget.maxAssetBytes, Math.max(contentLength ?? DEFAULT_BROWSER_TOOL_ASSET_BUFFER_BYTES, 1)));
        while (true) {
            throwIfAborted(abortSignal);
            const pendingRead = reader.read();
            const { done, value } = aborted
                ? await Promise.race([pendingRead, aborted])
                : await pendingRead;
            throwIfAborted(abortSignal);
            if (done)
                break;
            if (!value)
                continue;
            const nextReceivedBytes = receivedBytes + value.byteLength;
            if (!Number.isSafeInteger(nextReceivedBytes) ||
                nextReceivedBytes > budget.maxAssetBytes) {
                const error = new Error(`${label} exceeds the ${budget.maxAssetBytes} byte asset limit`);
                cancelReader(error);
                throw error;
            }
            if (contentLength !== undefined && nextReceivedBytes > contentLength) {
                const error = new Error(`${label} size mismatch: expected ${contentLength} bytes, received more data`);
                cancelReader(error);
                throw error;
            }
            if (nextReceivedBytes > accountedBytes) {
                accountBrowserToolInputBytes(budget, label, nextReceivedBytes - accountedBytes);
                accountedBytes = nextReceivedBytes;
            }
            if (nextReceivedBytes > bytes.byteLength) {
                const nextCapacity = Math.min(budget.maxAssetBytes, Math.max(nextReceivedBytes, bytes.byteLength * 2));
                const grown = new Uint8Array(nextCapacity);
                grown.set(bytes.subarray(0, receivedBytes));
                bytes = grown;
            }
            bytes.set(value, receivedBytes);
            receivedBytes = nextReceivedBytes;
        }
        throwIfAborted(abortSignal);
        if (contentLength !== undefined && receivedBytes !== contentLength) {
            throw new Error(`${label} size mismatch: expected ${contentLength} bytes, received ${receivedBytes}`);
        }
        loadedBytes = receivedBytes === bytes.byteLength ? bytes : bytes.slice(0, receivedBytes);
    }
    catch (error) {
        if (abortSignal?.aborted) {
            const reason = abortReason(abortSignal);
            cancelReader(reason);
            throw reason;
        }
        cancelReader(error);
        throw error;
    }
    finally {
        if (cancelOnAbort)
            abortSignal?.removeEventListener('abort', cancelOnAbort);
        try {
            reader.releaseLock();
        }
        catch (error) {
            if (!abortSignal?.aborted)
                releaseFailure = { error };
        }
    }
    if (abortSignal?.aborted) {
        const reason = abortReason(abortSignal);
        cancelReader(reason);
        throw reason;
    }
    if (releaseFailure)
        throw releaseFailure.error;
    return loadedBytes;
}
async function verifyBrowserToolAssetSha256(bytes, expectedSha256, label, signal) {
    throwIfAborted(signal);
    const subtle = globalThis.crypto?.subtle;
    if (!subtle)
        throw new Error(`Web Crypto is required to verify ${label}`);
    const pendingDigest = subtle.digest('SHA-256', bytes);
    const digestBuffer = signal
        ? await new Promise((resolve, reject) => {
            let settled = false;
            const onAbort = () => {
                if (settled)
                    return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                reject(abortReason(signal));
            };
            signal.addEventListener('abort', onAbort, { once: true });
            void pendingDigest.then((value) => {
                if (settled)
                    return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                resolve(value);
            }, (error) => {
                if (settled)
                    return;
                settled = true;
                signal.removeEventListener('abort', onAbort);
                reject(error);
            });
            if (signal.aborted)
                onAbort();
        })
        : await pendingDigest;
    const digest = new Uint8Array(digestBuffer);
    throwIfAborted(signal);
    const actualSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (actualSha256 !== expectedSha256) {
        throw new Error(`${label} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`);
    }
}
export async function fetchBrowserToolAsset(value, label, budget, options = {}) {
    throwIfAborted(options.signal);
    const receipt = options.receipt
        ? validateBrowserToolAssetReceipt(options.receipt, label, budget.maxAssetBytes)
        : undefined;
    const requestUrl = resolveBrowserToolAssetUrl(value, options.baseUrl);
    const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (!fetchImpl)
        throw new Error(`fetch is required to load ${label}`);
    const requestInit = {
        cache: options.cache ?? 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer'
    };
    if (options.signal)
        requestInit.signal = options.signal;
    let response;
    try {
        const pendingResponse = Promise.resolve(fetchImpl(requestUrl.href, requestInit));
        if (!options.signal) {
            response = await pendingResponse;
        }
        else {
            const signal = options.signal;
            response = await new Promise((resolve, reject) => {
                let settled = false;
                const onAbort = () => {
                    if (settled)
                        return;
                    settled = true;
                    signal.removeEventListener('abort', onAbort);
                    reject(abortReason(signal));
                };
                signal.addEventListener('abort', onAbort, { once: true });
                void pendingResponse.then((candidate) => {
                    if (settled) {
                        cancelResponse(candidate, abortReason(signal));
                        return;
                    }
                    settled = true;
                    signal.removeEventListener('abort', onAbort);
                    resolve(candidate);
                }, (error) => {
                    if (settled)
                        return;
                    settled = true;
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                });
                if (signal.aborted)
                    onAbort();
            });
        }
    }
    catch (error) {
        if (options.signal?.aborted)
            throw abortReason(options.signal);
        throw new Error(`failed to fetch ${label}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    if (options.signal?.aborted) {
        const reason = abortReason(options.signal);
        cancelResponse(response, reason);
        throw reason;
    }
    if (response.url) {
        let finalUrl;
        try {
            finalUrl = new URL(response.url);
        }
        catch (error) {
            cancelResponse(response, error);
            throw new Error(`${label} returned an invalid final URL`, {
                cause: error
            });
        }
        if (finalUrl.href !== requestUrl.href) {
            cancelResponse(response);
            throw new Error(`${label} final URL mismatch`);
        }
    }
    if (!response.ok) {
        cancelResponse(response);
        throw new Error(`failed to fetch ${label}: HTTP ${response.status}`);
    }
    let contentLength;
    try {
        contentLength = parseContentLength(response, label);
    }
    catch (error) {
        cancelResponse(response, error);
        throw error;
    }
    if (receipt && contentLength !== undefined && contentLength !== receipt.bytes) {
        cancelResponse(response);
        throw new Error(`${label} size mismatch: expected ${receipt.bytes} bytes, received ${contentLength}`);
    }
    const expectedBytes = receipt?.bytes ?? contentLength;
    if (expectedBytes !== undefined) {
        try {
            accountBrowserToolInputBytes(budget, label, expectedBytes);
        }
        catch (error) {
            cancelResponse(response, error);
            throw error;
        }
    }
    const bytes = await readBrowserToolAssetBody(response, label, budget, expectedBytes, options.signal);
    if (receipt) {
        await verifyBrowserToolAssetSha256(bytes, receipt.sha256, label, options.signal);
    }
    return bytes;
}
export function decodeBrowserToolSource(bytes, label) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    }
    catch (error) {
        throw new Error(`${label} is not valid UTF-8`, { cause: error });
    }
}
