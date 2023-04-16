interface sandbox {
    constructor: any
    eof: () => void
    load: (code?: string, log?: boolean) => Promise<void>
    run: (code: string) => Promise<string>
    terminate: () => void
    clear: () => Promise<void>
}

export default sandbox
