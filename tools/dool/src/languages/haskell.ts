import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

const haskellMemoryHeadroomMB = 128

export function build(path: string, uid: string, sourceName: string[] = ['Main.hs'], targetName = 'Main') {
    return `ghc -O2 -o ${targetName} ${sourceName.join(' ')}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${path}/${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.HASKELL
}

export function getExtension() {
    return 'hs'
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
    return baseMemory + haskellMemoryHeadroomMB
}
