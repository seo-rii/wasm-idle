import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.java'], targetName = 'Main') {
    return `javac --release 15 -J-Xms1024m -J-Xmx1920m -J-Xss512m -encoding UTF-8 ${sourceName.join(' ')} `
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `java -XX:ReservedCodeCacheSize=64m -XX:-UseCompressedClassPointers -Xmx32m -Xss16m -Dfile.encoding=UTF-8 -XX:+UseSerialGC -DONLINE_JUDGE=1 ${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.JAVA15
}

export function getExtension() {
    return 'java'
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
    return baseMemory * 2 + 1024 + 256
}
