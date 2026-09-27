import { afterEach, describe, expect, it, vi } from 'vitest';
import Clang from '../src/runtime.js';

const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
function harness() {
	return Object.assign(Object.create(Clang.prototype), {
		ready: Promise.resolve(), stdout: vi.fn(), log: false, showTiming: false,
		lastBuildKey: '', assetUrls: { clang: 'clang', lld: 'lld' },
		memfs: { addDirectory: vi.fn(), addFile: vi.fn(), getFileContents: () => wasm },
		getModule: vi.fn(async () => WebAssembly.compile(wasm)),
		compile: vi.fn(async () => null), run: vi.fn(async () => null),
		hostLogAsync: async (_label: string, operation: Promise<unknown>) => operation
	}) as Clang;
}
function libraries(clang: Clang) {
	return vi.mocked(clang.run).mock.calls.at(-1)!.slice(2);
}
afterEach(() => vi.restoreAllMocks());

describe('C-only linker profile', () => {
	it.each(['none', 'trace', 'lldb'] as const)('omits C++ archives for pure C in %s mode', async (debugMode) => {
		const clang = harness();
		await clang.compileLink('int main(void) { return 0; }', { language: 'C', debugMode });
		expect(libraries(clang)).toContain('-lc');
		expect(libraries(clang)).toContain('-lm');
		expect(libraries(clang)).toContain('-lclang_rt.builtins-wasm32');
		expect(libraries(clang)).not.toContain('-lc++');
		expect(libraries(clang)).not.toContain('-lc++abi');
		// Export policy is deliberately unchanged for debugger and API compatibility.
		expect(libraries(clang)).toContain('--export-dynamic');
	});
	it('omits C++ archives for several C translation units, ignoring headers', async () => {
		const clang = harness();
		await clang.compileLink('int main(void) { return 0; }', {
			language: 'C', activePath: 'src/main.c', workspaceFiles: [
				{ path: 'src/helper.c', content: 'int helper(void) { return 0; }' },
				{ path: 'include/helper.hpp', content: '/* not a translation unit */' }
			]
		});
		expect(clang.compile).toHaveBeenCalledTimes(2);
		expect(libraries(clang)).not.toContain('-lc++');
	});
	it.each(['cc', 'cpp', 'cxx'])('keeps C++ archives when a C project has a .%s unit', async (extension) => {
		const clang = harness();
		await clang.compileLink('int main(void) { return 0; }', {
			language: 'C', workspaceFiles: [{ path: `helper.${extension}`, content: 'int helper() { return 0; }' }]
		});
		expect(libraries(clang)).toContain('-lc++');
		expect(libraries(clang)).toContain('-lc++abi');
	});
	it.each([['-x', 'c++'], ['-xc++'], ['-x', 'c']])('conservatively retains archives for override %j', async (...compileArgs) => {
		const clang = harness();
		await clang.compileLink('int main() {}', { language: 'C', compileArgs });
		expect(libraries(clang)).toContain('-lc++');
	});
	it('keeps the default C++ profile and existing direct-link API behavior', async () => {
		const clang = harness();
		await clang.compileLink('int main() {}');
		expect(libraries(clang)).toContain('-lc++');
		await clang.link('foreign.o', 'foreign.wasm', false);
		expect(libraries(clang)).toContain('-lc++abi');
	});
	it('does not reuse the C link result after the workspace gains a C++ unit', async () => {
		const clang = harness();
		const code = 'int main(void) { return 0; }';
		await clang.compileLink(code, { language: 'C' });
		await clang.compileLink(code, { language: 'C', workspaceFiles: [{ path: 'helper.cpp', content: '' }] });
		expect(libraries(clang)).toContain('-lc++');
	});
});
