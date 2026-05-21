import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.cpp'], targetName = 'Main') {
    return `g++ ${sourceName.join(' ')} -o ${targetName} -O2 -Wall -lm --static -pipe -std=c++11 -DONLINE_JUDGE`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${path}/${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.CPP11
}

export function getExtension() {
    return 'cpp'
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
