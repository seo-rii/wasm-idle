import { describe, expect, it } from 'vitest';
import { OutputLimitError } from '@wasm-idle/core';
import Runtime from '../src/runtime.js';

function createRuntime(chunks: string[][], limit: number, rejectFirstHeader = false) {
	const output: string[] = [];
	const checked: number[] = [];
	const files = new Map<string, Uint8Array>();
	const encoder = new TextEncoder();
	let bytes = 0;
	let emitted = 0;
	let invocations = 0;
	let failure: OutputLimitError | undefined;
	const check = (additional: number) => {
		if (failure) throw failure;
		const actual = bytes + additional;
		if (actual > limit) {
			failure = new OutputLimitError('Compiler output exceeded its limit', {
				actual,
				limit,
				phase: 'compile'
			});
			throw failure;
		}
	};
	const stdout = (chunk: string) => {
		const length = encoder.encode(chunk).byteLength;
		check(length);
		bytes += length;
		output.push(chunk);
	};
	const memfs = {
		stdout,
		addFile(path: string, value: string | Uint8Array) {
			files.set(path, typeof value === 'string' ? encoder.encode(value) : value);
		},
		addDirectory() {},
		hasFile: (path: string) => files.has(path),
		getFileContents: (path: string) => files.get(path) || new Uint8Array()
	};
	const runtime = Object.assign(Object.create(Runtime.prototype), {
		ready: Promise.resolve(),
		log: false,
		debug: false,
		stdout,
		memfs,
		assetUrls: { clang: 'https://assets.example/clang.wasm.gz' },
		compilerConfig: { resourceDir: '/lib/clang/22' },
		getModule: async () => ({}),
		ensureCppSysroot: async () => {},
		getPrecompiledHeaderFingerprint: async () => ({
			compiler: 'a'.repeat(64),
			sysroot: ['b'.repeat(64)],
			runtimeHeaders: 'c'.repeat(64)
		}),
		debugVariableMetadata: {},
		debugGlobalMetadata: [],
		debugFunctionMetadata: {},
		run: async () => {
			const current = invocations++;
			for (const chunk of chunks[current] || []) {
				emitted++;
				memfs.stdout(chunk);
			}
			if (rejectFirstHeader && current === 0) throw new Error('Rejected cached header');
			return null;
		}
	}) as Runtime;
	const onBufferedOutput = (length: number) => {
		checked.push(length);
		check(length);
	};
	return {
		runtime,
		memfs,
		stdout,
		output,
		checked,
		onBufferedOutput,
		emitted: () => emitted,
		bytes: () => bytes,
		invocations: () => invocations
	};
}

const request = {
	input: 'main.cpp',
	obj: 'main.o',
	code: '#include <bits/stdc++.h>\nint main() {}',
	language: 'CPP' as const
};

async function compileWithHeader(harness: ReturnType<typeof createRuntime>) {
	await harness.runtime.compile({ ...request, planPrecompiledHeaderOnly: true });
	const key = harness.runtime.precompiledHeaderPlan!.key;
	return harness.runtime.compile({
		...request,
		precompiledHeader: { key, bytes: Uint8Array.of(1) },
		onBufferedOutput: harness.onBufferedOutput
	});
}

describe('real compiler PCH diagnostic capture budget', () => {
	it('checks the budget before retaining each chunk and stops the compiler immediately', async () => {
		const harness = createRuntime([Array(4).fill('12345678')], 16);
		await expect(compileWithHeader(harness)).rejects.toMatchObject({
			code: 'output-limit',
			limit: 16,
			actual: 24
		});
		expect(harness.emitted()).toBe(3);
		expect(harness.checked).toEqual([8, 16, 24]);
		expect(harness.output).toEqual([]);
		expect(harness.memfs.stdout).toBe(harness.stdout);
	});

	it('replays within-budget captured output once without counting it twice', async () => {
		const harness = createRuntime([Array(4).fill('12345678')], 32);
		await expect(compileWithHeader(harness)).resolves.toBeNull();
		expect(harness.checked).toEqual([8, 16, 24, 32]);
		expect(harness.bytes()).toBe(32);
		expect(harness.output.join('')).toBe('12345678'.repeat(4));
		expect(harness.runtime.usedPrecompiledHeader).toBe(true);
		expect(harness.memfs.stdout).toBe(harness.stdout);
	});

	it('continues to hide rejected-header diagnostics while bounding their temporary capture', async () => {
		const harness = createRuntime(
			[['precompiled header is invalid'], ['textual warning\n']],
			64,
			true
		);
		await expect(compileWithHeader(harness)).resolves.toBeNull();
		expect(harness.invocations()).toBe(2);
		expect(harness.checked).toEqual([29]);
		expect(harness.output).toEqual(['textual warning\n']);
		expect(harness.bytes()).toBe(16);
		expect(harness.runtime.usedPrecompiledHeader).not.toBe(true);
	});
});
