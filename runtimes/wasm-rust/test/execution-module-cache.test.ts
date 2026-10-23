import wabt from 'wabt';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	clearBrowserRustExecutionCache,
	executeBrowserRustArtifact
} from '../src/browser-execution.js';

async function program(initial = 48) {
	const toolkit = await wabt();
	const module = toolkit.parseWat(
		'test.wat',
		`(module
		(import "wasi_snapshot_preview1" "fd_read" (func $read (param i32 i32 i32 i32) (result i32)))
		(import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
		(memory (export "memory") 1)
		(global $count (mut i32) (i32.const ${initial}))
		(func (export "_start")
			(global.set $count (i32.add (global.get $count) (i32.const 1)))
			(i32.store8 (i32.const 32) (global.get $count))
			(i32.store (i32.const 0) (i32.const 33))
			(i32.store (i32.const 4) (i32.const 1))
			(drop (call $read (i32.const 0) (i32.const 0) (i32.const 1) (i32.const 8)))
			(i32.store (i32.const 0) (i32.const 32))
			(i32.store (i32.const 4) (i32.const 2))
			(drop (call $write (i32.const 1) (i32.const 0) (i32.const 1) (i32.const 8)))))`
	);
	try {
		return new Uint8Array(module.toBinary({}).buffer);
	} finally {
		module.destroy();
	}
}

const artifact = (wasm: Uint8Array) => ({
	wasm,
	targetTriple: 'wasm32-wasip1' as const,
	format: 'core-wasm' as const
});
const input = (text: string) => {
	let value: string | null = text;
	return () => {
		const next = value;
		value = null;
		return next;
	};
};

afterEach(() => {
	clearBrowserRustExecutionCache();
	vi.restoreAllMocks();
});

describe('Rust execution Module cache with real Wasm', () => {
	it('reuses compiled code but starts with fresh globals, memory, input and output', async () => {
		const bytes = await program();
		const compile = vi.spyOn(WebAssembly, 'compile');
		expect(
			(await executeBrowserRustArtifact(artifact(bytes), { stdin: input('A') })).stdout
		).toBe('1A');
		expect(
			(await executeBrowserRustArtifact(artifact(bytes.slice()), { stdin: input('B') }))
				.stdout
		).toBe('1B');
		expect(compile).toHaveBeenCalledOnce();
	});

	it('does not reuse code after a caller mutates the artifact bytes', async () => {
		const bytes = await program(48);
		const replacement = await program(49);
		const compile = vi.spyOn(WebAssembly, 'compile');
		expect(
			(await executeBrowserRustArtifact(artifact(bytes), { stdin: input('A') })).stdout
		).toBe('1A');
		expect(replacement.byteLength).toBe(bytes.byteLength);
		bytes.set(replacement);
		expect(
			(await executeBrowserRustArtifact(artifact(bytes), { stdin: input('B') })).stdout
		).toBe('2B');
		expect(compile).toHaveBeenCalledTimes(2);
	});

	it('evicts failed engine compilations and bounds the retained Module count', async () => {
		const bytes = await program();
		const compile = vi.spyOn(WebAssembly, 'compile');
		compile.mockRejectedValueOnce(new WebAssembly.CompileError('test engine rejection'));
		await expect(executeBrowserRustArtifact(artifact(bytes))).rejects.toThrow(
			'test engine rejection'
		);
		await executeBrowserRustArtifact(artifact(bytes));
		for (let offset = 1; offset <= 4; offset++)
			await executeBrowserRustArtifact(artifact(await program(48 + offset)));
		await executeBrowserRustArtifact(artifact(bytes));
		expect(compile).toHaveBeenCalledTimes(7);
	});

	it('does not repopulate a cache cleared while its digest was pending', async () => {
		const bytes = await program();
		const digest = crypto.subtle.digest.bind(crypto.subtle);
		let finish!: (value: ArrayBuffer) => void;
		vi.spyOn(crypto.subtle, 'digest').mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const compile = vi.spyOn(WebAssembly, 'compile');
		const running = executeBrowserRustArtifact(artifact(bytes));
		clearBrowserRustExecutionCache();
		finish(await digest('SHA-256', bytes));
		await running;
		await executeBrowserRustArtifact(artifact(bytes));
		expect(compile).toHaveBeenCalledTimes(2);
	});
});
