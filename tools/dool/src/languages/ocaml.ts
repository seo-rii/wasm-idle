import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

const ocamlRunParam = 's=32k'

export function build(path: string, uid: string, sourceName: string[] = ['Main.ml'], targetName = 'Main') {
    const orderedSource = [...sourceName].sort((left, right) => {
        const leftIsMain = left === 'Main.ml'
        const rightIsMain = right === 'Main.ml'
        if (leftIsMain !== rightIsMain) return leftIsMain ? 1 : -1

        const leftIsInterface = left.endsWith('.mli')
        const rightIsInterface = right.endsWith('.mli')
        if (leftIsInterface !== rightIsInterface) return leftIsInterface ? -1 : 1

        return left.localeCompare(right)
    })

    return `ocamlopt -o ${targetName} ${orderedSource.join(' ')}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `env OCAMLRUNPARAM='${ocamlRunParam}' ${path}/${sourceName}`
}

export function getLanguage() {
    return SourceLanguage.OCAML
}

export function getExtension() {
    return 'ml'
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
    return baseMemory + 64
}
