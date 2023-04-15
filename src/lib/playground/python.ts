import type Sandbox from '$lib/playground/sandbox'

class Python implements Sandbox {
    ts = Date.now()
    output = null
    worker: Worker = <any>null
    buffer = new SharedArrayBuffer(1024)
    interruptBuffer = new SharedArrayBuffer(1)
    internalBuffer: string[] = []
    begin = 0
    elapse = 0
    uid = 0

    load(code = '') {
        return new Promise<void>(async (resolve) => {
            this.internalBuffer = []
            if (!this.worker) {
                this.worker = new (await import('$lib/playground/worker/python?worker')).default()
                this.worker.onmessage = (event) => {
                    resolve()
                }
                this.worker.postMessage({load: true, code})
            } else resolve()
        })
    }

    write(input: string) {
        this.internalBuffer.push(input)
    }

    _write(input: string) {
        let strInfo = input,
            padding = 4 - (strInfo.length % 4)
        while (strInfo.length % 4 !== 3) strInfo += ' '
        strInfo += padding
        const buffer = new Int32Array(this.buffer)
        const enc = new TextEncoder()
        const data = enc.encode(strInfo)
        buffer.set(new Int32Array(data.buffer.slice(data.byteOffset), 0))
    }

    eof() {
    }

    run(code: string) {
        return new Promise<string>(async (resolve, reject) => {
            const interrupt = new Uint8Array(this.interruptBuffer),
                _uid = ++this.uid
            const handler = (event) => {
                if (_uid !== this.uid) {
                    this.worker.onmessage = null
                    return
                }
                const {id, output, results, log, error, buffer} = event.data
                if (buffer && this.internalBuffer.length)
                    this._write(this.internalBuffer.splice(0, 1)[0])
                if (output) this.output(output)
                if (results) {
                    this.elapse = Date.now() - this.begin
                    resolve(results as string)
                }
                if (log) console.log(log)
                if (error) {
                    this.elapse = Date.now() - this.begin
                    reject(error)
                }
            }
            interrupt[0] = 0
            this.worker.onmessage = handler
            this.begin = Date.now()
            this.worker.postMessage({
                code,
                buffer: this.buffer,
                interrupt: this.interruptBuffer,
                context: {}
            })
        })
    }

    terminate() {
        const interrupt = new Uint8Array(this.interruptBuffer)
        interrupt[0] = 2
    }

    async clear() {
        this.terminate()
        this.internalBuffer = []
        this.worker.onmessage = null
        const buffer = new Int32Array(this.buffer)
        buffer.fill(0)
        await new Promise((resolve) => setTimeout(resolve, 200))
    }
}

export default Python
