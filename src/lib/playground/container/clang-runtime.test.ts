// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Container, ContainerProcess } from '@wasm-idle/container';
import { WebsiteClangRuntime } from './clang-runtime';
import type { WebsiteRuntimeAdapter } from './runtime-adapter';
import type { SandboxExecutionOptions } from '../options';

function fixture(stderr: string[] = []) {
	const files = new Map<string, Uint8Array>();
	const fs = {
		readFile: (path: string) => Uint8Array.from(files.get(path) ?? []),
		writeFile: (path: string, bytes: Uint8Array) => files.set(path, Uint8Array.from(bytes)),
		unlink: (path: string) => files.delete(path)
	};
	const codes: number[] = [];
	const spawn = vi.fn(async (_name: string, argv: string[]) => {
		const code = codes.shift() ?? 0;
		if (code === 0 && argv.includes('c++-header'))
			fs.writeFile(argv[argv.indexOf('-o') + 1], Uint8Array.of(1, 2, 3));
		return {
			stdin: new WritableStream(),
			stdout: new ReadableStream({
				start(controller) {
					controller.close();
				}
			}),
			stderr: new ReadableStream({
				start(controller) {
					for (const chunk of stderr) controller.enqueue(new TextEncoder().encode(chunk));
					controller.close();
				}
			}),
			exited: Promise.resolve({ reason: 'exited', code })
		} as unknown as ContainerProcess;
	});
	const profile = {
		container: { spawn, fs } as unknown as Container,
		prepareCommand: vi.fn(async () => {})
	};
	const adapter = {
		directory: (language: string) => `/workspace/${language}`,
		inputs: (_language: string, code: string, options: SandboxExecutionOptions) => ({
			code,
			options: { ...options, activePath: options.activePath ?? 'main.cpp' }
		})
	} as unknown as WebsiteRuntimeAdapter;
	const progress = { set: vi.fn() };
	const emit = vi.fn();
	const runtime = new WebsiteClangRuntime(profile, adapter, emit);
	const prepare = (code: string, options: SandboxExecutionOptions = {}, language = 'CPP') =>
		runtime.prepare(language, code, [], options, new AbortController().signal, progress, 1);
	return { runtime, prepare, spawn, progress, codes, files, emit };
}

const source = '// PCH probe\n#include <bits/stdc++.h>\nint main() {}';
describe('website container Clang compilation', () => {
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
		const { prepare, runtime, files } = fixture();
		await prepare(source);
		expect(files.size).toBe(1);
		await runtime.dispose();
		expect(files.size).toBe(0);
	});
});
