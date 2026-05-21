import { afterEach, describe, expect, it, vi } from 'vitest';

const wasiCtorCalls: Array<{
	args: string[];
	envEntries: string[];
	fds: unknown[];
	options: Record<string, unknown>;
}> = [];
const wasiStart = vi.fn((..._args: unknown[]) => 0);

vi.mock('@bjorn3/browser_wasi_shim', () => {
	class Directory {
		contents: Map<string, unknown>;

		constructor(contents = new Map<string, unknown>()) {
			this.contents = contents;
		}
	}

	class Fd {}

	class File {
		bytes: Uint8Array;

		constructor(bytes: Uint8Array) {
			this.bytes = bytes;
		}
	}

	class PreopenDirectory {
		path: string;
		contents: Map<string, unknown>;

		constructor(path: string, contents: Map<string, unknown>) {
			this.path = path;
			this.contents = contents;
		}
	}

	class WASI {
		wasiImport = {};

		constructor(
			args: string[],
			envEntries: string[],
			fds: unknown[],
			options: Record<string, unknown>
		) {
			wasiCtorCalls.push({ args, envEntries, fds, options });
		}

		start(instance: unknown) {
			return wasiStart(instance);
		}
	}

	class Filestat {
		constructor(..._args: unknown[]) {}
	}

	class Fdstat {
		fs_rights_base = 0n;

		constructor(..._args: unknown[]) {}
	}

	return {
		Directory,
		Fd,
		File,
		Inode: {
			issue_ino: (() => {
				let next = 1;
				return () => next++;
			})()
		},
		PreopenDirectory,
		WASI,
		wasi: {
			ERRNO_SUCCESS: 0,
			FILETYPE_CHARACTER_DEVICE: 2,
			RIGHTS_FD_READ: 1,
			RIGHTS_FD_WRITE: 2,
			Filestat,
			Fdstat
		}
	};
});

afterEach(() => {
	wasiCtorCalls.length = 0;
	wasiStart.mockReset();
	vi.restoreAllMocks();
	vi.resetModules();
});

describe('browser execution', () => {
	it('uses the requested program name when building a WASI host', async () => {
		const { createBrowserWasiHost } = await import('../src/browser-execution.js');

		const host = createBrowserWasiHost({
			programName: 'probe.wasm',
			args: ['--flag']
		});

		expect(host.args).toEqual(['probe.wasm', '--flag']);
		expect(host.envEntries).toEqual(['PWD=/']);
	});

	it('uses artifact fileName as argv0 and skips recompiling a precompiled module', async () => {
		const { executeBrowserClangArtifact } = await import('../src/browser-execution.js');
		const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
		const precompiledModule = await WebAssembly.compile(wasmBytes);
		const compileSpy = vi.spyOn(WebAssembly, 'compile');
		const instantiateSpy = vi
			.spyOn(WebAssembly, 'instantiate')
			.mockResolvedValue({
				exports: {
					memory: new WebAssembly.Memory({ initial: 1 }),
					_start: () => {}
				}
			} as unknown as WebAssembly.Instance);
		wasiStart.mockReturnValue(0);

		const result = await executeBrowserClangArtifact({
			bytes: wasmBytes,
			wasm: precompiledModule,
			target: 'wasm32-wasi',
			format: 'wasi-core-wasm',
			fileName: 'hello.wasm'
		});

		expect(compileSpy).not.toHaveBeenCalled();
		expect(instantiateSpy).toHaveBeenCalledWith(precompiledModule, expect.any(Object));
		expect(wasiCtorCalls[0]?.args).toEqual(['hello.wasm']);
		expect(result).toMatchObject({
			exitCode: 0,
			stdout: '',
			stderr: ''
		});
	});
});
