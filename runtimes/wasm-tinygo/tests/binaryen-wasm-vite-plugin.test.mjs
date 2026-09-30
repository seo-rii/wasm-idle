import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { parse } from 'acorn';
import {
	createBinaryenWasmPlugin,
	extractBinaryenWasm
} from '../scripts/binaryen-wasm-vite-plugin.mjs';

const parseModule = (source) => parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
const decoder =
	'function decode(r){for(var i=0,j=r.length,b=new Uint8Array(j),n;i<j;++i)n=r.charCodeAt(i),b[i]=~n>>8&n;return b}';
const source = decoder + 'export const wasm = decode(`\\0asm\\x01\\0\\0\\0`);';

test('extracts the exact Wasm bytes without evaluating the module', () => {
	const result = extractBinaryenWasm('throw new Error("never execute");' + source, parseModule);
	assert.deepEqual([...result.wasm], [0, 97, 115, 109, 1, 0, 0, 0]);
});

test('rejects unknown byte decoders and ambiguous payloads', () => {
	assert.throws(
		() => extractBinaryenWasm(source.replace('~n>>8&n', 'n+1'), parseModule),
		/decoder/
	);
	assert.throws(
		() => extractBinaryenWasm(source + ';decode(`\\0asm\\x01\\0\\0\\0`)', parseModule),
		/exactly one/
	);
});

test('emits compressed Wasm with a pinned logical loader and removes the inline payload', () => {
	const emitted = [];
	const plugin = createBinaryenWasmPlugin();
	const output = plugin.transform.call(
		{ parse: parseModule, emitFile: (file) => emitted.push(file) },
		source,
		'/node_modules/binaryen/index.js'
	);
	assert.equal(emitted.length, 1);
	assert.deepEqual([...gunzipSync(emitted[0].source)], [0, 97, 115, 109, 1, 0, 0, 0]);
	assert.match(emitted[0].fileName, /^assets\/upstream-binaryen-[a-f0-9]{16}\.wasm\.gz\.bin$/);
	assert.match(output.code, /crypto\.subtle\.digest/);
	assert.doesNotMatch(output.code, /decode\(`/);
	parseModule(output.code);
});
