import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createLlvmToolHost, type LlvmToolBindingContext, type LlvmToolBindings,
	type LlvmToolInvocation, createLlvmToolHostFromServices, type LlvmToolModuleService
} from '../src/tool-host.js';
import { createPreparedRuntimeWasmModuleService, RuntimeAssetCache } from '@wasm-idle/core';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();
function u32(value: number): number[] {
	const result: number[] = [];
	do { const byte = value & 127; value >>>= 7; result.push(byte | (value ? 128 : 0)); } while (value);
	return result;
}
function i32(value: number): number[] {
	const result: number[] = [];
	for (;;) {
		const byte = value & 127; value >>= 7;
		const end = (value === 0 && !(byte & 64)) || (value === -1 && Boolean(byte & 64));
		result.push(byte | (end ? 0 : 128)); if (end) return result;
	}
}
const name = (value: string) => { const bytes = [...encoder.encode(value)]; return [...u32(bytes.length), ...bytes]; };
const section = (id: number, bytes: number[]) => [id, ...u32(bytes.length), ...bytes];
const constant = (value: number) => [0x41, ...i32(value)];

/** Real core Wasm fixtures: one exported memory and a synchronous _start returning i32. */
function moduleBytes(options: { exit?: number; packet?: ReturnType<typeof packet>; repeatAfterGrowth?: boolean; trap?: boolean } = {}): Uint8Array {
	const bridge = options.packet !== undefined;
	const types = bridge ? [2, 0x60, 7, ...Array(7).fill(0x7f), 1, 0x7f, 0x60, 0, 1, 0x7f] : [1, 0x60, 0, 1, 0x7f];
	const imports = bridge ? section(2, [1, ...name('wasm_idle_tool_host'), ...name('exec_v1'), 0, 0]) : [];
	const call = options.packet ? [...options.packet.args.flatMap(constant), 0x10, 0] : constant(options.exit ?? 0);
	const instructions = options.trap ? [0x00] : options.repeatAfterGrowth ? [...call, 0x1a, ...constant(1), 0x40, 0, 0x1a, ...call] : call;
	const body = [0, ...instructions, 0x0b];
	return Uint8Array.from([
		0, 97, 115, 109, 1, 0, 0, 0,
		...section(1, types), ...imports,
		...section(3, [1, bridge ? 1 : 0]), ...section(5, [1, 1, 1, 2]),
		...section(7, [2, ...name('memory'), 2, 0, ...name('_start'), 0, bridge ? 1 : 0]),
		...section(10, [1, ...u32(body.length), ...body]),
		...(options.packet ? section(11, [1, 0, ...constant(0), 0x0b, ...u32(options.packet.bytes.length), ...options.packet.bytes]) : [])
	]);
}

function packet(options: { program?: string; argv?: string[]; env?: string[]; flags?: number; mutate?: (value: { bytes: Uint8Array; args: number[] }) => void } = {}) {
	const bytes = new Uint8Array(4096); const view = new DataView(bytes.buffer); let offset = 256;
	const text = (value: string) => { const data = encoder.encode(value); const ptr = offset; bytes.set(data, ptr); offset += data.length; return [ptr, data.length]; };
	const program = text(options.program ?? 'wasm-ld');
	const argv = options.argv ?? ['wasm-ld', '', '한 글', 'a\\b'];
	const env = options.env ?? [];
	argv.forEach((value, index) => { const [ptr, len] = text(value); view.setUint32(index * 8, ptr!, true); view.setUint32(index * 8 + 4, len!, true); });
	env.forEach((value, index) => { const [ptr, len] = text(value); view.setUint32(128 + index * 8, ptr!, true); view.setUint32(128 + index * 8 + 4, len!, true); });
	const flags = options.flags ?? 1;
	const result = { bytes: bytes.slice(0, offset), args: [...program, 0, argv.length, flags === 1 ? 0 : 128, env.length, flags] };
	options.mutate?.(result); return result;
}

const invocation = (overrides: Partial<LlvmToolInvocation> = {}): LlvmToolInvocation => ({ executable: 'clang', argv: ['clang', 'main.c', '-o', 'a.wasm'], cwd: '/workspace/a b', env: { TEST: '한 글' }, ...overrides });
function fixtures(clang = moduleBytes(), lld = moduleBytes({ exit: 37 })) {
	return { clang: { bytes: clang, sha256: hash(clang) }, 'wasm-ld': { bytes: lld, sha256: hash(lld) } };
}
function bindings(onContext?: (context: LlvmToolBindingContext) => void, onDispose?: () => void) {
	return (context: LlvmToolBindingContext): LlvmToolBindings => {
		onContext?.(context);
		return { imports: {}, run: (instance) => ({ code: (instance.exports._start as () => number)() }), dispose: () => { onDispose?.(); } };
	};
}

describe('LLVM low-level tool host', () => {
	it('owner module endpoints preserve fresh instances and repeat profile admission on cache hits', async () => {
		const pins = fixtures(), cache = new RuntimeAssetCache();
		const endpoints: ReturnType<typeof createPreparedRuntimeWasmModuleService>[] = [];
		const source = () => Object.fromEntries(Object.entries(pins).map(([executable, pin]) => {
			const profile = { identity: `llvm-test:${executable}`, compileKey: 'native-default-v1', maxAssetBytes: 65536 };
			const endpoint = createPreparedRuntimeWasmModuleService({ ...profile, cache, bytes: pin.bytes, receipt: { bytes: pin.bytes.length, sha256: pin.sha256 } });
			endpoints.push(endpoint);
			return [executable, { ...profile, port: endpoint.port, bytes: pin.bytes.length, sha256: pin.sha256 }];
		})) as Record<'clang' | 'wasm-ld', LlvmToolModuleService>;
		let admitted = 0, runs = 0;
		try {
			for (let index = 0; index < 2; index++) {
				const host = await createLlvmToolHostFromServices({ services: source(), validateModule() { admitted++; }, createBindings: () => ({ imports: {}, run(instance) {
					const memory = new Uint8Array((instance.exports.memory as WebAssembly.Memory).buffer);
					expect(memory[0]).toBe(0); memory[0] = 99; runs++;
					return { code: (instance.exports._start as () => number)() };
				}, dispose() {} }) });
				host.run(invocation()); host.run(invocation()); host.dispose();
			}
			expect(runs).toBe(4); expect(admitted).toBe(4); expect(cache.stats()).toMatchObject({ entries: 2, hits: 2 });
			await expect(createLlvmToolHostFromServices({ services: source(), validateModule() { throw new Error('policy changed'); }, createBindings: bindings() })).rejects.toMatchObject({ code: 'COMPILE_FAILED' });
			await expect(createLlvmToolHostFromServices({ services: { clang: { module: new WebAssembly.Module(pins.clang.bytes), sha256: pins.clang.sha256 } } as never, createBindings: bindings() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
		} finally { for (const endpoint of endpoints) endpoint.close(); cache.dispose(); }
	});

	it('admits exact trusted package linker paths and rejects a failed host module profile', async () => {
		const pins = fixtures(moduleBytes({ packet: packet({ program: '/opt/toolchains/pinned/bin/wasm-ld' }) }));
		const validated: string[] = [];
		const host = await createLlvmToolHost({ tools: pins, createBindings: bindings(), linkerPaths: ['/opt/toolchains/pinned/bin/wasm-ld'], validateModule(executable) { validated.push(executable); } });
		expect(host.run(invocation()).code).toBe(37); expect(validated).toEqual(['clang', 'wasm-ld']); host.dispose();
		await expect(createLlvmToolHost({ tools: pins, createBindings: bindings(), validateModule() { throw new Error('unsupported module profile'); } })).rejects.toMatchObject({ code: 'COMPILE_FAILED' });
		await expect(createLlvmToolHost({ tools: pins, createBindings: bindings(), linkerPaths: ['/opt/../evil'] })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
	});
	it('verifies and snapshots both tools before async preparation, then executes pinned Wasm without URL loading', async () => {
		const tools = fixtures(); const pending = createLlvmToolHost({ tools, createBindings: bindings() });
		tools.clang.bytes.fill(255); tools['wasm-ld'].bytes.fill(255);
		const host = await pending;
		expect(host.run(invocation()).code).toBe(0);
		expect(host.run(invocation({ executable: 'wasm-ld', argv: ['wasm-ld', '--version'] })).code).toBe(37);
		host.dispose(); host.dispose(); expect(() => host.run(invocation())).toThrowError(expect.objectContaining({ code: 'DISPOSED' }));
	});
	it('rejects wrong digest and non-Wasm modules before creating any bindings', async () => {
		let calls = 0;
		const createBindings = bindings(() => { calls++; });
		const wrong = fixtures(); wrong.clang.sha256 = '0'.repeat(64);
		await expect(createLlvmToolHost({ tools: wrong, createBindings })).rejects.toMatchObject({ code: 'INTEGRITY' });
		await expect(createLlvmToolHost({ tools: fixtures(new Uint8Array([1])), createBindings })).rejects.toMatchObject({ code: 'COMPILE_FAILED' });
		expect(calls).toBe(0);
	});
	it('exec_v1 preserves argv/env/cwd and exact child status in real nested Wasm instances', async () => {
		const contexts: LlvmToolBindingContext[] = []; let closed = 0;
		const tools = fixtures(moduleBytes({ packet: packet({ program: '/usr/bin/ld.lld' }) }));
		const host = await createLlvmToolHost({ tools, createBindings: bindings((context) => contexts.push(context), () => { closed++; }) });
		const request = invocation();
		const result = host.run(request);
		expect(result.code).toBe(37); expect(closed).toBe(2);
		expect(contexts[1]).toMatchObject({ executable: 'wasm-ld', depth: 2, argv: ['wasm-ld', '', '한 글', 'a\\b'], cwd: '/workspace/a b', env: { TEST: '한 글' } });
		expect(Object.isFrozen(contexts[0]!.argv)).toBe(true); expect(Object.isFrozen(contexts[0]!.env)).toBe(true);
		expect(result.provenance.invocations.map((item) => item.identity.executable)).toEqual(['wasm-ld', 'clang']);
		expect(result.provenance.invocations[0]).toMatchObject({ code: 37, reason: 'exited', depth: 2 });
		expect(JSON.stringify(result.provenance)).not.toContain('한 글'); host.dispose();
	});
	it('flags0 provides explicit empty/replaced environments without inheriting caller entries', async () => {
		for (const env of [[], ['OTHER=x=y', 'EMPTY=']]) {
			const contexts: LlvmToolBindingContext[] = [];
			const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: packet({ env, flags: 0 }) })), createBindings: bindings((context) => contexts.push(context)) });
			host.run(invocation());
			expect(contexts[1]!.env).toEqual(env.length ? { OTHER: 'x=y', EMPTY: '' } : {}); host.dispose();
		}
	});
	it('flags1 ignores the pointer of a zero-length producer environment slice without reading memory', async () => {
		for (const pointer of [128, 0xffffffff]) {
			const contexts: LlvmToolBindingContext[] = [];
			const body = packet({ mutate: (value) => { value.args[4] = pointer; } });
			const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: body })), createBindings: bindings((context) => contexts.push(context)) });
			expect(host.run(invocation()).code).toBe(37);
			expect(contexts[1]!.env).toEqual({ TEST: '한 글' }); host.dispose();
		}
	});
	it('opted-in multicall cc1 children use the same pinned compiler and original argv without recursive execution', async () => {
		for (const mode of ['-cc1', '-cc1as']) {
			const contexts: LlvmToolBindingContext[] = []; let closed = 0;
			const argv = ['', 'clang', mode, '', '한 글', 'a\\b'];
			const host = await createLlvmToolHost({ allowClangCc1: true, tools: fixtures(moduleBytes({ packet: packet({ program: '', argv }) })), createBindings(context) {
				contexts.push(context);
				return { imports: {}, run(instance) { const code = (instance.exports._start as () => number)(); return { code: context.depth === 2 ? (code === -1 ? 37 : 99) : code }; }, dispose() { closed++; } };
			} });
			const result = host.run(invocation());
			expect(result.code).toBe(37); expect(closed).toBe(2);
			expect(contexts.map((context) => context.depth)).toEqual([1, 2]);
			expect(contexts[1]).toMatchObject({ executable: 'clang', argv, cwd: '/workspace/a b', env: { TEST: '한 글' } });
			expect(contexts[1]!.identity.sha256).toBe(contexts[0]!.identity.sha256);
			expect(result.provenance.invocations.map((entry) => entry.identity.executable)).toEqual(['clang', 'clang']); host.dispose();
		}
	});
	it('snapshots exact resolved compiler aliases and preserves cc1 argv and bounded recursion', async () => {
		for (const mode of ['-cc1', '-cc1as']) {
			const compilerPaths = ['/usr/local/bin/clang'];
			const argv = [compilerPaths[0]!, 'clang', mode, 'path with spaces.c'];
			const contexts: LlvmToolBindingContext[] = [];
			const pending = createLlvmToolHost({ allowClangCc1: true, compilerPaths, tools: fixtures(moduleBytes({ packet: packet({ program: compilerPaths[0], argv }) })), createBindings(context) {
				contexts.push(context);
				return { imports: {}, run(instance) { const code = (instance.exports._start as () => number)(); return { code: context.depth === 2 ? (code === -1 ? 23 : 99) : code }; }, dispose() {} };
			} });
			compilerPaths[0] = '/other/clang';
			const host = await pending;
			expect(host.run(invocation()).code).toBe(23);
			expect(contexts.map(context => context.depth)).toEqual([1, 2]);
			expect(contexts[1]).toMatchObject({ executable: 'clang', argv, cwd: '/workspace/a b', env: { TEST: '한 글' } });
			expect(contexts[1]!.identity).toBe(contexts[0]!.identity); host.dispose();
		}
	});
	it('requires valid explicit compiler aliases and matching native argv0', async () => {
		for (const compilerPaths of [['relative'], ['/tmp/../clang'], ['/tmp//clang'], ['/tmp/clang/'], ['/tmp/clang\0'], ['/tmp/\ud800'], ['/usr/bin/wasm-ld'], Array(17).fill('/bin/clang')]) {
			await expect(createLlvmToolHost({ allowClangCc1: true, compilerPaths, tools: fixtures(), createBindings: bindings() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
		}
		await expect(createLlvmToolHost({ compilerPaths: ['/bin/clang'], tools: fixtures(), createBindings: bindings() })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
		for (const [program, argv] of [
			['/other/clang', ['/other/clang', 'clang', '-cc1']],
			['/bin/clang', ['', 'clang', '-cc1']],
			['/bin/clang', ['/other/clang', 'clang', '-cc1']],
			['/bin/clang', ['/bin/clang', 'clang', 'main.c']],
			['/bin/clang', ['/bin/clang', 'clang', '@response']],
			['/bin/clang', ['/bin/clang', 'llvm', '-cc1']]
		] as [string, string[]][]) {
			let children = 0;
			const host = await createLlvmToolHost({ allowClangCc1: true, compilerPaths: ['/bin/clang'], tools: fixtures(moduleBytes({ packet: packet({ program, argv }) })), createBindings(context) {
				if (context.depth > 1) children++;
				return { imports: {}, run(instance) { return { code: (instance.exports._start as () => number)() === -1 ? 0 : 99 }; }, dispose() {} };
			} });
			expect(host.run(invocation()).code).toBe(0); expect(children).toBe(0); host.dispose();
		}
	});
	it('rejects unregistered or malformed compiler jobs and public empty argv0 before child bindings', async () => {
		const packets = [
			...[[''], ['', 'clang'], ['', 'clang', 'main.c'], ['', 'clang', '--version'], ['', 'clang', '-cc1gen-reproducer'], ['', 'clang', '-cc1evil'], ['', 'clang', '-CC1'], ['', 'llvm', 'clang', '-cc1'], ['clang', 'clang', '-cc1'], ['', '@response']].map((argv) => packet({ program: '', argv })),
			...['/tmp/clang', '../clang', 'https://bad.test/clang', 'clang'].map((program) => packet({ program, argv: ['', 'clang', '-cc1'] }))
		];
		for (const body of packets) {
			let children = 0;
			const host = await createLlvmToolHost({ allowClangCc1: true, tools: fixtures(moduleBytes({ packet: body })), createBindings(context) {
				if (context.depth > 1) children++;
				return { imports: {}, run(instance) { return { code: (instance.exports._start as () => number)() === -1 ? 0 : 99 }; }, dispose() {} };
			} });
			expect(host.run(invocation()).code).toBe(0); expect(children).toBe(0);
			expect(() => host.run(invocation({ argv: ['', 'clang', '-cc1'] }))).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' })); host.dispose();
		}
		let children = 0;
		const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: packet({ program: '', argv: ['', 'clang', '-cc1'] }) })), createBindings(context) {
			if (context.depth > 1) children++;
			return { imports: {}, run(instance) { return { code: (instance.exports._start as () => number)() === -1 ? 0 : 99 }; }, dispose() {} };
		} });
		expect(host.run(invocation()).code).toBe(0); expect(children).toBe(0); host.dispose();
	});
	it('rejects arbitrary linker paths, malformed packets, unknown flags and environment ambiguity before child bindings', async () => {
		const packets = [
			...['/tmp/wasm-ld', '../wasm-ld', 'https://bad.test/wasm-ld', 'clang', 'wasm-ld\0'].map((program) => packet({ program })),
			packet({ flags: 2 }), packet({ argv: [] }), packet({ env: ['BAD'], flags: 0 }),
			packet({ env: ['A=1', 'A=2'], flags: 0 }), packet({ env: ['=empty'], flags: 0 }),
			packet({ env: ['A=ignored'], flags: 1 }),
			packet({ mutate: (value) => { value.args[0] = -1; } }),
			packet({ mutate: (value) => { value.args[1] = 1024 * 1024 + 1; } }),
			packet({ mutate: (value) => { value.args[2] = 65532; } }),
			packet({ mutate: (value) => { value.args[3] = 4097; } }),
			packet({ mutate: (value) => { new DataView(value.bytes.buffer).setUint32(0, 65536, true); new DataView(value.bytes.buffer).setUint32(4, 1, true); } }),
			packet({ mutate: (value) => { value.bytes[value.args[0]!] = 0xff; } })
		];
		for (const body of packets) {
			let children = 0;
			const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: body })), createBindings: (context) => {
				if (context.depth > 1) children++;
				return { imports: {}, run: (instance) => { const result = (instance.exports._start as () => number)(); return { code: result === -1 ? 0 : 99 }; }, dispose() {} };
			} });
			expect(host.run(invocation()).code).toBe(0); expect(children).toBe(0); host.dispose();
		}
	});
	it('refreshes guest views after memory.grow and rejects child or directly invoked linker dispatch', async () => {
		const contexts: LlvmToolBindingContext[] = [];
		const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: packet(), repeatAfterGrowth: true })), createBindings: bindings((context) => contexts.push(context)) });
		expect(host.run(invocation()).code).toBe(37); expect(contexts.length).toBe(3); host.dispose();
		const recursive = moduleBytes({ packet: packet() });
		const depths: number[] = [];
		const bounded = await createLlvmToolHost({ tools: fixtures(recursive, recursive), createBindings: (context) => ({ imports: {}, run(instance) { depths.push(context.depth); const code = (instance.exports._start as () => number)(); return { code: code === -1 ? 0 : code }; }, dispose() {} }) });
		expect(bounded.run(invocation()).code).toBe(0); expect(depths).toEqual([1, 2]);
		depths.length = 0;
		expect(bounded.run(invocation({ executable: 'wasm-ld', argv: ['wasm-ld'] })).code).toBe(0);
		expect(depths).toEqual([1]); bounded.dispose();
	});
	it('distinguishes child startup rejection from runtime/cleanup failure and disposes every binding', async () => {
		for (const mode of ['startup', 'trap', 'dispose'] as const) {
			let closed = 0;
			const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: packet() }), moduleBytes({ trap: mode === 'trap' })), createBindings(context) {
				if (context.depth === 2 && mode === 'startup') throw new Error('cannot create child');
				return { imports: {}, run(instance) { const code = (instance.exports._start as () => number)(); return { code: context.depth === 1 ? (code === (mode === 'startup' ? -1 : -2) ? 0 : 99) : code }; }, dispose() { closed++; if (context.depth === 2 && mode === 'dispose') throw new Error('cleanup failed'); } };
			} });
			const result = host.run(invocation()); expect(result.code).toBe(0); expect(closed).toBe(mode === 'startup' ? 1 : 2);
			expect(result.provenance.invocations[0]!.reason).toBe(mode === 'startup' ? 'startup-failure' : 'runtime-error'); host.dispose();
		}
	});
	it('rejects malformed host argv/env and asynchronous bindings, and resets after a runtime failure', async () => {
		let closed = 0;
		const host = await createLlvmToolHost({ tools: fixtures(), createBindings: () => ({ imports: {}, run: (() => Promise.resolve({ code: 0 })) as unknown as LlvmToolBindings['run'], dispose() { closed++; } }) });
		for (const value of [invocation({ argv: [] }), invocation({ argv: ['x', '\ud800'] }), invocation({ env: { 'bad=name': 'x' } }), invocation({ cwd: 'relative' })]) {
			expect(() => host.run(value)).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
		}
		expect(() => host.run(invocation())).toThrowError(expect.objectContaining({ code: 'RUNTIME_ERROR' }));
		expect(() => host.run(invocation())).toThrowError(expect.objectContaining({ code: 'RUNTIME_ERROR' }));
		expect(closed).toBe(2); host.dispose();
	});
});
