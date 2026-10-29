import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Scala from './scala';
import { createScalaCompilerPayload } from './scalaAssets';

vi.mock('./scalaAssets', () => ({ createScalaCompilerPayload: vi.fn() }));
const fetchPayload = vi.mocked(createScalaCompilerPayload);
const source = 'object Main:\n  def main(args: Array[String]): Unit = ()';
const workers: TestWorker[] = [];
class TestWorker {
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: unknown = null;
	onmessageerror: unknown = null;
	terminated = false;
	messages: Record<string, unknown>[] = [];
	constructor(readonly url: URL) {
		workers.push(this);
	}
	postMessage(message: Record<string, unknown>) {
		this.messages.push(message);
		if (message.type === 'initialize') queueMicrotask(() => this.reply({ type: 'ready' }));
	}
	reply(data: Record<string, unknown>) {
		this.onmessage?.({ data: { id: this.messages.at(-1)?.id, ...data } });
	}
	terminate() {
		this.terminated = true;
	}
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
	workers.length = 0;
	fetchPayload.mockReset().mockResolvedValue({ 'compiler/main.wasm': new Uint8Array([1]) });
	vi.stubGlobal('Worker', TestWorker);
	vi.stubGlobal('WebAssembly', { JSTag: {}, Suspending: () => {}, promising: () => {} });
});
afterEach(() => vi.unstubAllGlobals());

describe('Scala Sandbox lifecycle', () => {
	it('does not download in an unsupported browser', async () => {
		vi.stubGlobal('WebAssembly', {});
		const sandbox = new Scala();
		await expect(sandbox.load()).rejects.toMatchObject({ code: 'unsupported-browser-feature' });
		expect(fetchPayload).not.toHaveBeenCalled();
	});
	it('initializes at load and respects the default one-worker budget', async () => {
		const sandbox = new Scala();
		await sandbox.load();
		const running = sandbox.run(source);
		await tick();
		workers[0].reply({ type: 'compiled', code: 'program', diagnostics: [] });
		await tick();
		expect(workers[0].terminated).toBe(true);
		expect(workers.length).toBe(2);
		workers[1].reply({ type: 'exit', exitCode: 0 });
		await expect(running).resolves.toBe(true);
		expect(workers[1].terminated).toBe(true);
		await sandbox.dispose();
	});
	it('Stop at compilation completion prevents execution and permits recovery', async () => {
		const sandbox = new Scala();
		await sandbox.load();
		const running = sandbox.run(source);
		const rejected = expect(running).rejects.toMatchObject({ code: 'cancelled' });
		await tick();
		workers[0].reply({ type: 'compiled', code: 'program', diagnostics: [] });
		sandbox.terminate();
		await rejected;
		expect(workers.length).toBe(1);
		await sandbox.clear();
		await sandbox.load();
		expect(workers.length).toBe(2);
		await sandbox.dispose();
	});
	it('never executes a previous artifact after a type error and reports locations', async () => {
		const sandbox = new Scala();
		const diagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load();
		const running = sandbox.run(source);
		const rejected = expect(running).rejects.toMatchObject({ code: 'compile' });
		await tick();
		workers[0].reply({
			type: 'error',
			message: 'Compiler exited 1',
			diagnostics: [
				'-- [E007] Type Mismatch Error: /workspace/Main.scala:2:5 ---',
				'Found String'
			]
		});
		await rejected;
		expect(diagnostic).toHaveBeenCalledWith(
			expect.objectContaining({ fileName: 'Main.scala', lineNumber: 2, columnNumber: 5 })
		);
		expect(workers.length).toBe(1);
		expect(workers[0].terminated).toBe(true);
		await sandbox.dispose();
	});
	it('keeps compiler warm when two workers are allowed and enforces output bytes on host', async () => {
		const sandbox = new Scala();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load();
		const running = sandbox.run(source, false, false, undefined, [], {
			limits: { maxWorkers: 2, maxOutputBytes: 2 }
		});
		const rejected = expect(running).rejects.toMatchObject({ code: 'output-limit' });
		await tick();
		workers[0].reply({ type: 'compiled', code: 'program', diagnostics: [] });
		await tick();
		workers[1].reply({ type: 'stdout', data: '한' });
		await rejected;
		expect(output).not.toHaveBeenCalled();
		expect(workers[0].terminated).toBe(false);
		expect(workers[1].terminated).toBe(true);
		await sandbox.dispose();
	});
	it('rejects unsupported options and workspace traversal before starting workers', async () => {
		const sandbox = new Scala();
		await expect(
			sandbox.run(source, false, false, undefined, [], { interactive: true })
		).rejects.toMatchObject({ code: 'runtime-configuration' });
		await expect(
			sandbox.run(source, false, false, undefined, [], { activePath: '../Main.scala' })
		).rejects.toThrow();
		expect(workers).toHaveLength(0);
		await sandbox.dispose();
	});
});

it('does not reuse a warm compiler after the caller lowers the asset ceiling', async () => {
	const sandbox = new Scala();
	fetchPayload.mockResolvedValueOnce({ 'compiler/main.wasm': new Uint8Array(16) });
	await sandbox.load();
	fetchPayload.mockRejectedValueOnce(new Error('Asset exceeds byte limit'));
	await expect(
		sandbox.run(source, false, false, undefined, [], { limits: { maxAssetBytes: 8 } })
	).rejects.toThrow('Asset exceeds byte limit');
	expect(workers[0].terminated).toBe(true);
	expect(workers).toHaveLength(1);
	await sandbox.dispose();
});

it('reports worker diagnostic byte-budget metadata without substituting diagnostic count', async () => {
	const sandbox = new Scala();
	await sandbox.load();
	const running = sandbox.run(source, false, false, undefined, [], {
		limits: { maxOutputBytes: 64 }
	});
	const rejected = expect(running).rejects.toMatchObject({
		code: 'diagnostic-limit',
		limit: 64,
		actual: 100
	});
	await tick();
	workers[0].reply({
		type: 'error',
		message: 'Too many diagnostic bytes',
		diagnostics: [],
		failureKind: 'diagnostic-limit',
		limit: 64,
		actual: 100
	});
	await rejected;
	await sandbox.dispose();
});

it('uses the hard output ceiling consistently when a caller requests a larger budget', async () => {
	const sandbox = new Scala();
	await sandbox.load();
	const running = sandbox.run(source, false, false, undefined, [], {
		limits: { maxWorkers: 2, maxOutputBytes: 2 * 1024 * 1024 }
	});
	const rejected = expect(running).rejects.toMatchObject({
		code: 'output-limit',
		limit: 1024 * 1024
	});
	await tick();
	workers[0].reply({ type: 'compiled', code: 'program', diagnostics: [] });
	await tick();
	expect(workers[1].messages[0].maxOutputBytes).toBe(1024 * 1024);
	workers[1].reply({ type: 'error', message: 'Scala output exceeds 1 MiB.' });
	await rejected;
	await sandbox.dispose();
});
