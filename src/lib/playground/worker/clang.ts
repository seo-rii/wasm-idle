import type Clang from '$lib/clang';

declare var self: any;
self.document = {
	querySelectorAll() {
		return [];
	}
};
let stdinBufferClang: Int32Array, interruptBufferClang: Uint8Array, clang: Clang;

async function loadClang(path: string, log: boolean) {
	const { default: Clang } = await import('$lib/clang');
	clang = new Clang({
		stdout: (output) => postMessage({ output }),
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
	const { code, buffer, load, interrupt, log, path, prepare } = event.data;
	if (load) {
		await loadClang(path, log);
		postMessage({ load: true });
	} else if (prepare) {
		stdinBufferClang = new Int32Array(buffer);
		interruptBufferClang = new Uint8Array(interrupt);

		try {
			await clang.compileLink(code);
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	} else if (code) {
		clang.log = log;
		stdinBufferClang = new Int32Array(buffer);
		interruptBufferClang = new Uint8Array(interrupt);

		try {
			await clang.compileLinkRun(code);
			self.postMessage({ results: true });
		} catch (error: any) {
			self.postMessage({ error: error.message });
		}
	}
};
