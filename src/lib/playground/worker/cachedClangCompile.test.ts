import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractCompilerDiagnostics } from '../../../../packages/llvm-core/runtime/clang/src/compiler-diagnostics';

const state = vi.hoisted(() => ({ fail: false }));
vi.mock('@wasm-idle/llvm-core/clang', () => {
	return {
		extractCompilerDiagnostics,
		resolveRuntimeManifestUrl: (base: string) => `${base}/manifest.json`,
		loadRuntimeManifest: async () => ({
			compiler: {
				clang: { asset: 'clang.gz' },
				lld: { asset: 'lld.gz' },
				sysroot: {}
			}
		}),
		BrowserClangRuntime: class {
			ready = Promise.resolve();
			constructor(private options: { stdout(chunk: string): void }) {}
			async compileArtifact() {
				this.options.stdout('\x1b[1mmain.c:2:3: \x1b[35mwarning: \x1b[0munused value\n');
				if (state.fail) throw new Error('compile failed');
				return {
					bytes: new Uint8Array(8),
					target: 'wasm32-wasi',
					format: 'wasi-core-wasm'
				};
			}
		}
	};
});
vi.mock('./assets', () => ({
	configureWorkerRuntimeAssets: vi.fn(),
	handleWorkerAssetMessage: () => false
}));
vi.mock('./runtimeModule', () => ({ compileWorkerRuntimeAsset: vi.fn() }));
vi.mock('../clangAssetIntegrity', () => ({
	BUNDLED_CLANG_ASSET_INTEGRITY: {},
	BUNDLED_CLANG_LANGUAGE_SYSROOT_PROFILES: {}
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('cached compile worker diagnostic protocol', () => {
	it.each([false, true])('includes structured output when compile fails=%s', async (fail) => {
		state.fail = fail;
		const posted: any[] = [];
		vi.stubGlobal('postMessage', (message: unknown) => posted.push(message));
		vi.stubGlobal('onmessage', null);
		await import('./cachedClangCompile');
		const handle = globalThis.onmessage as unknown as (event: {
			data: unknown;
		}) => Promise<void>;
		await handle({
			data: {
				request: { code: 'int main(void) {}', language: 'C' },
				runtimeBaseUrl: 'https://assets.test/',
				assets: {}
			}
		});
		const response = posted.find((message) => message.type === (fail ? 'error' : 'compiled'));
		expect(response.diagnostics).toEqual([
			{
				fileName: 'main.c',
				lineNumber: 2,
				columnNumber: 3,
				severity: 'warning',
				message: 'unused value'
			}
		]);
		expect(response.stdout).toContain('unused value');
	});
});
