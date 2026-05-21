import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.cpp'], targetName = 'Main') {
    return `python3.13 -m compileall -b .`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `python3.13 ${sourceName}.${getExtension()}`
}

export function getLanguage() {
    return SourceLanguage.PYTHON3
}

export function getExtension() {
    return 'py'
}

export function getSupportedType() {
    return [
        JudgeType.CommonJudge
    ]
}

export function getTimeLimit(baseTime: number) {
    return baseTime * 3 + 2000
}

export function getMemoryLimit(baseMemory: number) {
    return baseMemory * 2 + 32
}
