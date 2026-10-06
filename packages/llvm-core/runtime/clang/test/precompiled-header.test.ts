// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import Clang from '../src/runtime.js';
import {
	PRECOMPILED_HEADER_PATH,
	precompiledHeaderArgsEligible,
	startsWithStdcppInclude
} from '../src/precompiled-header.js';

const stdcppSource = '#include <bits/stdc++.h>\nint main() { return 0; }\n';
const pchPath = `/${PRECOMPILED_HEADER_PATH}`;

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
