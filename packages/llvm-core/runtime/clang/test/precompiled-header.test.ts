// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const persisted = vi.hoisted(() => ({
	entries: new Map<string, Uint8Array>(),
	read: vi.fn(),
	write: vi.fn(),
	remove: vi.fn(),
	failure: false
}));
vi.mock('@wasm-idle/core', async (original) => ({
	...(await original<typeof import('@wasm-idle/core')>()),
	createRuntimeGeneratedAssetCacheBackend: (policy: { enabled: boolean }) => ({
		read: async (key: string) => {
			persisted.read(key, policy);
			if (persisted.failure) throw new Error('storage unavailable');
			return policy.enabled ? persisted.entries.get(key)?.slice() : undefined;
		},
		write: async (key: string, bytes: Uint8Array) => {
			persisted.write(key, bytes, policy);
			if (persisted.failure) throw new Error('quota exceeded');
			if (policy.enabled) persisted.entries.set(key, bytes.slice());
			return policy.enabled;
		},
		remove: async (key: string) => {
			persisted.remove(key);
			persisted.entries.delete(key);
		}
	})
}));
import Clang from '../src/runtime.js';
import {
	PRECOMPILED_HEADER_PATH,
	precompiledHeaderArgsEligible,
	startsWithStdcppInclude,
	fingerprintPrecompiledHeaderBytes,
	fingerprintRuntimeHeaders
} from '../src/precompiled-header.js';

const stdcppSource = '#include <bits/stdc++.h>\nint main() { return 0; }\n';
const pchPath = `/${PRECOMPILED_HEADER_PATH}`;

beforeEach(() => {
	persisted.entries.clear();
	persisted.failure = false;
	persisted.read.mockClear();
	persisted.write.mockClear();
	persisted.remove.mockClear();
});

type RunArgs = [WebAssembly.Module, boolean, ...string[]];

function harness(run: (runtime: Clang, args: string[]) => void | Promise<void> = () => {}) {
	const files = new Map<string, Uint8Array>();
	const forwarded: string[] = [];
	const memfs = {
		stdout: (chunk: string) => forwarded.push(chunk),
		addFile: vi.fn((path: string, contents: string | Uint8Array) =>
			files.set(
				path,
				typeof contents === 'string' ? new TextEncoder().encode(contents) : contents
			)
		),
		addDirectory: vi.fn(),
		hasFile: (path: string) => files.has(path),
		getFileContents: (path: string) => files.get(path) ?? new Uint8Array()
	};
	const runtime = Object.assign(Object.create(Clang.prototype), {
		ready: Promise.resolve(),
		log: false,
		debug: false,
		stdout: vi.fn(),
		memfs,
		assetUrls: { clang: 'https://cdn.test/clang.wasm.gz', sysroot: 'https://cdn.test/sysroot' },
		compilerConfig: { resourceDir: '/lib/clang/22' },
		getModule: vi.fn(async () => ({})),
		getPrecompiledHeaderFingerprint: vi.fn(async () => ({
			compiler: 'a'.repeat(64),
			sysroot: ['b'.repeat(64)],
			runtimeHeaders: 'c'.repeat(64)
		})),
		debugVariableMetadata: {},
		debugGlobalMetadata: [],
		debugFunctionMetadata: {}
	}) as Clang;
	const runMock = vi.fn(async (...[, , ...args]: RunArgs) => {
		await run(runtime, args);
		return null;
	});
	runtime.run = runMock as unknown as Clang['run'];
	return { runtime, files, forwarded, runMock };
}

function compile(runtime: Clang, options: Record<string, unknown> = {}) {
	return runtime.compile({
		input: 'main.cpp',
		obj: 'main.o',
		code: stdcppSource,
		language: 'CPP',
		...options
	});
}

describe('precompiled <bits/stdc++.h> eligibility', () => {
	it('accepts the umbrella include after blank lines and comments only', () => {
		expect(startsWithStdcppInclude(stdcppSource)).toBe(true);
		expect(
			startsWithStdcppInclude('\uFEFF// solution\n/* a\n b */\n  #  include <bits/stdc++.h>')
		).toBe(true);
		expect(startsWithStdcppInclude('#define int long long\n#include <bits/stdc++.h>')).toBe(
			false
		);
		expect(startsWithStdcppInclude('#pragma pack(1)\n#include <bits/stdc++.h>')).toBe(false);
		expect(startsWithStdcppInclude('#include "bits/stdc++.h"')).toBe(false);
		expect(startsWithStdcppInclude('#include <iostream>\n#include <bits/stdc++.h>')).toBe(
			false
		);
		expect(startsWithStdcppInclude('// continued \\\n#include <bits/stdc++.h>')).toBe(false);
		expect(startsWithStdcppInclude('/* unterminated #include <bits/stdc++.h>')).toBe(false);
	});

	it('accepts only arguments that cannot change header lookup', () => {
		expect(precompiledHeaderArgsEligible([])).toBe(true);
		expect(
			precompiledHeaderArgsEligible([
				'-DLOCAL',
				'-UNDEBUG',
				'-Wall',
				'-w',
				'-O3',
				'-std=c++20'
			])
		).toBe(true);
		expect(precompiledHeaderArgsEligible(['-fno-exceptions', '-pedantic-errors'])).toBe(true);
		for (const args of [
			['-Iinclude'],
			['-include', 'x.h'],
			['-D', 'X'],
			['@args'],
			['-fsyntax-only'],
			[1]
		]) {
			expect(precompiledHeaderArgsEligible(args)).toBe(false);
		}
	});
});

describe('BrowserClangRuntime precompiled headers', () => {
	it('retrieves a persisted header before the first eligible compile in a new runtime', async () => {
		const first = harness((current, args) => {
			if (args.includes('-emit-pch'))
				current.memfs.addFile(PRECOMPILED_HEADER_PATH, new Uint8Array([4, 2]));
		});
		await compile(first.runtime);
		const header = await first.runtime.buildPrecompiledHeader();
		expect(persisted.entries.get(header!.key)).toEqual(header!.bytes);
		const reloaded = harness();
		await compile(reloaded.runtime);
		expect(reloaded.runMock.mock.calls).toHaveLength(1);
		expect(reloaded.runMock.mock.calls[0]).toContain('-include-pch');
		expect(reloaded.runtime.usedPrecompiledHeader).toBe(true);
	});

	it('invalidates reuse for compiler, sysroot, runtime headers and exact compile arguments', async () => {
		const first = harness();
		await compile(first.runtime);
		const key = first.runtime.precompiledHeaderPlan!.key;
		persisted.entries.set(key, new Uint8Array([1]));
		for (const change of ['compiler', 'sysroot', 'runtimeHeaders', 'args']) {
			const reloaded = harness();
			const fingerprint = {
				compiler: 'a'.repeat(64),
				sysroot: ['b'.repeat(64)],
				runtimeHeaders: 'c'.repeat(64)
			};
			if (change === 'compiler') fingerprint.compiler = 'd'.repeat(64);
			if (change === 'sysroot') fingerprint.sysroot = ['d'.repeat(64)];
			if (change === 'runtimeHeaders') fingerprint.runtimeHeaders = 'd'.repeat(64);
			reloaded.runtime.getPrecompiledHeaderFingerprint = vi.fn(async () => fingerprint);
			await compile(reloaded.runtime, change === 'args' ? { compileArgs: ['-DLOCAL'] } : {});
			expect(reloaded.runtime.precompiledHeaderPlan!.key).not.toBe(key);
			expect(reloaded.runMock.mock.calls[0]).not.toContain('-include-pch');
		}
	});

	it('uses fingerprints independently of asset URLs and requires them before persistence', async () => {
		const first = harness();
		await compile(first.runtime);
		persisted.entries.set(first.runtime.precompiledHeaderPlan!.key, new Uint8Array([1]));
		const relocated = harness();
		relocated.runtime.assetUrls.clang = 'https://another.test/compiler.wasm';
		await compile(relocated.runtime);
		expect(relocated.runMock.mock.calls[0]).toContain('-include-pch');
		const unavailable = harness();
		unavailable.runtime.getPrecompiledHeaderFingerprint = vi.fn(async () => undefined);
		await compile(unavailable.runtime);
		expect(unavailable.runtime.precompiledHeaderPlan).toBeUndefined();
		expect(unavailable.runMock.mock.calls[0]).not.toContain('-include-pch');
	});

	it('falls back when storage fails, and per-call disabling prevents a persisted hit', async () => {
		const first = harness();
		await compile(first.runtime);
		persisted.entries.set(first.runtime.precompiledHeaderPlan!.key, new Uint8Array([1]));
		persisted.failure = true;
		const denied = harness();
		await compile(denied.runtime);
		expect(denied.runMock.mock.calls[0]).not.toContain('-include-pch');
		persisted.failure = false;
		const disabled = harness();
		await compile(disabled.runtime, { persistentCache: false });
		expect(disabled.runMock.mock.calls[0]).not.toContain('-include-pch');
		expect(persisted.read.mock.calls.at(-1)?.[1]).toMatchObject({ enabled: false });
	});

	it('removes a persisted header rejected by Clang and completes textual compilation', async () => {
		const first = harness();
		await compile(first.runtime);
		const key = first.runtime.precompiledHeaderPlan!.key;
		persisted.entries.set(key, new Uint8Array([1]));
		const reloaded = harness((current, args) => {
			if (args.includes('-include-pch')) {
				current.memfs.stdout('fatal error: PCH file uses an incompatible configuration\n');
				throw new Error('exit 1');
			}
		});
		await compile(reloaded.runtime);
		expect(reloaded.runMock).toHaveBeenCalledTimes(2);
		expect(reloaded.runMock.mock.calls.at(-1)).not.toContain('-include-pch');
		expect(persisted.remove).toHaveBeenCalledWith(key);
		expect(persisted.entries.has(key)).toBe(false);
	});

	it('does not reuse archive fingerprints when workspace files override system headers', async () => {
		const { runtime, runMock } = harness();
		await compile(runtime, {
			workspaceFiles: [{ path: 'include/bits/stdc++.h', content: '#define DIFFERENT 1' }]
		});
		expect(runtime.precompiledHeaderPlan).toBeUndefined();
		expect(runMock.mock.calls[0]).not.toContain('-include-pch');
	});
	it('plans a header only for eligible C++ translation units', async () => {
		const { runtime } = harness();
		await compile(runtime);
		expect(runtime.precompiledHeaderPlan?.args).toEqual(
			expect.arrayContaining([
				'-emit-pch',
				'-x',
				'c++-header',
				'/include/bits/stdc++.h',
				pchPath
			])
		);
		for (const options of [
			{ code: `#define X\n${stdcppSource}` },
			{ compileArgs: ['-Iinclude'] },
			{ debugMode: 'trace' },
			{ language: 'C', input: 'main.c', code: '#include <bits/stdc++.h>\nint main(void) {}' }
		]) {
			const { runtime: other } = harness();
			await compile(other, options);
			expect(other.precompiledHeaderPlan).toBeUndefined();
		}
	});

	it('compiles with a matching header and ignores a header for other arguments', async () => {
		const { runtime, files, runMock } = harness();
		await compile(runtime);
		const header = { key: runtime.precompiledHeaderPlan!.key, bytes: new Uint8Array([7, 8]) };

		await compile(runtime, { precompiledHeader: header });
		expect(runMock.mock.calls.at(-1)).toEqual(
			expect.arrayContaining(['-include-pch', pchPath, 'main.cpp'])
		);
		expect(files.get(PRECOMPILED_HEADER_PATH)).toEqual(header.bytes);
		expect(runtime.usedPrecompiledHeader).toBe(true);

		runtime.usedPrecompiledHeader = false;
		await compile(runtime, { precompiledHeader: header, compileArgs: ['-DLOCAL'] });
		expect(runMock.mock.calls.at(-1)).not.toContain('-include-pch');
		expect(runtime.usedPrecompiledHeader).toBeFalsy();
	});

	it('falls back to the textual header when Clang rejects the precompiled one', async () => {
		const { runtime, forwarded, runMock } = harness((current, args) => {
			if (args.includes('-include-pch')) {
				current.memfs.stdout('fatal error: PCH file was compiled for a different target\n');
				throw new Error('exit 1');
			}
			current.memfs.stdout('textual compile\n');
		});
		await compile(runtime, { precompiledHeader: { key: 'stale', bytes: new Uint8Array() } });
		expect(runMock).toHaveBeenCalledTimes(1);
		const key = runtime.precompiledHeaderPlan!.key;
		forwarded.length = 0;

		await compile(runtime, { precompiledHeader: { key, bytes: new Uint8Array([1]) } });
		expect(runMock).toHaveBeenCalledTimes(3);
		expect(runMock.mock.calls.at(-1)).not.toContain('-include-pch');
		expect(forwarded).toEqual(['textual compile\n']);
		expect(runtime.usedPrecompiledHeader).toBeFalsy();
	});

	it('reports source errors from a compile that used the header without retrying', async () => {
		const { runtime, forwarded, runMock } = harness();
		await compile(runtime);
		const header = { key: runtime.precompiledHeaderPlan!.key, bytes: new Uint8Array([1]) };
		runMock.mockImplementationOnce(async () => {
			runtime.memfs.stdout("main.cpp:2:1: error: unknown type name 'foo'\n");
			throw new Error('exit 1');
		});
		forwarded.length = 0;
		await expect(compile(runtime, { precompiledHeader: header })).rejects.toThrow('exit 1');
		expect(runMock).toHaveBeenCalledTimes(2);
		expect(forwarded).toEqual(["main.cpp:2:1: error: unknown type name 'foo'\n"]);
	});

	it('builds the planned header and returns its bytes', async () => {
		const { runtime, runMock } = harness((current, args) => {
			if (args.includes('-emit-pch'))
				current.memfs.addFile(PRECOMPILED_HEADER_PATH, new Uint8Array([4, 2]));
		});
		expect(await runtime.buildPrecompiledHeader()).toBeUndefined();
		await compile(runtime);
		const header = await runtime.buildPrecompiledHeader();
		expect(runMock.mock.calls.at(-1)?.slice(3)).toEqual(runtime.precompiledHeaderPlan!.args);
		expect(header).toEqual({
			key: runtime.precompiledHeaderPlan!.key,
			bytes: new Uint8Array([4, 2])
		});
	});

	it('uses a supplied header when compiling and running through the combined API', async () => {
		const { runtime } = harness();
		const header = { key: 'matching-header', bytes: new Uint8Array([4, 2]) };
		runtime.compileLink = vi.fn(
			async () => new WebAssembly.Module(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))
		);

		await runtime.compileLinkRun(stdcppSource, { precompiledHeader: header });

		expect(runtime.compileLink).toHaveBeenCalledWith(
			stdcppSource,
			expect.objectContaining({ precompiledHeader: header })
		);
	});
});

describe('PCH content fingerprints', () => {
	it('uses the loaded compiler Module digest without another cancellable download', async () => {
		const compiler = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
		const changedCompiler = Uint8Array.of(...compiler, 0, 2, 1, 120);
		const fetchMock = vi
			.spyOn(globalThis, 'fetch')
			.mockResolvedValueOnce(new Response(compiler))
			.mockResolvedValueOnce(new Response(changedCompiler));
		try {
			const runtime = Object.assign(Object.create(Clang.prototype), {
				moduleCache: {},
				moduleLoads: {},
				assetUrls: { clang: 'https://cdn.test/compiler-fingerprint-changing.wasm' },
				maxAssetBytes: 128,
				signal: new AbortController().signal,
				log: false
			}) as Clang;
			await runtime.getModule(runtime.assetUrls.clang);
			await expect(runtime.getCompilerFingerprint()).resolves.toBe(
				await fingerprintPrecompiledHeaderBytes(compiler)
			);
			expect(fetchMock).toHaveBeenCalledOnce();
		} finally {
			fetchMock.mockRestore();
		}
	});

	it('hashes actual bytes and frames header paths independently of enumeration order', async () => {
		expect(await fingerprintPrecompiledHeaderBytes(new Uint8Array([1]))).not.toBe(
			await fingerprintPrecompiledHeaderBytes(new Uint8Array([2]))
		);
		const entries: [string, Uint8Array][] = [
			['a', new Uint8Array([1, 2])],
			['b', new Uint8Array([3])]
		];
		expect(await fingerprintRuntimeHeaders(new Map(entries))).toBe(
			await fingerprintRuntimeHeaders(new Map([...entries].reverse()))
		);
		expect(await fingerprintRuntimeHeaders(new Map(entries))).not.toBe(
			await fingerprintRuntimeHeaders(
				new Map([
					['a', new Uint8Array([1])],
					['b', new Uint8Array([2, 3])]
				])
			)
		);
	});
});
