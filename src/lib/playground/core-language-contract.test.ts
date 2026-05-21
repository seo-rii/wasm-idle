import { describe, expect, it } from 'vitest';
import {
	createRuntimeAssetsKey,
	isDeferredProgressLanguage,
	normalizeLanguageId,
	supportedLanguageIds
} from '@wasm-idle/core';

describe('core language contract', () => {
	it('exposes Zig as a deferred browser runtime language', () => {
		expect(supportedLanguageIds).toContain('ZIG');
		expect(normalizeLanguageId('zig')).toBe('ZIG');
		expect(isDeferredProgressLanguage('zig')).toBe(true);
	});

	it('includes Zig compiler and stdlib urls in runtime asset cache keys', () => {
		const key = createRuntimeAssetsKey({
			rootUrl: '/repl',
			zig: {
				compilerUrl: '/wasm-zig/zig_small.wasm?v=test',
				stdlibUrl: '/wasm-zig/std.zip?v=test'
			}
		});

		expect(key).toContain('"zigCompilerUrl":"/wasm-zig/zig_small.wasm?v=test"');
		expect(key).toContain('"zigStdlibUrl":"/wasm-zig/std.zip?v=test"');
	});
});
