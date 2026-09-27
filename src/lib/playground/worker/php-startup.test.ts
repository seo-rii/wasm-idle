import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ importRuntime: vi.fn(), create: vi.fn() }));
vi.mock('$lib/playground/runtimeModule', () => ({
	importRuntimeModule: mocks.importRuntime
}));
const runtime = () => ({
	exit: vi.fn(),
	mkdir: vi.fn(),
	writeFile: vi.fn(),
	rmdir: vi.fn(),
	run: vi.fn()
});
const deferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
async function worker() {
	await import('./php');
	return (globalThis as any).self.onmessage as (event: { data: unknown }) => Promise<void>;
}
const load = (url = '/php/runtime.mjs') => ({
	data: { load: true, moduleUrl: url, log: false }
});

beforeEach(() => {
	vi.resetModules();
	vi.resetAllMocks();
	(globalThis as any).self = globalThis;
	(globalThis as any).postMessage = vi.fn();
	mocks.importRuntime.mockResolvedValue({ createPhp84: mocks.create });
	mocks.create.mockImplementation(async () => runtime());
});

describe('PHP startup retry and ownership', () => {
	it('retries a failed module import instead of caching its rejection forever', async () => {
		mocks.importRuntime.mockRejectedValueOnce(new Error('network'));
		const handle = await worker();
		await handle(load());
		await handle(load());
		expect(mocks.importRuntime).toHaveBeenCalledTimes(2);
		expect(mocks.create).toHaveBeenCalledTimes(1);
		expect(postMessage).toHaveBeenCalledWith({ error: 'network' });
		expect(postMessage).toHaveBeenCalledWith({ load: true });
	});
	it('retries failed PHP VM creation and workspace setup', async () => {
		const broken = runtime();
		broken.mkdir.mockImplementation(() => {
			throw new Error('mkdir');
		});
		mocks.create.mockRejectedValueOnce(new Error('VM')).mockResolvedValueOnce(broken);
		const handle = await worker();
		await handle(load());
		await handle(load());
		await handle(load());
		expect(mocks.create).toHaveBeenCalledTimes(3);
		expect(broken.exit).toHaveBeenCalledOnce();
		expect(postMessage).toHaveBeenCalledWith({ error: 'VM' });
		expect(postMessage).toHaveBeenCalledWith({ error: 'mkdir' });
		expect(postMessage).toHaveBeenCalledWith({ load: true });
	});
	it('deduplicates concurrent and later successful same-configuration loads', async () => {
		const pending = deferred<ReturnType<typeof runtime>>();
		mocks.create.mockReturnValue(pending.promise);
		const handle = await worker();
		const a = handle(load()),
			b = handle(load());
		await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		pending.resolve(runtime());
		await Promise.all([a, b]);
		await handle(load());
		expect(mocks.importRuntime).toHaveBeenCalledOnce();
		expect(mocks.create).toHaveBeenCalledOnce();
	});
	it('an old failure cannot clear the pending new URL', async () => {
		const old = deferred<unknown>(),
			newer = deferred<unknown>();
		mocks.importRuntime.mockImplementation((url: string) =>
			url.includes('old') ? old.promise : newer.promise
		);
		const handle = await worker();
		const a = handle(load('/old.mjs')),
			b = handle(load('/new.mjs'));
		old.reject(new Error('old failure'));
		await a;
		expect(vi.mocked(postMessage).mock.calls.filter(([value]) => value?.error)).toEqual([]);
		const c = handle(load('/new.mjs'));
		newer.resolve({ createPhp84: mocks.create });
		await Promise.all([b, c]);
		expect(mocks.importRuntime).toHaveBeenCalledTimes(2);
		expect(mocks.create).toHaveBeenCalledOnce();
	});
	it('does not initialize or acknowledge a superseded module import', async () => {
		const old = deferred<unknown>();
		mocks.importRuntime.mockImplementation((url: string) =>
			url.includes('old') ? old.promise : Promise.resolve({ createPhp84: mocks.create })
		);
		const handle = await worker();
		const a = handle(load('/old.mjs'));
		await handle(load('/new.mjs'));
		old.resolve({ createPhp84: mocks.create });
		await a;
		expect(mocks.create).toHaveBeenCalledOnce();
		expect(vi.mocked(postMessage).mock.calls.filter(([value]) => value?.error)).toEqual([]);
		expect(
			vi.mocked(postMessage).mock.calls.filter(([value]) => value?.load === true)
		).toHaveLength(1);
	});
	it('does not publish stale readiness after the old VM finishes late', async () => {
		const old = deferred<ReturnType<typeof runtime>>();
		const oldVm = runtime(),
			newVm = runtime();
		mocks.create.mockReturnValueOnce(old.promise).mockResolvedValueOnce(newVm);
		const handle = await worker();
		const a = handle(load('/old.mjs'));
		await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
		await handle(load('/new.mjs'));
		old.resolve(oldVm);
		await a;
		expect(oldVm.exit).toHaveBeenCalledOnce();
		expect(oldVm.mkdir).not.toHaveBeenCalled();
		expect(newVm.mkdir).toHaveBeenCalledOnce();
		await handle(load('/new.mjs'));
		expect(mocks.create).toHaveBeenCalledTimes(2);
	});
	it('disposes a completed runtime when a different module URL replaces it', async () => {
		const oldVm = runtime(),
			newVm = runtime();
		mocks.create.mockResolvedValueOnce(oldVm).mockResolvedValueOnce(newVm);
		const handle = await worker();
		await handle(load('/old.mjs'));
		await handle(load('/new.mjs'));
		await vi.waitFor(() => expect(oldVm.exit).toHaveBeenCalledOnce());
		expect(newVm.exit).not.toHaveBeenCalled();
	});
	it('a prepare operation initializes the VM but never runs user code', async () => {
		const php = runtime();
		mocks.create.mockResolvedValue(php);
		const handle = await worker();
		await handle(load());
		await handle({
			data: {
				prepare: true,
				code: '<?php die("must not run");',
				buffer: new SharedArrayBuffer(4096),
				log: false
			}
		});
		expect(php.run).not.toHaveBeenCalled();
		expect(php.writeFile).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith({ results: true });
	});
});
