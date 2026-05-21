import {loadLanguage} from './loader'
import {
    tryIt,
} from './util'
import fs from 'fs'
import {v4 as uuid} from 'uuid'
import {clearTempEnv, getTmpPath, getUserName, initTempEnv} from "./environment";
import {execute, executeJudge} from "./execute";
import {SourceLanguage} from "../types/source";

const specialJudgeSource = 'Main',
    specialJudgeIn = '_special_judge__DOOL__INPUT',
    specialJudgeOut = '_special_judge__DOOL__OUTPUT',
    specialJudgeSolution = '_special_judge__DOOL__SOLUTION'

export async function initSpecialJudge(
    language: SourceLanguage,
    source: string,
    extension: string
) {
    const uid = uuid()
    const {tmpPath} = initTempEnv(uid, [], extension, false)
    const languageModule = await loadLanguage(language)
    if (!languageModule) return ''

    fs.writeFileSync(
        tmpPath + '/' + specialJudgeSource + '.' + languageModule.getExtension(), source
    )

    if (languageModule.build) {
        const buildResult = await execute(getUserName(uid), languageModule.build(tmpPath, uid), {cwd: tmpPath})
        if (buildResult.code) return ''
    }

    return uid
}

export function clearSpecialJudge(uid: string) {
    clearTempEnv(uid)
}

export async function runSpecialJudge(
    uid: string,
    language: SourceLanguage,
    data: { input: string; solution: string; output: string }
) {
    const tmpPath = getTmpPath(uid)
    const languageModule = await loadLanguage(language)
    if (!languageModule) return {
        code: -1,
        stdout: '0'
    }

    tryIt(() => fs.rmSync(tmpPath + '/' + specialJudgeIn))
    tryIt(() => fs.rmSync(tmpPath + '/' + specialJudgeSolution))
    tryIt(() => fs.rmSync(tmpPath + '/' + specialJudgeOut))

    fs.writeFileSync(tmpPath + '/' + specialJudgeIn, data.input)
    fs.writeFileSync(tmpPath + '/' + specialJudgeSolution, data.solution)
    fs.writeFileSync(tmpPath + '/' + specialJudgeOut, data.output)

    const env = process.env.PYTHONPATH ? {PYTHONPATH: process.env.PYTHONPATH} : undefined
    const {code, stdout} = await executeJudge(
        {
            uid,
            limit: {
                time: languageModule.getTimeLimit(3000),
                memory: languageModule.getMemoryLimit(1024),
            }
        }, tmpPath,
        languageModule.getExecuteCommand(tmpPath, uid, specialJudgeSource) +
        ` ${tmpPath}/${specialJudgeIn} ${tmpPath}/${specialJudgeSolution} ${tmpPath}/${specialJudgeOut}`, '',
        env ? {env} : {}
    )

    return {code, stdout}
}
