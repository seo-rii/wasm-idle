import source from './python.ts?raw';
import { describe, expect, it } from 'vitest';

describe('Python worker source', () => {
	it('strips the submitted line terminator from builtins.input return values', () => {
		expect(source).toContain('def __wasm_idle_input_wrapper(prompt = ""):');
		expect(source).toContain('if value.endswith("\\\\r\\\\n"):');
		expect(source).toContain('value = value[:-2]');
		expect(source).toContain('elif value.endswith("\\\\n") or value.endswith("\\\\r"):');
		expect(source).toContain('value = value[:-1]');
	});
});
