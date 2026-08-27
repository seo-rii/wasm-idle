self.addEventListener('install', function () {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});

const precompressedExtension = /\.(br|brotli|gz|tgz|zip|zst)$/i;
const exactResponseUrlAssetPaths = new Set([
	'wasm-awk/goawk.wasm.gz.bin',
	'wasm-awk/runner-worker.v2.js',
	'wasm-awk/runtime-manifest.v2.json',
	'wasm-awk/wasm_exec.js',
	'wasm-tinygo/upstream.js',
	'wasm-tinygo/assets/upstream-compile-worker-CFw6Ych6.js',
	'wasm-tinygo/assets/upstream-compile-worker-Dat9LBTc.js',
	'wasm-tinygo/assets/upstream-compile-worker-NPJcbr3r.js',
	'wasm-tinygo/assets/upstream-compile-worker-R7P8Uy5f.js'
]);
const exactResponseUrlAssetReceipts = new Map([
	['wasm-rust/asset-url.js.bin', '0cfc9638ca814251f9ddf117a5cef1832a1ee1c5035226f6538cdf739c55772a'],
	['wasm-rust/browser-component-tools.js.bin', '5d8981ab2e776cf1c91afdf7e08b7bacb53ff60ec9353294098309aa7db66d30'],
	['wasm-rust/browser-execution.js.bin', 'c6897e959c05627e5bb708a4f1d4035f6b911adc86e8d7c4a735cd391b91e944'],
	['wasm-rust/browser-linker.js.bin', '5bb3d25bab942c7908a0ec8116dc8c11c5c46117b3ccde40cd88219da2855cb7'],
	['wasm-rust/browser-stdin.js.bin', '52dba3d7edc435816adb4b795033000f3d5fee16bb265710b4361601f9a1eee5'],
	['wasm-rust/compiler-preload.js.bin', '00528f41dbe28a20bd3389889a01ab444780b66be68cfa312e701b17a2e6e185'],
	['wasm-rust/compiler-runtime.js.bin', 'cdb81fdb5d5ce4b872e74f622444ea4da87f3f76a2ae2d28250cb523f6c5da0f'],
	['wasm-rust/compiler-support.js.bin', 'cc42eadb107b61d04142739840d823fdbb70d9d167f9706e31e73291a085e6a3'],
	['wasm-rust/compiler-worker.js.bin', '0959cb65fd230338dd6c9a4534505125f2cb074065ea25b4fa0b7ed2d6278cf0'],
	['wasm-rust/compiler.js.bin', '540c35a4a00115a4fc9fe2e31363b80bba404bee66c75aad47639c269d2292be'],
	['wasm-rust/index.js.bin', 'cfbc70c3349b35c1f510ead79fdfb95bb29700f2566716b6b5fa0d1017cd00d7'],
	['wasm-rust/module-worker.js.bin', '317eee43c55be3923ffc9630342deeac9ff1030abb2cb2d222e1036ca796b3fc'],
	['wasm-rust/retryable-failure-kind.js.bin', '32d49e791d1c35329e8aa8dc16cc372ee0c52ba8570c7488c7f7a5a99e1e003c'],
	['wasm-rust/runtime-asset-store.js.bin', '769111f9fbcef89ad83cddd3a9081c8908638e0f0a1bb80702f65f454d0866ce'],
	['wasm-rust/runtime-asset.js.bin', 'a922e7598932199505715884ab75efb6bd2b4a283f2741e44b9e38a81f18d951'],
	['wasm-rust/runtime-manifest.js.bin', '8fb4f728a386c2350fd8e49f1c1cd3c562dbe6c602cb1762d976945b63549d27'],
	['wasm-rust/rustc-runtime.js.bin', 'f72739e496d8b9e012f323f30f5869f8fee2d444986494cfe08c378fc05e6913'],
	['wasm-rust/rustc-thread-worker.js.bin', '0fcaad568a966036952251eeabab53c99483d1e484f1cd7644ca5630ecdbb10e'],
	['wasm-rust/shared-workspace.js.bin', 'a522f740cac9d237cedb54ad4aaeb68e595a08073259a1e603f5dec3d7274469'],
	['wasm-rust/thread-startup.js.bin', '2c407a04ed387991ff4c770d3ba8af6f493217ba48c57df381ab13909799e258'],
	['wasm-rust/vendor/browser_wasi_shim/debug.js.bin', 'a91848ee180529e2a60c05dfb9584cad19cd4e1c6f391fdb76a938bcae4c0328'],
	['wasm-rust/vendor/browser_wasi_shim/fd.js.bin', '9e82e1fc1bfd3e3573f64349dc42b4b624ed61d24e5c553f2bb4d041444f166c'],
	['wasm-rust/vendor/browser_wasi_shim/fs_mem.js.bin', '85dbc9e0ee784d9ff8b55452644e00bf7058e32355aab974f8b71d7d85772324'],
	['wasm-rust/vendor/browser_wasi_shim/fs_opfs.js.bin', '4b96aaeb5ac5986cf802cbf22b975c656682d22a38248160c96fc2ded5644869'],
	['wasm-rust/vendor/browser_wasi_shim/index.js.bin', '7e2fd52ee3f728bb0b1d6e449724e0f13e3d586bb25bde6e02a66366175b5605'],
	['wasm-rust/vendor/browser_wasi_shim/strace.js.bin', 'ece435d3784d928d02bff4d015b7cb686f8c06de8536ff9f8ebc38a8f403a3be'],
	['wasm-rust/vendor/browser_wasi_shim/wasi.js.bin', '168eb977a826f75ab0c39f9322f78cc58dbd5b233019ad1d6a7e940af8a7c4aa'],
	['wasm-rust/vendor/browser_wasi_shim/wasi_defs.js.bin', '0db0f42ba330749a7b05095ea1fd0ff63fd2b30e84cead30fe4c28359d15f194'],
	['wasm-rust/vendor/jco/obj/js-component-bindgen-component.js.gz.bin', '7b5f36771a9bbcb47576d45d00629c59e9046166e5c6b686a2e3b77f0058e612'],
	['wasm-rust/vendor/jco/obj/wasm-tools.js.gz.bin', '9bf222d2dfc2006ee0ffe2a79f5d0d15816f44938458e0e0f6eec4ba820b0ff0'],
	['wasm-rust/vendor/jco/src/browser.js.bin', '7d8d056dedc4327245520d7b3b2ce1930953f017fe0335902899e8aa5dbd3f8e'],
	['wasm-rust/vendor/preview2-shim/lib/browser/cli.js.bin', 'fc73e8c872db6e100522ae1b41c1b7ae5160ac97629610cae53eb2bc2d320266'],
	['wasm-rust/vendor/preview2-shim/lib/browser/clocks.js.bin', '3a44508f62ce3cd3fb2adbabf8cc70be0c3fd962bb0e77cbc8125b6d5bba3f35'],
	['wasm-rust/vendor/preview2-shim/lib/browser/config.js.bin', 'ef5271f78522c5ecb7fee3579f73f12a43e85874f6bfcb24d449d0d6e1c9e813'],
	['wasm-rust/vendor/preview2-shim/lib/browser/environment.js.bin', '6a755f21d705e98caede66bb86e5aa880deff71c1721c39a641a59d287123298'],
	['wasm-rust/vendor/preview2-shim/lib/browser/filesystem.js.bin', '083e8c1be5c4b11264c3be7e15477fc37894723a649445daeaabfb973460acc5'],
	['wasm-rust/vendor/preview2-shim/lib/browser/http.js.bin', '270e10d75628add4d96878b705dbf0ce3121648540c2c8df331796f809c7d84a'],
	['wasm-rust/vendor/preview2-shim/lib/browser/io.js.bin', 'c2429defe2de286efe7579c76e17a627d68846fb9c100260b1f5ea4ddb370096'],
	['wasm-rust/vendor/preview2-shim/lib/browser/random.js.bin', '10ca591c575a43051f205ef953861e2bcba3a917e1ffbb40d74c0bc6985c4eb2'],
	['wasm-rust/vendor/preview2-shim/lib/browser/sockets.js.bin', 'a9a6ba4c7847c8109924447d36ec3087d410237e0728832f1de14625d03969e3'],
	['wasm-rust/worker-status.js.bin', '8c345945f87eb1305fca69d4b99cca7a3df90a8f5b4ac334cd04e5d5b5be7041']
]);
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
let layeredRuntimeAssetManifestLoadedAt = 0;
let layeredRuntimeAssetManifestMissRefreshAt = 0;
const decompressedLayerPromises = new Map();
const runtimeAssetManifestMaxAgeMs = 5000;

function shouldBypassIsolationHeaders(url) {
	return (
		url.pathname.includes('/webr/') &&
		!url.pathname.endsWith('/R.js') &&
		!url.pathname.endsWith('/webr-worker.js')
	);
}

function shouldPreserveExactResponseUrl(request, url) {
	const scopeUrl = new URL(self.registration.scope);
	const assetPath = url.pathname.startsWith(scopeUrl.pathname)
		? url.pathname.slice(scopeUrl.pathname.length)
		: '';
	const version = url.searchParams.get('v') || '';
	const exactReceipt = exactResponseUrlAssetReceipts.get(assetPath);
	return (
		request.method === 'GET' &&
		request.destination === '' &&
		request.credentials === 'omit' &&
		!request.headers.has('range') &&
		url.origin === scopeUrl.origin &&
		((exactReceipt !== undefined && version === exactReceipt) ||
			(exactReceipt === undefined &&
				exactResponseUrlAssetPaths.has(assetPath) &&
				/^[a-f0-9]{64}$/u.test(version))) &&
		url.search === `?v=${version}`
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

async function layeredRuntimeAssetManifest(forceRefresh = false) {
	const now = Date.now();
	if (
		forceRefresh ||
		!layeredRuntimeAssetManifestPromise ||
		now - layeredRuntimeAssetManifestLoadedAt >= runtimeAssetManifestMaxAgeMs
	) {
		layeredRuntimeAssetManifestLoadedAt = now;
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
					let layerVersion = null;
					if (typeof layer === 'string') {
						layerPath = layer;
					} else if (layer && typeof layer === 'object') {
						if (typeof layer.path === 'string') layerPath = layer.path;
						if (/^[0-9a-f]{64}$/u.test(layer.sha256)) layerVersion = layer.sha256;
					}
					if (!layerPath || !layerVersion) continue;
					assets.set(logicalPath, {
						layerPath,
						layerVersion,
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

function decompressedLayer(request, layerPath, layerVersion) {
	const layerUrl = new URL(layerPath, self.registration.scope);
	if (!layerUrl.pathname.endsWith('.gz')) layerUrl.pathname = `${layerUrl.pathname}.gz`;
	layerUrl.searchParams.set('__wasm_idle_layer', layerVersion);
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
	const relativePath = relativePathInScope(url);
	let manifest = await layeredRuntimeAssetManifest();
	let asset = manifest.assets.get(relativePath);
	if (
		!asset &&
		Date.now() - layeredRuntimeAssetManifestMissRefreshAt >= runtimeAssetManifestMaxAgeMs
	) {
		layeredRuntimeAssetManifestMissRefreshAt = Date.now();
		manifest = await layeredRuntimeAssetManifest(true);
		asset = manifest.assets.get(relativePath);
	}
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

	const layerBytes = await decompressedLayer(request, asset.layerPath, asset.layerVersion);
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
				if (shouldPreserveExactResponseUrl(event.request, url)) return fetch(event.request);
				return (
					(await fetchDynamicModule(event.request, url)) ||
					(await fetchRuntimeAssetAlias(event.request, url)) ||
					(await fetchLayeredRuntimeAsset(event.request, url)) ||
					(await fetchCompressedRuntimeAsset(event.request, url)) ||
					fetch(event.request)
				);
			})
			.then(function (response) {
				// Receipt-verified runtime consumers require the browser's network Response URL.
				// Cloning into a synthetic Response clears it, so preserve these pinned
				// same-origin responses exactly as fetched.
				if (shouldPreserveExactResponseUrl(event.request, url)) return response;
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
