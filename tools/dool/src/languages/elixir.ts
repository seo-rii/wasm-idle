import {JudgeType} from '../types/judgement'
import {SourceLanguage} from '../types/source'

const literalAllocSuperCarrierMB = 128
const elixirSchedulers = '1:1'
const elixirAsyncThreads = 1
const elixirMemoryHeadroomMB = 1024 + 512
// The judge runs a fresh BEAM VM for each test case. Keep the VM thread footprint
// low so repeated Elixir launches do not fail with aux thread creation errors.
const elixirCommandPrefix =
    `env ERL_AFLAGS='+MIscs ${literalAllocSuperCarrierMB} +S ${elixirSchedulers} +A ${elixirAsyncThreads}'`

export function build(path: string, uid: string, sourceName: string[] = ['Main.exs'], targetName = 'Main') {
    return `${elixirCommandPrefix} elixir -e 'Code.string_to_quoted!(File.read!(hd(System.argv())), file: hd(System.argv()))' ${sourceName[0]}`
}

export function getExecuteCommand(
    path: string,
    uid: string,
    sourceName: string = 'Main'
) {
    return `${elixirCommandPrefix} elixir ${sourceName}.${getExtension()}`
}

export function getLanguage() {
    return SourceLanguage.ELIXIR
}

export function getExtension() {
    return 'exs'
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
    return baseMemory * 2 + elixirMemoryHeadroomMB
}
