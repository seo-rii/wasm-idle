interface sandbox {
    constructor: any
    eof: () => void
    load: (path: string, code?: string, log?: boolean) => Promise<void>
    run: (code: string, prepare: boolean, log?: boolean) => Promise<string>
    terminate: () => void
    clear: () => Promise<void>
}

export default sandbox
