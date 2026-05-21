import {SourceLanguage} from '../types/source'
export {
    build,
    getExecuteCommand,
    getExtension,
    getMemoryLimit,
    getSupportedType,
    getTimeLimit
} from './kotlin'

export function getLanguage() {
    return SourceLanguage.KOTLIN_NATIVE
}
