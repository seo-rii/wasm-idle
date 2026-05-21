import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.cpp'], targetName = 'Main') {
    return `php -l ${sourceName.join(' ')} `
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `php -d display_errors=stderr ${sourceName} `
}

export function getLanguage() {
    return SourceLanguage.PHP
}

export function getExtension() {
    return 'php'
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
    return baseMemory + 512
}
