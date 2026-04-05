import compilerSource from '../../../static/wasm-go/compiler.js?raw';
import { describe, expect, it } from 'vitest';

describe('bundled wasm-go compiler', () => {
	it('ships the asset-aware progress mapping instead of the coarse fallback ranges', () => {
		expect(compilerSource).toContain('compile: [20, 88]');
		expect(compilerSource).toContain('link: [88, 97]');
		expect(compilerSource).toContain('resolving compile inputs');
		expect(compilerSource).toContain('preparing compile runtime');
		expect(compilerSource).not.toContain('compile: [35, 75]');
		expect(compilerSource).not.toContain('link: [75, 95]');
	});
});
