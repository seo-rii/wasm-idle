import {SourceLanguage} from "./source";
import {ErrorCode, JudgeProgressCode, JudgeResultCode} from "./judgement";

export const enum PubEvent {
    JUDGE_FINISH = 'JUDGE_FINISH',
    JUDGE_PROGRESS = 'JUDGE_PROGRESS',
    JUDGE_ERROR = 'JUDGE_ERROR',
    IMG = 'img',
}

export interface LiveDataPS {
    p: number
    id: number
    progress: number
    r: JudgeProgressCode | JudgeResultCode
    u?: string
    l: SourceLanguage
    t?: number
    c?: number
    i?: boolean
    f?: any
    x?: boolean
}

export interface FinalDataPS extends LiveDataPS {
    s: number
    d: number
    m: number
    b: number
    a?: SourceLanguage
    e?: ErrorCode
}

export interface ImgDataPS {
    p: number
    id: number
    mime: string
    b64: string
    ts?: number
    u?: string
    l?: SourceLanguage
    t?: number
    c?: number
    i?: boolean
    f?: any
    x?: boolean
    a?: SourceLanguage
}
