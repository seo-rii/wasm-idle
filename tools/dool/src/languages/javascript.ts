import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `node --stack-size=65536 ${sourceName} `
}

export function getLanguage() {
    return SourceLanguage.JAVASCRIPT
}

export function getExtension() {
    return 'js'
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
    return baseMemory * 2 + 1024
}
