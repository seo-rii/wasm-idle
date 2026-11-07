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
}>) => {
	try {
		if (initialized) throw new Error('GCC shared Worker cannot be reused');
		initialized = true;
		const instance = await WebAssembly.instantiate(data.module, {
			env: { memory: data.memory }
		});
		const global = (name: string) => (instance.exports[name] as WebAssembly.Global).value;
		if (
			global('__heap_base') !== data.heapBase ||
			global('__data_end') !== data.dataEnd ||
			global('__tls_size') !== 0
		)
			throw new Error('GCC shared Worker bounds differ from inspected artifact');
		(instance.exports.__stack_pointer as WebAssembly.Global).value = data.stackTop;
		const gate = new Int32Array(data.gate);
		scope.postMessage({ id: data.id, type: 'ready' });
		if (Atomics.wait(gate, 0, 0, data.timeoutMs) === 'timed-out' || Atomics.load(gate, 0) !== 1)
			throw new Error('GCC shared Worker start barrier expired');
		const entry = instance.exports[data.entry] as (...values: number[]) => number;
		const value = entry(...data.arguments);
		if (
			global('__stack_pointer') !== data.stackTop ||
			data.memory.buffer.byteLength !== data.memoryBytes
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
