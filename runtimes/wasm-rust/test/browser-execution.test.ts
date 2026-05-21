import { describe, expect, it } from 'vitest';

import { BufferedExecutionInput } from '../src/browser-stdin.js';

describe('browser execution stdin buffering', () => {
	it('treats null as EOF', () => {
		const input = new BufferedExecutionInput(() => null);

		expect(input.read(16)).toEqual(new Uint8Array(0));
	});

	it('rejects empty stdin chunks so callers cannot accidentally spin forever', () => {
		const input = new BufferedExecutionInput(() => '');

		expect(() => input.read(16)).toThrow(/empty chunks are not allowed/);
	});

	it('rejects undefined from stdin callbacks and requires an explicit null EOF sentinel', () => {
		const input = new BufferedExecutionInput(() => undefined as never);

		expect(() => input.read(16)).toThrow(/must return null to signal EOF/);
	});
});
