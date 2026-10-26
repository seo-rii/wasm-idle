import { describe, expect, it, vi } from 'vitest';
import { createGccCompiler } from '../src/compiler.js';
import { gccAssetPaths, parseCrossGccManifest, parseWasiGccManifest } from '../src/manifest.js';
import { gccCompilePlan } from '../src/plan.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';
import { runGccWasiArtifact } from '../src/wasi-run.js';
import { inspectGccWasm } from '../src/wasm-output.js';
import type { WasiGccArtifact } from '../src/types.js';

const encoder = new TextEncoder();
const revision = (family: string) => ({
	family,
	repository: `https://example.test/${family}`,
	version: family === 'gcc' ? '17.0.0' : '1.0.0',
	commit: 'a'.repeat(40)
});

function manifestFixture() {
	return {
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
		runtimeLibraries: ['/sysroot/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a'],
		capabilities: {
			c: true,
			cpp: true,
			libc: true,
			libm: true,
			libstdcxx: false,
			staticInitialization: false,
			exceptions: false,
			rtti: false,
			threads: false,
			dynamicLinking: false,
			simd: false
		},
		assets: Object.fromEntries(
			Object.entries(gccAssetPaths)
				.filter(([key]) => key !== 'ldJs')
				.map(([key, path]) => [key, { path, bytes: 8, sha256: 'a'.repeat(64) }])
		),
		qualification: { status: 'unverified' }
	};
}

// Hand-encoded transport/runtime fixture. It does not establish GCC code-generation support.
function uleb(value: number): number[] {
	const bytes: number[] = [];
	do {
		const byte = value & 127;
		value >>>= 7;
		bytes.push(byte | (value ? 128 : 0));
	} while (value);
	return bytes;
}
const name = (value: string) => [...uleb(encoder.encode(value).length), ...encoder.encode(value)];
const section = (id: number, contents: number[]) => [id, ...uleb(contents.length), ...contents];
function echoFixture(namespace = 'wasi_snapshot_preview1', shared = false) {
	const code = [
		0, // no locals
		0x41,
		0,
		0x41,
		0,
		0x41,
		1,
		0x41,
		8,
		0x10,
		0,
		0x1a, // fd_read(0, 0, 1, 8)
		0x41,
		4,
		0x41,
		8,
		0x28,
		2,
		0,
		0x36,
		2,
		0, // iov.len = nread
		0x41,
		1,
		0x41,
		0,
		0x41,
		1,
		0x41,
		12,
		0x10,
		1,
		0x1a, // fd_write(1, 0, 1, 12)
		0x41,
		7,
		0x10,
		2,
		0x0b // proc_exit(7)
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
		...section(1, [3, 0x60, 4, 0x7f, 0x7f, 0x7f, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 0, 0x60, 0, 0]),
		...section(2, [
			3,
			...name(namespace),
			...name('fd_read'),
			0,
			0,
			...name(namespace),
			...name('fd_write'),
			0,
			0,
			...name(namespace),
			...name('proc_exit'),
			0,
			1
		]),
		...section(3, [1, 2]),
		...section(5, [1, shared ? 3 : 1, 1, 2]),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, 3]),
		...section(10, [1, ...uleb(code.length), ...code]),
		...section(11, [1, 0, 0x41, 0, 0x0b, 8, 32, 0, 0, 0, 64, 0, 0, 0])
	]);
}

function artifact(bytes = echoFixture()): WasiGccArtifact {
	return {
		compiler: 'gcc',
		compilerHost: 'wasm32-emscripten',
		target: 'wasm32-wasi',
		format: 'wasm-executable',
		fileName: 'program.wasm',
		bytes,
		cpu: 'wasm32'
	};
}

function commandFixture(result: 'void' | 'i32', importedFunction = false) {
	const body = result === 'void' ? [0, 0x0b] : [0, 0x41, 42, 0x0b];
	return Uint8Array.from([
		0,
		97,
		115,
		109,
		1,
		0,
		0,
		0,
		...section(1, [2, 0x60, 0, 0, 0x60, 0, 1, 0x7f]),
		...(importedFunction
			? section(2, [1, ...name('wasi_snapshot_preview1'), ...name('sched_yield'), 0, 1])
			: []),
		...section(3, [1, result === 'void' ? 0 : 1]),
		...section(5, [1, 0, 1]),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, importedFunction ? 1 : 0]),
		...section(10, [1, ...uleb(body.length), ...body])
	]);
}

function instructionFixture(
	instructions: number[],
	options: {
		types?: number[][];
		locals?: number[];
		globals?: number[];
		dataSegments?: number[][];
		start?: boolean;
		closed?: boolean;
	} = {}
) {
	const types = [[0x60, 0, 0], ...(options.types ?? [])];
	const body = [
		...(options.locals ?? [0]),
		...instructions,
		...(options.closed === false ? [] : [0x0b])
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
		...section(1, [...uleb(types.length), ...types.flat()]),
		...section(3, [1, 0]),
		...section(5, [1, 0, 1]),
		...(options.globals ? section(6, options.globals) : []),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, 0]),
		...(options.start ? section(8, [0]) : []),
		...(options.dataSegments ? section(12, uleb(options.dataSegments.length)) : []),
		...section(10, [1, ...uleb(body.length), ...body]),
		...(options.dataSegments
			? section(11, [
					...uleb(options.dataSegments.length),
					...options.dataSegments.flatMap((data) => [1, ...uleb(data.length), ...data])
				])
			: [])
	]);
}

describe('GCC WASI API contract (synthetic fixtures, not GCC qualification)', () => {
	it('requires a separate pinned output manifest and preserves source revisions', () => {
		const source = manifestFixture(),
			manifest = parseWasiGccManifest(source);
		expect(manifest.compiler.commit).toBe('a'.repeat(40));
		expect(manifest.linker.host).toBe('wasm32-wasi');
		expect(manifest.assets).not.toHaveProperty('ldJs');
		expect(() => parseCrossGccManifest(source)).toThrow();
		source.compiler.commit = 'b'.repeat(40);
		expect(manifest.compiler.commit).toBe('a'.repeat(40));
		expect(Object.isFrozen(manifest.capabilities)).toBe(true);
		for (const update of [
			{ host: 'wasm32-wasi' },
			{ target: 'x86_64-linux-gnu' },
			{ compiler: { ...source.compiler, version: '13.3.0' } },
			{ compiler: { ...source.compiler, commit: 'main' } },
			{ linker: { ...source.linker, host: 'wasm32-emscripten' } },
			{ runtimeLibraries: ['/sysroot/lib/../bad.a'] },
			{ capabilities: { ...source.capabilities, simd: 'simd128' } }
		])
			expect(() => parseWasiGccManifest({ ...source, ...update })).toThrow();
	});

	it('opts into SIMD only with a capable bundle and a real engine feature probe', () => {
		const legacy = parseWasiGccManifest(manifestFixture());
		const source = manifestFixture();
		source.capabilities.simd = true;
		const capable = parseWasiGccManifest(source);
		for (const language of ['c', 'cpp'] as const) {
			const oldPlan = wasiGccCompilePlan({ code: '', language }, legacy);
			expect(oldPlan.stages[0].argv).not.toContain('-mno-simd128');
			expect(wasiGccCompilePlan({ code: '', language }, capable).stages[0].argv).toContain(
				'-mno-simd128'
			);
			expect(
				wasiGccCompilePlan({ code: '', language, simd: true }, capable).stages[0].argv
			).toContain('-msimd128');
		}
		expect(() => wasiGccCompilePlan({ code: '', simd: true }, legacy)).toThrow(
			'bundle does not support Wasm SIMD'
		);
		const validate = vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
		try {
			expect(() => wasiGccCompilePlan({ code: '', simd: true }, capable)).toThrow(
				'engine does not support Wasm SIMD'
			);
			expect(validate).toHaveBeenCalledOnce();
		} finally {
			validate.mockRestore();
		}
	});

	it('schedules actual GCC, relocatable WABT and wasm-ld with real -D options for each unit', () => {
		const code = '#include "local.h"\nint helper(void); int main(void) { return helper(); }';
		const manifest = parseWasiGccManifest(manifestFixture());
		const plan = wasiGccCompilePlan(
			{
				code,
				language: 'c',
				defines: ['ONLINE_JUDGE=1', 'ANSWER=42'],
				files: [
					{ path: 'local.h', contents: '#define LOCAL 1' },
					{ path: 'helper.c', contents: 'int helper(void) { return ANSWER; }' }
				],
				sources: ['helper.c']
			},
			manifest
		);
		expect(plan.stages.map(({ tool }) => tool)).toEqual(['cc1', 'as', 'cc1', 'as', 'ld']);
		expect(plan.files[0].contents).toEqual(encoder.encode(code));
		for (const stage of plan.stages.filter(({ tool }) => tool === 'cc1')) {
			expect(stage.argv).toContain('-D__GCC_WASI_SINGLE_THREAD__=1');
			expect(stage.argv).toContain('-DONLINE_JUDGE=1');
			expect(stage.argv).toContain('-DANSWER=42');
			expect(stage.argv).not.toContain('-m64');
		}
		expect(plan.stages[1].argv).toEqual([
			'-r',
			'--enable-annotations',
			'/workspace/program.wat',
			'-o',
			'/workspace/program.o'
		]);
		expect(plan.stages.at(-1)?.argv).toEqual(
			expect.arrayContaining([
				'/sysroot/lib/wasm32-wasi/crt1-command.o',
				'/workspace/program.o',
				'/workspace/program.1.o',
				'-lm',
				'-lc',
				...manifest.runtimeLibraries
			])
		);
		expect(plan.fileName).toBe('program.wasm');
	});

	it('preserves C++ static destruction and makes incompatible ABI link warnings fatal', () => {
		const manifest = parseWasiGccManifest(manifestFixture());
		for (const language of ['c', 'cpp'] as const) {
			const plan = wasiGccCompilePlan({ code: '', language }, manifest);
			// wasm-ld otherwise emits a trapping executable for signature mismatches.
			expect(plan.stages.at(-1)?.argv).toContain('--fatal-warnings');
			if (language === 'cpp') {
				// The experimental GCC target's default destructor hook drops global dtors.
				expect(plan.stages[0].argv).toEqual(
					expect.arrayContaining(['-fuse-cxa-atexit', '-fno-threadsafe-statics'])
				);
			}
		}
	});

	it('rejects unavailable features and invalid definitions before any tool executes', () => {
		const manifest = parseWasiGccManifest(manifestFixture());
		for (const update of [
			{ cpu: 'avx2' },
			{ cpu: 'avx2-fma' },
			{ flags: ['-flto'] },
			...['exceptions', 'rtti', 'threads', 'dynamicLinking', 'simd'].map((feature) => ({
				[feature]: true
			})),
			{ defines: ['-include=bad.h'] },
			{ defines: ['F(x)=x'] },
			{ defines: ['NAME=1\n#error'] },
			{ defines: null },
			{ defines: ['ONLINE_JUDGE'], preprocessed: true },
			{ files: [{ path: 'program.wasm', contents: '' }] }
		])
			expect(() =>
				wasiGccCompilePlan({ code: '', language: 'c', ...update } as never, manifest)
			).toThrow();
		expect(() =>
			wasiGccCompilePlan(
				{ code: '', language: 'cpp' },
				parseWasiGccManifest({
					...manifestFixture(),
					capabilities: { ...manifestFixture().capabilities, cpp: false }
				})
			)
		).toThrow('does not support C++');
	});

	it('keeps target pragmas unchanged and asks GCC to diagnose unavailable target attributes', () => {
		const code = '#pragma GCC target("avx2,fma")\nint main(void) { return 0; }';
		const plan = wasiGccCompilePlan(
			{ code, language: 'c', emit: 'assembly' },
			parseWasiGccManifest(manifestFixture())
		);
		expect(plan.files[0].contents).toEqual(encoder.encode(code));
		expect(plan.stages[0].argv).toEqual(
			expect.arrayContaining(['-Werror=attributes', '-Werror=pragmas'])
		);
		expect(plan.stages).toHaveLength(1);
	});

	it('retains the GNU x86 link profile while adding genuine macro options', () => {
		const manifest = parseCrossGccManifest({
			schemaVersion: 1,
			kind: 'gcc-x86_64-linux-gnu',
			host: 'wasm32-emscripten',
			target: 'x86_64-linux-gnu',
			compiler: { family: 'gcc', version: '13.3.0' },
			cpuProfiles: ['x86-64', 'avx2-fma'],
			linkMode: 'static',
			sysrootPath: '/sysroot',
			gccInstallation: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13',
			resourceDir: '/sysroot/usr/lib/gcc/x86_64-linux-gnu/13/include',
			assets: Object.fromEntries(
				Object.entries(gccAssetPaths).map(([key, path]) => [
					key,
					{ path, bytes: 8, sha256: 'a'.repeat(64) }
				])
			),
			gnu: { gccVersion: '13', glibcVersion: '2.39', distribution: 'Synthetic fixture' },
			qualification: { status: 'unverified' }
		});
		const plan = gccCompilePlan(
			{ code: '', cpu: 'avx2-fma', defines: ['ONLINE_JUDGE'] },
			manifest
		);
		expect(plan.stages[0].argv).toEqual(
			expect.arrayContaining(['-DONLINE_JUDGE', '-mavx2', '-mfma', '-fexceptions'])
		);
		expect(plan.stages.at(-1)?.argv).toEqual(
			expect.arrayContaining(['-static', '-lstdc++', '-lm', '-lgcc_eh'])
		);
	});

	it('rejects an implicit target before fetching compiler assets', async () => {
		await expect(
			createGccCompiler({
				manifestUrl: 'https://example.test/manifest.json',
				manifestSha256: 'a'.repeat(64)
			} as never)
		).rejects.toThrow('explicit');
	});
});

describe('WASI runner and binary validation with hand-encoded Wasm fixtures', () => {
	it('distinguishes SIMD instructions from FD bytes in integer, floating point and data immediates', async () => {
		const bytes = instructionFixture(
			[
				0x41,
				0xfd,
				1,
				0x1a, // i32.const 253
				0x42,
				0xfd,
				1,
				0x1a, // i64.const 253
				0x43,
				0xfd,
				0,
				0,
				0,
				0x1a,
				0x44,
				0xfd,
				0,
				0,
				0,
				0,
				0,
				0,
				0,
				0x1a
			],
			{ dataSegments: [[0xfd, 0x0c, ...Array<number>(16).fill(0)]] }
		);
		await expect(inspectGccWasm(bytes, 'executable')).resolves.toMatchObject({
			features: { simd128: false }
		});
		const vector = instructionFixture([0xfd, 0x0c, ...Array<number>(16).fill(0), 0x1a]);
		const inspected = await inspectGccWasm(vector, 'executable');
		expect(inspected.features).toEqual({ simd128: true });
		expect(Object.isFrozen(inspected.features)).toBe(true);
	});

	it('detects SIMD types, locals and globals without relying on opcode or target_features metadata', async () => {
		for (const options of [
			{ types: [[0x60, 1, 0x7b, 0]] },
			{ locals: [1, 1, 0x7b] },
			{ globals: [1, 0x7b, 0, 0xfd, 0x0c, ...Array<number>(16).fill(0), 0x0b] }
		])
			await expect(
				inspectGccWasm(instructionFixture([], options), 'executable')
			).resolves.toMatchObject({ features: { simd128: true } });
	});

	it('decodes signed block types and type indices containing FD without confusing them with instructions', async () => {
		const scalar = instructionFixture(
			[
				0x02,
				0x7f,
				0x41,
				1,
				0x0b,
				0x1a, // block (result i32)
				0x02,
				0xfd,
				1,
				0x0b // block (type 253)
			],
			{ types: Array.from({ length: 253 }, () => [0x60, 0, 0]) }
		);
		await expect(inspectGccWasm(scalar, 'executable')).resolves.toMatchObject({
			features: { simd128: false }
		});
		const vector = instructionFixture([
			0x02,
			0x7b,
			0xfd,
			0x0c,
			...Array<number>(16).fill(0),
			0x0b,
			0x1a
		]);
		await expect(inspectGccWasm(vector, 'executable')).resolves.toMatchObject({
			features: { simd128: true }
		});
	});

	it('skips bulk-memory indices and validates numeric instruction semantics in the engine', async () => {
		const zeros = [0x41, 0, 0x41, 0, 0x41, 0];
		const bytes = instructionFixture(
			[
				...zeros,
				0xfc,
				8,
				0xfd,
				1,
				0, // memory.init 253 0
				0xfc,
				9,
				0xfd,
				1, // data.drop 253
				...zeros,
				0xfc,
				10,
				0,
				0, // memory.copy
				...zeros,
				0xfc,
				11,
				0 // memory.fill
			],
			{ dataSegments: Array.from({ length: 254 }, () => [0xfd]) }
		);
		await expect(inspectGccWasm(bytes, 'executable')).resolves.toMatchObject({
			features: { simd128: false }
		});
		await expect(
			inspectGccWasm(instructionFixture([0x6a]), 'executable')
		).rejects.toBeInstanceOf(WebAssembly.CompileError);
	});

	it.each([
		{ code: [0xfd, 0x0c], error: 'Truncated GCC WebAssembly instruction immediate' },
		{ code: [0xfd], error: 'Truncated GCC WebAssembly section' },
		{ code: [0xfc], error: 'Truncated GCC WebAssembly section' },
		{ code: [0xfd, ...uleb(0x9a)], error: 'Unsupported GCC WebAssembly opcode: 0xfd 9a' },
		{ code: [0xfc, 18], error: 'Unsupported GCC WebAssembly opcode: 0xfc 12' },
		{ code: [0xfd, ...uleb(0x100)], error: 'GCC WASI does not support relaxed SIMD' },
		{ code: [0xfe, 0], error: 'GCC WASI does not support atomic instructions or threads' }
	])('rejects malformed or unsupported instructions: $error ($code)', async ({ code, error }) => {
		await expect(
			inspectGccWasm(instructionFixture(code, { closed: false }), 'executable')
		).rejects.toThrow(error);
	});

	it('rejects an implicit Wasm start section before instantiation', async () => {
		await expect(
			runGccWasiArtifact(artifact(instructionFixture([], { start: true })))
		).rejects.toThrow('without a WebAssembly start section');
	});

	it.each(['constructor', 'toString'])(
		'rejects the inherited WASI import %s',
		async (importName) => {
			const body = [0, 0x10, 0, 0x1a, 0x0b]; // Call () -> i32 and drop its result.
			const bytes = Uint8Array.from([
				0,
				97,
				115,
				109,
				1,
				0,
				0,
				0,
				...section(1, [2, 0x60, 0, 0, 0x60, 0, 1, 0x7f]),
				...section(2, [1, ...name('wasi_snapshot_preview1'), ...name(importName), 0, 1]),
				...section(3, [1, 0]),
				...section(5, [1, 0, 1]),
				...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, 1]),
				...section(10, [1, ...uleb(body.length), ...body])
			]);
			expect(WebAssembly.validate(bytes)).toBe(true);
			await expect(runGccWasiArtifact(artifact(bytes))).rejects.toThrow(
				`Unsupported WASI Preview 1 function: ${importName}`
			);
		}
	);

	it('requires a void entry point and resolves its type after imported functions', async () => {
		for (const importedFunction of [false, true]) {
			await expect(
				inspectGccWasm(commandFixture('i32', importedFunction), 'executable')
			).rejects.toThrow('_start must have type () -> ()');
			await expect(
				inspectGccWasm(commandFixture('void', importedFunction), 'executable')
			).resolves.toMatchObject({ memory: { initialPages: 1 } });
		}
	});

	it('checks imported object memory flags as well as defined executable memory', async () => {
		for (const flags of [3, 5]) {
			const bytes = Uint8Array.from([
				0,
				97,
				115,
				109,
				1,
				0,
				0,
				0,
				...section(2, [1, ...name('env'), ...name('memory'), 2, flags, 1, 1]),
				...section(0, [...name('linking'), 2])
			]);
			await expect(inspectGccWasm(bytes, 'object')).rejects.toThrow(
				'shared memory, threads or memory64'
			);
		}
		const bytes = Uint8Array.from([
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0,
			...section(2, [1, ...name('env'), ...name('memory'), 2, 1, 1, 2]),
			...section(0, [...name('linking'), 2])
		]);
		await expect(inspectGccWasm(bytes, 'object')).resolves.toMatchObject({
			memory: { initialPages: 1, maximumPages: 2, shared: false }
		});
	});

	it('requires one current linking metadata section for relocatable objects', async () => {
		for (const linking of [
			section(0, [...name('linking'), 1]),
			[...section(0, [...name('linking'), 2]), ...section(0, [...name('linking'), 2])]
		])
			await expect(
				inspectGccWasm(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, ...linking]), 'object')
			).rejects.toThrow('Unsupported GCC Wasm object linking metadata');
	});

	it('inspects and runs the original byte snapshot when the caller mutates its buffer', async () => {
		const bytes = echoFixture();
		const pending = runGccWasiArtifact(artifact(bytes), { stdin: 'snapshot' });
		const exitInstruction = bytes.findIndex(
			(byte, i) =>
				byte === 0x41 && bytes[i + 1] === 7 && bytes[i + 2] === 0x10 && bytes[i + 3] === 2
		);
		expect(exitInstruction).toBeGreaterThan(0);
		bytes[exitInstruction + 1] = 9;
		await expect(pending).resolves.toMatchObject({ exitCode: 7, stdout: 'snapshot' });
	});

	it('executes actual Wasm stdin/stdout with Preview 1 proc_exit and reports the memory ABI', async () => {
		const result = await runGccWasiArtifact(artifact(), { stdin: 'input 42 한글\n' });
		expect(result).toMatchObject({
			exitCode: 7,
			stdout: 'input 42 한글\n',
			stderr: '',
			peakMemoryBytes: 65536
		});
		const inspection = await inspectGccWasm(echoFixture(), 'executable');
		expect(inspection.memory).toEqual({ initialPages: 1, maximumPages: 2, shared: false });
		expect(inspection.imports).toHaveLength(3);
		expect(inspection.exports.map(({ name }) => name)).toEqual(['memory', '_start']);
	});

	it('rejects ELF, plain modules passed as objects, foreign imports and shared memory', async () => {
		await expect(inspectGccWasm(Uint8Array.of(127, 69, 76, 70), 'executable')).rejects.toThrow(
			'WebAssembly'
		);
		await expect(inspectGccWasm(echoFixture(), 'object')).rejects.toThrow('linking metadata');
		await expect(inspectGccWasm(echoFixture('env'), 'executable')).rejects.toThrow(
			'Unsupported GCC WASI import'
		);
		await expect(inspectGccWasm(echoFixture(undefined, true), 'executable')).rejects.toThrow(
			'shared memory'
		);
		await expect(runGccWasiArtifact({ ...artifact(), format: 'wasm-object' })).rejects.toThrow(
			'linked'
		);
	});

	it('enforces the output bound and input contract, then starts with fresh state', async () => {
		await expect(
			runGccWasiArtifact(artifact(), { stdin: '12345', maxOutputBytes: 4 })
		).rejects.toThrow('output limit');
		await expect(runGccWasiArtifact(artifact(), { args: ['bad\0arg'] })).rejects.toThrow(
			'argument text'
		);
		await expect(runGccWasiArtifact(artifact(), { env: { 'BAD=NAME': '1' } })).rejects.toThrow(
			'environment'
		);
		expect(await runGccWasiArtifact(artifact(), { stdin: 'ok' })).toMatchObject({
			exitCode: 7,
			stdout: 'ok'
		});
	});
});
