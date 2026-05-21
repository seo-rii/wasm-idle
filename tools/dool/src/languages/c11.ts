import { JudgeType } from '../types/judgement'
import { SourceLanguage } from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.c'], targetName = 'Main') {
    return `gcc ${sourceName.join(' ')} -o ${targetName} -O2 -Wall -lm --static -std=c11 -DONLINE_JUDGE`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${path}/${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.C11
}

export function getExtension() {
    return 'c'
}

export function getSupportedType() {
    return [
        JudgeType.CommonJudge
    ]
}

export function getTimeLimit(baseTime: number) {
    return baseTime
}

export function getMemoryLimit(baseMemory: number) {
    return baseMemory
}
