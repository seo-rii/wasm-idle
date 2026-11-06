const scope = globalThis as unknown as {
	onmessage: ((event: MessageEvent) => void) | null;
	postMessage(message: unknown): void;
	close(): void;
};
let initialized = false;

scope.onmessage = async ({
	data
}: MessageEvent<{
	id: number;
	module: WebAssembly.Module;
	memory: WebAssembly.Memory;
	gate: SharedArrayBuffer;
	entry: string;
	arguments: number[];
	stackTop: number;
	heapBase: number;
	dataEnd: number;
	memoryBytes: number;
	timeoutMs: number;
	tls?: {
		base: number;
		size: number;
		alignment: number;
		reservedLow: number;
		reservedHigh: number;
	};
}>) => {
	try {
		if (initialized) throw new Error('GCC shared Worker cannot be reused');
		initialized = true;
		const yieldControl = data.tls ? new Int32Array(new SharedArrayBuffer(4)) : undefined;
		const instance = await WebAssembly.instantiate(data.module, {
			env: { memory: data.memory },
			...(yieldControl
				? {
						wasi_snapshot_preview1: {
							sched_yield: () => {
								// This private host word never represents a guest atomic operation.
								Atomics.wait(yieldControl, 0, 0, 1);
								return 0;
							}
						}
					}
				: {})
		});
		const global = (name: string) => (instance.exports[name] as WebAssembly.Global).value;
		if (
			global('__heap_base') !== data.heapBase ||
			global('__data_end') !== data.dataEnd ||
			global('__tls_size') !== (data.tls?.size ?? 0)
		)
			throw new Error('GCC shared Worker bounds differ from inspected artifact');
		(instance.exports.__stack_pointer as WebAssembly.Global).value = data.stackTop;
		if (data.tls) {
			if (
				global('__tls_align') !== data.tls.alignment ||
				global('__stack_low') !== data.tls.reservedLow ||
				global('__stack_high') !== data.tls.reservedHigh ||
				data.tls.base % data.tls.alignment ||
				data.tls.base < data.tls.reservedLow ||
				data.tls.base + data.tls.size > data.tls.reservedHigh ||
				data.stackTop > data.tls.reservedHigh
			)
				throw new Error(
					'GCC shared Worker TLS reservation differs from inspected artifact'
				);
			(instance.exports.__wasm_init_tls as (base: number) => void)(data.tls.base);
			if (global('__tls_base') !== (data.tls.size ? data.tls.base : 0))
				throw new Error(
					'GCC shared Worker TLS initialization did not install its private base'
				);
		}
		const gate = new Int32Array(data.gate);
		scope.postMessage({ id: data.id, type: 'ready' });
		if (Atomics.wait(gate, 0, 0, data.timeoutMs) === 'timed-out' || Atomics.load(gate, 0) !== 1)
			throw new Error('GCC shared Worker start barrier expired');
		const entry = instance.exports[data.entry] as (...values: number[]) => number;
		const value = entry(...data.arguments);
		if (data.tls) {
			if (
				global('__stack_pointer') !== data.stackTop ||
				global('__tls_base') !== (data.tls.size ? data.tls.base : 0)
			)
				throw new Error('GCC shared Worker changed its stack or TLS base');
			(instance.exports.__wasm_call_thread_dtors as () => void)();
		}
		if (
			global('__stack_pointer') !== data.stackTop ||
			data.memory.buffer.byteLength !== data.memoryBytes ||
			(data.tls && global('__tls_base') !== (data.tls.size ? data.tls.base : 0))
		)
			throw new Error('GCC shared Worker changed its stack or memory bounds');
		scope.postMessage({ id: data.id, type: 'result', value });
	} catch (error) {
		scope.postMessage({
			id: data.id,
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	} finally {
		scope.close();
	}
};

export {};
