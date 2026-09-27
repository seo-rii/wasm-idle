import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	loadDotnetCompilerRuntime,
	resetDotnetCompilerRuntimeForTests
} from '../src/runtime-loader.js';
const token = 'a'.repeat(32);
const refs = () => [{ name: 'System.dll', bytesBase64: 'AQI=' }];
let serial = 0;
async function fixture(
	register = vi.fn(async () => JSON.stringify({ referenceSetId: token })),
	legacy = false
) {
	let abort!: (reason: unknown) => void;
	const bridge = {
		...(legacy ? {} : { RegisterReferences: register }),
		Compile: vi.fn(async (_s: string) => JSON.stringify({ success: true, assemblyId: 'app' })),
		Run: vi.fn(async () => '{}')
	};
	const options = {
		runtimeBaseUrl: `https://refs.test/${serial++}/`,
		dotnetModule: {
			dotnet: {
				withModuleConfig(c: { onAbort: (r: unknown) => void }) {
					abort = c.onAbort;
					return this;
				},
				create: vi.fn(async () => ({
					getAssemblyExports: async () => ({ CompilerHost: bridge })
				}))
			}
		}
	};
	return {
		runtime: await loadDotnetCompilerRuntime(options),
		bridge,
		register,
		options,
		abort: (r: unknown) => abort(r)
	};
}
const request = (references = refs()) => ({
	source: 'class Main {}',
	language: 'csharp' as const,
	target: 'browser-wasm' as const,
	references
});
afterEach(() => {
	resetDotnetCompilerRuntimeForTests();
	vi.restoreAllMocks();
});
describe('runtime-local reference registration', () => {
	it('registers once for preparation and repeated compilation, omitting base64 payloads', async () => {
		const f = await fixture();
		const references = refs();
		await f.runtime.prepareReferences!(references);
		await f.runtime.compile(request(references));
		await f.runtime.compile(request(references));
		expect(f.register).toHaveBeenCalledTimes(1);
		for (const [json] of f.bridge.Compile.mock.calls) {
			const p = JSON.parse(json);
			expect(p.referenceSetId).toBe(token);
			expect(p).not.toHaveProperty('references');
			expect(json).not.toContain('AQI=');
		}
	});
	it('coalesces concurrent registrations', async () => {
		const f = await fixture();
		const references = refs();
		await Promise.all([
			f.runtime.prepareReferences!(references),
			f.runtime.compile(request(references)),
			f.runtime.compile(request(references))
		]);
		expect(f.register).toHaveBeenCalledTimes(1);
		expect(f.bridge.Compile).toHaveBeenCalledTimes(2);
	});
	it('reuses a registration for equivalent reference arrays', async () => {
		const f = await fixture();
		for (let i = 0; i < 9; i++) await f.runtime.compile(request(refs()));
		expect(f.register).toHaveBeenCalledTimes(1);
		expect(f.bridge.Compile).toHaveBeenCalledTimes(9);
	});
	it('does not cache across runtime instances', async () => {
		const a = await fixture();
		const b = await fixture();
		const references = refs();
		await a.runtime.compile(request(references));
		await b.runtime.compile(request(references));
		expect(a.register).toHaveBeenCalledTimes(1);
		expect(b.register).toHaveBeenCalledTimes(1);
	});
	it('registers again after runtime failure', async () => {
		const f = await fixture();
		const references = refs();
		await f.runtime.compile(request(references));
		f.abort(new Error('fatal'));
		await expect(f.runtime.compile(request(references))).rejects.toThrow('fatal');
		const next = await loadDotnetCompilerRuntime(f.options);
		await next.compile(request(references));
		expect(f.register).toHaveBeenCalledTimes(2);
	});
	it('detects in-place name, byte and length changes', async () => {
		const f = await fixture();
		const references = refs();
		await f.runtime.compile(request(references));
		references[0].name = 'Other.dll';
		await f.runtime.compile(request(references));
		references[0].bytesBase64 = 'AwQ=';
		await f.runtime.compile(request(references));
		references.push({ name: 'Third.dll', bytesBase64: 'BQY=' });
		await f.runtime.compile(request(references));
		expect(f.register).toHaveBeenCalledTimes(4);
	});
	it('retries rejected registration and never compiles before successful registration', async () => {
		const register = vi
			.fn()
			.mockRejectedValueOnce(new Error('failed'))
			.mockResolvedValue(JSON.stringify({ referenceSetId: token }));
		const f = await fixture(register);
		const references = refs();
		await expect(f.runtime.compile(request(references))).rejects.toThrow('failed');
		expect(f.bridge.Compile).not.toHaveBeenCalled();
		await f.runtime.compile(request(references));
		expect(register).toHaveBeenCalledTimes(2);
	});
	it.each([
		{ error: 'full' },
		{ referenceSetId: '' },
		{ referenceSetId: 'forged' },
		{ referenceSetId: token, error: 'invalid' }
	])('rejects malformed registration response %j', async (response) => {
		const f = await fixture(vi.fn(async () => JSON.stringify(response)));
		await expect(f.runtime.compile(request())).rejects.toThrow();
		expect(f.bridge.Compile).not.toHaveBeenCalled();
	});
	it('preserves compatibility with existing managed runtimes', async () => {
		const f = await fixture(undefined, true);
		expect(f.runtime.prepareReferences).toBeUndefined();
		const req = request();
		await f.runtime.compile(req);
		expect(JSON.parse(f.bridge.Compile.mock.calls[0][0])).toEqual(req);
	});
	it('does not register empty sets or change requests without references', async () => {
		const f = await fixture();
		await f.runtime.prepareReferences!([]);
		await f.runtime.compile(request([]));
		expect(f.register).not.toHaveBeenCalled();
		expect(JSON.parse(f.bridge.Compile.mock.calls[0][0]).references).toEqual([]);
	});
});
