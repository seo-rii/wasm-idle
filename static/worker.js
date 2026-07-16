self.addEventListener('install', function () {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

const precompressedExtension = /\.(br|brotli|gz|tgz|zip|zst)$/i;
const runtimeAssetAliases = [
	{
		from: 'wasm-tinygo/vendor/wasm-rust-runtime/',
		to: 'wasm-rust/runtime/'
	}
];
const dynamicModuleCacheName = 'wasm-idle-dynamic-modules-v1';
const dynamicModulePathPrefix = '__wasm_idle_dynamic_modules__/';
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
			.then((manifest) => ({
				assets: new Set(Array.isArray(manifest.assets) ? manifest.assets : []),
				sizes: manifest.sizes && typeof manifest.sizes === 'object' ? manifest.sizes : {}
			}))
			.catch(() => ({ assets: new Set(), sizes: {} }));
	}
	return compressedRuntimeAssetManifestPromise;
}

async function shouldTryCompressedRuntimeAsset(request, url) {
	if (request.method !== 'GET' && request.method !== 'HEAD') return false;
	if (request.headers.has('range')) return false;
	if (precompressedExtension.test(url.pathname)) return false;
	return (await compressedRuntimeAssetManifest()).assets.has(relativePathInScope(url));
}

function originalContentLength(manifest, relativePath) {
	const size = manifest.sizes[relativePath];
	return Number.isSafeInteger(size) && size >= 0 ? size : null;
}

function contentTypeForPath(pathname) {
	if (pathname.endsWith('.js') || pathname.endsWith('.mjs')) return 'application/javascript';
	if (pathname.endsWith('.wasm')) return 'application/wasm';
	if (pathname.endsWith('.json')) return 'application/json';
	return 'application/octet-stream';
}

function aliasedRuntimeAssetUrl(url) {
	const relativePath = relativePathInScope(url);
	for (const alias of runtimeAssetAliases) {
		if (!relativePath.startsWith(alias.from)) continue;
		const aliasedUrl = new URL(
			`${alias.to}${relativePath.slice(alias.from.length)}`,
			self.registration.scope
		);
		aliasedUrl.search = url.search;
		return aliasedUrl;
	}
	return null;
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
	if (request.method === 'HEAD') {
		const manifest = await compressedRuntimeAssetManifest();
		const relativePath = relativePathInScope(url);
		if (!manifest.assets.has(relativePath)) return null;
		const headers = new Headers({
			'content-type': contentTypeForPath(url.pathname)
		});
		const originalSize = originalContentLength(manifest, relativePath);
		if (originalSize !== null) headers.set('content-length', String(originalSize));
		return new Response(null, {
			status: 200,
			statusText: 'OK',
			headers
		});
	}
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
	const manifest = await compressedRuntimeAssetManifest();
	const originalSize = originalContentLength(manifest, relativePathInScope(url));
	if (originalSize !== null) headers.set('content-length', String(originalSize));
	const body = hasGzipContentEncoding(compressedResponse)
		? compressedResponse.body
		: compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(body, {
		status: 200,
		statusText: 'OK',
		headers
	});
}

async function fetchRuntimeAssetAlias(request, url) {
	if (request.method !== 'GET') return null;
	const aliasUrl = aliasedRuntimeAssetUrl(url);
	if (!aliasUrl) return null;
	const aliasRequest = new Request(aliasUrl, {
		cache: request.cache,
		credentials: request.credentials,
		headers: request.headers,
		mode: request.mode,
		redirect: request.redirect,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy
	});
	return (
		(await fetchCompressedRuntimeAsset(aliasRequest, aliasUrl)) ||
		fetch(aliasRequest).catch(() => null)
	);
}

async function fetchDynamicModule(request, url) {
	if (request.method !== 'GET') return null;
	if (!relativePathInScope(url).startsWith(dynamicModulePathPrefix)) return null;
	const cache = await caches.open(dynamicModuleCacheName);
	const response = await cache.match(request);
	return (
		response ||
		new Response('Generated module is no longer available.', {
			status: 404,
			statusText: 'Not Found',
			headers: {
				'content-type': 'text/plain; charset=utf-8'
			}
		})
	);
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
					(await fetchDynamicModule(event.request, url)) ||
					(await fetchRuntimeAssetAlias(event.request, url)) ||
					(await fetchCompressedRuntimeAsset(event.request, url)) ||
					fetch(event.request)
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
