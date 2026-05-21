import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.rs'], targetName = 'Main') {
    return `rustup default stable && /usr/bin/rustc --edition 2024 -O -o ${targetName} ${sourceName.join(' ')}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${path}/${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.RUST2024
}

export function getExtension() {
    return 'rs'
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
