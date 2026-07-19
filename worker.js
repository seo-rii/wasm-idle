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
let compressedRuntimeAssetManifestMissRefreshAt = 0;
let layeredRuntimeAssetManifestPromise = null;
const decompressedLayerPromises = new Map();

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

async function compressedRuntimeAssetManifest(forceRefresh = false) {
	if (forceRefresh) compressedRuntimeAssetManifestPromise = null;
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

async function layeredRuntimeAssetManifest() {
	if (!layeredRuntimeAssetManifestPromise) {
		layeredRuntimeAssetManifestPromise = fetch(
			new URL('layered-runtime-assets.v1.json', self.registration.scope),
			{
				cache: 'no-cache'
			}
		)
			.then((response) => (response.ok ? response.json() : null))
			.then((manifest) => {
				if (
					manifest?.schemaVersion !== 1 ||
					!manifest.assets ||
					typeof manifest.assets !== 'object' ||
					Array.isArray(manifest.assets) ||
					!manifest.layers ||
					typeof manifest.layers !== 'object' ||
					Array.isArray(manifest.layers)
				) {
					return { assets: new Map() };
				}

				const assets = new Map();
				for (const [logicalPath, entry] of Object.entries(manifest.assets)) {
					if (
						!entry ||
						typeof entry !== 'object' ||
						typeof entry.layer !== 'string' ||
						!Object.prototype.hasOwnProperty.call(manifest.layers, entry.layer) ||
						!Number.isSafeInteger(entry.offset) ||
						entry.offset < 0 ||
						!Number.isSafeInteger(entry.length) ||
						entry.length < 0 ||
						!Number.isSafeInteger(entry.offset + entry.length)
					) {
						continue;
					}

					const layer = manifest.layers[entry.layer];
					let layerPath = entry.layer;
					if (typeof layer === 'string') {
						layerPath = layer;
					} else if (layer && typeof layer === 'object' && typeof layer.path === 'string') {
						layerPath = layer.path;
					}
					if (!layerPath) continue;
					assets.set(logicalPath, {
						layerPath,
						offset: entry.offset,
						length: entry.length
					});
				}
				return { assets };
			})
			.catch(() => ({ assets: new Map() }));
	}
	return layeredRuntimeAssetManifestPromise;
}

async function shouldTryCompressedRuntimeAsset(request, url) {
	if (request.method !== 'GET' && request.method !== 'HEAD') return false;
	if (request.headers.has('range')) return false;
	if (precompressedExtension.test(url.pathname)) return false;
	const relativePath = relativePathInScope(url);
	let manifest = await compressedRuntimeAssetManifest();
	if (
		!manifest.assets.has(relativePath) &&
		Date.now() - compressedRuntimeAssetManifestMissRefreshAt >= 5000
	) {
		compressedRuntimeAssetManifestMissRefreshAt = Date.now();
		manifest = await compressedRuntimeAssetManifest(true);
	}
	return manifest.assets.has(relativePath);
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

function decompressedLayer(request, layerPath) {
	const layerUrl = new URL(layerPath, self.registration.scope);
	if (!layerUrl.pathname.endsWith('.gz')) layerUrl.pathname = `${layerUrl.pathname}.gz`;
	const cacheKey = layerUrl.href;
	let layerPromise = decompressedLayerPromises.get(cacheKey);
	if (!layerPromise) {
		const headers = new Headers(request.headers);
		headers.delete('range');
		layerPromise = fetch(layerUrl, {
			cache: request.cache,
			credentials: request.credentials,
			headers,
			mode: request.mode,
			redirect: request.redirect,
			referrer: request.referrer,
			referrerPolicy: request.referrerPolicy
		})
			.then((response) => {
				if (!response.ok || !response.body) throw new Error('layer fetch failed');
				const body = hasGzipContentEncoding(response)
					? response.body
					: response.body.pipeThrough(new DecompressionStream('gzip'));
				return new Response(body).arrayBuffer();
			})
			.then((bytes) => new Uint8Array(bytes))
			.catch(() => {
				if (decompressedLayerPromises.get(cacheKey) === layerPromise) {
					decompressedLayerPromises.delete(cacheKey);
				}
				return null;
			});
		decompressedLayerPromises.set(cacheKey, layerPromise);
	}
	return layerPromise;
}

async function fetchLayeredRuntimeAsset(request, url) {
	if (request.method !== 'GET' && request.method !== 'HEAD') return null;
	const manifest = await layeredRuntimeAssetManifest();
	const asset = manifest.assets.get(relativePathInScope(url));
	if (!asset) return null;

	let rangeStart = 0;
	let rangeEnd = asset.length - 1;
	let status = 200;
	let statusText = 'OK';
	const rangeHeader = request.headers.get('range');
	if (rangeHeader !== null) {
		const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
		let invalid = !match || (!match[1] && !match[2]) || asset.length === 0;
		if (!invalid && match[1]) {
			rangeStart = Number(match[1]);
			invalid = !Number.isSafeInteger(rangeStart) || rangeStart >= asset.length;
			if (!invalid && match[2]) {
				rangeEnd = Number(match[2]);
				invalid = !Number.isSafeInteger(rangeEnd) || rangeEnd < rangeStart;
			} else if (!invalid) {
				rangeEnd = asset.length - 1;
			}
			if (!invalid) rangeEnd = Math.min(rangeEnd, asset.length - 1);
		} else if (!invalid) {
			const suffixLength = Number(match[2]);
			invalid = !Number.isSafeInteger(suffixLength) || suffixLength <= 0;
			if (!invalid) {
				rangeStart = Math.max(asset.length - suffixLength, 0);
				rangeEnd = asset.length - 1;
			}
		}

		if (invalid) {
			return new Response(null, {
				status: 416,
				statusText: 'Range Not Satisfiable',
				headers: {
					'accept-ranges': 'bytes',
					'content-length': '0',
					'content-range': `bytes */${asset.length}`
				}
			});
		}
		status = 206;
		statusText = 'Partial Content';
	}

	const contentLength = rangeEnd >= rangeStart ? rangeEnd - rangeStart + 1 : 0;
	const headers = new Headers({
		'accept-ranges': 'bytes',
		'content-length': String(contentLength),
		'content-type': contentTypeForPath(url.pathname)
	});
	if (status === 206) {
		headers.set('content-range', `bytes ${rangeStart}-${rangeEnd}/${asset.length}`);
	}
	if (request.method === 'HEAD') {
		return new Response(null, { status, statusText, headers });
	}

	const layerBytes = await decompressedLayer(request, asset.layerPath);
	if (!layerBytes || asset.offset + asset.length > layerBytes.byteLength) return null;
	const body = layerBytes.slice(asset.offset + rangeStart, asset.offset + rangeEnd + 1);
	return new Response(body, { status, statusText, headers });
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
		(await fetchLayeredRuntimeAsset(aliasRequest, aliasUrl)) ||
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
					(await fetchLayeredRuntimeAsset(event.request, url)) ||
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
