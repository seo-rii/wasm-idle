import { describe, expect, it, vi } from 'vitest';
import { parseWasiGccManifest, gccAssetPaths } from '../src/manifest.js';
import { wasiGccCompilePlan } from '../src/wasi-plan.js';
import * as output from '../src/wasm-output.js';
import type { WasiGccCompileRequest } from '../src/types.js';
import { runGccWasiArtifact } from '../src/wasi-run.js';
import { runGccSharedArtifact } from '../src/shared-run.js';
import type { WasiGccArtifact } from '../src/types.js';

import { exceptionProgram as program, modernExceptionBody as modernBody } from './eh-fixtures.js';

function manifest(exceptions = true) {
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
		runtimeLibraries: ['/sysroot/lib/wasm32-wasi/libclang_rt.builtins-wasm32.a'],
		capabilities: {
			c: true,
			cpp: true,
			libc: true,
			libm: true,
			libstdcxx: true,
			staticInitialization: true,
			exceptions,
			rtti: true,
			threads: false,
			dynamicLinking: false,
			simd: false
		},
		assets: Object.fromEntries(
			Object.entries(gccAssetPaths)
				.filter(([key]) => key !== 'ldJs')
				.map(([key, path]) => [key, { path, bytes: 8, sha256: 'a'.repeat(64) }])
		),
		qualification: { status: 'verified' }
	};
}

describe('explicit modern Wasm exception boundary', () => {
	it('accepts actual modern catch_ref/throw_ref with the explicit profile', async () => {
		const bytes = program();
		expect(WebAssembly.validate(bytes)).toBe(true);
		const compiled = await output.compileGccWasm(bytes, 'executable', { exceptions: true });
		expect(compiled.inspection.features.exceptions).toBe(true);
		const instance = await WebAssembly.instantiate(compiled.module);
		expect(() => (instance.exports._start as () => void)()).not.toThrow();
	});

	it('requires opt-in for a tag even when no handler is present', async () => {
		await expect(
			output.inspectGccWasm(program([0, 0x0b], 0, false), 'executable')
		).rejects.toThrow(/exception.*opt-in/i);
	});

	it.each([
		[0x69],
		[0xe9, 0x7f],
		[0xe9, 0xff, 0x7f],
		[0xe9, 0xff, 0xff, 0x7f],
		[0xe9, 0xff, 0xff, 0xff, 0x7f]
	])('detects the decoded exception heap type in ref.null: %j', async (...heapType) => {
		// Valid s33 padding must not bypass opt-in; no tag or other EH opcode exists.
		const bytes = program([0, 0xd0, ...heapType, 0x1a, 0x0b], null, false);
		expect(WebAssembly.validate(bytes)).toBe(true);
		await expect(output.inspectGccWasm(bytes, 'executable')).rejects.toThrow(
			/exceptions.*opt-in/
		);
		await expect(
			output.inspectGccWasm(bytes, 'executable', { exceptions: true })
		).resolves.toMatchObject({ features: { exceptions: true } });
	});

	it('preserves padded ordinary ref.null heap types without enabling exceptions', async () => {
		const bytes = program([0, 0xd0, 0xf0, 0x7f, 0x1a, 0x0b], null, false);
		expect(WebAssembly.validate(bytes)).toBe(true);
		expect((await output.inspectGccWasm(bytes, 'executable')).features).not.toHaveProperty(
			'exceptions'
		);
	});

	it.each([
		[0xe9, 0x7f],
		[0xe9, 0xff, 0xff, 0xff, 0x7f]
	])('rejects padded negative block types that the engine forbids: %j', async (...blockType) => {
		const bytes = program([0, 0x02, ...blockType, 0x00, 0x0b, 0x1a, 0x0b], null, false);
		expect(WebAssembly.validate(bytes)).toBe(false);
		await expect(
			output.inspectGccWasm(bytes, 'executable', { exceptions: true })
		).rejects.toThrow();
	});

	it.each([
		['legacy', [0, 0x06, 0x40, 0x0b, 0x0b]],
		['mixed', [0, 0x06, 0x40, 0x0b, ...modernBody.slice(1)]]
	])('rejects %s instructions even on a permissive engine', async (_label, body) => {
		await expect(
			output.inspectGccWasm(program(body as number[]), 'executable', { exceptions: true })
		).rejects.toThrow(/legacy.*exception/i);
	});

	it('requires the GNU exception tag payload to be one i32 with no result', async () => {
		const bytes = program([0, 0x0b], 1, false);
		expect(WebAssembly.validate(bytes)).toBe(true);
		await expect(
			output.inspectGccWasm(bytes, 'executable', { exceptions: true })
		).rejects.toThrow(/exception tag.*i32/i);
	});

	it('checks actual modern engine support rather than WebAssembly.Tag existence', async () => {
		const validate = vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
		try {
			await expect(
				output.inspectGccWasm(program(), 'executable', { exceptions: true })
			).rejects.toThrow(/engine.*modern.*exception/i);
			expect(validate).toHaveBeenCalled();
		} finally {
			validate.mockRestore();
		}
	});

	it.each([
		[0, 0x1f, 0x40, 1, 4, 0, 0x0b, 0x0b], // Unknown catch clause.
		[0, 0x1f, 0x40, 0x7f, 0x0b], // Vector exceeds remaining payload.
		[0, 0x41, 1, 0x08, 1, 0x0b], // Undeclared tag.
		[0, 0x1f, 0x40, 1, 0, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]
	])('rejects malformed modern catch/tag encodings: %j', async (...body) => {
		await expect(
			output.inspectGccWasm(program(body as number[], 0, false), 'executable', {
				exceptions: true
			})
		).rejects.toThrow();
	});

	it('does not mistake data/custom bytes for EH or add false fields to legacy inspection', async () => {
		const data = [0x1f, 0x69, 0x08, 0x0a, 0x06];
		const bytes = program([0, 0x0b], null, false, [
			11,
			11,
			1,
			0,
			0x41,
			0,
			0x0b,
			data.length,
			...data,
			0,
			7,
			1,
			120,
			...data
		]);
		expect(WebAssembly.validate(bytes)).toBe(true);
		const inspection = await output.inspectGccWasm(bytes, 'executable');
		expect(inspection.features).toEqual({
			simd128: false,
			relaxedSimd: false,
			atomics: false,
			bulkMemory: false
		});
	});

	it.each([
		['table', [4, 4, 1, 0x69, 0, 1]],
		['passive element', [9, 4, 1, 5, 0x69, 0]]
	])('detects exception reference types in %s metadata', async (_label, section) => {
		const bytes = Uint8Array.from([
			0,
			97,
			115,
			109,
			1,
			0,
			0,
			0,
			...(section as number[]),
			0,
			9,
			7,
			...new TextEncoder().encode('linking'),
			2
		]);
		expect(WebAssembly.validate(bytes)).toBe(true);
		await expect(output.inspectGccWasm(bytes, 'object')).rejects.toThrow(/exceptions.*opt-in/);
		await expect(
			output.inspectGccWasm(bytes, 'object', { exceptions: true })
		).resolves.toMatchObject({ features: { exceptions: true } });
	});

	it('requires actual capable provenance and re-inspects private bytes on standalone execution', async () => {
		const artifact: WasiGccArtifact = {
			compiler: 'gcc',
			compilerHost: 'wasm32-emscripten',
			target: 'wasm32-wasi',
			format: 'wasm-executable',
			cpu: 'wasm32',
			fileName: 'program.wasm',
			bytes: program(),
			exceptions: true
		};
		const capable = parseWasiGccManifest(manifest());
		await expect(runGccWasiArtifact(artifact)).rejects.toThrow(/exception.*qualified/);
		await expect(
			runGccWasiArtifact(artifact, {}, parseWasiGccManifest(manifest(false)))
		).rejects.toThrow(/exception.*qualified/);
		await expect(runGccWasiArtifact(artifact, {}, capable)).resolves.toMatchObject({
			exitCode: 0
		});
		const running = runGccWasiArtifact(artifact, {}, capable);
		artifact.bytes.fill(0);
		await expect(running).resolves.toMatchObject({ exitCode: 0 });
		await expect(runGccWasiArtifact(artifact, {}, capable)).rejects.toThrow(/WebAssembly 1/);
	});

	it('rejects shared EH before consulting Worker or isolation state', async () => {
		const Worker = vi.fn();
		vi.stubGlobal('Worker', Worker);
		try {
			await expect(
				runGccSharedArtifact(
					{ exceptions: true } as WasiGccArtifact,
					{ workerArguments: [[], []], stackBytes: 4096 },
					parseWasiGccManifest(manifest())
				)
			).rejects.toThrow(/shared.*exceptions/);
			expect(Worker).not.toHaveBeenCalled();
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('preserves the complete omitted/false/default C++ command plan', () => {
		const old = parseWasiGccManifest(manifest(false));
		const enabled = parseWasiGccManifest(manifest());
		const request = { language: 'cpp' as const, code: 'int main() { return 0; }' };
		expect(wasiGccCompilePlan(request, enabled)).toEqual(wasiGccCompilePlan(request, old));
		expect(wasiGccCompilePlan({ ...request, exceptions: false }, enabled)).toEqual(
			wasiGccCompilePlan(request, old)
		);
	});

	it('enables backend and assembler EH only for an explicit qualified request', () => {
		const plan = wasiGccCompilePlan(
			{
				language: 'cpp',
				code: 'int main() {}',
				exceptions: true,
				files: [{ path: 'helper.cpp', contents: 'void helper() {}' }],
				sources: ['helper.cpp']
			},
			parseWasiGccManifest(manifest())
		);
		expect(plan.stages[0].argv).toContain('-mexception-handling');
		expect(plan.stages[0].argv).toContain('-fexceptions');
		expect(plan.stages[0].argv).not.toContain('-fno-exceptions');
		expect(plan.stages[1].argv).toContain('--enable-exceptions');
		for (const stage of plan.stages.filter((stage) => stage.tool === 'cc1plus')) {
			expect(stage.argv).toContain('-mexception-handling');
			expect(stage.argv).toContain('-fexceptions');
			expect(stage.argv).not.toContain('-mtls');
		}
		const link = plan.stages.at(-1)!.argv;
		for (const name of ['__main_void', '__wasm_call_ctors', '__wasm_call_dtors', 'exit'])
			expect(link).toContain('--wrap=' + name);
		expect(link).not.toContain('-lstdc++');
		const runtime = link.filter((arg) => arg.startsWith('/sysroot/lib/wasm32-wasi-eh/'));
		expect(runtime).toEqual(
			['libstdc++.a', 'libsupc++.a', 'libunwind.a'].map(
				(file) => '/sysroot/lib/wasm32-wasi-eh/' + file
			)
		);
		expect(link.indexOf(runtime[0])).toBeGreaterThan(link.indexOf('/workspace/program.1.o'));
		expect(link.indexOf(runtime[2])).toBeLessThan(link.indexOf('-lc'));
	});

	it('rejects unverified opt-in and prevents global exception provider selection', () => {
		const raw = manifest();
		expect(() =>
			wasiGccCompilePlan(
				{ code: '', language: 'cpp', exceptions: true },
				parseWasiGccManifest({ ...raw, qualification: { status: 'unverified' } })
			)
		).toThrow(/exceptions.*qualified/);
		for (const value of [null, 0, 'true']) {
			expect(() =>
				parseWasiGccManifest({
					...raw,
					capabilities: { ...raw.capabilities, exceptions: value }
				})
			).toThrow(/capability.*exceptions/);
			expect(() =>
				wasiGccCompilePlan(
					{ code: '', language: 'cpp', exceptions: value } as never,
					parseWasiGccManifest(raw)
				)
			).toThrow(/exception option/);
		}
		expect(() =>
			parseWasiGccManifest({
				...raw,
				runtimeLibraries: [
					...raw.runtimeLibraries,
					'/sysroot/lib/wasm32-wasi-eh/libunwind.a'
				]
			})
		).toThrow(/separate.*runtimeLibraries/);
	});

	it('rejects an incapable engine before any asset fetch while leaving default plans usable', () => {
		const capable = parseWasiGccManifest(manifest());
		const validate = vi.spyOn(WebAssembly, 'validate').mockReturnValue(false);
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		try {
			expect(() => wasiGccCompilePlan({ code: '', language: 'cpp' }, capable)).not.toThrow();
			expect(validate).not.toHaveBeenCalled();
			expect(() =>
				wasiGccCompilePlan({ code: '', language: 'cpp', exceptions: true }, capable)
			).toThrow(/engine.*modern.*exception/);
			expect(fetch).not.toHaveBeenCalled();
		} finally {
			validate.mockRestore();
			vi.unstubAllGlobals();
		}
	});

	it.each([
		{ language: 'c' },
		{ sharedMemory: { entry: 'run', initialPages: 4, maximumPages: 4 } },
		{ tls: true },
		{ debug: true },
		{ coverage: true },
		{ simd: true },
		{ atomics: true }
	])('rejects an unqualified exception combination before staging: %j', (change) => {
		const request = { language: 'cpp', code: 'int main() {}', exceptions: true, ...change };
		expect(() =>
			wasiGccCompilePlan(request as WasiGccCompileRequest, parseWasiGccManifest(manifest()))
		).toThrow(/exception.*(ordinary C\+\+|combination|qualified)/i);
	});
});
