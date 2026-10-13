// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { StaticStdinRingHost, type StaticStdinRingDescriptor } from './staticStdinRing';

const workers = fileURLToPath(new URL('../../../scripts/runtime-workers/', import.meta.url));
const readers = {
	awk: 'createStdinReader',
	'awk-v1': 'createStdinReader',
	bqn: 'createSharedInputReader',
	c3: 'c3Stdin',
	clojurescript: 'createSharedByteReader',
	commonlisp: 'createSharedStdinReader',
	forth: 'createSharedKeyReader',
	gleam: 'createSharedByteReader',
	grain: 'grainStdin',
	j: 'createSharedInputReader',
	janet: 'createSharedInputReader',
	julia: 'createStdinReader',
	lean4: 'createSharedStdinReader',
	lfortran: 'createSharedStdinReader',
	nim: 'createStdinReader',
	pascal: 'createSharedByteReader',
	perl: 'createSharedStdinReader',
	prolog: 'createSharedStdinReader',
	rescript: 'createSharedByteReader',
	tcl: 'createSharedStdinReader'
};

function workerFile(runtime: string) {
	return runtime === 'awk-v1'
		? 'wasm-awk-runner-worker.v1.js'
		: `wasm-${runtime}-runner-worker.js`;
}

// Execute the production function declarations, without loading a compiler or
// duplicating the ring arithmetic in the test. Atomics.wait must never block the test process.
function createReader(runtime: keyof typeof readers, channel: StaticStdinRingDescriptor) {
	const file = workerFile(runtime);
	const source = ts.createSourceFile(
		file,
		readFileSync(`${workers}/${file}`, 'utf8'),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.JS
	);
	const declarations = source.statements
		.filter(
			(statement) =>
				ts.isFunctionDeclaration(statement) &&
				[readers[runtime], 'withPartialReads'].includes(statement.name!.text)
		)
		.map((statement) => statement.getText(source))
		.join('\n');
	const construct = runInNewContext(`${declarations}\n${readers[runtime]}`, {
		SharedArrayBuffer,
		Int32Array,
		Uint8Array,
		TextEncoder,
		textEncoder: new TextEncoder(),
		self: { postMessage() {} },
		Atomics: {
			load: Atomics.load,
			store: Atomics.store,
			wait() {
				throw new Error('Unexpected blocking stdin read');
			}
		}
	});
	const takesSource = ['awk', 'awk-v1', 'c3', 'grain', 'julia', 'nim'].includes(runtime);
	const reader = takesSource ? construct('', channel) : construct(channel);
	return (length = 1): Uint8Array => {
		const value = typeof reader === 'function' ? reader(length) : reader.read(length);
		if (value instanceof Uint8Array) return value;
		return value === null || value === undefined || value === -1
			? new Uint8Array()
			: Uint8Array.of(value);
	};
}

describe('static stdin consumer rollover contract', () => {
	it('includes every source consumer of the static stdin protocol', () => {
		const actual = readdirSync(workers)
			.filter(
				(file) =>
					file.endsWith('.js') &&
					readFileSync(`${workers}/${file}`, 'utf8').includes(
						'wasm-idle-static-stdin-ring'
					)
			)
			.sort();
		expect(Object.keys(readers).map(workerFile).sort()).toEqual(actual);
	});

	for (const runtime of Object.keys(readers) as (keyof typeof readers)[]) {
		describe(runtime, () => {
			it.each([1, 3, 7, 8])(
				'preserves every UTF-8 byte through signed and unsigned rollover at capacity %i',
				(capacity) => {
					const counterRange = Math.floor(2 ** 32 / capacity) * capacity;
					for (const readSize of [1, 3])
						for (const start of [2 ** 31 - 2, counterRange - 2]) {
							const host = new StaticStdinRingHost({
								capacity,
								maxBufferedBytes: 128
							});
							const control = new Int32Array(host.descriptor.buffer, 0, 4);
							Atomics.store(control, 0, start);
							Atomics.store(control, 1, start);
							const input = 'aé한🙂Z\n'.repeat(3);
							const expected = new TextEncoder().encode(input);
							host.enqueue(input);
							host.close();
							const read = createReader(runtime, host.descriptor);
							const output: number[] = [];
							const decoder = new TextDecoder();
							let text = '';
							while (output.length < expected.length) {
								// Reading one byte hits every possible split within multibyte UTF-8.
								const chunk = read(readSize);
								expect(chunk.length).toBeGreaterThan(0);
								expect(chunk.length).toBeLessThanOrEqual(readSize);
								output.push(...chunk);
								text += decoder.decode(chunk, { stream: true });
								host.consumerRequestedInput();
								expect(host.bufferedBytes).toBe(expected.length - output.length);
							}
							expect(Uint8Array.from(output)).toEqual(expected);
							expect(text + decoder.decode()).toBe(input);
							expect(read()).toHaveLength(0);
							expect(host.isClosed).toBe(true);
							expect(Atomics.load(control, 0) >>> 0).toBe(
								(start + expected.length) % counterRange
							);
						}
				}
			);

			it('rejects old protocol descriptors and counters outside the capacity-aligned range', () => {
				const host = new StaticStdinRingHost({ capacity: 3, maxBufferedBytes: 8 });
				expect(() =>
					createReader(runtime, { ...host.descriptor, protocolVersion: 1 } as never)
				).toThrow();
				const control = new Int32Array(host.descriptor.buffer, 0, 4);
				Atomics.store(control, 0, 2 ** 32 - 1);
				Atomics.store(control, 1, 2 ** 32 - 1);
				expect(() => createReader(runtime, host.descriptor)()).toThrow(/counter|corrupt/);
			});
		});
	}
});
