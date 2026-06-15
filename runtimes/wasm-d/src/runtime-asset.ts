import { resolveVersionedAssetUrl } from './asset-url.js';

type RuntimeAssetProgressReporter = (loaded: number, total?: number) => void;

function createRuntimeFetch(): typeof fetch {
	return (async (input: string | URL) => {
		const url = new URL(input.toString());
		if (url.protocol !== 'file:') return fetch(url);
		const [{ readFile }, { fileURLToPath }] = await Promise.all([
			import('node:fs/promises'),
			import('node:url')
		]);
		try {
			return new Response(await readFile(fileURLToPath(url)));
		} catch (error) {
			const code =
				error && typeof error === 'object' && 'code' in error ? (error as { code?: string }).code : '';
			return new Response(null, {
				status: code === 'ENOENT' ? 404 : 500
			});
		}
	}) as typeof fetch;
}

export const defaultFetch = createRuntimeFetch();

export async function fetchRuntimeAssetBytes(
	assetUrl: string | URL,
	assetLabel: string,
	fetchImpl: typeof fetch = defaultFetch,
	reportProgress?: RuntimeAssetProgressReporter
) {
	const resolvedAssetUrl = assetUrl.toString();
	let response: Response;
	try {
		response = await fetchImpl(resolvedAssetUrl);
	} catch (error) {
		throw new Error(
			`failed to fetch ${assetLabel} from ${resolvedAssetUrl}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (!response.ok) {
		throw new Error(`failed to fetch ${assetLabel} from ${resolvedAssetUrl} (status ${response.status})`);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		reportProgress?.(bytes.byteLength, bytes.byteLength);
		return bytes;
	}
	const reader = response.body.getReader();
	const contentLength = Number(response.headers.get('content-length') || 0) || undefined;
	let receivedLength = 0;
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		const chunk = Uint8Array.from(value);
		chunks.push(chunk);
		receivedLength += chunk.byteLength;
		reportProgress?.(receivedLength, contentLength);
	}
	const bytes = new Uint8Array(receivedLength);
	let position = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, position);
		position += chunk.byteLength;
	}
	reportProgress?.(receivedLength, contentLength ?? receivedLength);
	return bytes;
}

export async function fetchRuntimeAssetJson<T>(
	baseUrl: string | URL,
	asset: string,
	assetLabel: string,
	fetchImpl: typeof fetch = defaultFetch,
	reportProgress?: RuntimeAssetProgressReporter
) {
	return JSON.parse(
		new TextDecoder().decode(
			await fetchRuntimeAssetBytes(
				resolveVersionedAssetUrl(baseUrl, asset),
				assetLabel,
				fetchImpl,
				reportProgress
			)
		)
	) as T;
}
