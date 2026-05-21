import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.go'], targetName = 'Main') {
    const quotedTarget = JSON.stringify(targetName)
    const quotedSources = sourceName.map((name) => JSON.stringify(name)).join(' ')
    return `env -u GOROOT GOENV=off /usr/bin/go build -o ${quotedTarget} ${quotedSources}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${path}/${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.GO
}

export function getExtension() {
    return 'go'
}

export function getSupportedType() {
    return [
        JudgeType.CommonJudge
    ]
}

export function getTimeLimit(baseTime: number) {
    return baseTime + 2000
}

export function getMemoryLimit(baseMemory: number) {
    return baseMemory + 1024
}
