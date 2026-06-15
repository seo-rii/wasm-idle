self.addEventListener('install', function () {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

const gzipVirtualExtensions = /\.(a|avm|bin|data|dat|dll|js|mjs|pdb|so|symbols|wasm)$/i;
const precompressedExtension = /\.(br|brotli|gz|tgz|zip|zst)$/i;
let compressedRuntimeAssetManifestPromise = null;

function shouldBypassIsolationHeaders(url) {
	return (
		url.pathname.includes('/webr/') &&
		!url.pathname.endsWith('/R.js') &&
		!url.pathname.endsWith('/webr-worker.js')
	);
}

function relativePathInScope(url) {
	const scopePath = new URL(self.registration.scope).pathname;
	if (url.pathname.startsWith(scopePath)) {
		return url.pathname.slice(scopePath.length);
	}
	return url.pathname.replace(/^\/+/, '');
}

async function compressedRuntimeAssetManifest() {
	if (!compressedRuntimeAssetManifestPromise) {
		compressedRuntimeAssetManifestPromise = fetch(
			new URL('compressed-runtime-assets.v1.json', self.registration.scope),
			{
				cache: 'no-cache'
			}
		)
			.then((response) => (response.ok ? response.json() : { assets: [] }))
			.then((manifest) => new Set(Array.isArray(manifest.assets) ? manifest.assets : []))
			.catch(() => new Set());
	}
	return compressedRuntimeAssetManifestPromise;
}

async function shouldTryCompressedRuntimeAsset(request, url) {
	if (request.method !== 'GET') return false;
	if (request.headers.has('range')) return false;
	if (precompressedExtension.test(url.pathname)) return false;
	if (!gzipVirtualExtensions.test(url.pathname)) return false;
	return (await compressedRuntimeAssetManifest()).has(relativePathInScope(url));
}

function contentTypeForPath(pathname) {
	if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return 'application/javascript';
	if (pathname.endsWith('.wasm')) return 'application/wasm';
	if (pathname.endsWith('.json')) return 'application/json';
	return 'application/octet-stream';
}

function hasGzipContentEncoding(response) {
	const contentEncoding = response.headers.get('content-encoding') || '';
	return contentEncoding
		.toLowerCase()
		.split(',')
		.map((value) => value.trim())
		.includes('gzip');
}

async function fetchCompressedRuntimeAsset(request, url) {
	if (!(await shouldTryCompressedRuntimeAsset(request, url))) return null;
	const compressedUrl = new URL(url);
	compressedUrl.pathname = `${compressedUrl.pathname}.gz`;
	const compressedResponse = await fetch(compressedUrl, {
		cache: request.cache,
		credentials: request.credentials,
		headers: request.headers,
		mode: request.mode,
		redirect: request.redirect,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy
	}).catch(() => null);
	if (!compressedResponse?.ok || !compressedResponse.body) return null;
	const headers = new Headers(compressedResponse.headers);
	headers.delete('content-encoding');
	headers.delete('content-length');
	headers.set('content-type', contentTypeForPath(url.pathname));
	const body = hasGzipContentEncoding(compressedResponse)
		? compressedResponse.body
		: compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(body, {
		status: 200,
		statusText: 'OK',
		headers
	});
}

function withIsolationHeaders(response) {
	const newHeaders = new Headers(response.headers);
	newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
	newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders
	});
}

self.addEventListener('fetch', function (event) {
	if (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin') {
		return;
	}
	const url = new URL(event.request.url);

	event.respondWith(
		Promise.resolve()
			.then(async function () {
				return (
					(await fetchCompressedRuntimeAsset(event.request, url)) || fetch(event.request)
				);
			})
			.then(function (response) {
				// It seems like we only need to set the headers for index.html
				// If you want to be on the safe side, comment this out
				// if (!response.url.includes("index.html")) return response;

				if (shouldBypassIsolationHeaders(url)) return response;
				return withIsolationHeaders(response);
			})
			.catch(function (e) {
				console.error(e);
			})
	);
});
