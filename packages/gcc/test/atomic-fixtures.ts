import { gccAssetPaths, parseWasiGccManifest } from '../src/manifest.js';
import type { WasiGccArtifact } from '../src/types.js';

export const atomicLibrary = '/sysroot/lib/wasm32-wasi/libatomic.a';
export function atomicManifest() {
	const revision = (family: string) => ({
		family,
		repository: `https://example.test/${family}`,
		version: family === 'gcc' ? '17.0.0' : '1.0.0',
		commit: 'a'.repeat(40)
	});
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
		runtimeLibraries: ['/sysroot/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a', atomicLibrary],
		assets: Object.fromEntries(
			Object.entries(gccAssetPaths)
				.filter(([key]) => key !== 'ldJs')
				.map(([key, path]) => [key, { path, bytes: 8, sha256: 'a'.repeat(64) }])
		),
		capabilities: {
			c: true,
			cpp: true,
			libc: true,
			libm: true,
			libstdcxx: true,
			staticInitialization: true,
			exceptions: false,
			rtti: false,
			threads: false,
			dynamicLinking: false,
			simd: false,
			atomics: true,
			sharedMemory: true
		},
		qualification: { status: 'verified' }
	};
}
export const qualifiedAtomicManifest = () => parseWasiGccManifest(atomicManifest());

// Hand-encoded boundary fixtures exercise the engine/host, never qualify GCC lowering.
export function uleb(value: number): number[] {
	const bytes = [];
	do {
		const next = value & 127;
		value >>>= 7;
		bytes.push(next | (value ? 128 : 0));
	} while (value);
	return bytes;
}
export const name = (value: string) => {
	const bytes = [...new TextEncoder().encode(value)];
	return [...uleb(bytes.length), ...bytes];
};
export const section = (id: number, bytes: number[]) => [id, ...uleb(bytes.length), ...bytes];
const header = [0, 97, 115, 109, 1, 0, 0, 0];
export function atomicObject(instructions: number[], extra: number[] = []) {
	const body = [0, ...instructions, 0x0b];
	return Uint8Array.from([
		...header,
		...section(1, [1, 0x60, 0, 0]),
		...section(3, [1, 0]),
		...section(5, [1, 0, 1]),
		...section(10, [1, ...uleb(body.length), ...body]),
		...extra,
		...section(0, [...name('linking'), 2]),
		...section(0, [...name('target_features'), 1, 43, ...name('atomics')])
	]);
}
export function atomicOperation(opcode: number, alignment?: number) {
	if (opcode === 3) return [0xfe, 3, alignment ?? 0];
	const address = [0x41, 0];
	if (opcode < 3)
		return [
			...address,
			...(opcode === 2 ? [0x42, 0] : [0x41, 0]),
			...(opcode ? [0x42, 0] : []),
			0xfe,
			opcode,
			alignment ?? (opcode === 2 ? 3 : 2),
			0,
			0x1a
		];
	const index = (opcode - 0x10) % 7,
		value = [[1, 4, 5, 6].includes(index) ? 0x42 : 0x41, 0];
	const store = opcode >= 0x17 && opcode <= 0x1d;
	return [
		...address,
		...(opcode >= 0x17 ? value : []),
		...(opcode >= 0x48 ? value : []),
		0xfe,
		opcode,
		alignment ?? [2, 3, 0, 1, 0, 1, 2][index],
		0,
		...(store ? [] : [0x1a])
	];
}

export function sharedFixture(
	options: {
		parameters?: number;
		tls?: number;
		constructors?: boolean;
		activeData?: boolean;
		passiveData?: boolean;
		importModule?: string;
		extraImport?: boolean;
		memoryGrow?: boolean;
		result64?: boolean;
		initializer?: number[];
		data?: number[];
		dataEnd?: number;
		heapBase?: number;
	} = {}
) {
	const parameters = options.parameters ?? 1,
		imported = options.extraImport ? 1 : 0;
	const type = [
		0x60,
		parameters,
		...Array(parameters).fill(0x7f),
		1,
		options.result64 ? 0x7e : 0x7f
	];
	const global = (mutable: number, value: number) => [0x7f, mutable, 0x41, ...uleb(value), 0x0b];
	const exports = [
		['memory', 2, 0],
		['__wasm_call_ctors', 0, imported],
		['entry', 0, imported + 1],
		['__stack_pointer', 3, 0],
		['__data_end', 3, 1],
		['__heap_base', 3, 2],
		['__tls_size', 3, 3]
	] as const;
	const constructors = options.constructors ? [0, 0x01, 0x0b] : [0, 0x0b];
	const initializer = options.initializer ? [0, ...options.initializer, 0x0b] : undefined;
	const entry = options.memoryGrow
		? [0, 0x41, 0, 0x40, 0, 0x0b]
		: options.result64
			? [0, 0x42, 0, 0x0b]
			: parameters
				? [0, 0x20, 0, 0x0b]
				: [0, 0x41, 0, 0x0b];
	return Uint8Array.from([
		...header,
		...section(1, [2, ...type, 0x60, 0, 0]),
		...section(2, [
			1 + imported,
			...name(options.importModule ?? 'env'),
			...name('memory'),
			2,
			3,
			1,
			1,
			...(imported ? [...name('env'), ...name('extra'), 0, 1] : [])
		]),
		...section(3, [initializer ? 3 : 2, 1, 0, ...(initializer ? [1] : [])]),
		...section(6, [
			4,
			...global(1, options.heapBase ?? 1024),
			...global(0, options.dataEnd ?? 1024),
			...global(0, options.heapBase ?? 1024),
			...global(0, options.tls ?? 0)
		]),
		...section(7, [
			exports.length,
			...exports.flatMap(([text, kind, index]) => [...name(text), kind, index])
		]),
		...(initializer ? section(8, [imported + 2]) : []),
		...(options.data ? section(12, [1]) : []),
		...section(10, [
			initializer ? 3 : 2,
			...uleb(constructors.length),
			...constructors,
			...uleb(entry.length),
			...entry,
			...(initializer ? [...uleb(initializer.length), ...initializer] : [])
		]),
		...(options.data
			? section(11, [1, 1, ...uleb(options.data.length), ...options.data])
			: options.activeData
				? section(11, [1, 0, 0x41, 0, 0x0b, 1, 0])
				: options.passiveData
					? section(11, [1, 1, 1, 0])
					: [])
	]);
}

export function guardedInitializer(
	options: {
		guard?: number;
		destination?: number;
		length?: number;
		source?: number;
		fill?: boolean;
		publishGuard?: number;
		waitGuard?: number;
		desiredState?: number;
		publishedState?: number;
		waitState?: number;
		waitTimeout?: number;
		branchTable?: number[];
		drop?: boolean;
		extraOp?: boolean;
	} = {}
) {
	const guard = options.guard ?? 1028;
	const i32 = (value: number) => {
		const result = [0x41];
		value |= 0;
		for (;;) {
			const next = value & 127;
			value >>= 7;
			const done = (value === 0 && !(next & 64)) || (value === -1 && Boolean(next & 64));
			result.push(next | (done ? 0 : 128));
			if (done) return result;
		}
	};
	return [
		0x02,
		0x40,
		0x02,
		0x40,
		0x02,
		0x40,
		...i32(guard),
		...i32(0),
		...i32(options.desiredState ?? 1),
		0xfe,
		0x48,
		2,
		0,
		0x0e,
		2,
		...(options.branchTable ?? [0, 1, 2]),
		0x0b,
		...i32(options.destination ?? 1024),
		...i32(options.source ?? 0),
		...i32(options.length ?? 4),
		...(options.fill ? [0xfc, 0x0b, 0] : [0xfc, 8, 0, 0]),
		...i32(options.publishGuard ?? guard),
		...i32(options.publishedState ?? 2),
		0xfe,
		0x17,
		2,
		0,
		...i32(guard),
		...i32(-1),
		0xfe,
		0,
		2,
		0,
		0x1a,
		0x0c,
		1,
		0x0b,
		...i32(options.waitGuard ?? guard),
		...i32(options.waitState ?? 1),
		0x42,
		options.waitTimeout === 0 ? 0 : 0x7f,
		0xfe,
		1,
		2,
		0,
		0x1a,
		0x0b,
		...(!options.fill && options.drop !== false ? [0xfc, 9, 0] : []),
		...(options.extraOp ? [0x01] : [])
	];
}
export const sharedProfile = { entry: 'entry', initialPages: 1, maximumPages: 1 } as const;
export function sharedArtifact(options: Parameters<typeof sharedFixture>[0] = {}): WasiGccArtifact {
	return {
		compiler: 'gcc',
		compilerHost: 'wasm32-emscripten',
		target: 'wasm32-wasi',
		format: 'wasm-executable',
		fileName: 'program.wasm',
		bytes: sharedFixture(options),
		cpu: 'wasm32',
		atomics: true,
		sharedMemory: sharedProfile
	};
}
