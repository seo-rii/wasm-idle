// Independent execution of native-produced artifacts in Chromium. This is a
// WASI host, not a C/C++ implementation or substitute compiler.
import { File, OpenFile, WASI } from '@bjorn3/browser_wasi_shim';

self.onmessage = async ({ data }) => {
	try {
		const stdin = new File(new TextEncoder().encode(data.stdin));
		const stdout = new File([]);
		const stderr = new File([]);
		const wasi = new WASI(
			['program'],
			[],
			[new OpenFile(stdin), new OpenFile(stdout), new OpenFile(stderr)],
			{ debug: false }
		);
		const module = await WebAssembly.compile(data.bytes);
		const instance = await WebAssembly.instantiate(module, {
			wasi_snapshot_preview1: wasi.wasiImport
		});
		const exitCode = wasi.start(instance);
		self.postMessage({
			exitCode,
			stdout: new TextDecoder().decode(stdout.data),
			stderr: new TextDecoder().decode(stderr.data),
			memoryBytes: instance.exports.memory.buffer.byteLength,
			worker: typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope
		});
	} catch (error) {
		self.postMessage({ error: String(error?.stack || error) });
	}
};
