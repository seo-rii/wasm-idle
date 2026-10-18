// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Container, ContainerProcess } from '@wasm-idle/container';
import { WebsiteClangRuntime } from './clang-runtime';
import type { WebsiteRuntimeAdapter } from './runtime-adapter';
import type { SandboxExecutionOptions } from '../options';

function fixture() {
	const spawn = vi.fn(
		async (_name: string, _argv: string[]) =>
			({
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
				exited: Promise.resolve({ reason: 'exited', code: 0 })
			}) as unknown as ContainerProcess
	);
	const profile = {
		container: { spawn } as unknown as Container,
		prepareCommand: vi.fn(async () => {})
	};
	const adapter = {
		directory: (language: string) => `/workspace/${language}`,
		inputs: (_language: string, code: string, options: SandboxExecutionOptions) => ({
			code,
			options: { ...options, activePath: options.activePath ?? 'main.cpp' }
		})
	} as unknown as WebsiteRuntimeAdapter;
	const runtime = new WebsiteClangRuntime(profile, adapter, vi.fn());
	const prepare = (code: string, options: SandboxExecutionOptions = {}, language = 'CPP') =>
		runtime.prepare(language, code, [], options, new AbortController().signal, undefined, 1);
	return { prepare, spawn };
}

describe('website container Clang compilation', () => {
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
});
