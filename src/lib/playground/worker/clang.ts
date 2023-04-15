import clang from "../clang";

declare var self: any;

async function loadClang() {
    const {default: Clang} = await import('$clang');
    self.clang = new Clang({stdout: (output) => postMessage({output})});
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
