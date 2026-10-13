import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
	createLlvmToolHost, type LlvmToolBindingContext, type LlvmToolBindings,
	type LlvmToolInvocation
} from '../src/tool-host.js';

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
	it('refreshes guest views after memory.grow and bounds nested exec depth', async () => {
		const contexts: LlvmToolBindingContext[] = [];
		const host = await createLlvmToolHost({ tools: fixtures(moduleBytes({ packet: packet(), repeatAfterGrowth: true })), createBindings: bindings((context) => contexts.push(context)) });
		expect(host.run(invocation()).code).toBe(37); expect(contexts.length).toBe(3); host.dispose();
		const recursive = moduleBytes({ packet: packet() });
		const depths: number[] = [];
		const bounded = await createLlvmToolHost({ tools: fixtures(recursive, recursive), createBindings: (context) => ({ imports: {}, run(instance) { depths.push(context.depth); const code = (instance.exports._start as () => number)(); return { code: code === -1 ? 0 : code }; }, dispose() {} }) });
		expect(bounded.run(invocation()).code).toBe(0); expect(depths).toEqual([1, 2, 3, 4]); bounded.dispose();
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
