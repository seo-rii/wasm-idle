export const enum ResultType {
    normal,
    timeLimitExceeded,
    stdioError,
}

export interface ExecuteLimit {
    time?: number
    memory?: number
}

export interface ExecuteRequest {
    uid: UID
    limit: ExecuteLimit
}

export interface ExecuteResult {
    resultType: ResultType
    stdout: string
    stderr: string
    code: number
    time: number
}

export interface ExecuteOption {
    input?: string
    timeout?: number
    cwd?: string
    env?: Record<string, string | undefined>
}

export type UID = string
