// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const readBuffer = vi.hoisted(() => vi.fn());
vi.mock('../../core/src/wasm.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../core/src/wasm.js')>()),
	readBuffer
}));
import Clang from '../src/runtime.js';

const libraryPath = 'lib/wasm32-wasi/libc-printscan-long-double.a';
const assetUrl = 'https://cdn.test/clang/libc-printscan-long-double.a.gz';
const archive = new TextEncoder().encode('!<arch>\n');
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function harness({
	hosted = true,
	bundled = false,
	signal
}: { hosted?: boolean; bundled?: boolean; signal?: AbortSignal } = {}) {
	const files = new Map<string, Uint8Array>();
	if (bundled) files.set(libraryPath, archive);
	const runtime = Object.assign(Object.create(Clang.prototype), {
		ready: Promise.resolve(),
		log: false,
		path: '',
		stdout: vi.fn(),
		maxAssetBytes: 123_456,
		signal,
		assetUrls: { lld: 'lld', ...(hosted ? { printscanLongDouble: assetUrl } : {}) },
		memfs: {
			hasFile: vi.fn((path: string) => files.has(path)),
			addFile: vi.fn((path: string, contents: Uint8Array) => files.set(path, contents))
		},
		getModule: vi.fn(async () => ({})),
		run: vi.fn(async () => null)
	}) as Clang;
	return { runtime, files };
}
afterEach(() => {
	readBuffer.mockReset();
});

describe('WASI long double linker support', () => {
	it('waits for the base sysroot before preparing arguments for a direct linker caller', async () => {
		const ready = deferred<void>();
		readBuffer.mockResolvedValue(archive);
		const { runtime } = harness();
		runtime.ready = ready.promise;
		const argumentsReady = runtime.prepareLongDoubleLinkArgs();
		await Promise.resolve();
		expect(readBuffer).not.toHaveBeenCalled();
		expect(runtime.memfs.hasFile).not.toHaveBeenCalled();
		ready.resolve();
		await expect(argumentsReady).resolves.toEqual(['-lc-printscan-long-double']);
	});

	it.each(['C', 'CPP', 'OBJC'] as const)(
		'links the bundled printf/scanf replacement before libc for %s',
		async (language) => {
			const { runtime } = harness({ hosted: false, bundled: true });
			await runtime.link('main.o', 'main.wasm', 'none', language);
			const args = vi.mocked(runtime.run).mock.calls[0].slice(2);
			expect(args).toContain('-lc-printscan-long-double');
			expect(args.indexOf('-lc-printscan-long-double')).toBeLessThan(args.indexOf('-lc'));
			expect(readBuffer).not.toHaveBeenCalled();
		}
	);
	it('shares one archive load across concurrent links and mounts it before either linker runs', async () => {
		const download = deferred<Uint8Array>();
		readBuffer.mockReturnValue(download.promise);
		const { runtime, files } = harness();
		const first = runtime.link('main.o', 'main.wasm', 'none', 'C');
		const second = runtime.link('other.o', 'other.wasm');
		await vi.waitFor(() => expect(readBuffer).toHaveBeenCalledOnce());
		expect(runtime.run).not.toHaveBeenCalled();
		download.resolve(archive);
		await Promise.all([first, second]);
		expect(readBuffer).toHaveBeenCalledWith(assetUrl, undefined, 123_456);
		expect(files.get(libraryPath)).toEqual(archive);
		expect(runtime.memfs.addFile).toHaveBeenCalledOnce();
		for (const args of vi.mocked(runtime.run).mock.calls)
			expect(args).toContain('-lc-printscan-long-double');
		await runtime.link('again.o', 'again.wasm', 'none', 'C');
		expect(readBuffer).toHaveBeenCalledOnce();
	});
	it('rejects a failed archive load before linking and allows a later retry', async () => {
		readBuffer
			.mockRejectedValueOnce(new Error('download failed'))
			.mockResolvedValueOnce(archive);
		const { runtime } = harness();
		await expect(runtime.link('main.o', 'main.wasm', 'none', 'C')).rejects.toThrow(
			'download failed'
		);
		expect(runtime.run).not.toHaveBeenCalled();
		expect(runtime.memfs.addFile).not.toHaveBeenCalled();
		await runtime.link('main.o', 'main.wasm', 'none', 'C');
		expect(readBuffer).toHaveBeenCalledTimes(2);
	});
	it('does not install or link a download aborted before it resolves', async () => {
		const controller = new AbortController();
		const download = deferred<Uint8Array>();
		readBuffer.mockReturnValue(download.promise);
		const { runtime } = harness({ signal: controller.signal });
		const link = runtime.link('main.o', 'main.wasm', 'none', 'C');
		const rejected = expect(link).rejects.toThrow('cancelled');
		await vi.waitFor(() => expect(readBuffer).toHaveBeenCalledOnce());
		expect(readBuffer).toHaveBeenCalledWith(assetUrl, undefined, 123_456, controller.signal);
		controller.abort(new Error('cancelled'));
		download.resolve(archive);
		await rejected;
		expect(runtime.memfs.addFile).not.toHaveBeenCalled();
		expect(runtime.run).not.toHaveBeenCalled();
	});
	it('uses an archive already in the sysroot without downloading another copy', async () => {
		const { runtime } = harness({ bundled: true });
		await runtime.link('main.o', 'main.wasm', 'none', 'C');
		expect(readBuffer).not.toHaveBeenCalled();
	});
	it('keeps older external sysroots without the archive or an opt-in asset usable', async () => {
		const { runtime } = harness({ hosted: false });
		await runtime.link('main.o', 'main.wasm', 'none', 'C');
		expect(readBuffer).not.toHaveBeenCalled();
		expect(vi.mocked(runtime.run).mock.calls[0]).not.toContain('-lc-printscan-long-double');
	});
});
