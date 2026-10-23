import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transpile: vi.fn(), imports: vi.fn() }));
vi.mock('../src/browser-component-tools.js', () => ({
	transpilePreview2Component: mocks.transpile,
	createPreview2ImportObject: mocks.imports
}));

import {
	clearBrowserRustExecutionCache,
	executeBrowserRustArtifact
} from '../src/browser-execution.js';

const entry = `export async function instantiate(getCoreModule, imports) {
  await getCoreModule('main.wasm');
  return { run: { run() { imports.stdout(new TextEncoder().encode(imports.args.join(','))); } } };
}`;
const generated = () => ({
	files: new Map([
		['main.js', new TextEncoder().encode(entry)],
		['main.wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])]
	]),
	imports: [],
	exports: []
});
const artifact = (wasm = new Uint8Array([1, 2, 3])) => ({
	wasm,
	format: 'component' as const,
	targetTriple: 'wasm32-wasip2' as const
});
const runtime = 'https://example.test/v1/runtime/';

function setup() {
	mocks.transpile.mockResolvedValue(generated());
	mocks.imports.mockImplementation(async (_base, options) => options);
	vi.spyOn(URL, 'createObjectURL').mockReturnValue(
		`data:text/javascript,${encodeURIComponent(entry)}`
	);
	vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
}

afterEach(() => {
	clearBrowserRustExecutionCache();
	vi.restoreAllMocks();
	mocks.transpile.mockReset();
	mocks.imports.mockReset();
});

describe('component execution cache', () => {
	it('reuses JCO output and core Modules with fresh import state', async () => {
		setup();
		const compile = vi.spyOn(WebAssembly, 'compile');
		expect(
			(await executeBrowserRustArtifact(artifact(), runtime, { args: ['one'] })).stdout
		).toBe('component.wasm,one');
		expect(
			(await executeBrowserRustArtifact(artifact(), runtime, { args: ['two'] })).stdout
		).toBe('component.wasm,two');
		expect(mocks.transpile).toHaveBeenCalledOnce();
		expect(compile).toHaveBeenCalledOnce();
		expect(mocks.imports).toHaveBeenCalledTimes(2);
	});

	it('separates runtime identities, mutable artifact contents, and bounds component entries', async () => {
		setup();
		const bytes = new Uint8Array([1, 2, 3]);
		await executeBrowserRustArtifact(artifact(bytes), runtime);
		await executeBrowserRustArtifact(artifact(bytes), runtime.replace('/v1/', '/v2/'));
		bytes[0] = 2;
		await executeBrowserRustArtifact(artifact(bytes), runtime);
		await executeBrowserRustArtifact(artifact(), runtime);
		expect(mocks.transpile).toHaveBeenCalledTimes(4);
	});

	it('evicts failed transpilations and never retains a result cleared while pending', async () => {
		setup();
		mocks.transpile.mockRejectedValueOnce(new Error('JCO failed'));
		await expect(executeBrowserRustArtifact(artifact(), runtime)).rejects.toThrow('JCO failed');
		let finish!: (value: ReturnType<typeof generated>) => void;
		mocks.transpile.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const running = executeBrowserRustArtifact(artifact(), runtime);
		await vi.waitFor(() => expect(mocks.transpile).toHaveBeenCalledTimes(2));
		clearBrowserRustExecutionCache();
		finish(generated());
		await running;
		await executeBrowserRustArtifact(artifact(), runtime);
		expect(mocks.transpile).toHaveBeenCalledTimes(3);
	});
});
