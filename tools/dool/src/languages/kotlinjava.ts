import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

export function build(path: string, uid: string, sourceName: string[] = ['Main.kt'], targetName = 'Main') {
    return `kotlinc -J-Xms1024m -J-Xmx1920m -J-Xss512m ${sourceName.join(' ')} -include-runtime -d ${targetName}.jar`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `java -XX:ReservedCodeCacheSize=64m -XX:-UseCompressedClassPointers -Xmx32m -Xss16m -Dfile.encoding=UTF-8 -XX:+UseSerialGC -DONLINE_JUDGE=1 -jar ${path}/${sourceName}.jar`
}

export function getLanguage() {
    return SourceLanguage.KOTLIN_JAVA
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
    return baseTime * 2 + 1000
}

export function getMemoryLimit(baseMemory: number) {
    return baseMemory * 2 + 1024 + 256
}
