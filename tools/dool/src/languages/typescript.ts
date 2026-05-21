import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.cpp'], targetName = 'Main') {
    return `cp -a /include/TYPESCRIPT/. ${path}/;tsc ${sourceName[0]} `
}

export const mergeBuildErrorStreams = true

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `node --stack-size=65536 ${sourceName}.js`
}

export function getLanguage() {
    return SourceLanguage.TYPESCRIPT
}

export function getExtension() {
    return 'ts'
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
