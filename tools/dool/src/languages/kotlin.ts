import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.kt'], targetName = 'Main') {
    return `kotlinc-native -o ${targetName} -opt ${sourceName.join(' ')} `
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${path}/${sourceName}.kexe`
}

export function getLanguage() {
    return SourceLanguage.KOTLIN
}

export function getExtension() {
    return 'kt'
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
    return baseMemory + 16
}
