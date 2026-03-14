// @ts-nocheck
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Python debug tracer source', () => {
	it('keeps bytes preview and hidden-local filtering in the injected debug script', () => {
		const source = readFileSync('src/lib/playground/worker/python.ts', 'utf8');

		expect(source).toContain('if isinstance(value, (bytes, bytearray)):');
		expect(source).toContain('name.startswith(".")');
		expect(source).toContain('sorted(list(value), key = repr)[:6]');
		expect(source).toContain('sys.settrace(None)');
		expect(source).toContain('if command != 5:');
		expect(source).toContain('expression = ${debugReadWatchName}()');
		expect(source).toContain('${debugWriteWatchName}(result)');
	});
});
