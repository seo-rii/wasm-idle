import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { validateWamrDebugModule } from '../src/wasm-module-preflight.js';

const wasmHeader = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

function u32(value: number) {
	const bytes: number[] = [];
	do {
		let byte = value & 0x7f;
		value >>>= 7;
		if (value !== 0) byte |= 0x80;
		bytes.push(byte);
	} while (value !== 0);
	return bytes;
}

function utf8(value: string) {
	const bytes = [...new TextEncoder().encode(value)];
	return [...u32(bytes.length), ...bytes];
}

function section(id: number, contents: number[]) {
	return [id, ...u32(contents.length), ...contents];
}

function moduleWith(...sections: number[][]) {
	return Uint8Array.from([...wasmHeader, ...sections.flat()]);
}

function customSection(name: string, contents: number[] = []) {
	return section(0, [...utf8(name), ...contents]);
}

function singleVoidFunction(bodyInstructions: number[], middleSections: number[][] = []) {
	const type = section(1, [1, 0x60, 0, 0]);
	const functions = section(3, [1, 0]);
	const body = [0, ...bodyInstructions, 0x0b];
	const code = section(10, [1, ...u32(body.length), ...body]);
	return moduleWith(type, functions, ...middleSections, code);
}

describe('validateWamrDebugModule', () => {
	it('accepts a valid core-v1 module with Preview 1 WASI imports', () => {
		const type = section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]);
		const imports = section(2, [
			1,
			...utf8('wasi_snapshot_preview1'),
			...utf8('fd_close'),
			0,
			0
		]);

		expect(() => validateWamrDebugModule(moduleWith(type, imports))).not.toThrow();
	});

	it('accepts Preview 1 imports with i64 parameters and void results', () => {
		const types = section(1, [2, 0x60, 3, 0x7f, 0x7e, 0x7f, 1, 0x7f, 0x60, 1, 0x7f, 0]);
		const imports = section(2, [
			2,
			...utf8('wasi_snapshot_preview1'),
			...utf8('clock_time_get'),
			0,
			0,
			...utf8('wasi_snapshot_preview1'),
			...utf8('proc_exit'),
			0,
			1
		]);

		expect(() => validateWamrDebugModule(moduleWith(types, imports))).not.toThrow();
	});

	it('accepts a linked wasm32 module with one table, memory, element, and data segment', () => {
		const type = section(1, [1, 0x60, 0, 0]);
		const functions = section(3, [1, 0]);
		const table = section(4, [1, 0x70, 0, 1]);
		const memory = section(5, [1, 1, 1, 2]);
		const global = section(6, [1, 0x7f, 0, 0x41, 0, 0x0b]);
		const exports = section(7, [2, ...utf8('memory'), 2, 0, ...utf8('_start'), 0, 0]);
		const start = section(8, [0]);
		const element = section(9, [1, 0, 0x41, 0, 0x0b, 1, 0]);
		const body = [0, 0x41, 0xfd, 0, 0x1a, 0x0b];
		const code = section(10, [1, ...u32(body.length), ...body]);
		const data = section(11, [1, 0, 0x41, 0, 0x0b, 2, 0x6f, 0x6b]);

		expect(() =>
			validateWamrDebugModule(
				moduleWith(
					type,
					functions,
					table,
					memory,
					global,
					exports,
					start,
					element,
					code,
					data
				)
			)
		).not.toThrow();
	});

	it('accepts Uint8Array module views created in another JavaScript realm', () => {
		const foreignModule = runInNewContext(
			'Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0])'
		) as Uint8Array;

		expect(() => validateWamrDebugModule(foreignModule)).not.toThrow();
	});

	it('validates the intrinsic bytes of Uint8Array views with an overridden buffer accessor', () => {
		const invalidModule = Uint8Array.from([
			...wasmHeader,
			...section(1, [0]),
			...section(1, [0])
		]);
		const sameLengthValidModule = moduleWith(customSection('', [0, 0, 0]));
		Object.defineProperty(invalidModule, 'buffer', {
			get: () => sameLengthValidModule.buffer
		});

		expect(WebAssembly.validate(invalidModule)).toBe(false);
		expect(() => validateWamrDebugModule(invalidModule)).toThrow(
			/core WebAssembly validation/u
		);
	});

	it('does not confuse immediate or custom-section payload bytes with proposal opcodes', () => {
		const module = singleVoidFunction([0x41, 0xfd, 0x00, 0x1a, 0x41, 0xfe, 0x00, 0x1a]);
		const withCustomPayload = Uint8Array.from([
			...wasmHeader,
			...customSection('opaque', [...new TextEncoder().encode('dylink.0'), 0xfd, 0xfe]),
			...module.slice(wasmHeader.length)
		]);

		expect(() => validateWamrDebugModule(withCustomPayload)).not.toThrow();
	});

	it('bounds declared vectors before iterating attacker-controlled counts', () => {
		const oversizedTypeVector = moduleWith(section(1, [...u32(1_000_001)]));

		expect(() => validateWamrDebugModule(oversizedTypeVector)).toThrow(
			/type count 1000001 exceeds 1000000/u
		);
	});

	it('bounds nested instruction control depth', () => {
		const nestedBlocks = new Array(4_097).fill([0x02, 0x40]).flat();

		expect(() => validateWamrDebugModule(singleVoidFunction(nestedBlocks))).toThrow(
			/control depth exceeds 4096/u
		);
	});

	it('allows disabled unsupported features and supported enabled target features', () => {
		const features = customSection('target_features', [
			2,
			0x2d,
			...utf8('simd128'),
			0x2b,
			...utf8('bulk-memory')
		]);

		expect(() => validateWamrDebugModule(moduleWith(features))).not.toThrow();
	});

	it.each([
		{
			name: 'truncated header',
			module: Uint8Array.of(0, 97, 115, 109),
			error: /core WebAssembly v1/u
		},
		{
			name: 'component-model version',
			module: Uint8Array.from([0, 97, 115, 109, 0x0d, 0x00, 0x01, 0x00]),
			error: /core WebAssembly v1/u
		},
		{
			name: 'truncated section',
			module: moduleWith([1, 2, 1]),
			error: /Malformed/u
		},
		{
			name: 'v128 type',
			module: moduleWith(section(1, [1, 0x60, 1, 0x7b, 0])),
			error: /SIMD.*v128/u
		},
		{
			name: 'SIMD instruction',
			module: singleVoidFunction([0xfd, 0x0c, ...new Array(16).fill(0), 0x1a]),
			error: /SIMD instructions/u
		},
		{
			name: 'atomic instruction',
			module: singleVoidFunction([0xfe, 0x03]),
			error: /atomic instructions/u
		},
		{
			name: 'GC heap type',
			module: singleVoidFunction([0xd0, 0x6e, 0x1a]),
			error: /GC or typed references/u
		},
		{
			name: 'typed function reference heap type',
			module: singleVoidFunction([0xd0, 0x00, 0x1a]),
			error: /GC or typed references/u
		},
		{
			name: 'GC typed block result',
			module: singleVoidFunction([0x02, 0x63, 0x6e, 0x00, 0x0b, 0x1a]),
			error: /GC or typed block types/u
		},
		{
			name: 'compact GC block result',
			module: singleVoidFunction([0x02, 0x6e, 0x00, 0x0b, 0x1a]),
			error: /GC or typed block types/u
		},
		{
			name: 'multi-memory load memarg',
			module: singleVoidFunction([0x41, 0, 0x28, 0x40, 0, 0, 0x1a], [section(5, [1, 0, 1])]),
			error: /multi-memory instruction encoding/u
		},
		{
			name: 'extended global constant expression',
			module: moduleWith(section(6, [1, 0x7f, 0, 0x41, 1, 0x41, 2, 0x6a, 0x0b])),
			error: /extended constant expressions/u
		},
		{
			name: 'extended element offset constant expression',
			module: singleVoidFunction(
				[],
				[
					section(4, [1, 0x70, 0, 1]),
					section(9, [1, 0, 0x41, 0, 0x41, 1, 0x6a, 0x0b, 1, 0])
				]
			),
			error: /extended constant expressions/u
		},
		{
			name: 'extended data offset constant expression',
			module: moduleWith(
				section(5, [1, 0, 1]),
				section(11, [1, 0, 0x41, 0, 0x41, 1, 0x6a, 0x0b, 0])
			),
			error: /extended constant expressions/u
		},
		{
			name: 'shared memory',
			module: moduleWith(section(5, [1, 3, 1, 1])),
			error: /shared memory/u
		},
		{
			name: 'memory64',
			module: moduleWith(section(5, [1, 4, 1])),
			error: /memory64/u
		},
		{
			name: 'table64',
			module: moduleWith(section(4, [1, 0x70, 4, 1])),
			error: /table64/u
		},
		{
			name: 'multiple memories',
			module: moduleWith(section(5, [2, 0, 1, 0, 1])),
			error: /multiple memories/u
		},
		{
			name: 'multiple tables',
			module: moduleWith(section(4, [2, 0x70, 0, 1, 0x70, 0, 1])),
			error: /multiple tables/u
		},
		{
			name: 'non-WASI import module',
			module: moduleWith(
				section(1, [1, 0x60, 0, 0]),
				section(2, [1, ...utf8('env'), ...utf8('host_callback'), 0, 0])
			),
			error: /unsupported import module.*env/u
		},
		{
			name: 'unknown Preview 1 function import',
			module: moduleWith(
				section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
				section(2, [1, ...utf8('wasi_snapshot_preview1'), ...utf8('not_a_wasi_call'), 0, 0])
			),
			error: /unsupported Preview 1 import.*not_a_wasi_call/u
		},
		{
			name: 'wrong Preview 1 function signature',
			module: moduleWith(
				section(1, [1, 0x60, 0, 1, 0x7f]),
				section(2, [1, ...utf8('wasi_snapshot_preview1'), ...utf8('fd_close'), 0, 0])
			),
			error: /Preview 1 import.*fd_close.*signature/u
		},
		{
			name: 'non-function Preview 1 import',
			module: moduleWith(
				section(2, [1, ...utf8('wasi_snapshot_preview1'), ...utf8('memory'), 2, 0, 1])
			),
			error: /Preview 1 imports must be functions/u
		},
		{
			name: 'legacy WASI unstable import module',
			module: moduleWith(
				section(1, [1, 0x60, 0, 0]),
				section(2, [1, ...utf8('wasi_unstable'), ...utf8('fd_close'), 0, 0])
			),
			error: /unsupported import module.*wasi_unstable/u
		},
		{
			name: 'dynamic linking metadata',
			module: moduleWith(customSection('dylink.0', [0])),
			error: /dynamic linking/u
		},
		{
			name: 'relocatable linking metadata',
			module: moduleWith(customSection('linking', [2])),
			error: /multi-module or relocatable/u
		},
		{
			name: 'enabled SIMD target feature',
			module: moduleWith(customSection('target_features', [1, 0x2b, ...utf8('simd128')])),
			error: /SIMD target feature/u
		},
		{
			name: 'enabled atomics target feature',
			module: moduleWith(customSection('target_features', [1, 0x2b, ...utf8('atomics')])),
			error: /atomics target feature/u
		}
	])('rejects $name', ({ module, error }) => {
		expect(() => validateWamrDebugModule(module)).toThrow(error);
	});
});
