// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MemoryFileSystem, type Container, type ContainerProcess } from '@wasm-idle/container';
import { WebsiteClangRuntime } from './clang-runtime.js';
import { WebsiteRuntimeAdapter } from './runtime-adapter.js';
import type { SandboxExecutionOptions } from '../playground/options.js';

function fixture(
	stderr: string[] = [],
	layered = false,
	sysrootProfile: 'full' | 'c-base-v1' = 'c-base-v1'
) {
	const fs = new MemoryFileSystem();
	const codes: number[] = [];
	const hooks: { compile?: (signal?: AbortSignal) => Promise<void> | void } = {};
	const writes: Uint8Array[] = [];
	let nextPid = 1;
	const spawn = vi.fn(
		async (name: string, argv: string[], options?: { signal?: AbortSignal }) => {
			const pid = nextPid++,
				code = name === 'clang' ? (codes.shift() ?? 0) : 0;
			if (name === 'clang') {
				await hooks.compile?.(options?.signal);
				if (code === 0 && argv.includes('-o'))
					fs.withMutationSource(pid, () => {
						const path = argv[argv.indexOf('-o') + 1];
						fs.writeFile(path, Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0));
						if (!argv.includes('c++-header'))
							fs.grantExecutable(fs.captureFileVersion(path));
					});
			}
			return {
				pid,
				stdin: new WritableStream({
					write: (bytes) => {
						writes.push(bytes.slice());
					}
				}),
				stdout: new ReadableStream({
					start(controller) {
						controller.close();
					}
				}),
				stderr: new ReadableStream({
					start(controller) {
						if (name === 'clang')
							for (const chunk of stderr)
								controller.enqueue(new TextEncoder().encode(chunk));
						controller.close();
					}
				}),
				exited: Promise.resolve({ reason: 'exited', code })
			} as unknown as ContainerProcess;
		}
	);
	const profile = {
		container: { spawn, fs } as unknown as Container,
		prepareCommand: vi.fn(async (_invocation: unknown, _signal: AbortSignal) => {}),
		...(layered
			? {
					sysrootProfile,
					prepareClang: vi.fn(async (profile: 'c' | 'full') =>
						profile === 'c'
							? [
									'--sysroot=/usr/share/wasm-sysroot-c',
									'-resource-dir=/usr/share/wasm-sysroot-c/lib/clang/22'
								]
							: []
					)
				}
			: {})
	};
	const adapter = new WebsiteRuntimeAdapter({
		runtimeAssets: '/wasm-idle/',
		emit: vi.fn(),
		createBinding: vi.fn()
	});
	adapter.attach(profile.container);
	const progress = { set: vi.fn(), report: vi.fn() };
	const emit = vi.fn();
	const runtime = new WebsiteClangRuntime(profile, adapter, emit);
	const published = new Map<string, { path: string; content: string }[]>();
	const prepare = (
		code: string,
		options: SandboxExecutionOptions = {},
		language = 'CPP',
		signal = new AbortController().signal,
		requestId = 1
	) => {
		const files = [
			...(options.workspaceFiles ?? []),
			{
				path: options.activePath ?? (language === 'C' ? 'main.c' : 'main.cpp'),
				content: code
			}
		];
		adapter.syncWorkspace(language, files, published.get(language));
		published.set(language, files);
		return runtime.prepare(language, code, [], options, signal, progress, requestId);
	};
	const run = (code: string, options: SandboxExecutionOptions = {}, language = 'CPP') =>
		runtime.run(
			language,
			code,
			[],
			{ stdin: '', ...options },
			new AbortController().signal,
			progress,
			2
		);
	return {
		runtime,
		prepare,
		run,
		spawn,
		profile,
		progress,
		codes,
		fs,
		emit,
		hooks,
		writes,
		adapter
	};
}

const source = '// PCH probe\n#include <bits/stdc++.h>\nint main() {}';
describe('website container Clang compilation', () => {
	it.each([
		['C', { cVersion: 'C23' }, '-std=gnu23'],
		['CPP', { cppVersion: 'CPP98' }, '-std=gnu++98']
	] as const)(
		'passes %s compiler flags separately from quoted program argv',
		async (language, standard, expected) => {
			const f = fixture();
			const code = 'int main(void) { return 0; }';
			const options = {
				...standard,
				compileArgs: ['-O2', '-Wall', '-Iheaders with spaces', '-DVALUE=42'],
				programArgs: ['hello world', '']
			};
			expect(await f.prepare(code, options, language)).toBe(true);
			const compilerArgs = f.spawn.mock.calls[0][1];
			expect(compilerArgs).toContain('--target=wasm32-wasip1');
			expect(compilerArgs).toContain(expected);
			expect(compilerArgs).toEqual(expect.arrayContaining(options.compileArgs));
			expect(compilerArgs).not.toContain('hello world');
			expect(compilerArgs.indexOf('-O2')).toBeGreaterThan(compilerArgs.indexOf(expected));
			expect(await f.run(code, options, language)).toBe(true);
			expect(f.spawn.mock.calls[1][1]).toEqual([
				`/workspace/${language}/program.wasm`,
				'hello world',
				''
			]);
		}
	);
	it('uses the explicitly selected C delivery profile for stock C and preserves compiler arguments', async () => {
		const { prepare, profile, spawn } = fixture([], true);
		expect(await prepare('int main(void) { return 0; }', { activePath: 'main.c' }, 'C')).toBe(
			true
		);
		expect(profile.prepareClang).toHaveBeenCalledWith('c', expect.any(AbortSignal));
		expect(profile.prepareCommand).not.toHaveBeenCalled();
		expect(spawn.mock.calls[0][1]).toContain('--sysroot=/usr/share/wasm-sysroot-c');
		expect(spawn.mock.calls[0][1]).toContain('/usr/share/wasm-sysroot-c/include/wasm32-wasi');
		expect(spawn.mock.calls[0][1]).toContain('-L/usr/share/wasm-sysroot-c/lib/wasm32-wasi');
		expect(spawn.mock.calls[0][1]).toContain('-B/usr/share/wasm-sysroot-c/lib/wasm32-wasi/');
		expect(spawn.mock.calls[0][1]).toContain(
			'-resource-dir=/usr/share/wasm-sysroot-c/lib/clang/22'
		);
		expect(spawn.mock.calls[0][1]).toContain('-lc-printscan-long-double');
	});
	it('keeps the complete sysroot by default even when the profile supports layered preparation', async () => {
		const { prepare, profile, spawn } = fixture([], true, 'full');
		await prepare('int main(void) { return 0; }', { activePath: 'main.c' }, 'C');
		expect(profile.prepareClang).toHaveBeenCalledWith('full', expect.any(AbortSignal));
		expect(spawn.mock.calls[0][1]).not.toContain('--sysroot=/usr/share/wasm-sysroot-c');
	});
	it.each<[string, SandboxExecutionOptions]>([
		['CPP', { activePath: 'main.cpp' }],
		['C', { activePath: 'main.c', compileArgs: ['-Icustom'] }],
		['C', { activePath: 'main.c', compileArgs: ['@flags.rsp'] }],
		['C', { activePath: 'main.c', env: { C_INCLUDE_PATH: '/custom' } }],
		['C', { activePath: 'main.C' }],
		['C', { activePath: 'main.cpp' }]
	])('retains the full tree for %s %j', async (language, options) => {
		const { prepare, profile, spawn } = fixture([], true);
		await prepare('int main() {}', options, language);
		expect(profile.prepareClang).toHaveBeenCalledWith('full', expect.any(AbortSignal));
		expect(spawn.mock.calls[0][1]).not.toContain('--sysroot=/usr/share/wasm-sysroot-c');
	});
	it('preserves compiler colors in terminal output and extracts plain editor diagnostics across chunks', async () => {
		const chunks = [
			'\x1b[1m/workspace/CPP/main.cpp:2:3: \x1b[',
			'0m\x1b[0;1;31merror: \x1b[0m\x1b[1mexpected expression\x1b[0m\n'
		];
		const { prepare, spawn, codes, emit } = fixture(chunks);
		codes.push(1);
		expect(await prepare('int main() { invalid }')).toBe(false);
		expect(spawn.mock.calls[0][1]).toContain('-fcolor-diagnostics');
		expect(spawn.mock.calls[0][1]).not.toContain('-fno-color-diagnostics');
		const events = emit.mock.calls.map(([event]) => event);
		expect(
			events
				.filter((event) => event.name === 'output')
				.map((event) => event.data)
				.join('')
		).toBe(chunks.join(''));
		expect(events.filter((event) => event.name === 'diagnostic')).toEqual([
			{
				language: 'CPP',
				name: 'diagnostic',
				requestId: 1,
				data: {
					fileName: '/workspace/main.cpp',
					lineNumber: 2,
					columnNumber: 3,
					severity: 'error',
					message: 'expected expression'
				}
			}
		]);
	});

	it('cancels pending toolchain preparation before starting a compiler', async () => {
		const { runtime, prepare, spawn, profile } = fixture();
		let release!: () => void;
		const pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		let signal!: AbortSignal;
		profile.prepareCommand.mockImplementationOnce(async (_invocation, value) => {
			signal = value;
			await pending;
		});
		const preparation = prepare('int main() {}');
		const cancelled = expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
		await runtime.stop('CPP');
		const abortedWhenStopped = signal.aborted;
		release();
		await cancelled;
		expect(abortedWhenStopped).toBe(true);
		expect(spawn).not.toHaveBeenCalled();
	});
	it.each(['prepare', 'run'] as const)(
		'terminates a %s command admitted while its spawn was being cancelled',
		async (phase) => {
			const { runtime, prepare, spawn } = fixture();
			if (phase === 'run') await prepare('int main() {}');
			spawn.mockClear();
			let release!: (process: ContainerProcess) => void;
			spawn.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					})
			);
			const command =
				phase === 'prepare'
					? prepare('int main() {}')
					: runtime.run(
							'CPP',
							'int main() {}',
							[],
							{},
							new AbortController().signal,
							undefined,
							1
						);
			const cancelled = expect(command).rejects.toMatchObject({ name: 'AbortError' });
			await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
			await runtime.stop('CPP');
			const terminate = vi.fn(async () => {});
			release({
				stdin: new WritableStream(),
				stdout: new ReadableStream({
					start(controller) {
						controller.close();
					}
				}),
				stderr: new ReadableStream({
					start(controller) {
						controller.close();
					}
				}),
				exited: Promise.resolve({ reason: 'exited', code: 0 }),
				terminate
			} as unknown as ContainerProcess);
			await cancelled;
			expect(terminate).toHaveBeenCalledOnce();
		}
	);
	it('applies language-changing response files before the input and links C++ safely', async () => {
		const { prepare, spawn } = fixture();
		await prepare('int main() {}', { activePath: 'main.c', compileArgs: ['@flags.rsp'] }, 'C');
		const argv = spawn.mock.calls[0][1];
		expect(argv).toContain('--driver-mode=g++');
		expect(argv.indexOf('@flags.rsp')).toBeLessThan(argv.indexOf('main.c'));
		expect(argv.slice(argv.indexOf('-x'), argv.indexOf('-x') + 2)).toEqual(['-x', 'c']);
		expect(argv).toContain('-fno-exceptions');
		expect(argv.indexOf('-lc-printscan-long-double')).toBeGreaterThan(argv.indexOf('main.c'));
	});
	it('builds and reuses a real header only with the same standard', async () => {
		const { prepare, spawn, progress } = fixture();
		expect(await prepare(source)).toBe(true);
		expect(spawn.mock.calls[1][1]).toContain('c++-header');
		expect(spawn.mock.calls[1][1]).toContain('-c');
		expect(spawn.mock.calls[1][1]).not.toContain('-lc-printscan-long-double');
		expect(await prepare(source.replace('main()', 'main(int, char**)'))).toBe(true);
		expect(spawn.mock.calls[2][1]).toContain('-include-pch');
		expect(progress.set).toHaveBeenCalledExactlyOnceWith(
			95,
			'Compiled with precompiled <bits/stdc++.h>'
		);
		await prepare(source, { cppVersion: 'CPP23' });
		expect(spawn.mock.calls[3][1]).not.toContain('-include-pch');
		expect(spawn.mock.calls[4][1]).toContain('c++-header');
	});
	it.each([
		{ compileArgs: ['-Icustom'] },
		{ env: { CPLUS_INCLUDE_PATH: '/custom' } },
		{ workspaceFiles: [{ path: 'vector', content: 'custom header' }] },
		{ workspaceFiles: [{ path: 'bits/stdc++.h', content: 'custom header' }] }
	])('does not cache headers with changed lookup inputs: %j', async (options) => {
		const { prepare, spawn } = fixture();
		await prepare(source, options);
		expect(spawn).toHaveBeenCalledTimes(1);
	});
	it('retries a rejected cached header textually without claiming a cache hit', async () => {
		const { prepare, spawn, progress, codes } = fixture();
		await prepare(source);
		codes.push(1, 0, 0);
		expect(await prepare(source + '\n')).toBe(true);
		expect(spawn.mock.calls[2][1]).toContain('-include-pch');
		expect(spawn.mock.calls[3][1]).not.toContain('-include-pch');
		expect(progress.set).not.toHaveBeenCalled();
	});
	it('clears its bounded temporary header on disposal', async () => {
		const { prepare, runtime, fs } = fixture();
		await prepare(source);
		expect(fs.readdir('/tmp')).toHaveLength(1);
		await runtime.dispose();
		expect(fs.readdir('/tmp')).toHaveLength(0);
	});

	it.each(['C', 'CPP'])(
		'reuses unchanged %s through repeated UI prepare and run with new input and program args',
		async (language) => {
			const f = fixture(),
				code = 'int main() {}';
			expect(await f.prepare(code, {}, language)).toBe(true);
			expect(await f.run(code, { stdin: 'first', programArgs: ['one'] }, language)).toBe(
				true
			);
			expect(await f.prepare(code, { stdin: 'second', programArgs: ['two'] }, language)).toBe(
				true
			);
			expect(await f.run(code, { stdin: 'second', programArgs: ['two'] }, language)).toBe(
				true
			);
			expect(f.spawn.mock.calls.filter(([name]) => name === 'clang')).toHaveLength(1);
			expect(f.profile.prepareCommand).toHaveBeenCalledTimes(1);
			expect(
				f.spawn.mock.calls.filter(([name]) => name === 'wasm-run').map(([, args]) => args)
			).toEqual([
				[`/workspace/${language}/program.wasm`, 'one'],
				[`/workspace/${language}/program.wasm`, 'two']
			]);
			expect(f.writes.map((bytes) => new TextDecoder().decode(bytes))).toEqual([
				'first',
				'second'
			]);
		}
	);
	it('replays complete compile output and diagnostics with the new preparation request id', async () => {
		const f = fixture(['/workspace/C/main.c:1:2: warning: example\n']);
		await f.prepare('int main() {}', {}, 'C');
		f.emit.mockClear();
		await f.prepare('int main() {}', {}, 'C', new AbortController().signal, 42);
		expect(f.spawn).toHaveBeenCalledTimes(1);
		expect(f.emit.mock.calls.map(([event]) => [event.name, event.requestId])).toEqual([
			['output', 42],
			['diagnostic', 42]
		]);
	});
	it('checks cache validity after progress callbacks before replaying old compiler events', async () => {
		const messages = ['/workspace/C/main.c:1:2: warning: old warning\n'],
			f = fixture(messages),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		f.emit.mockClear();
		messages.splice(0, messages.length, '/workspace/C/main.c:1:2: warning: fresh warning\n');
		f.progress.report.mockImplementation((event) => {
			if (event.label === 'Reusing the compiled program')
				f.fs.writeFile('/workspace/C/changed.h', new TextEncoder().encode('changed'));
		});
		expect(await f.prepare(code, {}, 'C', new AbortController().signal, 42)).toBe(true);
		expect(f.spawn).toHaveBeenCalledTimes(2);
		expect(
			f.emit.mock.calls.map(([event]) => [event.name, event.data, event.requestId])
		).toEqual([
			['output', messages[0], 42],
			['diagnostic', expect.objectContaining({ message: 'fresh warning' }), 42]
		]);
	});
	it('holds cached diagnostics until every output callback has preserved the compiled inputs', async () => {
		const messages = [
				'/workspace/C/main.c:1:2: warning: old first warning\n',
				'/workspace/C/main.c:2:3: warning: old second warning\n'
			],
			f = fixture(messages),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		f.emit.mockClear();
		let outputs = 0;
		f.emit.mockImplementation((event) => {
			if (event.name === 'output' && ++outputs === 2) {
				f.fs.writeFile('/workspace/C/changed.h', new TextEncoder().encode('changed'));
				messages.splice(
					0,
					messages.length,
					'/workspace/C/main.c:1:2: warning: fresh warning\n'
				);
			}
		});
		expect(await f.prepare(code, {}, 'C', new AbortController().signal, 42)).toBe(true);
		expect(f.spawn).toHaveBeenCalledTimes(2);
		expect(
			f.emit.mock.calls.map(([event]) => event).filter((event) => event.name === 'diagnostic')
		).toEqual([
			expect.objectContaining({
				requestId: 42,
				data: expect.objectContaining({ message: 'fresh warning' })
			})
		]);
	});
	it('rebuilds after an editor source change or an unchanged editor buffer with a newer shell source', async () => {
		const f = fixture();
		await f.prepare('int main() {}', {}, 'C');
		await f.prepare('int main() {return 1;}', {}, 'C');
		f.fs.writeFile('/workspace/C/main.c', new TextEncoder().encode('int main() {return 2;}'));
		await f.prepare('int main() {return 1;}', {}, 'C');
		expect(f.spawn).toHaveBeenCalledTimes(3);
		expect(new TextDecoder().decode(f.fs.readFile('/workspace/C/main.c'))).toContain(
			'return 2'
		);
	});
	it.each(['edit', 'appearance', 'deletion'])(
		'invalidates header %s, including negative include dependencies',
		async (change) => {
			const f = fixture(),
				path = '/workspace/C/optional.h';
			if (change !== 'appearance') f.fs.mkdir('/workspace/C', { recursive: true });
			if (change !== 'appearance')
				f.fs.writeFile(path, new TextEncoder().encode('#define VALUE 1'));
			await f.prepare('int main() {}', {}, 'C');
			if (change === 'deletion') f.fs.unlink(path);
			else f.fs.writeFile(path, new TextEncoder().encode('#define VALUE 2'));
			await f.prepare('int main() {}', {}, 'C');
			expect(f.spawn).toHaveBeenCalledTimes(2);
		}
	);
	it.each(['replace', 'unlink', 'rename', 'timestamp'])(
		'rebuilds after artifact %s',
		async (change) => {
			const f = fixture(),
				artifact = '/workspace/C/program.wasm';
			await f.prepare('int main() {}', {}, 'C');
			if (change === 'replace') f.fs.writeFile(artifact, f.fs.readFile(artifact));
			else if (change === 'unlink') f.fs.unlink(artifact);
			else if (change === 'rename') f.fs.rename(artifact, `${artifact}.old`);
			else f.fs.setTimes(artifact, { mtimeMs: 1 });
			await f.prepare('int main() {}', {}, 'C');
			expect(f.spawn).toHaveBeenCalledTimes(2);
		}
	);
	it('rebuilds when compiler environment, standard, or response-file contents change', async () => {
		const f = fixture(),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		await f.prepare(code, { env: { CPATH: '/tmp' } }, 'C');
		await f.prepare(code, { cVersion: 'c17' }, 'C');
		f.fs.writeFile('/workspace/C/flags.rsp', new TextEncoder().encode('-O1'));
		await f.prepare(code, { compileArgs: ['@flags.rsp'] }, 'C');
		f.fs.writeFile('/workspace/C/flags.rsp', new TextEncoder().encode('-O2'));
		await f.prepare(code, { compileArgs: ['@flags.rsp'] }, 'C');
		expect(f.spawn).toHaveBeenCalledTimes(5);
	});
	it('does not repeat opaque compiler-side effects from a cache, but runs the immediately prepared artifact once', async () => {
		const f = fixture(),
			code = 'int main() {}',
			options = { compileArgs: ['@flags.rsp'] };
		await f.prepare(code, options, 'C');
		await f.run(code, options, 'C');
		await f.prepare(code, options, 'C');
		expect(f.spawn.mock.calls.filter(([name]) => name === 'clang')).toHaveLength(2);
	});
	it('rejects cache admission after a concurrent transient header mutation, even when bytes are restored', async () => {
		const f = fixture(),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		f.fs.writeFile('/workspace/C/header.h', new TextEncoder().encode('original'));
		f.hooks.compile = () => {
			f.fs.writeFile('/workspace/C/header.h', new TextEncoder().encode('transient'));
			f.fs.writeFile('/workspace/C/header.h', new TextEncoder().encode('original'));
		};
		await f.prepare(code, {}, 'C');
		delete f.hooks.compile;
		await f.run(code, {}, 'C');
		await f.prepare(code, {}, 'C');
		expect(f.spawn.mock.calls.filter(([name]) => name === 'clang')).toHaveLength(3);
	});
	it('keeps observing input mutations between compiler completion and PCH progress callbacks', async () => {
		const f = fixture();
		await f.prepare(source);
		f.progress.set.mockImplementation(() => {
			f.fs.writeFile(
				'/workspace/CPP/late.h',
				new TextEncoder().encode('changed after compilation')
			);
		});
		await f.prepare(`${source}\n`);
		f.progress.set.mockReset();
		await f.prepare(`${source}\n`);
		expect(f.spawn).toHaveBeenCalledTimes(4);
	});
	it('does not revive a successful artifact after a failed rebuild or cancellation', async () => {
		const f = fixture(),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		f.codes.push(1);
		expect(await f.prepare(`${code}\n`, {}, 'C')).toBe(false);
		await f.prepare(code, {}, 'C');
		const controller = new AbortController();
		f.hooks.compile = () => {
			controller.abort();
		};
		await expect(f.prepare(`${code}\n`, {}, 'C', controller.signal)).rejects.toThrow();
		delete f.hooks.compile;
		await f.prepare(code, {}, 'C');
		expect(f.spawn).toHaveBeenCalledTimes(5);
	});
	it('does not reuse an artifact after cancellation reenters a cached preparation', async () => {
		const f = fixture(),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		const controller = new AbortController();
		f.progress.report.mockImplementation(() => {
			controller.abort();
		});
		await expect(f.prepare(code, {}, 'C', controller.signal)).rejects.toThrow();
		f.progress.report.mockReset();
		await f.prepare(code, {}, 'C');
		expect(f.spawn).toHaveBeenCalledTimes(2);
	});
	it('bypasses reuse when complete diagnostics exceed the retention budget', async () => {
		const f = fixture(['가'.repeat(22 * 1024)]),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		await f.prepare(code, {}, 'C');
		expect(f.spawn).toHaveBeenCalledTimes(2);
	});
	it('never republishes a prepared executable after disposal', async () => {
		const f = fixture(),
			code = 'int main() {}';
		await f.prepare(code, {}, 'C');
		await f.runtime.dispose();
		await expect(f.prepare(code, {}, 'C')).rejects.toThrow(/disposed/);
		await expect(f.run(code, {}, 'C')).rejects.toThrow(/disposed/);
		expect(f.spawn).toHaveBeenCalledTimes(1);
	});
	it('bypasses optional cache admission if the observer budget is exhausted', async () => {
		const f = fixture(),
			observers = Array.from({ length: 64 }, () => f.fs.observeMutations());
		try {
			await f.prepare('int main() {}', {}, 'C');
			await f.run('int main() {}', {}, 'C');
			await f.prepare('int main() {}', {}, 'C');
			expect(f.spawn.mock.calls.filter(([name]) => name === 'clang')).toHaveLength(2);
		} finally {
			observers.forEach((observer) => observer.dispose());
		}
	});
	it('keys effective compiler flags and ignores redundant legacy args overridden by compileArgs', async () => {
		const f = fixture(),
			code = 'int main() {}';
		await f.prepare(code, { compileArgs: [] }, 'C');
		await f.runtime.prepare(
			'C',
			code,
			['unused'],
			{ compileArgs: [] },
			new AbortController().signal,
			f.progress,
			4
		);
		expect(f.spawn).toHaveBeenCalledTimes(1);
	});
});
