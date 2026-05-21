import { JudgeType } from '../types/judgement'
import { SourceLanguage } from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.cpp'], targetName = 'Main') {
    return `luac5.4 -p ${sourceName.join(' ')} `
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `lua5.4 ${sourceName}.${getExtension()}`
}

export function getLanguage() {
    return SourceLanguage.LUA
}

export function getExtension() {
    return 'lua'
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
