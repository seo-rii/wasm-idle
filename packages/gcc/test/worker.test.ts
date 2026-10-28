import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCrossGccWorker, createGccWorker } from '../src/worker.js';

/** Synthetic transport fixture only: CPU/compiler correctness belongs to the real bundle probe. */
class FixtureWorker {
	static instances: FixtureWorker[] = [];
	onmessage?: (event: { data: unknown }) => void;
	onerror?: (event: { message: string }) => void;
	onmessageerror?: () => void;
	terminate = vi.fn();
	messages: Record<string, unknown>[] = [];
	constructor() {
		FixtureWorker.instances.push(this);
	}
	postMessage(message: Record<string, unknown>) {
		this.messages.push(message);
		if (message.type === 'initialize')
			queueMicrotask(() =>
				this.onmessage?.({
					data: {
						id: message.id,
						type: 'ready',
						manifest: { compiler: { family: 'gcc' } },
						identity: {
							compilerHost: 'wasm32-emscripten',
							target:
								(message.options as { target?: string }).target ??
								'x86_64-linux-gnu'
						}
					}
				})
			);
	}
}

const options = {
	manifestUrl: 'https://example.test/gcc-toolchain.v1.json',
	manifestSha256: '0'.repeat(64)
};
beforeEach(() => {
	FixtureWorker.instances.length = 0;
	vi.stubGlobal('Worker', FixtureWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe('GCC Worker ownership and cancellation', () => {
	it.each([
		null,
		{ id: 1, type: 'unknown' },
		{ id: 1, type: 'run-result', result: {} },
		{ id: 1, type: 'result' }
	])('terminates and settles pending work on malformed Worker response %j', async (data) => {
		const compiler = await createCrossGccWorker(options),
			transport = FixtureWorker.instances[0];
		const pending = compiler.compile({ code: 'source' });
		const rejected = expect(pending).rejects.toThrow('invalid response');
		expect(() => transport.onmessage?.({ data })).not.toThrow();
		await rejected;
		expect(transport.terminate).toHaveBeenCalledOnce();
		await expect(compiler.compile({ code: 'again' })).rejects.toThrow('disposed');
	});
	it('terminates synchronous compiler work on AbortSignal and rejects reuse', async () => {
		const compiler = await createCrossGccWorker(options),
			transport = FixtureWorker.instances[0];
		const controller = new AbortController();
		const compilation = compiler.compile(
			{ code: 'slow program' },
			{ signal: controller.signal }
		);
		const rejected = expect(compilation).rejects.toMatchObject({ name: 'AbortError' });
		controller.abort();
		await rejected;
		expect(transport.terminate).toHaveBeenCalledOnce();
		await expect(compiler.compile({ code: 'next program' })).rejects.toThrow('disposed');
		compiler.dispose();
		expect(transport.terminate).toHaveBeenCalledOnce();
	});

	it('rejects concurrent work and ignores late results from terminated workers', async () => {
		const compiler = await createCrossGccWorker(options),
			transport = FixtureWorker.instances[0];
		const pending = compiler.compile({ code: 'source' });
		await expect(compiler.compile({ code: 'second' })).rejects.toThrow('busy');
		const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		compiler.cancel();
		await rejected;
		transport.onmessage?.({
			data: { id: 1, type: 'result', result: { exitCode: 0, artifact: {} } }
		});
		await expect(compiler.compile({ code: 'third' })).rejects.toThrow('disposed');
	});

	it('returns failed compile responses without inventing artifacts and disposes on worker faults', async () => {
		const compiler = await createCrossGccWorker(options),
			transport = FixtureWorker.instances[0];
		const pending = compiler.compile({ code: 'invalid' });
		transport.onmessage?.({
			data: {
				id: 1,
				type: 'result',
				result: { exitCode: 1, stdout: '', stderr: 'error', stages: [] }
			}
		});
		expect(await pending).toEqual({ exitCode: 1, stdout: '', stderr: 'error', stages: [] });
		const next = compiler.compile({ code: 'next' });
		const rejected = expect(next).rejects.toThrow('Worker failed');
		transport.onerror?.({ message: 'fault' });
		await rejected;
		expect(transport.terminate).toHaveBeenCalledOnce();
	});

	it('does not create a worker when initialization was already cancelled', async () => {
		await expect(
			createCrossGccWorker({ ...options, signal: AbortSignal.abort() })
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(FixtureWorker.instances).toHaveLength(0);
	});

	it('sends an explicit Wasm output target and returns WASI run output through the Worker', async () => {
		const compiler = await createGccWorker({ ...options, target: 'wasm32-wasi' });
		const transport = FixtureWorker.instances[0];
		expect(transport.messages[0].options).toMatchObject({ target: 'wasm32-wasi' });
		const artifact = {
			compiler: 'gcc',
			compilerHost: 'wasm32-emscripten',
			target: 'wasm32-wasi',
			format: 'wasm-executable',
			fileName: 'program.wasm',
			bytes: new Uint8Array(),
			cpu: 'wasm32'
		} as const;
		const pending = compiler.run(artifact, { stdin: '42\n' });
		expect(transport.messages[1]).toMatchObject({
			type: 'run',
			artifact,
			options: { stdin: '42\n' }
		});
		await expect(compiler.compile({ code: 'int main() {}' })).rejects.toThrow('busy');
		transport.onmessage?.({
			data: {
				id: 1,
				type: 'run-result',
				result: {
					exitCode: 0,
					stdout: '42\n',
					stderr: '',
					milliseconds: 1,
					peakMemoryBytes: 65536
				}
			}
		});
		expect(await pending).toMatchObject({ exitCode: 0, stdout: '42\n' });
		const controller = new AbortController();
		const running = compiler.run(artifact, { signal: controller.signal });
		expect(transport.messages[2].options).not.toHaveProperty('signal');
		const rejected = expect(running).rejects.toMatchObject({ name: 'AbortError' });
		controller.abort();
		await rejected;
		expect(transport.terminate).toHaveBeenCalledOnce();
	});
});
