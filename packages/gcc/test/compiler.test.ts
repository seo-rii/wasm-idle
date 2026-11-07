import { createHash } from 'node:crypto';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrossGccCompiler, createGccCompiler } from '../src/compiler.js';
import { gccTlsRuntimePaths, parseCrossGccManifest } from '../src/manifest.js';
import { loadGccModuleFactory } from '../src/module-loader.js';
import * as wasiLinker from '../src/wasi-linker.js';
import { tlsObject } from './tls-fixtures.js';

interface FixtureNode {
	mode: number;
	node_ops: {
		readdir(node: FixtureNode): string[];
		lookup(node: FixtureNode, name: string): FixtureNode;
		getattr(node: FixtureNode): { size: number };
	};
	stream_ops: {
		read(stream: object, bytes: Uint8Array, offset: number, length: number, at: number): number;
	};
}

const host = vi.hoisted(() => ({
	calls: [] as { tool: string; argv: string[]; files: Map<string, Uint8Array> }[],
	sysrootFiles: [] as WeakRef<Uint8Array>[],
	mode: '',
	output: undefined as Uint8Array | undefined,
	coverageSizes: [] as number[],
	coverageReads: [] as string[],
	coverageContentsBytes: undefined as number | undefined,
	failure: undefined as WebAssembly.RuntimeError | undefined
}));

vi.mock('../src/sysroot-fs.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../src/sysroot-fs.js')>();
	return {
		...actual,
		gccSysrootTree(...args: Parameters<typeof actual.gccSysrootTree>) {
			host.sysrootFiles = [...args[0].values()].map((bytes) => new WeakRef(bytes));
			return actual.gccSysrootTree(...args);
		}
	};
});

/** Deliberately synthetic host fixture. It does not compile C/C++ or validate GCC semantics. */
vi.mock('../src/module-loader.js', () => ({
	loadGccModuleFactory: vi.fn(async (source: Uint8Array) => ({
		revoke: vi.fn(),
		factory: async (options: Record<string, unknown>) => {
			const tool = new TextDecoder().decode(source).replace('synthetic-fixture:', '');
			// Real binutils Emscripten loaders retain their pre-package names.
			(options.locateFile as Function)(
				`${tool}${tool === 'as' || tool === 'ld' ? '-new' : ''}.wasm`
			);
			if (host.mode === `abort-factory-${tool}`) {
				(options.print as Function)(`${tool} fixture stdout`);
				(options.printErr as Function)(
					`${tool}: internal compiler error during initialization`
				);
				throw host.failure;
			}
			const files = new Map<string, Uint8Array>();
			let instance: WebAssembly.Instance;
			(options.instantiateWasm as Function)({}, (value: WebAssembly.Instance) => {
				instance = value;
			});
			return {
				HEAPU8: new Uint8Array((instance!.exports.memory as WebAssembly.Memory).buffer),
				FS: {
					mkdirTree() {},
					chdir() {},
					writeFile(path: string, bytes: Uint8Array) {
						files.set(path, Uint8Array.from(bytes));
					},
					readFile(path: string) {
						if (path.endsWith('.gcno')) host.coverageReads.push(path);
						if (!files.has(path)) throw new Error('fixture output missing');
						return files.get(path)!;
					},
					stat(path: string) {
						if (!files.has(path)) throw new Error('fixture coverage notes missing');
						return { size: host.coverageSizes.shift() ?? files.get(path)!.length };
					},
					ErrnoError: class {
						constructor(readonly errno: number) {}
					},
					createNode: (_parent: unknown, name: string, mode: number) => ({ name, mode }),
					// Record mounted files by reading them through the mount's own operations.
					mount(type: { mount(mount: object): FixtureNode }, _: object, path: string) {
						const visit = (node: FixtureNode, directory: string) => {
							for (const name of node.node_ops.readdir(node).slice(2)) {
								const child = node.node_ops.lookup(node, name);
								if (child.mode & 0o40000) visit(child, `${directory}/${name}`);
								else {
									const bytes = new Uint8Array(
										child.node_ops.getattr(child).size
									);
									child.stream_ops.read(
										{ node: child },
										bytes,
										0,
										bytes.length,
										0
									);
									files.set(`${directory}/${name}`, bytes);
								}
							}
						};
						visit(type.mount({}), path);
					}
				},
				callMain(argv: string[]) {
					host.calls.push({ tool, argv, files });
					(options.print as Function)(`${tool} fixture stdout`);
					if (host.mode === 'diagnostics') {
						(options.printErr as Function)('retained diagnostic before limit');
						(options.printErr as Function)('x'.repeat(4 * 1024 * 1024));
					}
					if (host.mode === `abort-main-${tool}`) {
						(options.printErr as Function)(
							`${tool}: internal compiler error during compilation`
						);
						throw host.failure;
					}
					const source = tool.startsWith('cc1')
						? files.get(argv[argv.indexOf('-o') - 1])
						: undefined;
					if (source?.[0] === 33 || host.mode === `fail-${tool}`) {
						(options.printErr as Function)('synthetic failure');
						return 9;
					}
					if (host.mode === 'no-output') return 0;
					if (
						tool.startsWith('cc1') &&
						argv.includes('-ftest-coverage') &&
						host.mode !== 'no-notes'
					) {
						const stem = argv[argv.indexOf('-dumpbase') + 1].replace(
							/\.(?:c|cpp)$/u,
							''
						);
						// Raw transport bytes only; not a gcov format or compiler semantics fixture.
						files.set(
							`/workspace/${stem}.gcno`,
							host.coverageContentsBytes === undefined
								? new TextEncoder().encode(`raw-notes:${stem}\0\xff`)
								: new Uint8Array(host.coverageContentsBytes)
						);
					}
					if (argv.includes('--output-pch'))
						files.set(argv[argv.indexOf('--output-pch') + 1], encoder.encode('gpch'));
					const output = argv[argv.indexOf('-o') + 1];
					files.set(
						output,
						tool.startsWith('cc1')
							? new TextEncoder().encode(
									'# Synthetic assembly fixture, not GCC output\n.text\n'
								)
							: (host.output ??
									elf(
										tool === 'as' ? 1 : 2,
										host.mode === 'wrong-machine' ? 183 : 62,
										host.mode === 'dynamic'
									))
					);
					if (host.mode === 'exit-status') throw { name: 'ExitStatus', status: 0 };
					return 0;
				}
			};
		}
	}))
}));

const encoder = new TextEncoder();
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
// Only exports a memory. Using this proves host-Wasm/ELF separation, not GCC compilation.
const wasm = Uint8Array.from([
	0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1, 7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0
]);

function elf(type: number, machine = 62, dynamic = false) {
	const bytes = new Uint8Array(type === 1 ? 64 : 120),
		view = new DataView(bytes.buffer);
	bytes.set([0x7f, 69, 76, 70, 2, 1, 1]);
	view.setUint16(16, type, true);
	view.setUint16(18, machine, true);
	view.setUint32(20, 1, true);
	view.setUint16(52, 64, true);
	if (type === 2) {
		view.setBigUint64(32, 64n, true);
		view.setUint16(54, 56, true);
		view.setUint16(56, 1, true);
		view.setUint32(64, dynamic ? 3 : 1, true);
	}
	return bytes;
}

function tar(path = 'usr/include/stdio.h', contents = Uint8Array.of(10)) {
	const bytes = new Uint8Array(2048);
	bytes.set(encoder.encode(path));
	for (const offset of [100, 108, 116]) bytes.set(encoder.encode('0000000\0'), offset);
	bytes.set(encoder.encode('00000000000\0'), 136);
	bytes.set(encoder.encode(`${contents.length.toString(8).padStart(11, '0')}\0`), 124);
	bytes[156] = 48;
	bytes.set(encoder.encode('ustar\0'), 257);
	bytes.set(contents, 512);
	bytes.fill(32, 148, 156);
	const checksum = bytes.subarray(0, 512).reduce((sum, value) => sum + value, 0);
	bytes.set(encoder.encode(`${checksum.toString(8).padStart(6, '0')}\0 `), 148);
	return bytes;
}

function bundle(
	archivePath?: string,
	version: '13.3.0' | '16.2.0' = '16.2.0',
	capabilities?: Record<string, unknown>
) {
	const major = version === '13.3.0' ? '13' : '16';
	const files = new Map<string, Uint8Array>([['sysroot.tar', tar(archivePath)]]);
	for (const tool of ['cc1', 'cc1plus', 'as', 'ld']) {
		files.set(`${tool}.mjs`, encoder.encode(`synthetic-fixture:${tool}`));
		files.set(`${tool}.wasm`, Uint8Array.from(wasm));
	}
	const assets = Object.fromEntries(
		[...files].map(([path, bytes]) => [
			path === 'sysroot.tar'
				? 'sysroot'
				: path.replace('.mjs', 'Js').replace('.wasm', 'Wasm'),
			{ path, sha256: hash(bytes), bytes: bytes.length }
		])
	);
	const manifest = {
		schemaVersion: 1,
		kind: 'gcc-x86_64-linux-gnu',
		host: 'wasm32-emscripten',
		target: 'x86_64-linux-gnu',
		compiler: { family: 'gcc', version },
		cpuProfiles: ['x86-64', 'avx2-fma'],
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: `/sysroot/usr/lib/gcc/x86_64-linux-gnu/${major}`,
		resourceDir: `/sysroot/usr/lib/gcc/x86_64-linux-gnu/${major}/include`,
		assets,
		gnu: { gccVersion: major, glibcVersion: '2.39', distribution: 'Synthetic test fixture' },
		...(capabilities ? { capabilities } : {}),
		qualification: { status: 'unverified' }
	};
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	files.set('gcc-toolchain.v1.json', manifestBytes);
	const fetchImpl = vi.fn(async (url: string | URL | Request) => {
		const bytes = files.get(new URL(String(url)).pathname.split('/').at(-1)!);
		return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 });
	}) as unknown as typeof fetch;
	return {
		manifest,
		files,
		options: {
			manifestUrl: 'https://example.test/gcc/gcc-toolchain.v1.json',
			manifestSha256: hash(manifestBytes),
			fetchImpl
		}
	};
}

// These byte fixtures exercise host boundaries only, never real GCC code generation.
function wasiCommand(simd = false, relaxedSimd = false, atomics = false) {
	const vector = [0xfd, 0x0c, ...Array<number>(16).fill(0)];
	const body = [
		0,
		...(atomics ? [0xfe, 3, 0] : []),
		...(relaxedSimd
			? [...vector, ...vector, 0xfd, 0x80, 2, 0x1a]
			: simd
				? [...vector, 0x1a]
				: []),
		0x0b
	];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		1,
		4,
		1,
		0x60,
		0,
		0,
		3,
		2,
		1,
		0,
		5,
		3,
		1,
		0,
		1,
		7,
		19,
		2,
		6,
		...encoder.encode('memory'),
		2,
		0,
		6,
		...encoder.encode('_start'),
		0,
		0,
		10,
		body.length + 2,
		1,
		body.length,
		...body
	]);
}

function wasiObject(relaxedSimd = false, atomics = false) {
	// Relocatable identity function: exercises host receipts, not GCC semantics.
	const vector = [0xfd, 0x0c, ...Array<number>(16).fill(0)];
	const body = [
		0,
		...(atomics ? [0xfe, 3, 0] : []),
		...(relaxedSimd ? [...vector, ...vector, 0xfd, 0x80, 2, 0x1a] : []),
		0x20,
		0,
		0x0b
	];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		1,
		6,
		1,
		96,
		1,
		127,
		1,
		127,
		3,
		2,
		1,
		0,
		10,
		body.length + 2,
		1,
		body.length,
		...body,
		0,
		19,
		7,
		108,
		105,
		110,
		107,
		105,
		110,
		103,
		2,
		8,
		8,
		1,
		0,
		0,
		0,
		3,
		97,
		100,
		100,
		...(atomics
			? [
					0,
					26,
					15,
					...encoder.encode('target_features'),
					1,
					43,
					7,
					...encoder.encode('atomics')
				]
			: [])
	]);
}

function wasiBundle(
	linker = wasiCommand(),
	rtti = false,
	coverage = false,
	relaxedSimd = false,
	atomics = false,
	atomicProvider = true,
	tls = false,
	tlsProviders: readonly string[] = Object.values(gccTlsRuntimePaths),
	tlsLongDouble = tls,
	tlsHeader: 'present' | 'missing' | 'empty' = 'present'
) {
	const fixture = bundle(atomics && atomicProvider ? 'lib/wasm32-wasi/libatomic.a' : undefined);
	if (tls) {
		const records = [
			fixture.files.get('sysroot.tar')!.subarray(0, 1024),
			...(tlsHeader === 'missing'
				? []
				: [
						tar(
							'include/wasm32-wasi-tls/__errno.h',
							tlsHeader === 'empty' ? new Uint8Array() : undefined
						).subarray(0, 1024)
					]),
			...tlsProviders.map((path) => tar(path.slice('/sysroot/'.length)).subarray(0, 1024))
		];
		const archive = new Uint8Array(records.length * 1024 + 1024);
		records.forEach((record, index) => archive.set(record, index * 1024));
		fixture.files.set('sysroot.tar', archive);
	}
	fixture.files.delete('gcc-toolchain.v1.json');
	fixture.files.delete('ld.mjs');
	fixture.files.set('ld.wasm', linker);
	const revision = (family: string) => ({
		family,
		repository: `https://example.test/${family}`,
		version: '17.0.0',
		commit: 'a'.repeat(40)
	});
	const manifest = {
		schemaVersion: 2,
		kind: 'gcc-wasm32-wasi',
		host: 'wasm32-emscripten',
		target: 'wasm32-wasi',
		compiler: revision('gcc'),
		assembler: revision('wabt'),
		linker: { ...revision('lld'), host: 'wasm32-wasi' },
		sysroot: revision('wasi-libc'),
		abi: 'wasm32-wasi-preview1',
		linkMode: 'static',
		sysrootPath: '/sysroot',
		gccInstallation: '/sysroot/lib/gcc/wasm32-wasi/17.0.0',
		resourceDir: '/sysroot/lib/gcc/wasm32-wasi/17.0.0/include',
		runtimeLibraries: [
			'/sysroot/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a',
			...(atomics ? ['/sysroot/lib/wasm32-wasi/libatomic.a'] : [])
		],
		capabilities: {
			c: true,
			cpp: true,
			libc: true,
			libm: true,
			libstdcxx: rtti,
			staticInitialization: coverage,
			exceptions: false,
			rtti,
			threads: false,
			dynamicLinking: false,
			simd: true,
			...(relaxedSimd ? { relaxedSimd: true } : {}),
			...(atomics ? { atomics: true, sharedMemory: true } : {}),
			...(tls ? { tls: true, longDouble: tlsLongDouble } : {}),
			...(coverage ? { coverage: true } : {})
		},
		qualification: { status: relaxedSimd || atomics || tls ? 'verified' : 'unverified' },
		assets: Object.fromEntries(
			[...fixture.files].map(([path, bytes]) => [
				path === 'sysroot.tar'
					? 'sysroot'
					: path.replace('.mjs', 'Js').replace('.wasm', 'Wasm'),
				{ path, sha256: hash(bytes), bytes: bytes.length }
			])
		)
	};
	const manifestBytes = encoder.encode(JSON.stringify(manifest));
	fixture.files.set('gcc-toolchain.v2.json', manifestBytes);
	return {
		...fixture.options,
		target: 'wasm32-wasi' as const,
		manifestUrl: 'https://example.test/gcc/gcc-toolchain.v2.json',
		manifestSha256: hash(manifestBytes)
	};
}

beforeEach(() => {
	host.calls.length = 0;
	host.sysrootFiles = [];
	host.mode = '';
	host.output = undefined;
	host.coverageSizes = [];
	host.coverageReads = [];
	host.coverageContentsBytes = undefined;
	host.failure = undefined;
});
afterEach(() => vi.restoreAllMocks());

describe('synthetic GCC host contract (not real compiler qualification)', () => {
	it('captures private raw per-frontend notes and marks covered objects without changing plain receipts', async () => {
		host.output = wasiObject();
		const compiler = await createGccCompiler(wasiBundle(undefined, true, true));
		try {
			for (const language of ['c', 'cpp'] as const) {
				for (const optimization of ['0', '2'] as const) {
					const result = await compiler.compile({
						code: 'fixture',
						language,
						optimization,
						emit: 'object',
						coverage: true
					});
					expect(result.coverage).toMatchObject({
						format: 'gcc-gcov',
						compilerVersion: '17.0.0',
						compilerCommit: 'a'.repeat(40)
					});
					const note = result.coverage!.notes[0];
					expect(note.path).toBe('program.gcno');
					expect(note.dataPath).toBe('/profile/program.gcda');
					const frontEnd = host.calls.at(-2)!;
					expect(note.contents).toEqual(frontEnd.files.get('/workspace/program.gcno'));
					expect(note.contents).not.toBe(frontEnd.files.get('/workspace/program.gcno'));
					expect(host.calls.at(-1)!.files.has('/workspace/program.gcno')).toBe(false);
					frontEnd.files.get('/workspace/program.gcno')!.fill(0);
					expect(new TextDecoder().decode(note.contents)).toContain('raw-notes:program');
					expect(result.artifact!.linkInput!.profile.coverage).toBe(true);
					const before = host.calls.length;
					for (const coverage of [undefined, false])
						await expect(
							compiler.compile({
								code: '',
								language,
								coverage,
								linkInputs: [
									{
										path: 'covered.o',
										bytes: result.artifact!.bytes,
										...result.artifact!.linkInput!
									}
								]
							})
						).rejects.toThrow('coverage link inputs are currently unsupported');
					expect(host.calls).toHaveLength(before);
					const plain = await compiler.compile({
						code: 'fixture',
						language,
						emit: 'object'
					});
					const disabled = await compiler.compile({
						code: 'fixture',
						language,
						emit: 'object',
						coverage: false
					});
					expect(disabled.artifact!.linkInput).toEqual(plain.artifact!.linkInput);
					expect(plain.artifact!.linkInput!.profile).not.toHaveProperty('coverage');
					expect(plain).not.toHaveProperty('coverage');
				}
			}
		} finally {
			compiler.dispose();
		}
	});

	it('retains ordered per-unit notes and fixed profile paths on covered executables', async () => {
		host.output = wasiObject();
		vi.spyOn(wasiLinker, 'runWasiGccLinker').mockResolvedValue({
			exitCode: 0,
			peakMemoryBytes: 65536,
			output: wasiCommand()
		});
		const compiler = await createGccCompiler(wasiBundle(undefined, false, true));
		try {
			const result = await compiler.compile({
				code: 'fixture',
				language: 'c',
				coverage: true,
				files: [
					{ path: 'left/helper.c', contents: 'fixture left' },
					{ path: 'right/helper.c', contents: 'fixture right' }
				],
				sources: ['left/helper.c', 'right/helper.c']
			});
			expect(result.coverage!.notes.map(({ path }) => path)).toEqual([
				'program.gcno',
				'program.1.gcno',
				'program.2.gcno'
			]);
			expect(host.coverageReads).toEqual([
				'/workspace/program.gcno',
				'/workspace/program.1.gcno',
				'/workspace/program.2.gcno'
			]);
			expect(result.artifact!.coverage).toEqual({
				format: 'gcc-gcov',
				directory: '/profile',
				dataPaths: [
					'/profile/program.gcda',
					'/profile/program.1.gcda',
					'/profile/program.2.gcda'
				]
			});
		} finally {
			compiler.dispose();
		}
	});

	it('requires bounded notes before later tools and recovers after failed coverage requests', async () => {
		host.output = wasiObject();
		const compiler = await createGccCompiler(wasiBundle(undefined, false, true));
		try {
			const result = await compiler.compile({
				code: '!synthetic failure',
				language: 'c',
				coverage: true,
				files: [{ path: 'helper.c', contents: 'fixture' }],
				sources: ['helper.c']
			});
			expect(result.exitCode).toBe(9);
			expect(result.artifact).toBeUndefined();
			expect(result.coverage).toBeUndefined();
			expect(host.coverageReads).toHaveLength(0);
			host.mode = 'no-notes';
			await expect(
				compiler.compile({ code: 'fixture', language: 'c', emit: 'object', coverage: true })
			).rejects.toThrow('coverage notes missing');
			expect(host.calls.at(-1)!.tool).toBe('cc1');
			host.mode = '';
			for (const size of [0, 16 * 1024 * 1024 + 1, Number.NaN]) {
				host.coverageSizes = [size];
				const reads = host.coverageReads.length;
				await expect(
					compiler.compile({
						code: 'fixture',
						language: 'c',
						emit: 'object',
						coverage: true
					})
				).rejects.toThrow('16 MiB per file or 64 MiB total');
				expect(host.coverageReads).toHaveLength(reads);
			}
			host.coverageSizes = [1];
			await expect(
				compiler.compile({ code: 'fixture', language: 'c', emit: 'object', coverage: true })
			).rejects.toThrow('invalid filesystem size');
			const recovered = await compiler.compile({
				code: 'fixture',
				language: 'c',
				emit: 'assembly',
				coverage: true
			});
			expect(recovered.coverage!.notes.map(({ path }) => path)).toEqual(['program.gcno']);
		} finally {
			compiler.dispose();
		}
	});

	it('bounds aggregate notes before reading the file that crosses 64 MiB', async () => {
		host.output = wasiObject();
		host.coverageContentsBytes = 16 * 1024 * 1024;
		const compiler = await createGccCompiler(wasiBundle(undefined, false, true));
		try {
			const sources = Array.from({ length: 4 }, (_, i) => `unit${i}.c`);
			await expect(
				compiler.compile({
					code: 'fixture',
					language: 'c',
					coverage: true,
					sources,
					files: sources.map((path) => ({ path, contents: 'fixture' }))
				})
			).rejects.toThrow('64 MiB total');
			expect(host.coverageReads).toHaveLength(4);
			expect(host.calls.at(-1)!.tool).toBe('cc1');
		} finally {
			compiler.dispose();
		}
	});

	it.each(['wasm', 'loader'] as const)(
		'preserves the original %s initialization failure',
		async (phase) => {
			const failure = new Error(`synthetic ${phase} initialization failure`);
			if (phase === 'wasm') vi.spyOn(WebAssembly, 'compile').mockRejectedValueOnce(failure);
			else vi.mocked(loadGccModuleFactory).mockRejectedValueOnce(failure);
			await expect(createCrossGccCompiler(bundle().options)).rejects.toBe(failure);
		}
	);

	it('preserves cancellation during initialization and releases prepared loaders', async () => {
		const controller = new AbortController();
		const failure = new DOMException('synthetic initialization cancellation', 'AbortError');
		const compile = WebAssembly.compile.bind(WebAssembly);
		vi.spyOn(WebAssembly, 'compile').mockImplementationOnce(async (bytes) => {
			const module = await compile(bytes);
			controller.abort(failure);
			return module;
		});
		await expect(
			createCrossGccCompiler({ ...bundle().options, signal: controller.signal })
		).rejects.toBe(failure);
		const loaded = await vi.mocked(loadGccModuleFactory).mock.results.at(-1)!.value;
		expect(loaded.revoke).toHaveBeenCalledOnce();
	});

	it('releases extracted sysroot bytes while the disposed compiler remains reachable', async () => {
		setFlagsFromString('--expose_gc');
		const collect = runInNewContext('gc') as () => void;
		setFlagsFromString('--no-expose_gc');
		const compiler = await createCrossGccCompiler(bundle().options);
		expect(host.sysrootFiles).toHaveLength(1);
		compiler.dispose();
		// WeakRefs keep their targets alive for the current job. Collect only after
		// crossing an event-loop boundary, without dereferencing between collections.
		for (let iteration = 0; iteration < 5; iteration++) {
			await new Promise<void>((resolve) => setImmediate(resolve));
			collect();
		}
		expect(host.sysrootFiles.map((file) => file.deref())).toEqual([undefined]);
		await expect(compiler.compile({ code: '' })).rejects.toThrow('disposed');
	});

	it('validates the pinned WASI linker command ABI during loading', async () => {
		await expect(createGccCompiler(wasiBundle(wasm))).rejects.toThrow(
			'must export memory and _start'
		);
	});

	it('binds reusable object receipts and validates private link inputs before front-end calls', async () => {
		host.output = wasiObject();
		const compiler = await createGccCompiler(wasiBundle());
		try {
			const produced = await compiler.compile({
				code: 'fixture',
				language: 'c',
				emit: 'object'
			});
			const artifact = produced.artifact!;
			expect(artifact.linkInput).toEqual({
				format: 'wasm-object',
				sha256: hash(artifact.bytes),
				profile: {
					target: 'wasm32-wasi',
					abi: 'wasm32-wasi-preview1',
					simd: false,
					compatibility: {
						kind: 'gcc-bundle',
						manifestSha256: compiler.identity.manifestSha256,
						sysrootSha256: compiler.identity.sysrootSha256
					}
				}
			});
			const input = { ...artifact.linkInput!, path: 'reuse.o', bytes: artifact.bytes };
			const before = host.calls.length;
			const rejected = compiler.compile({
				code: '',
				language: 'c',
				linkInputs: [{ ...input, sha256: '0'.repeat(64) }]
			});
			await expect(compiler.compile({ code: 'overlap' })).rejects.toThrow('busy');
			await expect(rejected).rejects.toThrow('SHA-256 mismatch');
			expect(host.calls).toHaveLength(before);
			// A failing source is enough to observe that validation, snapshots, and identity
			// propagation completed; no synthetic executable is substituted for a linker.
			const pending = compiler.compile({
				code: '!source error',
				language: 'c',
				linkInputs: [input]
			});
			artifact.bytes.fill(255);
			const result = await pending;
			expect(result.exitCode).toBe(9);
			expect(result.artifact).toBeUndefined();
			expect(result.linkInputs?.[0]).toMatchObject({ path: 'reuse.o', sha256: input.sha256 });
			expect(host.calls.at(-1)!.files.get('/link-inputs/reuse.o')?.[0]).toBe(0);
		} finally {
			compiler.dispose();
		}
	});

	it('records known language/RTTI modes and rejects incompatible inputs before frontend calls', async () => {
		host.output = wasiObject();
		const compiler = await createGccCompiler(wasiBundle(undefined, true));
		try {
			const artifacts = [];
			for (const request of [
				{ language: 'c' as const },
				{ language: 'cpp' as const },
				{ language: 'cpp' as const, rtti: true }
			]) {
				const result = await compiler.compile({
					code: 'fixture',
					emit: 'object',
					...request
				});
				const profile = result.artifact!.linkInput!.profile;
				expect(profile.language).toBe(request.language);
				if (request.language === 'c') expect(profile).not.toHaveProperty('rtti');
				else expect(profile.rtti).toBe(request.rtti === true);
				artifacts.push(result.artifact!);
			}
			const inputs = artifacts.map((artifact) => ({
				...artifact.linkInput!,
				bytes: artifact.bytes,
				path: 'reuse.o'
			}));
			const before = host.calls.length;
			for (const [input, rtti] of [
				[inputs[1], true],
				[inputs[2], false]
			] as const)
				await expect(
					compiler.compile({ code: '', language: 'cpp', rtti, linkInputs: [input] })
				).rejects.toThrow('C++ RTTI profile');
			const { language: _language, rtti: _rtti, ...legacy } = inputs[0].profile;
			await expect(
				compiler.compile({
					code: '',
					rtti: true,
					linkInputs: [{ ...inputs[0], profile: legacy }]
				})
			).rejects.toThrow('unknown legacy language');
			await expect(compiler.compile({ code: '', language: 'c', rtti: true })).rejects.toThrow(
				'C++ source'
			);
			expect(host.calls).toHaveLength(before);
			// Validation reaches the synthetic failing frontend for known C and matching C++.
			for (const input of [inputs[0], inputs[2]]) {
				const result = await compiler.compile({
					code: '!source failure',
					rtti: true,
					linkInputs: [input]
				});
				expect(result.exitCode).toBe(9);
				expect(result.linkInputs?.[0].profile).toEqual(input.profile);
				expect(host.calls.at(-1)?.argv).toContain('-frtti');
			}
		} finally {
			compiler.dispose();
		}
	});

	it('rejects RTTI opt-in against an old bundle before any tool runs', async () => {
		const compiler = await createGccCompiler(wasiBundle());
		try {
			await expect(compiler.compile({ code: '', rtti: true })).rejects.toThrow(
				'does not support RTTI'
			);
			expect(host.calls).toHaveLength(0);
		} finally {
			compiler.dispose();
		}
	});

	it('refuses unrequested SIMD in assembled output and permits the explicit capable-bundle opt-in', async () => {
		host.output = Uint8Array.from([
			...wasiCommand(true),
			0,
			9,
			7,
			...encoder.encode('linking'),
			2
		]);
		const compiler = await createGccCompiler(wasiBundle());
		try {
			await expect(
				compiler.compile({ code: 'fixture', language: 'c', emit: 'object' })
			).rejects.toThrow('SIMD without an enabled SIMD compilation request');
			const result = await compiler.compile({
				code: 'fixture',
				language: 'c',
				emit: 'object',
				simd: true
			});
			expect(result.artifact?.wasm?.features).toEqual({
				simd128: true,
				relaxedSimd: false,
				atomics: false,
				bulkMemory: false
			});
			expect(result.stages[0].argv).toContain('-msimd128');
		} finally {
			compiler.dispose();
		}
	});

	it.each(['missing', 'empty'] as const)(
		'rejects a %s TLS errno header before creating tool instances',
		async (header) => {
			await expect(
				createGccCompiler(
					wasiBundle(
						undefined,
						false,
						false,
						false,
						false,
						true,
						true,
						undefined,
						true,
						header
					)
				)
			).rejects.toThrow('missing its qualified errno header');
			expect(host.calls).toHaveLength(0);
		}
	);

	it('requires every integrity-bound TLS provider before creating tool instances', async () => {
		for (const missing of Object.values(gccTlsRuntimePaths)) {
			const providers = Object.values(gccTlsRuntimePaths).filter((path) => path !== missing);
			await expect(
				createGccCompiler(
					wasiBundle(undefined, false, false, false, false, true, true, providers)
				)
			).rejects.toThrow('missing its qualified runtime archive: ' + missing);
			expect(host.calls).toHaveLength(0);
		}
		const ordinaryProviders = Object.values(gccTlsRuntimePaths).filter(
			(path) => path !== gccTlsRuntimePaths.ordinaryLongDouble
		);
		const withoutLongDouble = await createGccCompiler(
			wasiBundle(undefined, false, false, false, false, true, true, ordinaryProviders, false)
		);
		withoutLongDouble.dispose();
	});

	it('binds TLS object metadata, receipts and ordinary execution to the explicit profile', async () => {
		host.output = tlsObject();
		const options = wasiBundle(undefined, false, false, false, false, true, true);
		const compiler = await createGccCompiler(options);
		const legacy = await createGccCompiler(wasiBundle());
		try {
			await expect(compiler.compile({ code: '', emit: 'object' })).rejects.toThrow(
				/TLS.*explicit opt-in/
			);
			const count = host.calls.length;
			await expect(legacy.compile({ code: '', emit: 'object', tls: true })).rejects.toThrow(
				/TLS.*qualified/
			);
			expect(host.calls).toHaveLength(count);
			const { artifact, stages } = await compiler.compile({
				code: '',
				language: 'cpp',
				emit: 'object',
				tls: true
			});
			expect(artifact).toMatchObject({
				tls: true,
				wasm: { features: { tls: true, atomics: false } },
				linkInput: { profile: { tls: true } }
			});
			expect(artifact).not.toHaveProperty('atomics');
			expect(stages[0].argv).toContain('-mtls');
			expect(stages[1].argv).toContain('--enable-threads');
			host.output = wasiObject(false, true);
			await expect(compiler.compile({ code: '', emit: 'object', tls: true })).rejects.toThrow(
				'atomic instructions require explicit opt-in'
			);
			host.output = tlsObject();
			const input = { ...artifact!.linkInput!, bytes: artifact!.bytes, path: 'tls.o' };
			const fetchCount = vi.mocked(options.fetchImpl).mock.calls.length,
				toolCount = host.calls.length;
			await expect(
				compiler.compile({ code: '', language: 'cpp', linkInputs: [input] })
			).rejects.toThrow('TLS profile differs');
			expect(vi.mocked(options.fetchImpl).mock.calls).toHaveLength(fetchCount);
			expect(host.calls).toHaveLength(toolCount);
			const executable = {
				...artifact!,
				format: 'wasm-executable' as const,
				bytes: wasiCommand()
			};
			await expect(compiler.run(executable)).resolves.toMatchObject({
				exitCode: 0,
				stdout: ''
			});
			await expect(legacy.run(executable)).rejects.toThrow(/TLS.*qualified/);
			const runtimeAtomics = { ...executable, bytes: wasiCommand(false, false, true) };
			await expect(compiler.run(runtimeAtomics)).resolves.toMatchObject({
				exitCode: 0,
				stdout: ''
			});
			await expect(compiler.run({ ...runtimeAtomics, tls: undefined })).rejects.toThrow(
				'atomic instructions require explicit opt-in'
			);
			host.output = wasiObject();
			const ordinary = await compiler.compile({ code: '', emit: 'object' });
			expect(ordinary.artifact).not.toHaveProperty('tls');
			expect(ordinary.artifact!.linkInput!.profile).not.toHaveProperty('tls');
			expect(ordinary.artifact!.wasm!.features).not.toHaveProperty('tls');
		} finally {
			compiler.dispose();
			legacy.dispose();
		}
	});

	it('binds atomic compilation receipts and private execution to the selected qualified provider', async () => {
		await expect(
			createGccCompiler(wasiBundle(undefined, false, false, false, true, false))
		).rejects.toThrow('missing its qualified libatomic archive');
		host.output = wasiObject(false, true);
		const options = wasiBundle(undefined, false, false, false, true);
		const compiler = await createGccCompiler(options);
		const legacy = await createGccCompiler(wasiBundle());
		try {
			await expect(compiler.compile({ code: '', emit: 'object' })).rejects.toThrow(
				'require explicit opt-in'
			);
			const count = host.calls.length;
			await expect(
				legacy.compile({ code: '', emit: 'object', atomics: true })
			).rejects.toThrow('qualified capable bundle');
			expect(host.calls).toHaveLength(count);
			const { artifact } = await compiler.compile({
				code: '',
				emit: 'object',
				atomics: true
			});
			expect(artifact).toMatchObject({
				atomics: true,
				wasm: { features: { atomics: true } },
				linkInput: { profile: { atomics: true } }
			});
			const input = { ...artifact!.linkInput!, bytes: artifact!.bytes, path: 'atomic.o' };
			const fetchCount = vi.mocked(options.fetchImpl).mock.calls.length,
				toolCount = host.calls.length;
			await expect(
				compiler.compile({
					code: '',
					atomics: true,
					sharedMemory: { entry: 'entry', initialPages: 4, maximumPages: 4 },
					linkInputs: [input]
				})
			).rejects.toThrow(
				'external link receipts do not attest shared-safe static initialization'
			);
			expect(vi.mocked(options.fetchImpl).mock.calls).toHaveLength(fetchCount);
			expect(host.calls).toHaveLength(toolCount);
			await expect(compiler.compile({ code: '', linkInputs: [input] })).rejects.toThrow(
				'atomic profile differs'
			);
			const failed = await compiler.compile({
				code: '!source error',
				atomics: true,
				linkInputs: [input]
			});
			expect(failed).toMatchObject({
				exitCode: 9,
				linkInputs: [{ profile: { atomics: true } }]
			});
			const executable = {
				...artifact!,
				format: 'wasm-executable' as const,
				bytes: wasiCommand(false, false, true)
			};
			await expect(compiler.run(executable)).resolves.toMatchObject({
				exitCode: 0,
				stdout: ''
			});
			await expect(compiler.run({ ...executable, atomics: undefined })).rejects.toThrow(
				'require explicit opt-in'
			);
			await expect(legacy.run(executable)).rejects.toThrow('qualified capable bundle');
			host.output = wasiObject();
			const normal = await compiler.compile({ code: '', emit: 'object' });
			expect(normal.artifact).not.toHaveProperty('atomics');
			expect(normal.artifact!.linkInput!.profile).not.toHaveProperty('atomics');
		} finally {
			compiler.dispose();
			legacy.dispose();
		}
	});

	it('binds relaxed compilation outputs, link receipts and execution to the opt-in and qualified bundle', async () => {
		host.output = wasiObject(true);
		const compiler = await createGccCompiler(wasiBundle(undefined, false, false, true));
		const legacy = await createGccCompiler(wasiBundle());
		try {
			for (const request of [{}, { simd: true }, { simd: true, relaxedSimd: false }])
				await expect(
					compiler.compile({ code: 'fixture', emit: 'object', ...request })
				).rejects.toThrow('requires explicit opt-in');
			const request = {
				code: 'fixture',
				emit: 'object' as const,
				language: 'c' as const,
				simd: true,
				relaxedSimd: true
			};
			const count = host.calls.length;
			await expect(legacy.compile(request)).rejects.toThrow(
				'bundle does not support relaxed SIMD'
			);
			expect(host.calls).toHaveLength(count);
			const result = await compiler.compile(request);
			const object = result.artifact!;
			expect(object.relaxedSimd).toBe(true);
			expect(object.wasm!.features).toEqual({
				simd128: true,
				relaxedSimd: true,
				atomics: false,
				bulkMemory: false
			});
			expect(object.linkInput!.profile).toMatchObject({ simd: true, relaxedSimd: true });
			const input = { ...object.linkInput!, bytes: object.bytes, path: 'provider.o' };
			await expect(
				compiler.compile({ code: '', simd: true, linkInputs: [input] })
			).rejects.toThrow('relaxed SIMD profile differs');
			const failed = await compiler.compile({
				code: '!source error',
				language: 'c',
				simd: true,
				relaxedSimd: true,
				linkInputs: [input]
			});
			expect(failed.exitCode).toBe(9);
			expect(failed.linkInputs![0].profile.relaxedSimd).toBe(true);
			const executable = {
				...object,
				format: 'wasm-executable' as const,
				bytes: wasiCommand(true, true)
			};
			await expect(compiler.run(executable)).resolves.toMatchObject({
				exitCode: 0,
				stdout: ''
			});
			await expect(compiler.run({ ...executable, relaxedSimd: undefined })).rejects.toThrow(
				'requires explicit opt-in'
			);
			await expect(legacy.run(executable)).rejects.toThrow(
				'requires a qualified capable bundle'
			);
			host.output = wasiObject();
			const normal = await compiler.compile({ code: '', emit: 'object' });
			expect(normal.artifact).not.toHaveProperty('relaxedSimd');
			expect(normal.artifact!.linkInput!.profile).not.toHaveProperty('relaxedSimd');
		} finally {
			compiler.dispose();
			legacy.dispose();
		}
	});

	it('runs separate front end, assembler and static linker with real GNU paths and untouched source', async () => {
		const fixture = bundle(),
			compileWasm = vi.spyOn(WebAssembly, 'compile');
		const compiler = await createCrossGccCompiler(fixture.options);
		const preparedCalls = compileWasm.mock.calls.length;
		try {
			const code =
				'#pragma GCC push_options\n#pragma GCC target("avx2,fma")\n#pragma GCC optimize("O3")\nint main() {}\n#pragma GCC pop_options\n';
			const result = await compiler.compile({
				code,
				cpu: 'x86-64',
				optimization: '0',
				files: [{ path: 'include/local.h', contents: '#define LOCAL 1' }]
			});
			expect(result.exitCode).toBe(0);
			expect(result.artifact).toMatchObject({
				compiler: 'gcc',
				compilerHost: 'wasm32-emscripten',
				target: 'x86_64-linux-gnu',
				format: 'elf-executable',
				fileName: 'program.elf',
				cpu: 'x86-64',
				bytes: elf(2)
			});
			expect(result.stages.map((stage) => stage.tool)).toEqual(['cc1plus', 'as', 'ld']);
			expect(result.stages.every((stage) => stage.peakMemoryBytes === 65536)).toBe(true);
			expect(new TextDecoder().decode(host.calls[0].files.get('/workspace/main.cpp'))).toBe(
				code
			);
			expect(host.calls.every((call) => call.files.has('/sysroot/usr/include/stdio.h'))).toBe(
				true
			);
			expect(host.calls[0].argv).toEqual(
				expect.arrayContaining([
					'-O0',
					'-march=x86-64',
					'-nostdinc',
					'-fexceptions',
					'-std=gnu++20',
					'/sysroot/usr/include/c++/16',
					'/sysroot/usr/include/x86_64-linux-gnu/c++/16',
					'/sysroot/usr/include/c++/16/backward',
					'/sysroot/usr/lib/gcc/x86_64-linux-gnu/16/include',
					'/sysroot/usr/lib/gcc/x86_64-linux-gnu/16/include-fixed'
				])
			);
			expect(host.calls[0].argv).not.toContain('-mavx2');
			expect(host.calls[2].argv).toEqual(
				expect.arrayContaining([
					'-static',
					'-lstdc++',
					'-lgcc_eh',
					'-lc',
					'/sysroot/usr/lib/gcc/x86_64-linux-gnu/16/crtbeginT.o'
				])
			);
			expect(compiler.identity).toMatchObject({
				compilerVersion: '16.2.0',
				compilerHost: 'wasm32-emscripten',
				sysrootSha256: fixture.manifest.assets.sysroot.sha256
			});
			expect(preparedCalls).toBeGreaterThanOrEqual(4);
			expect(compileWasm).toHaveBeenCalledTimes(preparedCalls);
			for (const [bytes] of compileWasm.mock.calls)
				expect(new Uint8Array(bytes as Uint8Array).slice(0, 4)).toEqual(
					Uint8Array.from([0, 97, 115, 109])
				);
		} finally {
			compiler.dispose();
		}
		await expect(compiler.compile({ code: '' })).rejects.toThrow('disposed');
	});

	it.each(['c', 'cpp'] as const)(
		'links the math library after the %s object and before its runtime dependencies',
		async (language) => {
			const compiler = await createCrossGccCompiler(bundle().options);
			try {
				const result = await compiler.compile({ code: 'int main() {}', language });
				const linker = result.stages.find((stage) => stage.tool === 'ld')!;
				expect(linker.argv.filter((argument) => argument.startsWith('-l'))).toEqual(
					language === 'cpp'
						? ['-lstdc++', '-lm', '-lgcc', '-lgcc_eh', '-lc']
						: ['-lm', '-lgcc', '-lgcc_eh', '-lc']
				);
				expect(linker.argv.indexOf('/workspace/program.o')).toBeLessThan(
					linker.argv.indexOf('-lm')
				);
				expect(linker.argv.indexOf('-lm')).toBeLessThan(
					linker.argv.indexOf('--start-group')
				);
			} finally {
				compiler.dispose();
			}
		}
	);

	it('supports C, preprocessed .ii, AVX2/FMA and each requested output without adding later stages', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			const assembly = await compiler.compile({
				code: 'int f(int a) { return a + 1; }',
				language: 'c',
				emit: 'assembly',
				cpu: 'avx2-fma'
			});
			expect(assembly.stages.map((stage) => stage.tool)).toEqual(['cc1']);
			expect(assembly.stages[0].argv).toEqual(
				expect.arrayContaining(['-march=x86-64', '-mavx2', '-mfma', '-std=gnu17'])
			);
			const object = await compiler.compile({
				code: 'int f(int a) { return a + 1; }',
				emit: 'object',
				preprocessed: true
			});
			expect(object.artifact?.format).toBe('elf-object');
			expect(object.stages.map((stage) => stage.tool)).toEqual(['cc1plus', 'as']);
			expect(object.stages[0].argv).toContain('-fpreprocessed');
			expect(object.stages[0].argv).toContain('/workspace/main.ii');
			expect(object.stages[0].argv).not.toContain('-nostdinc');
		} finally {
			compiler.dispose();
		}
	});

	it.each(['c', 'cpp'] as const)(
		'supports AVX2 without FMA for %s with existing producer metadata',
		async (language) => {
			const fixture = bundle();
			const compiler = await createCrossGccCompiler(fixture.options);
			try {
				const result = await compiler.compile({
					code: 'int main() {}',
					language,
					cpu: 'avx2'
				});
				expect(result.exitCode).toBe(0);
				expect(result.artifact?.cpu).toBe('avx2');
				expect(result.stages[0].tool).toBe(language === 'c' ? 'cc1' : 'cc1plus');
				expect(result.stages[0].argv).toEqual(
					expect.arrayContaining(['-march=x86-64', '-mavx2', '-mno-fma'])
				);
				expect(result.stages[0].argv).not.toContain('-mfma');
				expect(compiler.manifest.cpuProfiles).toEqual(['x86-64', 'avx2-fma']);
			} finally {
				compiler.dispose();
			}
		}
	);

	it('never returns stale output after front end, assembler or linker failures and can compile again', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			expect((await compiler.compile({ code: '' })).artifact).toBeDefined();
			for (const tool of ['cc1plus', 'as', 'ld']) {
				host.mode = `fail-${tool}`;
				const result = await compiler.compile({ code: '' });
				expect(result.exitCode).toBe(9);
				expect(result.artifact).toBeUndefined();
				expect(result.stages.at(-1)?.tool).toBe(tool);
			}
			host.mode = 'exit-status';
			expect((await compiler.compile({ code: '' })).artifact).toBeDefined();
		} finally {
			compiler.dispose();
		}
	});

	it('compiles only explicitly selected additional units and links their distinct objects in order', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		const helper = encoder.encode('#include "local.h"\nint helper() { return LOCAL; }');
		try {
			const result = await compiler.compile({
				code: 'int helper(); int other(); int main() { return helper() + other(); }',
				files: [
					{ path: 'lib/helper.cpp', contents: helper },
					{ path: 'other.cpp', contents: 'int other() { return 3; }' },
					{ path: 'lib/local.h', contents: '#define LOCAL 4' },
					{ path: 'unselected.cpp', contents: '!not selected for compilation' }
				],
				sources: ['other.cpp', 'lib/helper.cpp']
			});
			expect(result.exitCode).toBe(0);
			expect(result.artifact?.format).toBe('elf-executable');
			expect(result.stages.map((stage) => stage.tool)).toEqual([
				'cc1plus',
				'as',
				'cc1plus',
				'as',
				'cc1plus',
				'as',
				'ld'
			]);
			const frontends = host.calls.filter((call) => call.tool === 'cc1plus');
			expect(frontends.map((call) => call.argv[call.argv.indexOf('-o') - 1])).toEqual([
				'/workspace/main.cpp',
				'/workspace/other.cpp',
				'/workspace/lib/helper.cpp'
			]);
			expect(frontends[2].files.get('/workspace/lib/helper.cpp')).toEqual(helper);
			expect(frontends[2].files.get('/workspace/lib/local.h')).toEqual(
				encoder.encode('#define LOCAL 4')
			);
			const link = host.calls.at(-1)!;
			expect(
				link.argv.filter((arg) => arg.startsWith('/workspace/') && arg.endsWith('.o'))
			).toEqual(['/workspace/program.o', '/workspace/program.1.o', '/workspace/program.2.o']);
			for (const object of ['program.o', 'program.1.o', 'program.2.o'])
				expect(link.files.get(`/workspace/${object}`)).toEqual(elf(1));
			expect(new Set(host.calls.map((call) => call.files)).size).toBe(7);
		} finally {
			compiler.dispose();
		}
	});

	it('stops at a failed additional unit without linking or returning an earlier artifact', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			expect((await compiler.compile({ code: 'int main() {}' })).artifact).toBeDefined();
			host.calls.length = 0;
			const result = await compiler.compile({
				code: 'int main() {}',
				files: [{ path: 'broken.cpp', contents: '!synthetic secondary failure' }],
				sources: ['broken.cpp']
			});
			expect(result.exitCode).toBe(9);
			expect(result.artifact).toBeUndefined();
			expect(result.stages.map((stage) => stage.tool)).toEqual(['cc1plus', 'as', 'cc1plus']);
			expect(host.calls.some((call) => call.tool === 'ld')).toBe(false);
			const next = await compiler.compile({ code: 'int main() {}' });
			expect(next.exitCode).toBe(0);
			expect(next.artifact).toBeDefined();
			expect(next.stderr).not.toContain('synthetic secondary failure');
		} finally {
			compiler.dispose();
		}
	});

	it.each([
		['c', false, 'helper.c', 'cc1'],
		['cpp', true, 'helper.ii', 'cc1plus']
	] as const)(
		'uses the same %s preprocessing contract for every unit',
		async (language, preprocessed, path, tool) => {
			const compiler = await createCrossGccCompiler(bundle().options);
			try {
				const result = await compiler.compile({
					code: 'int main() {}',
					language,
					preprocessed,
					files: [{ path, contents: 'int helper() { return 1; }' }],
					sources: [path]
				});
				expect(result.exitCode).toBe(0);
				const frontends = result.stages.filter((stage) => stage.tool === tool);
				expect(frontends).toHaveLength(2);
				for (const frontend of frontends)
					expect(frontend.argv.includes('-fpreprocessed')).toBe(preprocessed);
			} finally {
				compiler.dispose();
			}
		}
	);

	it('rejects missing output, another ELF architecture, dynamic linkage, and oversized diagnostics', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			for (const mode of ['no-output', 'wrong-machine', 'dynamic', 'diagnostics']) {
				host.mode = mode;
				await expect(compiler.compile({ code: '' })).rejects.toThrow();
			}
		} finally {
			compiler.dispose();
		}
	});

	it.each([
		['factory', 'cc1plus'],
		['factory', 'as'],
		['factory', 'ld'],
		['main', 'cc1plus'],
		['main', 'as'],
		['main', 'ld']
	])(
		'preserves diagnostics and the cause when %s aborts in %s, then can compile again',
		async (phase, tool) => {
			const compiler = await createCrossGccCompiler(bundle().options);
			try {
				expect((await compiler.compile({ code: '' })).artifact).toBeDefined();
				host.mode = `abort-${phase}-${tool}`;
				host.failure = new WebAssembly.RuntimeError('unreachable');
				const error = await compiler
					.compile({ code: '' })
					.catch((reason: unknown) => reason);
				expect(error).toBeInstanceOf(Error);
				expect((error as Error).cause).toBe(host.failure);
				expect((error as Error).message).toContain('unreachable');
				expect((error as Error).message).toContain(`${tool} fixture stdout`);
				expect((error as Error).message).toContain(`${tool}: internal compiler error`);
				expect(error).not.toHaveProperty('artifact');
				host.mode = '';
				const retried = await compiler.compile({ code: '' });
				expect(retried.artifact).toBeDefined();
				expect(retried.stderr).not.toContain('internal compiler error');
			} finally {
				compiler.dispose();
			}
		}
	);

	it('retains only diagnostics accepted before the four-MiB limit when rejecting', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			host.mode = 'diagnostics';
			const error = await compiler.compile({ code: '' }).catch((reason: unknown) => reason);
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain('GCC diagnostics exceeded four MiB');
			expect((error as Error).message).toContain('retained diagnostic before limit');
			expect((error as Error).message.length).toBeLessThan(1024);
			host.mode = '';
			expect((await compiler.compile({ code: '' })).artifact).toBeDefined();
		} finally {
			compiler.dispose();
		}
	});

	it('rejects arbitrary driver flags, unsafe paths, collisions and unsupported options before executing', async () => {
		const compiler = await createCrossGccCompiler(bundle().options);
		try {
			for (const request of [
				{ code: '', cpu: 'native' },
				{ code: '', flags: ['-flto'] },
				{ code: '', standard: 'gnu++20 -fplugin=bad' },
				{ code: '', preprocessed: 1 },
				{ code: '', sources: 'helper.cpp' },
				{ code: '', sources: null },
				{ code: '', sources: [1] },
				{ code: '', sources: ['../helper.cpp'] },
				{ code: '', sources: ['missing.cpp'] },
				{
					code: '',
					files: [{ path: 'helper.cpp', contents: '' }],
					sources: ['helper.cpp', 'helper.cpp']
				},
				{ code: '', sources: Array.from({ length: 64 }, (_, i) => `helper${i}.cpp`) },
				...['assembly', 'object'].map((emit) => ({
					code: '',
					emit,
					files: [{ path: 'helper.cpp', contents: '' }],
					sources: ['helper.cpp']
				})),
				...['program.1.s', 'program.1.o/header.h'].map((path) => ({
					code: '',
					sources: ['helper.cpp'],
					files: [
						{ path: 'helper.cpp', contents: '' },
						{ path, contents: '' }
					]
				})),
				...[
					'../outside',
					'/outside',
					'a\\b',
					'a//b',
					'a/./b',
					'program.o',
					'program.elf/x',
					'main.cpp'
				].map((path) => ({ code: '', files: [{ path, contents: '' }] })),
				{
					code: '',
					files: [
						{ path: 'a', contents: '' },
						{ path: 'a/b', contents: '' }
					]
				},
				{
					code: '',
					files: [
						{ path: 'a', contents: '' },
						{ path: 'a', contents: '' }
					]
				},
				{ code: 'a'.repeat(16 * 1024 * 1024 + 1) }
			])
				await expect(compiler.compile(request as never)).rejects.toThrow();
			expect(host.calls).toHaveLength(0);
		} finally {
			compiler.dispose();
		}
	});

	it('precompiles bits/stdc++.h once and offers it only to C++ units with identical flags', async () => {
		const header = 'usr/include/x86_64-linux-gnu/c++/16/bits/stdc++.h';
		const unsupported = await createCrossGccCompiler(bundle(header).options);
		try {
			expect(unsupported.manifest.capabilities.precompiledHeaders).toBe(false);
			await expect(unsupported.precompileHeader()).rejects.toThrow(
				'This GCC bundle cannot load precompiled headers'
			);
		} finally {
			unsupported.dispose();
		}
		const compiler = await createCrossGccCompiler(
			bundle(header, '16.2.0', { precompiledHeaders: true }).options
		);
		try {
			await expect(compiler.precompileHeader({ code: '' } as never)).rejects.toThrow(
				'Unsupported GCC precompiled header option'
			);
			const precompiled = await compiler.precompileHeader({ optimization: '2' });
			expect(precompiled).toMatchObject({ exitCode: 0, bytes: 4 });
			expect(precompiled.stages.map((stage) => stage.tool)).toEqual(['cc1plus']);
			expect(precompiled.stages[0].argv.slice(-5)).toEqual([
				`/sysroot/${header}`,
				'-o',
				'/workspace/stdc++.h.s',
				'--output-pch',
				'/pch/bits/stdc++.h.gch'
			]);
			const flags = precompiled.stages[0].argv.slice(0, -5);
			host.calls.length = 0;
			const code = '#include <bits/stdc++.h>\nint main() {}\n';
			await compiler.compile({
				code,
				files: [{ path: 'b.cpp', contents: code }],
				sources: ['b.cpp']
			});
			const frontends = host.calls.filter((call) => call.tool === 'cc1plus');
			expect(frontends).toHaveLength(2);
			for (const call of frontends) {
				const include = flags.indexOf('-isystem');
				expect(call.argv.slice(0, -3)).toEqual([
					...flags.slice(0, include),
					'-isystem',
					'/pch',
					...flags.slice(include)
				]);
				expect(new TextDecoder().decode(call.files.get('/pch/bits/stdc++.h.gch'))).toBe(
					'gpch'
				);
			}
			for (const request of [
				{ code, optimization: '0' as const },
				{ code, standard: 'gnu++17' },
				{ code, cpu: 'avx2' as const },
				{ code: 'int main() {}', language: 'c' as const },
				{ code: 'int main() {}', preprocessed: true }
			]) {
				host.calls.length = 0;
				expect((await compiler.compile(request)).exitCode).toBe(0);
				expect(host.calls[0].argv).not.toContain('/pch');
				expect(host.calls[0].files.has('/pch/bits/stdc++.h.gch')).toBe(false);
			}
		} finally {
			compiler.dispose();
		}
	});

	it('verifies manifest and every asset before executing any imported loader', async () => {
		const loader = (await import('../src/module-loader.js')).loadGccModuleFactory;
		vi.mocked(loader).mockClear();
		const compileWasm = vi.spyOn(WebAssembly, 'compile'),
			fixture = bundle();
		await expect(
			createCrossGccCompiler({ ...fixture.options, manifestSha256: '0'.repeat(64) })
		).rejects.toThrow();
		expect(fixture.options.fetchImpl).toHaveBeenCalledTimes(1);
		for (const path of ['cc1plus.mjs', 'as.wasm', 'sysroot.tar']) {
			const corrupt = bundle();
			corrupt.files.get(path)![9] ^= 1;
			await expect(createCrossGccCompiler(corrupt.options)).rejects.toThrow();
		}
		expect(loader).not.toHaveBeenCalled();
		expect(compileWasm).not.toHaveBeenCalled();
	});

	it.each(['gcc-toolchain.v1.json', 'cc1plus.mjs', 'as.wasm', 'sysroot.tar'])(
		'refetches %s after an integrity failure when the same fetch provider is reused',
		async (path) => {
			const fixture = bundle(),
				original = Uint8Array.from(fixture.files.get(path)!);
			fixture.files.get(path)![9] ^= 1;
			await expect(createCrossGccCompiler(fixture.options)).rejects.toThrow(
				'SHA-256 mismatch'
			);
			fixture.files.set(path, original);
			const compiler = await createCrossGccCompiler(fixture.options);
			try {
				expect((await compiler.compile({ code: '' })).exitCode).toBe(0);
				expect(
					vi
						.mocked(fixture.options.fetchImpl)
						.mock.calls.filter(([url]) => String(url).endsWith(`/${path}`))
				).toHaveLength(2);
			} finally {
				compiler.dispose();
			}
		}
	);

	it('loads a repinned bundle at the same URLs with the same fetch provider and asset sizes', async () => {
		const fixture = bundle(),
			first = await createCrossGccCompiler(fixture.options);
		first.dispose();
		const sysroot = Uint8Array.from(fixture.files.get('sysroot.tar')!);
		sysroot[512] = 42;
		fixture.files.set('sysroot.tar', sysroot);
		fixture.manifest.assets.sysroot.sha256 = hash(sysroot);
		const manifest = encoder.encode(JSON.stringify(fixture.manifest));
		expect(manifest.length).toBe(fixture.files.get('gcc-toolchain.v1.json')!.length);
		fixture.files.set('gcc-toolchain.v1.json', manifest);
		const compiler = await createCrossGccCompiler({
			...fixture.options,
			manifestSha256: hash(manifest)
		});
		try {
			expect(compiler.identity.sysrootSha256).toBe(hash(sysroot));
			expect((await compiler.compile({ code: '' })).exitCode).toBe(0);
			expect(host.calls[0].files.get('/sysroot/usr/include/stdio.h')).toEqual(
				Uint8Array.of(42)
			);
		} finally {
			compiler.dispose();
		}
	});

	it.each([
		['13.3.0', '13', '16'],
		['16.2.0', '16', '13']
	] as const)(
		'retains GCC %s identity, C++ headers and link paths',
		async (version, major, other) => {
			const fixture = bundle(undefined, version);
			for (const create of [
				() => createCrossGccCompiler(fixture.options),
				() => createGccCompiler({ ...fixture.options, target: 'x86_64-linux-gnu' })
			]) {
				const compiler = await create();
				try {
					expect(compiler.identity.compilerVersion).toBe(version);
					expect(compiler.manifest.gnu.gccVersion).toBe(major);
					const result = await compiler.compile({
						code: 'int main() {}',
						language: 'cpp'
					});
					expect(result.exitCode).toBe(0);
					expect(result.stages[0].argv).toEqual(
						expect.arrayContaining([
							`/sysroot/usr/include/c++/${major}`,
							`/sysroot/usr/include/x86_64-linux-gnu/c++/${major}`,
							`/sysroot/usr/include/c++/${major}/backward`,
							`/sysroot/usr/lib/gcc/x86_64-linux-gnu/${major}/include`
						])
					);
					expect(result.stages[0].argv).not.toContain(
						`/sysroot/usr/include/c++/${other}`
					);
					expect(result.stages.at(-1)!.argv).toContain(
						`/sysroot/usr/lib/gcc/x86_64-linux-gnu/${major}/crtbeginT.o`
					);
				} finally {
					compiler.dispose();
				}
			}
		}
	);

	it('rejects every mixed compiler, installation, resource and target-library version', () => {
		for (let mask = 1; mask < 15; mask++) {
			const fixture = bundle().manifest;
			fixture.compiler.version = mask & 1 ? '13.3.0' : '16.2.0';
			fixture.gccInstallation = `/sysroot/usr/lib/gcc/x86_64-linux-gnu/${mask & 2 ? 13 : 16}`;
			fixture.resourceDir = `/sysroot/usr/lib/gcc/x86_64-linux-gnu/${mask & 4 ? 13 : 16}/include`;
			fixture.gnu.gccVersion = mask & 8 ? '13' : '16';
			expect(() => parseCrossGccManifest(fixture)).toThrow();
		}
	});

	it('rejects asset/extraction limits and path traversal, and freezes a manifest snapshot', async () => {
		await expect(
			createCrossGccCompiler({ ...bundle().options, maxAssetBytes: 1024 })
		).rejects.toThrow('byte limit');
		for (const path of ['../file', '/outside', 'usr/../../outside'])
			await expect(createCrossGccCompiler(bundle(path).options)).rejects.toThrow(
				'relative path'
			);
		const { manifest } = bundle(),
			parsed = parseCrossGccManifest(manifest);
		manifest.assets.cc1Js.sha256 = '0'.repeat(64);
		expect(parsed.assets.cc1Js.sha256).not.toBe(manifest.assets.cc1Js.sha256);
		expect(Object.isFrozen(parsed.assets.cc1Js)).toBe(true);
		for (const change of [
			{ host: 'x86_64-linux-gnu' },
			{ target: 'wasm32-wasi' },
			{ compiler: { family: 'clang', version: '16.2.0' } },
			{ compiler: { family: 'gcc', version: '13.3.0' } },
			{ compiler: { family: 'gcc', version: '16.1.0' } },
			{ compiler: { family: 'gcc', version: '17.0.0' } },
			{ gnu: { ...manifest.gnu, gccVersion: '13' } },
			{ gnu: { ...manifest.gnu, gccVersion: '16.2.0' } },
			{ gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13' },
			{ resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13/include' },
			{ cpuProfiles: ['native'] },
			{ capabilities: { precompiledHeaders: 'yes' } },
			{ capabilities: [] },
			{ resourceDir: '/tmp/include' },
			{
				assets: {
					...manifest.assets,
					cc1Js: { ...manifest.assets.cc1Js, path: 'https://evil.test/gcc.mjs' }
				}
			}
		])
			expect(() => parseCrossGccManifest({ ...manifest, ...change })).toThrow();
	});
});
