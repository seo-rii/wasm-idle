// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainer, type Container } from '@wasm-idle/container';
import { ScriptExitError } from '../playground/executionObservation.js';
import { WebsiteRuntimeAdapter } from './runtime-adapter.js';
import { emptyProjectDirectories, readWorkspaceDirectories } from './workspace.js';
import type { PlaygroundBinding } from '../playground/sandbox.js';

const owned: Container[] = [];
afterEach(async () => {
	await Promise.all(owned.splice(0).map((container) => container.dispose()));
});
function fixture(limits: { maxBytes?: number; maxInodes?: number } = {}) {
	const adapter = new WebsiteRuntimeAdapter({
		runtimeAssets: '/wasm-idle/',
		emit: vi.fn(),
		createBinding: vi.fn()
	});
	const container = createContainer({
		adapters: [adapter.adapter],
		commands: adapter.commands,
		maxBytes: 16 * 1024 * 1024,
		...limits
	});
	adapter.attach(container);
	owned.push(container);
	return { adapter, container };
}
const f = (path: string, content: string) => ({ path, content });
const read = (container: Container, path: string) =>
	new TextDecoder().decode(container.fs.readFile(path));

function runtimeGate<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function executionFixture(limits: { maxOutputBytes?: number } = {}) {
	const sandbox = {
		output: undefined as ((data: string) => void) | undefined,
		load: vi.fn(async () => {}),
		run: vi.fn(async () => true),
		terminate: vi.fn(async () => {}),
		clear: vi.fn(),
		write: vi.fn(),
		eof: vi.fn()
	};
	const binding = { load: vi.fn(async () => sandbox), dispose: vi.fn(async () => {}) };
	const adapter = new WebsiteRuntimeAdapter({
		runtimeAssets: '/',
		emit: vi.fn(),
		createBinding: () => binding as unknown as PlaygroundBinding
	});
	const container = createContainer({
		adapters: [adapter.adapter],
		commands: adapter.commands,
		...limits
	});
	adapter.attach(container);
	owned.push(container);
	return {
		adapter,
		container,
		sandbox,
		binding,
		run: (signal = new AbortController().signal) =>
			adapter.execute('run', 'PYTHON', 'print(1)', true, [], {}, signal)
	};
}

describe('container execution file representations', () => {
	it.each(['BASH', 'PYTHON', 'RUBY'])(
		'passes text siblings to %s without converting binary data',
		(language) => {
			const { adapter } = fixture();
			const binary = Uint8Array.of(0, 255, 128);
			adapter.syncWorkspace(language, [
				f('main.txt', 'active'),
				f('data/notes.txt', '한글'),
				f('empty.txt', ''),
				f('bom.txt', '\ufeffhello'),
				{ path: 'bytes.dat', content: binary },
				{ path: 'image.bin', content: Uint8Array.of(65) }
			]);
			const input = adapter.inputs(language, 'stale editor source', {
				activePath: 'main.txt'
			});
			expect(input.code).toBe('active');
			expect(input.options.workspaceFiles).toEqual(
				expect.arrayContaining([
					f('main.txt', 'active'),
					f('data/notes.txt', '한글'),
					f('empty.txt', ''),
					f('bom.txt', '\ufeffhello'),
					{ path: 'bytes.dat', content: binary },
					{ path: 'image.bin', content: Uint8Array.of(65) }
				])
			);
			expect(
				adapter.readWorkspace(language).find((file) => file.path === 'data/notes.txt')
					?.content
			).toEqual(new TextEncoder().encode('한글'));
		}
	);

	it('passes uploaded WASM bytes and text-form WASM sources to the runtime', () => {
		const { adapter } = fixture();
		const path = 'modules/answer.wasm';
		const base64 = 'AGFzbQEAAAABBQFgAAF/AwIBAAcKAQZhbnN3ZXIAAAoGAQQAQSoL';
		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		adapter.syncWorkspace('WASM', [{ path, content: bytes }]);
		const input = adapter.inputs('WASM', '', { activePath: path });
		expect(input.code).toBe('data:application/wasm;base64,' + base64);
		expect(input.options.workspaceFiles).toEqual([f(path, input.code)]);
		expect(adapter.readWorkspace('WASM')).toEqual([{ path, content: bytes }]);
		adapter.syncWorkspace('WASM', [f(path, base64)]);
		expect(adapter.inputs('WASM', '', { activePath: path }).code).toBe(base64);
	});
});

it('records an explicit nonzero status on the container process and returns it to the terminal', async () => {
	const f = executionFixture();
	const spawn = f.container.spawn.bind(f.container);
	let admitted: Awaited<ReturnType<typeof spawn>> | undefined;
	vi.spyOn(f.container, 'spawn').mockImplementationOnce(async (...args) => {
		admitted = await spawn(...args);
		return admitted;
	});
	const exit = new ScriptExitError(7);
	f.sandbox.run.mockRejectedValueOnce(exit);
	await expect(f.run()).rejects.toBe(exit);
	await expect(admitted!.exited).resolves.toMatchObject({ reason: 'exited', code: 7 });
});

describe('container runtime admission cancellation', () => {
	it('cancels an immediate Stop before the sandbox starts and remains reusable', async () => {
		const f = executionFixture();
		const result = f.run();
		const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		await f.adapter.stop('PYTHON');
		await rejected;
		expect(f.sandbox.run).not.toHaveBeenCalled();
		expect(f.adapter.inspect()).toEqual([]);
		expect((await f.container.inspect()).processes).toEqual([]);
		await expect(f.run()).resolves.toBe(true);
		expect(f.sandbox.run).toHaveBeenCalledOnce();
	});
	it('keeps Stop pending until delayed admission releases its original job', async () => {
		const f = executionFixture(),
			admission = runtimeGate(),
			spawn = f.container.spawn.bind(f.container);
		vi.spyOn(f.container, 'spawn').mockImplementationOnce(async (...args) => {
			await admission.promise;
			return await spawn(...args);
		});
		const result = f.run();
		const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		const stopped = f.adapter.stop('PYTHON');
		let settled = false;
		void stopped.then(() => {
			settled = true;
		});
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(settled).toBe(false);
			await expect(f.run()).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
		} finally {
			admission.resolve();
			await stopped;
			await rejected;
		}
		expect(f.sandbox.run).not.toHaveBeenCalled();
		expect((await f.container.inspect()).processes).toEqual([]);
		await expect(f.run()).resolves.toBe(true);
	});
	it('retires a delayed handle without letting its old signal stop a replacement run', async () => {
		const f = executionFixture(),
			admitted = runtimeGate(),
			admission = runtimeGate(),
			first = runtimeGate<boolean>(),
			second = runtimeGate<boolean>(),
			caller = new AbortController(),
			spawn = f.container.spawn.bind(f.container);
		f.sandbox.run
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);
		f.sandbox.terminate.mockImplementation(async () => {
			first.resolve(false);
		});
		vi.spyOn(f.container, 'spawn').mockImplementationOnce(async (...args) => {
			const process = await spawn(...args);
			admitted.resolve();
			await admission.promise;
			return process;
		});
		const result = f.run(caller.signal);
		const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		try {
			await admitted.promise;
			const stopped = f.adapter.stop('PYTHON');
			admission.resolve();
			await stopped;
			await rejected;
			expect(caller.signal.aborted).toBe(false);
			const terminated = f.sandbox.terminate.mock.calls.length;
			const replacement = f.run();
			await vi.waitFor(() => expect(f.sandbox.run).toHaveBeenCalledTimes(2));
			caller.abort();
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(f.sandbox.terminate).toHaveBeenCalledTimes(terminated);
			expect(f.adapter.inspect()).toHaveLength(1);
			second.resolve(true);
			await expect(replacement).resolves.toBe(true);
			expect((await f.container.inspect()).processes).toEqual([]);
		} finally {
			admission.resolve();
			first.resolve(false);
			second.resolve(false);
		}
	});
	it('does not let an idle Stop terminate a newly admitted job while binding load completes', async () => {
		const f = executionFixture(),
			ready = runtimeGate<typeof f.sandbox>();
		f.binding.load.mockImplementationOnce(() => ready.promise);
		await f.adapter.write('PYTHON', 'queued input');
		const stopped = f.adapter.stop('PYTHON');
		const result = f.run();
		ready.resolve(f.sandbox);
		await stopped;
		await expect(result).resolves.toBe(true);
		expect(f.sandbox.terminate).not.toHaveBeenCalled();
		expect(f.sandbox.write).not.toHaveBeenCalled();
	});
	it('disposes an owner whose active job is still waiting for admission', async () => {
		const f = executionFixture(),
			admission = runtimeGate(),
			spawn = f.container.spawn.bind(f.container);
		vi.spyOn(f.container, 'spawn').mockImplementationOnce(async (...args) => {
			await admission.promise;
			return await spawn(...args);
		});
		const result = f.run();
		const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
		const disposed = f.adapter.dispose();
		admission.resolve();
		await disposed;
		await rejected;
		expect(f.sandbox.run).not.toHaveBeenCalled();
		expect(f.binding.dispose).toHaveBeenCalledOnce();
		expect(f.adapter.inspect()).toEqual([]);
		expect((await f.container.inspect()).processes).toEqual([]);
		await expect(f.run()).rejects.toThrow(/disposed/);
	});
	it('disposes the binding before waiting for an unfinished sandbox load', async () => {
		const f = executionFixture(),
			ready = runtimeGate<typeof f.sandbox>();
		f.binding.load.mockImplementationOnce(() => ready.promise);
		f.binding.dispose.mockImplementation(async () => {
			ready.resolve(f.sandbox);
		});
		await f.adapter.write('PYTHON', 'queued input');
		const disposed = f.adapter.dispose();
		try {
			await new Promise<void>((resolve) => setImmediate(resolve));
			expect(f.binding.dispose).toHaveBeenCalledOnce();
		} finally {
			ready.resolve(f.sandbox);
			await disposed;
		}
		expect(f.sandbox.terminate).not.toHaveBeenCalled();
	});
	it('keeps output quota failures distinct from a user cancellation', async () => {
		const f = executionFixture({ maxOutputBytes: 4 });
		f.sandbox.run.mockImplementation(async () => {
			f.sandbox.output?.('too much output');
			return true;
		});
		await expect(f.run()).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
		expect((await f.container.inspect()).processes).toEqual([]);
		expect(f.adapter.inspect()).toEqual([]);
	});
});

describe('container shared editor input boundary', () => {
	it.each([{ maxBytes: 4 }, { maxInodes: 13 }])(
		'preserves the complete namespace when the first publication exceeds %j',
		(limits) => {
			const { adapter, container } = fixture(limits);
			const snapshot = container.fs.exportSnapshot();
			expect(() =>
				adapter.syncWorkspace('C', [f('first', 'a'), f('second', '12345')])
			).toThrow(/quota/);
			expect(container.fs.exportSnapshot()).toEqual(snapshot);
			adapter.syncWorkspace('C', [f('first', 'ok')]);
			expect(read(container, '/workspace/C/first')).toBe('ok');
		}
	);
	it('does not create a language directory before validating the first publication', () => {
		const { adapter, container } = fixture();
		const snapshot = container.fs.exportSnapshot();
		expect(() => adapter.syncWorkspace('C', [f('../escape', 'invalid')])).toThrow();
		expect(container.fs.exportSnapshot()).toEqual(snapshot);
		adapter.syncWorkspace('C', []);
		expect(container.fs.stat('/workspace/C').type).toBe('directory');
	});
	it('preserves every file and published baseline when a batch exceeds the shared byte quota', () => {
		const { adapter, container } = fixture({ maxBytes: 12 });
		const before = [f('old.txt', 'old'), f('first.txt', 'a')];
		adapter.syncWorkspace('C', before);
		const snapshot = container.fs.exportSnapshot();
		expect(() =>
			adapter.syncWorkspace('C', [f('first.txt', 'changed'), f('new.txt', '123456')], before)
		).toThrow(/quota/);
		expect(container.fs.exportSnapshot()).toEqual(snapshot);
		// A retry still compares against the unchanged editor publication.
		adapter.syncWorkspace('C', [f('first.txt', 'changed'), f('new.txt', '12345')], before);
		expect(read(container, '/workspace/C/first.txt')).toBe('changed');
		expect(read(container, '/workspace/C/new.txt')).toBe('12345');
		expect(() => container.fs.stat('/workspace/C/old.txt')).toThrow();
	});
	it('keeps an editor delta intact when another language consumes the shared quota', () => {
		const { adapter, container } = fixture({ maxBytes: 12 });
		const before = [f('main.c', 'a')];
		adapter.syncWorkspace('C', before);
		adapter.syncWorkspace('CPP', [f('other.cpp', '12345678')]);
		const snapshot = container.fs.exportSnapshot();
		expect(() =>
			adapter.syncWorkspace('C', [f('main.c', 'bb'), f('nested/new', 'ccc')], before, [
				{ path: 'main.c', bytes: 2 },
				{ path: 'nested/new', bytes: 3 }
			])
		).toThrow(/quota/);
		expect(container.fs.exportSnapshot()).toEqual(snapshot);
	});
	it('replaces its own empty directory tree with an editor file in the same or a later publication', () => {
		for (const separate of [false, true]) {
			const { adapter, container } = fixture();
			const initial = [f('parts/nested/one.txt', 'old')];
			const next = [f('parts', 'new')];
			adapter.syncWorkspace('C', initial, []);
			if (separate) adapter.syncWorkspace('C', [], initial);
			adapter.syncWorkspace('C', next, separate ? [] : initial);
			expect(read(container, '/workspace/C/parts')).toBe('new');
		}
	});

	it('can turn a file into an implicit parent and restore the original layout', () => {
		const { adapter, container } = fixture();
		const flat = [f('parts', 'flat')],
			nested = [f('parts/nested/source', 'deep')];
		adapter.syncWorkspace('C', flat, []);
		adapter.syncWorkspace('C', nested, flat);
		expect(read(container, '/workspace/C/parts/nested/source')).toBe('deep');
		adapter.syncWorkspace('C', flat, nested);
		expect(read(container, '/workspace/C/parts')).toBe('flat');
	});

	it('keeps editor parents replaceable and shell directories protected after saving and reopening', () => {
		const original = fixture();
		const initial = [f('parts/nested/one.txt', 'old'), f('manual/source', 'old')];
		original.adapter.syncWorkspace('C', initial, []);
		original.adapter.syncWorkspace('C', [], initial);
		// Recreating a directory in Bash gives it a new inode, even at the same path.
		original.container.fs.rmdir('/workspace/C/manual');
		original.container.fs.mkdir('/workspace/C/manual');
		const saved = emptyProjectDirectories(original.adapter.listWorkspaceFiles(), ['C']);
		expect(saved).toEqual([
			'C/manual',
			{ path: 'C/parts', implicit: true },
			{ path: 'C/parts/nested', implicit: true }
		]);
		const restored = fixture();
		restored.adapter.restoreWorkspaceDirectories(
			readWorkspaceDirectories(JSON.parse(JSON.stringify(saved)), ['C'])
		);
		expect(restored.container.fs.stat('/workspace/C/parts/nested').type).toBe('directory');
		restored.adapter.syncWorkspace('C', [f('parts', 'new')], []);
		expect(read(restored.container, '/workspace/C/parts')).toBe('new');
		expect(() => restored.adapter.syncWorkspace('C', [f('manual', 'data')], [])).toThrow();
		expect(restored.container.fs.stat('/workspace/C/manual').type).toBe('directory');
	});

	it('restores named directories and files together while protecting unrelated shell data', () => {
		const { adapter, container } = fixture();
		adapter.directory('C');
		container.fs.mkdir('/workspace/C/old-dir');
		container.fs.mkdir('/workspace/C/manual');
		container.fs.mkdir('/workspace/C/occupied');
		container.fs.writeFile('/workspace/C/occupied/keep', Uint8Array.of(42));
		const original = [f('source-dir', 'old file'), f('control.c', 'unchanged')];
		adapter.syncWorkspace('C', original);
		const next = [f('manual', 'incoming file'), f('control.c', 'unchanged')];
		adapter.syncWorkspace('C', next, original, undefined, ['C/source-dir/nested']);
		expect(read(container, '/workspace/C/manual')).toBe('incoming file');
		expect(container.fs.stat('/workspace/C/source-dir/nested').type).toBe('directory');
		expect(() => container.fs.stat('/workspace/C/old-dir')).toThrow();
		expect(container.fs.readFile('/workspace/C/occupied/keep')).toEqual(Uint8Array.of(42));
		const before = container.fs.exportSnapshot();
		expect(() =>
			adapter.syncWorkspace('C', [f('occupied', 'file')], next, undefined, [])
		).toThrow();
		expect(container.fs.exportSnapshot()).toEqual(before);
	});
	it('retains unlisted shell directories when a legacy backup only describes files', () => {
		const { adapter, container } = fixture();
		adapter.directory('C');
		container.fs.mkdir('/workspace/C/build/old', { recursive: true });
		container.fs.mkdir('/workspace/C/keep/nested', { recursive: true });
		const files = [f('build', 'file')];
		adapter.syncWorkspace('C', files, [], undefined, null);
		expect(read(container, '/workspace/C/build')).toBe('file');
		expect(container.fs.stat('/workspace/C/keep/nested').type).toBe('directory');
		adapter.syncWorkspace('C', files, files, undefined, []);
		expect(() => container.fs.stat('/workspace/C/keep')).toThrow();
	});
	it('preserves shell-created directories, replacements and unrelated content on failure', () => {
		for (const situation of ['preexisting', 'recreated', 'occupied']) {
			const { adapter, container } = fixture();
			adapter.directory('C');
			const dir = '/workspace/C/parts';
			if (situation === 'preexisting') container.fs.mkdir(dir);
			const original = [f('parts/one.txt', 'old')];
			adapter.syncWorkspace('C', original, []);
			adapter.syncWorkspace('C', [], original);
			if (situation === 'recreated') {
				container.fs.rmdir(dir);
				container.fs.mkdir(dir);
			}
			if (situation === 'occupied')
				container.fs.writeFile(dir + '/shell.txt', new Uint8Array([42]));
			const before = container.fs.stat(dir);
			expect(() =>
				adapter.syncWorkspace('C', [f('unrelated', 'x'), f('parts', 'new')], [])
			).toThrow();
			expect(container.fs.stat(dir)).toEqual(before);
			expect(container.fs.readdir(dir)).toEqual(
				situation === 'occupied' ? ['shell.txt'] : []
			);
			expect(() => container.fs.stat('/workspace/C/unrelated')).toThrow();
		}
	});

	it('rejects a conflicting editor batch before writing any of its files', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		expect(() =>
			adapter.syncWorkspace('C', [f('new.txt', 'new'), f('main.c', 'editor')], before)
		).toThrow(/changed while editing/);
		expect(read(container, '/workspace/C/main.c')).toBe('shell');
		expect(() => container.fs.stat('/workspace/C/new.txt')).toThrow();
	});
	it('does not overwrite a shell edit when the supplied editor file was unchanged', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		adapter.syncWorkspace('C', [...before, f('added.txt', 'editor')], before);
		expect(read(container, '/workspace/C/main.c')).toBe('shell');
		expect(read(container, '/workspace/C/added.txt')).toBe('editor');
	});
	it('applies a partial publication without reading or deleting untouched file bodies', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base'), f('large.dat', 'large'), f('old', 'remove')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/large.dat', new TextEncoder().encode('shell'));
		container.fs.writeFile('/workspace/C/extra', Uint8Array.of(255));
		const reads = vi.spyOn(container.fs, 'readFile');
		adapter.syncWorkspace(
			'C',
			[f('main.c', 'edit')],
			[before[0], before[2]],
			[
				{ path: 'main.c', bytes: 4 },
				{ path: 'large.dat', bytes: 5 }
			]
		);
		expect(reads.mock.calls.every(([path]) => path !== 'large.dat')).toBe(true);
		expect(read(container, '/workspace/C/main.c')).toBe('edit');
		expect(read(container, '/workspace/C/large.dat')).toBe('shell');
		expect(container.fs.readFile('/workspace/C/extra')).toEqual(Uint8Array.of(255));
		expect(() => container.fs.stat('/workspace/C/old')).toThrow();
		// A later legacy publication still owns all editor paths, not only the last patch.
		adapter.syncWorkspace('C', [f('main.c', 'next')]);
		expect(() => container.fs.stat('/workspace/C/large.dat')).toThrow();
		expect(container.fs.readFile('/workspace/C/extra')).toEqual(Uint8Array.of(255));
	});
	it('rejects a conflicting partial batch before publishing additions or deletions', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base'), f('old', 'remove')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		expect(() =>
			adapter.syncWorkspace('C', [f('new', 'x'), f('main.c', 'edit')], before, [
				{ path: 'main.c', bytes: 4 },
				{ path: 'new', bytes: 1 }
			])
		).toThrow(/changed while editing/);
		expect(() => container.fs.stat('/workspace/C/new')).toThrow();
		expect(read(container, '/workspace/C/old')).toBe('remove');
	});
	it('publishes literal POSIX names while passing only unambiguous portable names to a language worker', () => {
		const { adapter, container } = fixture();
		const literal = 'names\\one.txt';
		const files = [
			f('main.c', 'source'),
			f(literal, 'one'),
			f('names/one.txt', 'two'),
			f('report:2026.txt', 'data')
		];
		adapter.syncWorkspace('C', files, []);
		adapter.syncWorkspace(
			'C',
			[f(literal, 'new')],
			[f(literal, 'one')],
			files.map(({ path, content }) => ({ path, bytes: content.length }))
		);
		expect(read(container, '/workspace/C/' + literal)).toBe('new');
		expect(read(container, '/workspace/C/names/one.txt')).toBe('two');
		expect(read(container, '/workspace/C/report:2026.txt')).toBe('data');
		expect(
			adapter
				.inputs('C', '', { activePath: 'main.c' })
				.options.workspaceFiles?.map((f) => f.path)
		).toEqual(['main.c', 'names/one.txt']);
		expect(() => adapter.inputs('C', '', { activePath: literal })).toThrow(
			/Rename the active file/
		);
		expect(() => adapter.syncWorkspace('C', [f('../outside', 'x')])).toThrow();
	});

	it('retains a long UTF-8 sibling in the container while running a portable entrypoint', () => {
		const { adapter, container } = fixture();
		const prefix = ('a'.repeat(200) + '/').repeat(5);
		const boundary = prefix + '한'.repeat(6) + 'x';
		const long = boundary + 'y';
		expect(new TextEncoder().encode(boundary)).toHaveLength(1024);
		const files = [f('main.c', 'source'), f(boundary, 'worker file'), f(long, 'editor file')];
		adapter.syncWorkspace('C', files, []);
		adapter.syncWorkspace(
			'C',
			[f(long, 'changed')],
			[f(long, 'editor file')],
			files.map(({ path, content }) => ({ path, bytes: path === long ? 7 : content.length }))
		);
		expect(read(container, '/workspace/C/' + long)).toBe('changed');
		const inputs = adapter.inputs('C', '', { activePath: 'main.c' });
		expect(inputs.code).toBe('source');
		expect(inputs.options.workspaceFiles?.map((file) => file.path).sort()).toEqual([
			boundary,
			'main.c'
		]);
		expect(() => adapter.inputs('C', '', { activePath: long })).toThrow(
			/Rename the active file/
		);
	});

	it('retains whole-project admission limits and checks delta metadata before writing', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('C', [f('main.c', 'base')]);
		expect(() =>
			adapter.syncWorkspace(
				'C',
				[f('main.c', 'edit')],
				[f('main.c', 'base')],
				[
					{ path: 'main.c', bytes: 4 },
					...Array.from({ length: 4 }, (_, i) => ({
						path: `big${i}`,
						bytes: 16 * 1024 * 1024
					}))
				]
			)
		).toThrow(/total size limit/);
		expect(() =>
			adapter.syncWorkspace(
				'C',
				[f('main.c', 'edit')],
				[f('main.c', 'base')],
				[{ path: 'main.c', bytes: 3 }]
			)
		).toThrow(/size mismatch/);
		expect(() =>
			adapter.syncWorkspace('C', [], [f('main.c', 'base')], [{ path: 'main.c', bytes: 4 }])
		).toThrow(/remains in project/);
		expect(read(container, '/workspace/C/main.c')).toBe('base');
	});
	it('reads only changed file bodies and resets an unknown read cursor', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('C', [f('main.c', 'base'), f('data.bin', 'data')]);
		const first = adapter.readWorkspaceDelta('C');
		expect(first.reset).toBe(true);
		const reads = vi.spyOn(container.fs, 'readFile');
		const unchanged = adapter.readWorkspaceDelta('C', first.revision);
		expect(unchanged).toMatchObject({ reset: false, files: [], deleted: [] });
		expect(reads).not.toHaveBeenCalled();
		container.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('shell'));
		container.fs.rename('/workspace/C/data.bin', '/workspace/C/renamed.bin');
		container.fs.symlink('/workspace', '/workspace/C/loop');
		const changed = adapter.readWorkspaceDelta('C', unchanged.revision);
		expect(changed.files.map(({ path }) => path)).toEqual(['main.c', 'renamed.bin']);
		expect(changed.deleted).toEqual(['data.bin']);
		expect(reads).toHaveBeenCalledTimes(2);
		reads.mockClear();
		const reset = adapter.readWorkspaceDelta('C', first.revision);
		expect(reset.reset).toBe(true);
		expect(reset.files).toHaveLength(2);
		expect(reads).toHaveBeenCalledTimes(2);
	});
	it('reads the other projects when a shell file occupies a project directory name', () => {
		const { adapter, container } = fixture();
		const shellBytes = Uint8Array.of(0, 255, 9);
		adapter.syncWorkspace('CPP', [f('main.cpp', 'editor')]);
		container.fs.writeFile('/workspace/PYTHON', shellBytes);
		const initial = adapter.readWorkspaceDelta('PYTHON');
		expect(initial).toMatchObject({ files: [], deleted: [] });
		expect(container.fs.readFile('/workspace/PYTHON')).toEqual(shellBytes);
		container.fs.unlink('/workspace/PYTHON');
		adapter.syncWorkspace('PYTHON', [f('main.py', 'previous project')]);
		const active = adapter.readWorkspaceDelta('PYTHON', initial.revision);
		expect(active.files.map(({ path }) => path)).toEqual(['main.py']);
		container.fs.rename('/workspace/PYTHON', '/workspace/archived');
		container.fs.writeFile('/workspace/PYTHON', shellBytes);
		expect(adapter.readWorkspaceDelta('PYTHON', active.revision)).toMatchObject({
			files: [],
			deleted: ['main.py']
		});
		expect(container.fs.readFile('/workspace/PYTHON')).toEqual(shellBytes);
		expect(adapter.readWorkspaceDelta('CPP').files.map(({ path }) => path)).toEqual([
			'main.cpp'
		]);
	});
	it('propagates read failures inside an existing project before committing its revision', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('CPP', [f('main.cpp', 'editor')]);
		const missing = Object.assign(new Error('file disappeared during read'), {
			code: 'ENOENT'
		});
		vi.spyOn(container.fs, 'readFile').mockImplementationOnce(() => {
			throw missing;
		});
		expect(() => adapter.readWorkspaceDelta('CPP')).toThrow(missing);
		expect(adapter.readWorkspaceDelta('CPP')).toMatchObject({ revision: 1, reset: true });
	});
	it('preserves unknown shell files while applying an explicit editor deletion', () => {
		const { adapter, container } = fixture();
		const before = [f('main.c', 'base'), f('old.txt', 'remove')];
		adapter.syncWorkspace('C', before);
		container.fs.writeFile('/workspace/C/terminal.txt', Uint8Array.of(0, 255, 42));
		adapter.syncWorkspace('C', [before[0]], before);
		expect(container.fs.readFile('/workspace/C/terminal.txt')).toEqual(
			Uint8Array.of(0, 255, 42)
		);
		expect(() => container.fs.stat('/workspace/C/old.txt')).toThrow();
	});
	it('keeps language project roots separate in one namespace and rejects traversal', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('C', [f('main.c', 'c')]);
		adapter.syncWorkspace('CPP', [f('main.c', 'cpp')]);
		expect(read(container, '/workspace/C/main.c')).toBe('c');
		expect(read(container, '/workspace/CPP/main.c')).toBe('cpp');
		expect(() => adapter.syncWorkspace('C', [f('../CPP/main.c', 'escape')])).toThrow();
		expect(read(container, '/workspace/CPP/main.c')).toBe('cpp');
	});
	it('lists files across projects and at the workspace root without following symlinks', () => {
		const { adapter, container } = fixture();
		adapter.syncWorkspace('CPP', [f('hi.txt', '1\n')]);
		adapter.syncWorkspace('BASH', [f('main.sh', 'echo hello')]);
		container.fs.writeFile('/workspace/root.txt', Uint8Array.of(0, 255));
		container.fs.symlink('/workspace', '/workspace/loop');
		container.fs.symlink('/usr', '/workspace/outside');
		const entries = adapter.listWorkspaceFiles();
		expect(entries).toContainEqual({ path: 'CPP/hi.txt', type: 'file', size: 2 });
		expect(entries).toContainEqual({ path: 'BASH/main.sh', type: 'file', size: 10 });
		expect(entries).toContainEqual({ path: 'root.txt', type: 'file', size: 2 });
		expect(
			entries.filter((entry) => entry.type === 'symlink').map((entry) => entry.path)
		).toEqual(['loop', 'outside']);
		expect(
			entries.some(
				(entry) => entry.path.startsWith('outside/') || entry.path.startsWith('loop/')
			)
		).toBe(false);
		expect(entries.every((entry) => !('content' in entry))).toBe(true);
	});
});

describe('container runtime prewarm', () => {
	it('loads the runtime once speculatively and lets a later Run reuse it', async () => {
		const f = executionFixture();
		await expect(f.adapter.prewarm('PYTHON', new AbortController().signal)).resolves.toBe(true);
		expect(f.sandbox.load).toHaveBeenCalledOnce();
		expect(f.sandbox.load).toHaveBeenCalledWith('', false, [], {
			signal: expect.any(AbortSignal)
		});
		await expect(f.adapter.prewarm('PYTHON', new AbortController().signal)).resolves.toBe(true);
		expect(f.sandbox.load).toHaveBeenCalledOnce();
		await expect(f.run()).resolves.toBe(true);
		expect(f.binding.load).toHaveBeenCalledOnce();
	});

	it('lets a job claim an in-flight warm-up so cancelling the request no longer aborts it', async () => {
		const f = executionFixture(),
			gate = runtimeGate();
		f.sandbox.load.mockImplementationOnce(async () => await gate.promise);
		const request = new AbortController();
		const warming = f.adapter.prewarm('PYTHON', request.signal);
		await new Promise<void>((resolve) => setImmediate(resolve));
		const loading = f.adapter.execute(
			'load',
			'PYTHON',
			'print(1)',
			true,
			[],
			{},
			new AbortController().signal
		);
		await new Promise<void>((resolve) => setImmediate(resolve));
		request.abort();
		const warmSignal = (f.sandbox.load.mock.calls[0] as unknown[])[3] as {
			signal: AbortSignal;
		};
		expect(warmSignal.signal.aborted).toBe(false);
		expect(f.sandbox.load).toHaveBeenCalledOnce();
		gate.resolve();
		await expect(warming).resolves.toBe(false);
		await expect(loading).resolves.toBeUndefined();
		expect(f.sandbox.load).toHaveBeenCalledTimes(2);
		expect(f.binding.dispose).not.toHaveBeenCalled();
	});

	it('retires the session of a cancelled warm-up so the next Run starts fresh', async () => {
		const f = executionFixture();
		f.sandbox.load.mockImplementationOnce(
			async (
				_code?: string,
				_log?: boolean,
				_args?: string[],
				options?: { signal?: AbortSignal }
			) =>
				await new Promise<void>((_, reject) =>
					options?.signal?.addEventListener('abort', () => reject(options.signal!.reason))
				)
		);
		const request = new AbortController();
		const warming = f.adapter.prewarm('PYTHON', request.signal);
		await new Promise<void>((resolve) => setImmediate(resolve));
		request.abort();
		await expect(warming).resolves.toBe(false);
		await vi.waitFor(() => expect(f.binding.dispose).toHaveBeenCalledOnce());
		await expect(f.run()).resolves.toBe(true);
		expect(f.binding.load).toHaveBeenCalledTimes(2);
	});

	it('does not warm a language with an active job and forgets a load after Stop', async () => {
		const f = executionFixture(),
			gate = runtimeGate<boolean>();
		f.sandbox.run.mockImplementationOnce(async () => await gate.promise);
		const running = f.run();
		await vi.waitFor(() => expect(f.sandbox.run).toHaveBeenCalledOnce());
		await expect(f.adapter.prewarm('PYTHON', new AbortController().signal)).resolves.toBe(
			false
		);
		expect(f.sandbox.load).not.toHaveBeenCalled();
		gate.resolve(true);
		await expect(running).resolves.toBe(true);
		await expect(f.adapter.prewarm('PYTHON', new AbortController().signal)).resolves.toBe(true);
		await f.adapter.stop('PYTHON');
		expect(f.sandbox.terminate).toHaveBeenCalledOnce();
		await expect(f.adapter.prewarm('PYTHON', new AbortController().signal)).resolves.toBe(true);
		expect(f.sandbox.load).toHaveBeenCalledTimes(2);
	});
});
