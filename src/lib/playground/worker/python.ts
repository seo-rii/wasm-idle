import type {PyodideInterface} from "pyodide";

declare var self: any;
self.document = {
    querySelectorAll() {
        return []
    }
};

let stdinBufferPyodide: Int32Array, interruptBufferPyodide: Uint8Array, pyodide: PyodideInterface, path = '';

async function loadPyodide(path: string) {
    if (pyodide) return;
    const {loadPyodide} = await import('pyodide');
    pyodide = await loadPyodide({indexURL: path + '/pyodide'});
}

self.onmessage = async (event: any) => {
    const {code, buffer, load, interrupt, path: _p, prepare} = event.data
    if (load) {
        path = _p;
        postMessage({output: 'Loading Pyodide...'});
        await loadPyodide(path);
        postMessage({output: ' Done.\n\r'});
        postMessage({load: true});
    } else if (prepare) {
        postMessage({output: 'Loading packages...'});
        try {
            await loadPyodide(path);
            await pyodide.loadPackagesFromImports(code);
            postMessage({output: ' Done.\n\r'});
            self.postMessage({results: true});
        } catch (e: any) {
            self.postMessage({error: e.message || 'Unknown error'});
        }
    } else if (code) {
        await loadPyodide(path);
        await pyodide.loadPackagesFromImports(code);
        const ts = Date.now();
        stdinBufferPyodide = new Int32Array(buffer);
        interruptBufferPyodide = new Uint8Array(interrupt);
        pyodide.setInterruptBuffer(interruptBufferPyodide);
        self['__pyodide__input_' + ts] = (output?: string) => {
            if (output) postMessage({output});
            while (true) {
                postMessage({buffer: true});
                const res = Atomics.wait(stdinBufferPyodide, 0, 0, 100)
                if (res === 'not-equal') {
                    try {
                        const cpy = new Int32Array(stdinBufferPyodide.byteLength)
                        cpy.set(stdinBufferPyodide)
                        stdinBufferPyodide.fill(0)
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
        self['__pyodide__output_' + ts] = (...data: any[]) => {
            let sep = ' ', end = '\r\n', output = '', clear = []
            for (const i of data) {
                if (i.end !== undefined) end = i.end.toString()
                else if (i.sep !== undefined) sep = i.sep.toString()
                else clear.push(i)
            }
            for (let i = 0; i < clear.length; i++) {
                if (typeof clear[i] === 'string' || (!clear[i].end && !clear[i].sep)) {
                    output += clear[i].toString();
                    if (i < clear.length - 1) output += sep;
                }
            }
            output += end;
            postMessage({output});
        }

        try {
            await pyodide.runPythonAsync(`import asyncio
from js import __pyodide__input_${ts}, __pyodide__output_${ts}

input = __pyodide__input_${ts}
print = __pyodide__output_${ts}

__builtins__.input = __pyodide__input_${ts}
__builtins__.print = __pyodide__output_${ts}

${code}`)
            self.postMessage({results: true});
        } catch (e: any) {
            self.postMessage({error: e.message || 'Unknown error'});
        }
    }
}
