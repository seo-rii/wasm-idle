import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.cpp'], targetName = 'Main') {
    return `ruby -c ${path}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `ruby ${path}/${sourceName}.${getExtension()}`
}

export function getLanguage() {
    return SourceLanguage.RUBY
}

export function getExtension() {
    return 'rb'
}

export function getSupportedType() {
    return [
        JudgeType.CommonJudge
    ]
}

export function getTimeLimit(baseTime: number) {
    return baseTime * 2 + 1000
}

export function getMemoryLimit(baseMemory: number) {
    return baseMemory + 512
}
