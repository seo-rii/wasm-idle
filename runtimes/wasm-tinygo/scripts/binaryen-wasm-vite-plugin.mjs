import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

// Binaryen 129's single-file Emscripten build encodes its Wasm in a JS template.
// Keep the upstream JS intact apart from replacing that decoder call with a
// receipt-checked external payload. Never evaluate the upstream source at build time.
export function extractBinaryenWasm(source, parse) {
	const candidates = [];
	const visit = (node) => {
		if (!node || typeof node !== 'object') return;
		if (
			node.type === 'CallExpression' &&
			node.callee.type === 'Identifier' &&
			node.arguments.length === 1
		) {
			const argument = node.arguments[0];
			if (
				argument.type === 'TemplateLiteral' &&
				argument.expressions.length === 0 &&
				argument.quasis[0].value.cooked?.startsWith('\0asm\x01\0\0\0')
			) {
				candidates.push({ node, value: argument.quasis[0].value.cooked });
			}
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === 'value' || key === 'raw') continue;
			if (Array.isArray(value)) value.forEach(visit);
			else if (value && typeof value === 'object') visit(value);
		}
	};
	visit(parse(source));
	if (candidates.length !== 1)
		throw new Error('Expected exactly one embedded Binaryen Wasm decoder call');
	const { node, value } = candidates[0];
	const decoder = node.callee.name;
	// Verify the exact upstream byte decoder before reproducing its conversion.
	const escaped = decoder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const decoderPattern = new RegExp(
		`function ${escaped}\\([^)]*\\)\\{[^{}]*charCodeAt\\([^)]*\\)[^{}]*=~[^{}]*>>8&[^{}]*return [^{}]+\\}`
	);
	if (!decoderPattern.test(source)) throw new Error('Unsupported Binaryen embedded Wasm decoder');
	const wasm = Uint8Array.from(value, (character) => {
		const code = character.charCodeAt(0);
		return (~code >> 8) & code;
	});
	if (!WebAssembly.validate(wasm))
		throw new Error('Extracted Binaryen payload is not valid Wasm');
	return { start: node.start, end: node.end, wasm };
}

export function createBinaryenWasmPlugin() {
	return {
		name: 'tinygo-external-binaryen-wasm',
		enforce: 'pre',
		transform(source, id) {
			if (!/[/\\]binaryen[/\\]index\.js$/.test(id)) return;
			const extracted = extractBinaryenWasm(source, (input) => this.parse(input));
			const hash = createHash('sha256').update(extracted.wasm).digest('hex');
			const fileName = `assets/upstream-binaryen-${hash.slice(0, 16)}.wasm.gz.bin`;
			const compressed = gzipSync(extracted.wasm, { level: 9 });
			this.emitFile({ type: 'asset', fileName, source: compressed });
			// Worker chunks live in assets/. The verified graph substitutes this URL
			// with a Blob of already verified logical Wasm bytes; direct producer
			// previews receive gzip and use the same logical receipt below.
			const loader = `async function __loadBinaryenWasm(url) {
				const response = await fetch(url, { redirect: 'error' });
				if (!response.ok) throw new Error('Binaryen Wasm download failed');
				let stream = response.body;
				if (!stream) throw new Error('Binaryen Wasm response has no body');
				const reader = stream.getReader();
				let first = await reader.read();
				while (!first.done && first.value.byteLength < 2) {
					const next = await reader.read();
					if (next.done) break;
					const joined = new Uint8Array(first.value.byteLength + next.value.byteLength);
					joined.set(first.value); joined.set(next.value, first.value.byteLength);
					first = { done: false, value: joined };
				}
				let received = first.value ? first.value.byteLength : 0;
				const limit = ${extracted.wasm.byteLength};
				const deliveryLimit = ${Math.max(extracted.wasm.byteLength, compressed.byteLength)};
				stream = new ReadableStream({
					start(controller) { if (first.value) controller.enqueue(first.value); },
					async pull(controller) {
						const next = await reader.read();
						if (next.done) { controller.close(); return; }
						received += next.value.byteLength;
						if (received > deliveryLimit) { await reader.cancel(); controller.error(new Error('Binaryen Wasm exceeds receipt')); return; }
						controller.enqueue(next.value);
					},
					cancel(reason) { return reader.cancel(reason); }
				});
				if (received > deliveryLimit) { await reader.cancel(); throw new Error('Binaryen Wasm exceeds receipt'); }
				if (first.value?.[0] === 31 && first.value?.[1] === 139) stream = stream.pipeThrough(new DecompressionStream('gzip'));
				const output = new Uint8Array(limit);
				const outputReader = stream.getReader();
				let offset = 0;
				for (;;) {
					const next = await outputReader.read();
					if (next.done) break;
					if (offset + next.value.byteLength > limit) { await outputReader.cancel(); throw new Error('Binaryen Wasm exceeds receipt'); }
					output.set(next.value, offset); offset += next.value.byteLength;
				}
				const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', output)), byte => byte.toString(16).padStart(2, '0')).join('');
				if (offset !== limit || actual !== '${hash}') throw new Error('Binaryen Wasm receipt mismatch');
				return output;
			}\n`;
			const replacement = `await __loadBinaryenWasm(new URL('./${fileName.slice('assets/'.length)}', import.meta.url))`;
			return {
				code:
					loader +
					source.slice(0, extracted.start) +
					replacement +
					source.slice(extracted.end),
				map: null
			};
		}
	};
}
