declare var self: any;

async function loadClang() {
    const {default: Clang} = await import('$clang');
    self.clang = new Clang({
        stdout: (output) => postMessage({output}),
        stdin: () => {
            while (true) {
                postMessage({buffer: true})
                const res = Atomics.wait(stdinBuffer, 0, 0, 100)
                if (res === 'not-equal') {
                    try {
                        const cpy = new Int32Array(stdinBuffer.byteLength)
                        cpy.set(stdinBuffer)
                        stdinBuffer.fill(0)
                        const dec = new TextDecoder()
                        const strInfo = dec.decode(cpy).replace(/\x00/g, ''),
                            padding = parseInt(strInfo.slice(-1))
                        return strInfo.slice(0, -padding)
                    } catch (e) {
                        postMessage({log: {e}})
                    }
                }
            }
        }
    });
}

const blockingSleepBuffer = new Int32Array(new SharedArrayBuffer(4));
let stdinBuffer, interruptBuffer;

self.onmessage = async (event: { data: any }) => {
    const {code, buffer, load, interrupt} = event.data
    await loadClang();
    if (load) {
        postMessage({load: true});
    } else if (code) {
        const ts = Date.now()
        stdinBuffer = new Int32Array(buffer);
        interruptBuffer = new Uint8Array(interrupt);

        try {
            await self.clang.compileLinkRun(code);
            self.postMessage({results: true})
        } catch (error: any) {
            self.postMessage({error: error.message})
        }
    }
}
