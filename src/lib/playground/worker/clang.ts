import type Clang from '$lib/clang';
import { waitForBufferedStdin } from '$lib/playground/stdinBuffer';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};
let stdinBufferClang: Int32Array,
	debugBufferClang: Int32Array,
	watchBufferClang: Int32Array,
	watchResultBufferClang: Int32Array,
	interruptBufferClang: Uint8Array,
	clang: Clang;

async function loadClang(path: string, log: boolean) {
	const { default: Clang } = await import('$lib/clang');
	clang = new Clang({
		stdout: (output) => postMessage({ output }),
		onDebugEvent: (debugEvent) => postMessage({ debugEvent }),
		stdin: () =>
			waitForBufferedStdin(stdinBufferClang, () => postMessage({ buffer: true })) ?? '',
		progress: (value) => postMessage({ progress: value }),
		log,
		path
	});
}

self.onmessage = async (event: { data: any }) => {
	const {
		code,
		buffer,
		debugBuffer,
		watchBuffer,
		watchResultBuffer,
		load,
		interrupt,
		log,
		path,
		prepare,
		language,
		compileArgs,
		programArgs,
		cppVersion,
		cVersion,
		debug,
		breakpoints,
		pauseOnEntry
	} = event.data;
	if (load) {
		await loadClang(path, log);
		postMessage({ load: true });
	} else if (prepare) {
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		watchBufferClang = new Int32Array(watchBuffer);
		watchResultBufferClang = new Int32Array(watchResultBuffer);
		interruptBufferClang = new Uint8Array(interrupt);

		try {
			await clang.compileLink(code, {
				language,
				compileArgs,
				programArgs,
				cppVersion,
				cVersion,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang,
				watchBuffer: watchBufferClang,
				watchResultBuffer: watchResultBufferClang
			});
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	} else if (code) {
		clang.log = log;
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		watchBufferClang = new Int32Array(watchBuffer);
		watchResultBufferClang = new Int32Array(watchResultBuffer);
		interruptBufferClang = new Uint8Array(interrupt);

		try {
			await clang.compileLinkRun(code, {
				language,
				compileArgs,
				programArgs,
				cppVersion,
				cVersion,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang,
				watchBuffer: watchBufferClang,
				watchResultBuffer: watchResultBufferClang
			});
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	}
};
