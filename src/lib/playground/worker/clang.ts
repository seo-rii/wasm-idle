import type Clang from '$lib/clang';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};
let stdinBufferClang: Int32Array,
	debugBufferClang: Int32Array,
	interruptBufferClang: Uint8Array,
	clang: Clang;

async function loadClang(path: string, log: boolean) {
	const { default: Clang } = await import('$lib/clang');
	clang = new Clang({
		stdout: (output) => postMessage({ output }),
		onDebugEvent: (debugEvent) => postMessage({ debugEvent }),
		stdin: () => {
			while (true) {
				postMessage({ buffer: true });
				const res = Atomics.wait(stdinBufferClang, 0, 0, 100);
				if (res === 'not-equal') {
					try {
						const cpy = new Int32Array(stdinBufferClang.byteLength);
						cpy.set(stdinBufferClang);
						stdinBufferClang.fill(0);
						const dec = new TextDecoder();
						const strInfo = dec.decode(cpy).replace(/\x00/g, ''),
							padding = parseInt(strInfo.slice(-1));
						return strInfo.slice(0, -padding);
					} catch (e) {
						postMessage({ log: { e } });
					}
				}
			}
		},
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
		load,
		interrupt,
		log,
		path,
		prepare,
		args,
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
		interruptBufferClang = new Uint8Array(interrupt);

		try {
			await clang.compileLink(code, {
				args,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang
			});
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	} else if (code) {
		clang.log = log;
		stdinBufferClang = new Int32Array(buffer);
		debugBufferClang = new Int32Array(debugBuffer);
		interruptBufferClang = new Uint8Array(interrupt);

		try {
			await clang.compileLinkRun(code, {
				args,
				debug,
				breakpoints,
				pauseOnEntry,
				debugBuffer: debugBufferClang,
				interruptBuffer: interruptBufferClang
			});
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	}
};
