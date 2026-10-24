import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Directory, PreopenDirectory, WASI, wasi } from '@bjorn3/browser_wasi_shim';
import { createCrossClangCompiler, parseCrossClangManifest, type CrossClangEmit } from '../src/cross-clang.js';

const encoder = new TextEncoder();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function unsigned(value: number): number[] {
	const result: number[] = [];
	do { const byte = value & 127; value >>>= 7; result.push(byte | (value ? 128 : 0)); } while (value);
	return result;
}
function signed(value: number): number[] {
	const result: number[] = [];
	for (;;) {
		const byte = value & 127; value >>= 7;
		const done = value === 0 && !(byte & 64) || value === -1 && Boolean(byte & 64);
		result.push(byte | (done ? 0 : 128)); if (done) return result;
	}
}
const name = (value: string) => { const bytes = [...encoder.encode(value)]; return [...unsigned(bytes.length), ...bytes]; };
const section = (id: number, bytes: number[]) => [id, ...unsigned(bytes.length), ...bytes];
const constant = (value: number) => [0x41, ...signed(value)];
const call = (index: number) => [0x10, ...unsigned(index)];
const store = (address: number, value: number) => [...constant(address), ...constant(value), 0x36, 2, 0];
const load = (address: number) => [...constant(address), 0x28, 2, 0];
function elf(type = 2, machine = 62) {
	const bytes = new Uint8Array(64), view = new DataView(bytes.buffer);
	bytes.set([0x7f, 69, 76, 70, 2, 1, 1]);
	view.setUint16(16, type, true); view.setUint16(18, machine, true);
	view.setUint32(20, 1, true); view.setUint16(52, 64, true);
	return bytes;
}

/** A WASI host-contract fixture, not a compiler: reads stdin-like source data and writes fixed bytes. */
function tool(output = elf(), fileName = 'program.elf', noOutput = false): Uint8Array {
	const sourcePath = 'workspace/main.cpp', outputPath = `workspace/${fileName}`;
	const data = new Uint8Array(1024);
	data.set(encoder.encode(sourcePath), 256); data.set(encoder.encode(outputPath), 320);
	data.set(output, 512); data.set(encoder.encode('compiler stdout\n'), 768);
	const pathOpen = (ptr: number, len: number, flags: number, rights: number) => [
		...constant(3), ...constant(0), ...constant(ptr), ...constant(len), ...constant(flags),
		0x42, ...signed(rights), 0x42, 0, ...constant(0), ...constant(64), ...call(0), 0x1a
	];
	const write = (fd: number | null, ptr: number, len: number) => [
		...store(80, ptr), ...store(84, len), ...(fd === null ? load(64) : constant(fd)),
		...constant(80), ...constant(1), ...constant(96), ...call(2), 0x1a
	];
	const body = [0,
		...constant(128), ...constant(64), ...call(4), 0x1a,
		// Actual WASI libc's access(X_OK) needs preopen PATH_OPEN and inherited
		// FD_READ rights. The shim's zero defaults hide the pinned linker.
		...constant(3), ...constant(128), ...call(5), 0x1a,
		...load(136), ...constant(8192), 0x71, 0x45, 0x04, 0x40,
		...constant(126), ...call(3), 0x0b,
		...load(144), ...constant(2), 0x71, 0x45, 0x04, 0x40,
		...constant(126), ...call(3), 0x0b,
		...pathOpen(256, sourcePath.length, 0, 2),
		...store(80, 128), ...store(84, 1), ...load(64), ...constant(80), ...constant(1), ...constant(96), ...call(1), 0x1a,
		...constant(128), 0x2d, 0, 0, ...constant(33), 0x46, 0x04, 0x40,
		...constant(9), ...call(3), 0x0b,
		...write(1, 768, 16),
		...(noOutput ? [] : [...pathOpen(320, outputPath.length, 9, 64), ...write(null, 512, output.length)]),
		0x0b
	];
	return Uint8Array.from([
		0, 97, 115, 109, 1, 0, 0, 0,
		...section(1, [5,
			0x60, 9, 0x7f, 0x7f, 0x7f, 0x7f, 0x7f, 0x7e, 0x7e, 0x7f, 0x7f, 1, 0x7f,
			0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f,
			0x60, 1, 0x7f, 0,
			0x60, 2, 0x7f, 0x7f, 1, 0x7f,
			0x60, 0, 0]),
		...section(2, [6,
			...name('wasi_snapshot_preview1'), ...name('path_open'), 0, 0,
			...name('wasi_snapshot_preview1'), ...name('fd_read'), 0, 1,
			...name('wasi_snapshot_preview1'), ...name('fd_write'), 0, 1,
			...name('wasi_snapshot_preview1'), ...name('proc_exit'), 0, 2,
			...name('wasm_idle_process_v1'), ...name('initial_cwd'), 0, 3,
			...name('wasi_snapshot_preview1'), ...name('fd_fdstat_get'), 0, 3]),
		...section(3, [1, 4]), ...section(5, [1, 1, 1, 2]),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, 6]),
		...section(10, [1, ...unsigned(body.length), ...body]),
		...section(11, [1, 0, ...constant(0), 0x0b, ...unsigned(data.length), ...data])
	]);
}
function tar(path = 'usr/include/stdio.h') {
	const bytes = new Uint8Array(2048);
	bytes.set(encoder.encode(path));
	for (const offset of [100, 108, 116]) bytes.set(encoder.encode('0000000\0'), offset);
	bytes.set(encoder.encode('00000000000\0'), 136);
	bytes.set(encoder.encode('00000000001\0'), 124);
	bytes[156] = 48; bytes.set(encoder.encode('ustar\0'), 257); bytes[512] = 10;
	bytes.fill(32, 148, 156);
	const checksum = bytes.subarray(0, 512).reduce((sum, value) => sum + value, 0);
	bytes.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	return bytes;
}
function bundle(options: { output?: Uint8Array; fileName?: string; archivePath?: string; noOutput?: boolean } = {}) {
	const assets = { clang: tool(options.output, options.fileName, options.noOutput), lld: tool(), sysroot: tar(options.archivePath) };
	const manifest = {
		schemaVersion: 1, kind: 'clang-x86_64-linux-gnu', host: 'wasm32-wasip1', target: 'x86_64-unknown-linux-gnu',
		sysrootPath: '/sysroot', gccToolchain: '/sysroot/usr', resourceDir: '/sysroot/lib/clang/22', compilerPath: '/bin/clang', linkerPath: '/bin/ld.lld', cpuProfiles: ['x86-64', 'x86-64-v3'],
		assets: Object.fromEntries(Object.entries(assets).map(([key, bytes]) => [key, { path: `${key}.${key === 'sysroot' ? 'tar' : 'wasm'}`, sha256: hash(bytes), bytes: bytes.length }])),
		gnu: { gccVersion: '14', glibcVersion: '2.40', distribution: 'fixture', source: 'https://example.test/source', licenses: ['GPL-3.0-with-GCC-exception', 'LGPL-2.1'] },
		qualification: { status: 'unverified' }
	};
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	const files = new Map<string, Uint8Array>([['cross-toolchain.v1.json', manifestBytes], ...Object.entries(assets).map(([key, bytes]): [string, Uint8Array] => [manifest.assets[key].path, bytes])]);
	const fetchImpl = vi.fn(async (url: string | URL | Request) => {
		const bytes = files.get(new URL(String(url)).pathname.split('/').at(-1)!);
		return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 });
	}) as unknown as typeof fetch;
	return { manifest, files, fetchImpl, options: { manifestUrl: 'https://example.test/cross/cross-toolchain.v1.json', manifestSha256: hash(manifestBytes), fetchImpl } };
}

afterEach(() => vi.restoreAllMocks());

describe('compile-only x86-64 Clang host', () => {
	it.skipIf(!process.env.WASM_IDLE_CLANG_HOST_FIXTURE_DIR).each([false, true])('actual pinned Clang reaches its backend with resolved compiler path=%s', async resolveCompilerPath => {
		// This older real compiler has the qualified exec/cwd ABI but only a Wasm
		// backend. It proves host admission/driver discovery, not x86 codegen.
		if (resolveCompilerPath) {
			// The memory filesystem has no symlinks. EINVAL lets WASI libc's
			// realpath resolve /bin/clang; the shim's default ENOSYS otherwise
			// makes LLVM emit an empty self path and masks the resolved-path case.
			vi.spyOn(PreopenDirectory.prototype, 'path_readlink').mockReturnValue({ ret: wasi.ERRNO_INVAL, data: null });
		}
		const launchedArgv: string[][] = [], start = WASI.prototype.start;
		vi.spyOn(WASI.prototype, 'start').mockImplementation(function (this: WASI, instance) {
			launchedArgv.push([...this.args]);
			return start.call(this, instance);
		});
		const fixture = bundle(), directory = process.env.WASM_IDLE_CLANG_HOST_FIXTURE_DIR!;
		for (const [name, sha256] of [
			['clang', 'e0b548b70e13ad9620c1f47a1ef3f552b74cea586866ef1d8dcc0558c87f50e3'],
			['lld', '3da2fc3d37702d3d56bce834672912334e36d245efaf97fbdda7e4b5e810134a']
		] as const) {
			const bytes = new Uint8Array(await readFile(path.join(directory, `${name}.wasm`)));
			expect(hash(bytes)).toBe(sha256);
			fixture.files.set(`${name}.wasm`, bytes);
			fixture.manifest.assets[name] = { path: `${name}.wasm`, sha256, bytes: bytes.length };
		}
		const manifestBytes = encoder.encode(JSON.stringify(fixture.manifest));
		fixture.files.set('cross-toolchain.v1.json', manifestBytes);
		const compiler = await createCrossClangCompiler({ ...fixture.options, manifestSha256: hash(manifestBytes) });
		try {
			const result = compiler.compile({ language: 'c', code: 'int main(void) { return 0; }' });
			expect(result.exitCode).not.toBe(0);
			expect(result.artifact).toBeUndefined();
			expect(result.stderr).not.toContain('invalid linker name');
			expect(result.stderr).not.toContain("unknown argument: '-cc1'");
			expect(result.stderr).toContain('No available targets are compatible with triple');
			expect(launchedArgv[1]?.slice(0, resolveCompilerPath ? 2 : 3)).toEqual(resolveCompilerPath ? ['/bin/clang', '-cc1'] : ['', 'clang', '-cc1']);
		} finally { compiler.dispose(); }
	}, 30_000);

	it('pins all inputs, runs WASI file I/O, captures diagnostics, and returns ELF without compiling it as Wasm', async () => {
		const fixture = bundle(), compile = vi.spyOn(WebAssembly, 'compile');
		const compiler = await createCrossClangCompiler(fixture.options);
		const preparedCalls = compile.mock.calls.length;
		try {
			const result = compiler.compile({ code: 'int main() {}', cpu: 'x86-64-v3', optimization: '3' });
			expect(result.exitCode).toBe(0); expect(result.stdout).toBe('compiler stdout\n');
			expect(result.artifact).toMatchObject({ target: 'x86_64-unknown-linux-gnu', format: 'elf-executable', cpu: 'x86-64-v3', fileName: 'program.elf', bytes: elf() });
			expect(result.argv).toEqual(expect.arrayContaining(['--target=x86_64-unknown-linux-gnu', '-march=x86-64-v3', '-O3', '--driver-mode=g++', '-stdlib=libstdc++', '-static', '-fno-pie', '--ld-path=/bin/ld.lld']));
			expect(compiler.identity.sysrootSha256).toBe(fixture.manifest.assets.sysroot.sha256);
			expect(preparedCalls).toBeGreaterThanOrEqual(2);
			expect(compile).toHaveBeenCalledTimes(preparedCalls);
			for (const [bytes] of compile.mock.calls) expect(new Uint8Array(bytes as Uint8Array).slice(0, 4)).toEqual(Uint8Array.from([0, 97, 115, 109]));
			const failure = compiler.compile({ code: '!invalid' });
			expect(failure.exitCode).toBe(9); expect(failure.artifact).toBeUndefined();
			expect(failure.stdout).toBe('');
			expect(compiler.compile({ code: 'int main() {}' }).artifact?.bytes).toEqual(elf());
		} finally { compiler.dispose(); }
		expect(() => compiler.compile({ code: '' })).toThrow('disposed');
	});

	it('validates object and assembly outputs independently of executable output', async () => {
		for (const [emit, output, fileName, format] of [
			['object', elf(1), 'program.o', 'elf-object'], ['assembly', encoder.encode('vpaddd %ymm0, %ymm1, %ymm2\n'), 'program.s', 'assembly']
		] as const) {
			const compiler = await createCrossClangCompiler(bundle({ output, fileName }).options);
			try { const result = compiler.compile({ code: '', emit }); expect(result.artifact?.format).toBe(format); expect(result.argv).not.toContain('-static'); }
			finally { compiler.dispose(); }
		}
	});

	it.each(['success', 'failure', 'missing-output'] as const)('releases invocation mounts after %s', async outcome => {
		const mounted: { root: Directory; sysroot: Directory; binaries: Directory }[] = [];
		const fdstat = PreopenDirectory.prototype.fd_fdstat_get;
		vi.spyOn(PreopenDirectory.prototype, 'fd_fdstat_get').mockImplementation(function (this: PreopenDirectory) {
			mounted.push({ root: this.dir, sysroot: this.dir.contents.get('sysroot') as Directory, binaries: this.dir.contents.get('bin') as Directory });
			return fdstat.call(this);
		});
		const compiler = await createCrossClangCompiler(bundle({ noOutput: outcome === 'missing-output' }).options);
		try {
			if (outcome === 'missing-output') {
				expect(() => compiler.compile({ code: 'int main() {}' })).toThrow('without producing the requested output');
			} else {
				const result = compiler.compile({ code: outcome === 'failure' ? '!invalid' : 'int main() {}' });
				expect(result.exitCode).toBe(outcome === 'failure' ? 9 : 0);
			}
			expect(mounted.length).toBeGreaterThan(0);
			for (const { root, sysroot, binaries } of mounted) {
				// Inspect the real WASI mounts: parent roots must release their mounts
				// while the compiler's immutable trees remain usable for the next run.
				expect(sysroot).toBeInstanceOf(Directory); expect(binaries).toBeInstanceOf(Directory);
				expect(sysroot.contents.size).toBeGreaterThan(0); expect(binaries.contents.size).toBe(2);
				expect(root.contents.size).toBe(0);
			}
		} finally { compiler.dispose(); }
	});

	it('rejects wrong architecture, wrong output type, empty assembly, and success without output', async () => {
		for (const [options, emit] of [[{ output: elf(2, 183) }, 'executable'], [{ output: elf(1) }, 'executable'], [{ output: new Uint8Array(), fileName: 'program.s' }, 'assembly'], [{ noOutput: true }, 'executable']] as const) {
			const compiler = await createCrossClangCompiler(bundle(options).options);
			try { expect(() => compiler.compile({ code: '', emit: emit as CrossClangEmit })).toThrow(); }
			finally { compiler.dispose(); }
		}
	});

	it('rejects target overrides, unsafe workspace paths, collisions, and oversized inputs before execution', async () => {
		const compiler = await createCrossClangCompiler(bundle().options);
		try {
			for (const request of [
				{ code: '', cpu: 'native' }, { code: '', standard: 'gnu++20 -march=native' }, { code: '', optimization: '2 -target=wasm32' },
				...['../file.h', '/etc/a', 'a//b', 'a/./b', 'a\\b', 'main.cpp', 'main.cpp/nested', 'program.elf', 'program.elf/child'].map(path => ({ code: '', files: [{ path, contents: '' }] })),
				{ code: '', files: [{ path: 'a', contents: '' }, { path: 'a/b', contents: '' }] },
				{ code: 'x'.repeat(16 * 1024 * 1024 + 1) }
			]) expect(() => compiler.compile(request as never)).toThrow();
		} finally { compiler.dispose(); }
	});

	it('checks the manifest pin before asset loading and checks asset pins before Wasm compilation', async () => {
		const fixture = bundle(), compile = vi.spyOn(WebAssembly, 'compile');
		await expect(createCrossClangCompiler({ ...fixture.options, manifestSha256: '0'.repeat(64) })).rejects.toThrow();
		expect(fixture.fetchImpl).toHaveBeenCalledTimes(1); expect(compile).not.toHaveBeenCalled();
		const corrupt = bundle(); corrupt.files.get('clang.wasm')![10] ^= 1;
		await expect(createCrossClangCompiler(corrupt.options)).rejects.toThrow();
		expect(compile).not.toHaveBeenCalled();
		await expect(createCrossClangCompiler({ ...bundle().options, maxAssetBytes: 1024 })).rejects.toThrow('byte limit');
	});

	it('validates bounded streaming responses and rejects sysroot path escapes', async () => {
		const large = bundle(); large.files.set('sysroot.tar', new Uint8Array(4096));
		await expect(createCrossClangCompiler(large.options)).rejects.toThrow('byte limit');
		for (const archivePath of ['../outside', '/outside', 'usr/../../outside']) {
			await expect(createCrossClangCompiler(bundle({ archivePath }).options)).rejects.toThrow('relative path');
		}
	});

	it('rejects incompatible manifests and returns an immutable independent snapshot', () => {
		const { manifest } = bundle(), parsed = parseCrossClangManifest(manifest);
		manifest.assets.clang.sha256 = '0'.repeat(64);
		expect(parsed.assets.clang.sha256).not.toBe(manifest.assets.clang.sha256);
		expect(Object.isFrozen(parsed.assets.clang)).toBe(true);
		for (const changed of [{ target: 'wasm32-wasi' }, { sysrootPath: '/' }, { compilerPath: '/tmp/evil' }, { resourceDir: '/sysroot/../bin' }, { cpuProfiles: ['native'] }, { assets: { ...manifest.assets, clang: { ...manifest.assets.clang, path: 'https://evil.test/clang.wasm' } } }]) expect(() => parseCrossClangManifest({ ...manifest, ...changed })).toThrow();
	});
});
