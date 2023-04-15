const staticUrl = '';

declare var self: any;

async function loadPyodideAndPackages() {
    const {loadPyodide} = await import('pyodide')
    self.pyodide = await loadPyodide({indexURL: staticUrl + '/pyodide'})
}

const blockingSleepBuffer = new Int32Array(new SharedArrayBuffer(4))
let stdinBuffer, interruptBuffer

self.onmessage = async (event) => {
    const {code, buffer, load, interrupt} = event.data
    if (load) {
        await loadPyodideAndPackages();
        await self.pyodide.loadPackagesFromImports(code)
        postMessage({load: true})
    } else if (code) {
        const ts = Date.now()
        stdinBuffer = new Int32Array(buffer)
        interruptBuffer = new Uint8Array(interrupt)
        self.pyodide.setInterruptBuffer(interruptBuffer)
        self['__pyodide__input_' + ts] = () => {
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
        self['__pyodide__output_' + ts] = (...data) => {
            let sep = ' ',
                end = '\r\n',
                output = '',
                clear = []
            for (const i of data) {
                if (i.end !== undefined) end = i.end.toString()
                else if (i.sep !== undefined) sep = i.sep.toString()
                else clear.push(i)
            }
            for (let i = 0; i < clear.length; i++) {
                if (typeof clear[i] === 'string' || (!clear[i].end && !clear[i].sep)) {
                    output += clear[i].toString()
                    if (i < clear.length - 1) output += sep
                }
            }
            output += end
            postMessage({output})
        }

        try {
            let results = await self.pyodide.runPythonAsync(`import asyncio
from js import __pyodide__input_${ts}, __pyodide__output_${ts}

input = __pyodide__input_${ts}
print = __pyodide__output_${ts}

__builtins__.input = __pyodide__input_${ts}
__builtins__.print = __pyodide__output_${ts}

${code}`)
            self.postMessage({results: true})
        } catch (error: any) {
            self.postMessage({error: error.message})
        }
    }
}
