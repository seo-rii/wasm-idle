import { createRequire } from 'node:module';
import { beforeAll, expect, it } from 'vitest';
import { runKotlinWasiProgram } from '../src/program.js';

// These are host-policy probes, not Kotlin program fixtures or a Kotlin emitter.
const requireWat = createRequire(new URL('../../wasm-wat/package.json', import.meta.url));
let wabt: ReturnType<typeof requireWat>;
beforeAll(async () => {
	wabt = await requireWat('wabt')();
});

function probe(wat: string): Uint8Array {
	const module = wabt.parseWat('program-host-policy.wat', wat);
	try {
		return new Uint8Array(module.toBinary({}).buffer);
	} finally {
		module.destroy();
	}
}

const run = (bytes: Uint8Array) =>
	runKotlinWasiProgram({
		bytes,
		stdin: new Uint8Array(),
		maxProgramBytes: 1024,
		maxStdinBytes: 32,
		maxOutputBytes: 64
	});

it('rejects a host escape import before a module start function can execute', async () => {
	const result = await run(
		probe(`(module
		(import "host" "escape" (func $escape))
		(memory (export "memory") 1)
		(func $initialize call $escape) (start $initialize)
		(func (export "_start")))`)
	);
	expect(result.status).toBe('runtime-error');
	expect(result.error).toContain('Unsupported program import: host.escape');
	expect(result.exitCode).toBeNull();
	expect(result.stdout).toBe('');
});

it('requires the explicit command entry rather than guessing an exported function', async () => {
	const result = await run(probe('(module (memory (export "memory") 1) (func (export "main")))'));
	expect(result.error).toContain('must export _start');
});

it('rejects a parameterized command entry before invoking it', async () => {
	const result = await run(
		probe(`(module (memory (export "memory") 1)
		(func (export "_start") (param i32) unreachable))`)
	);
	expect(result.status).toBe('runtime-error');
	expect(result.error).toContain('must have no parameters');
});

it('rejects a command entry returning a value', async () => {
	const result = await run(
		probe(`(module (memory (export "memory") 1)
		(func (export "_start") (result i32) i32.const 7))`)
	);
	expect(result.status).toBe('runtime-error');
	expect(result.error).toContain('must not return a value');
});

it('provides real WASI random bytes across the Web Crypto per-call limit', async () => {
	const result = await run(
		probe(`(module
		(import "wasi_snapshot_preview1" "random_get" (func $random (param i32 i32) (result i32)))
		(memory (export "memory") 2)
		(func (export "_start")
			i32.const 32 i32.const 65540 call $random
			if unreachable end))`)
	);
	expect(result.status).toBe('completed');
});

it('rejects an out-of-range random buffer without modifying its prefix', async () => {
	const result = await run(
		probe(`(module
		(import "wasi_snapshot_preview1" "random_get" (func $random (param i32 i32) (result i32)))
		(memory (export "memory") 1)
		(func (export "_start")
			i32.const 65535 i32.const 165 i32.store8
			i32.const 65535 i32.const 2 call $random i32.const 21 i32.ne
			if unreachable end
			i32.const 65535 i32.load8_u i32.const 165 i32.ne
			if unreachable end))`)
	);
	expect(result.status).toBe('completed');
});

it('refuses I/O during module initialization before exported memory is available', async () => {
	const result = await run(
		probe(`(module
		(import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
		(memory (export "memory") 1)
		(func $initialize i32.const 1 i32.const 0 i32.const 0 i32.const 0 call $write drop)
		(start $initialize) (func (export "_start")))`)
	);
	expect(result.status).toBe('runtime-error');
	expect(result.error).toContain('before exported memory is available');
});

it('preserves a guest trap and starts the following request with a fresh instance', async () => {
	const bytes = probe(`(module
		(memory (export "memory") 1)
		(global $once (mut i32) (i32.const 0))
		(func (export "_start")
			global.get $once if unreachable end
			i32.const 1 global.set $once))`);
	expect((await run(bytes)).status).toBe('completed');
	expect((await run(bytes)).status).toBe('completed');
	const trapped = await run(
		probe('(module (memory (export "memory") 1) (func (export "_start") unreachable))')
	);
	expect(trapped.status).toBe('runtime-error');
	expect(trapped.exitCode).toBeNull();
	expect((await run(bytes)).status).toBe('completed');
});
