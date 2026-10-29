import { SCALA_ASSET_RECEIPTS } from './asset-receipts.js';

/** Build the complete executable graph only from verified in-memory source bytes. */
/** @param {Record<string, Uint8Array>} payload */
export async function loadScalaCompilerAssets(payload) {
	const names = Object.keys(payload ?? {}).sort();
	const expected = SCALA_ASSET_RECEIPTS.map((entry) => entry.path).sort();
	if (names.length !== expected.length || names.some((name, index) => name !== expected[index]))
		throw new Error('Scala requires exactly the pinned compiler asset graph.');
	for (const receipt of SCALA_ASSET_RECEIPTS) {
		const bytes = payload[receipt.path];
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== receipt.bytes)
			throw new Error(`Scala asset size mismatch: ${receipt.path}`);
		const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
		const hash = Array.from(new Uint8Array(digest), (value) =>
			value.toString(16).padStart(2, '0')
		).join('');
		if (hash !== receipt.sha256)
			throw new Error(`Scala asset integrity mismatch: ${receipt.path}`);
	}
	/** @type {string[]} */
	const urls = [];
	/** @param {BlobPart} bytes */
	const url = (bytes, type = 'text/javascript') => {
		const result = URL.createObjectURL(new Blob([bytes], { type }));
		urls.push(result);
		return result;
	};
	/** @param {string} path */
	const text = (path) => new TextDecoder('utf-8', { fatal: true }).decode(payload[path]);
	/** @param {string} source @param {string} from @param {string} to */
	const replace = (source, from, to) => {
		if (source.split(from).length !== 2)
			throw new Error('Scala compiler graph does not match pinned rewrite profile.');
		return source.replace(from, to);
	};
	try {
		const zipGlobal = url(Uint8Array.from(payload['vendor/jszip.global.js']));
		const wrapper = url(
			replace(
				text('vendor/jszip-wrapper.js'),
				'"./jszip.global.js"',
				JSON.stringify(zipGlobal)
			)
		);
		const loader = url(Uint8Array.from(payload['compiler/__loader.js']));
		const wasm = url(Uint8Array.from(payload['compiler/main.wasm']), 'application/wasm');
		let source = text('compiler/main.js');
		source = replace(source, '"../vendor/jszip-wrapper.js"', JSON.stringify(wrapper));
		source = replace(source, '"./__loader.js"', JSON.stringify(loader));
		source = replace(source, '"./main.wasm"', JSON.stringify(wasm));
		const compiler = await import(/* @vite-ignore */ url(source));
		const { default: JSZip } = await import(/* @vite-ignore */ wrapper);
		return { compiler, JSZip };
	} finally {
		for (const value of urls) URL.revokeObjectURL(value);
	}
}
