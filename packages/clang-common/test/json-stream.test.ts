import { describe, expect, it } from 'vitest';

import { JsonStream } from '../src/json-stream.js';

describe('JsonStream', () => {
	it('extracts complete JSON objects from surrounding output', () => {
		const stream = new JsonStream();
		const json = JSON.stringify({ jsonrpc: '2.0', result: { text: '} and "' } });
		const input = `clangd log\n${json}\n`;
		const messages = [...new TextEncoder().encode(input)]
			.map((byte) => stream.insert(byte))
			.filter((message): message is string => message !== null);

		expect(messages).toEqual([json]);
	});
});
