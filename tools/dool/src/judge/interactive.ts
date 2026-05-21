import {spawn, type ChildProcessWithoutNullStreams} from 'child_process'
import {performance} from 'perf_hooks'
import * as fs from 'fs'
import * as path from 'path'
import {v4 as uuid} from 'uuid'
import {loadLanguage} from './loader'
import {abort, accurateTimeout, execute, getLimitString, getMeasuredCommand, parseExecuteJudgeStderr} from './execute'
import {clearTempEnv, getTmpPath, getUserName, initTempEnv} from './environment'
import {ResultType, type ExecuteLimit} from '../types/execute'
import {JudgeResultCode} from '../types/judgement'
import {SourceLanguage} from '../types/source'

const INTERACTOR_SOURCE = 'Main'
const INTERACTIVE_INPUT = '_interactive__DOOL__INPUT'
const INTERACTIVE_ANSWER = '_interactive__DOOL__ANSWER'
const INTERACTIVE_OUTPUT = '_interactive__DOOL__OUTPUT'
const LOG_SIZE = 2000

type StaticFile = { name: string; content: Uint8Array }

export interface InteractorInitResult {
    uid: string
    message?: string
}

export interface InteractiveRunResult {
    verdict: JudgeResultCode
    score: number
    output: string
    message: string
    resultType: ResultType
    code: number
    time: number
    memory: number
}

const appendLimited = (current: string, chunk: Buffer | string) => {
    if (current.length >= LOG_SIZE) return current
    return (current + chunk.toString()).slice(0, LOG_SIZE)
}

const writeStaticFiles = (tmpPath: string, files: StaticFile[] = []) => {
    for (const file of files) {
        const dest = path.join(tmpPath, file.name)
        fs.mkdirSync(path.dirname(dest), {recursive: true, mode: 0o777})
        fs.writeFileSync(dest, file.content, {mode: 0o644})
    }
}

const shellEnv = (overrideEnv: Record<string, string | undefined> = {}) => {
    const baseEnv: Record<string, string | undefined> = {
        PATH: process.env.PATH,
        HOME: '/tmp',
        RUSTUP_HOME: '/cargo',
        CARGO_HOME: '/cargo',
        GOCACHE: '/tmp/gocache',
        GOENV: 'off',
        KONAN_USER_HOME: process.env.KONAN_USER_HOME,
        KONAN_DATA_DIR: process.env.KONAN_DATA_DIR,
        ...(process.env.GOPATH ? {GOPATH: process.env.GOPATH} : {}),
        LANG: 'C.utf8',
        LC_ALL: 'C.utf8',
    }
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries({...baseEnv, ...overrideEnv})) {
        if (value !== undefined) env[key] = value
    }
    return env
}

const spawnAs = (
    userName: string,
    command: string,
    cwd: string,
    env: Record<string, string | undefined> = {}
) =>
    spawn('su', ['-m', userName, '-c', command], {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
        cwd,
        env: {
            ...shellEnv(env),
            LOGNAME: userName,
            USER: userName,
        },
    })

const safeEnd = (child?: ChildProcessWithoutNullStreams) => {
    try {
        if (child?.stdin && !child.stdin.destroyed) child.stdin.end()
    } catch (e) {
    }
}

const safeWrite = (child: ChildProcessWithoutNullStreams, chunk: Buffer) => {
    try {
        if (!child.stdin.destroyed) child.stdin.write(chunk)
    } catch (e) {
    }
}

export async function initInteractor(
    language: SourceLanguage,
    source: string,
    staticFiles: StaticFile[] = []
): Promise<InteractorInitResult> {
    const uid = uuid()
    const languageModule = await loadLanguage(language)
    if (!languageModule) return {uid: '', message: 'Interactor language is not available'}

    const extension = languageModule.getExtension()
    const {tmpPath} = initTempEnv(uid, [], extension, false)
    writeStaticFiles(tmpPath, staticFiles)
    fs.writeFileSync(path.join(tmpPath, `${INTERACTOR_SOURCE}.${extension}`), source, {
        mode: 0o644,
    })

    if (languageModule.build) {
        const buildResult = await execute(
            getUserName(uid),
            languageModule.build(tmpPath, uid),
            {cwd: tmpPath}
        )
        if (buildResult.code) {
            clearTempEnv(uid)
            return {
                uid: '',
                message: (buildResult.stderr || buildResult.stdout || 'Interactor compilation failed').slice(0, LOG_SIZE),
            }
        }
    }

    return {uid}
}

export function clearInteractor(uid: string) {
    if (uid) clearTempEnv(uid)
}

export async function runInteractiveJudge({
    contestantUid,
    contestantCommand,
    contestantTmpPath,
    interactorUid,
    interactorLanguage,
    input,
    answer,
    limit,
    env,
}: {
    contestantUid: string
    contestantCommand: string
    contestantTmpPath: string
    interactorUid: string
    interactorLanguage: SourceLanguage
    input: string
    answer: string
    limit: ExecuteLimit
    env?: Record<string, string | undefined>
}): Promise<InteractiveRunResult> {
    const interactorModule = await loadLanguage(interactorLanguage)
    if (!interactorModule) {
        return {
            verdict: 'CE',
            score: 0,
            output: '',
            message: 'Interactor language is not available',
            resultType: ResultType.stdioError,
            code: -1,
            time: 0,
            memory: 0,
        }
    }

    const interactorTmpPath = getTmpPath(interactorUid)
    const inputPath = path.join(interactorTmpPath, INTERACTIVE_INPUT)
    const answerPath = path.join(interactorTmpPath, INTERACTIVE_ANSWER)
    const outputPath = path.join(interactorTmpPath, INTERACTIVE_OUTPUT)
    fs.writeFileSync(inputPath, input)
    fs.writeFileSync(answerPath, answer)
    try {
        fs.rmSync(outputPath)
    } catch (e) {
    }

    const contestantUser = getUserName(contestantUid)
    const interactorUser = getUserName(interactorUid)
    const contestantShell = getLimitString(
        {memory: limit.memory},
        getMeasuredCommand(contestantCommand)
    )
    const interactorCommand =
        `${interactorModule.getExecuteCommand(interactorTmpPath, interactorUid, INTERACTOR_SOURCE)} ${inputPath} ${outputPath} ${answerPath}`

    return new Promise<InteractiveRunResult>((resolve) => {
        const startedAt = performance.now()
        const contestant = spawnAs(contestantUser, contestantShell, contestantTmpPath, env)
        const interactor = spawnAs(interactorUser, interactorCommand, interactorTmpPath)
        let contestantClosed = false
        let interactorClosed = false
        let contestantCode = 0
        let interactorCode = 0
        let contestantStdout = ''
        let contestantStderr = ''
        let interactorStderr = ''
        let timeouted = false
        let resolved = false

        contestant.stdin.on('error', () => {})
        interactor.stdin.on('error', () => {})
        contestant.on('error', () => {})
        interactor.on('error', () => {})

        const cleanup = async () => {
            safeEnd(contestant)
            safeEnd(interactor)
            await Promise.all([
                abort(contestant.pid, contestantUser).catch(() => {}),
                abort(interactor.pid, interactorUser).catch(() => {}),
            ])
        }

        const finishIfReady = () => {
            if (resolved || !contestantClosed || !interactorClosed) return
            resolved = true
            clearTimer()

            const parsed = parseExecuteJudgeStderr(contestantStderr)
            const timeLimit = limit.time || 0
            const elapsed = Math.max(0, Math.round(performance.now() - startedAt))
            const time = parsed.timeMs || (timeouted ? (timeLimit || elapsed) : elapsed)
            let verdict: JudgeResultCode = 'WA'
            let message = interactorStderr || parsed.stderr
            let code = interactorCode || contestantCode

            if (timeouted) verdict = 'TLE'
            else if (interactorCode === 0) {
                verdict = 'AC'
            } else if (interactorCode === 3) {
                verdict = 'CE'
                if (!message) message = 'Interactor failed'
            } else if (interactorCode < 0 || contestantCode < 0) {
                verdict = 'RE'
                if (!message) message = 'Interactive execution failed'
            } else {
                verdict = 'WA'
                if (!message) message = 'Wrong answer'
            }

            resolve({
                verdict,
                score: verdict === 'AC' ? 1 : 0,
                output: contestantStdout.slice(0, LOG_SIZE),
                message: message.replaceAll(getTmpPath(contestantUid), '~').slice(0, LOG_SIZE),
                resultType: timeouted ? ResultType.timeLimitExceeded : ResultType.normal,
                code,
                time,
                memory: parsed.memoryKB,
            })
        }

        const clearTimer = limit.time
            ? accurateTimeout(limit.time, () => {
                if (resolved || timeouted) return
                timeouted = true
                cleanup().finally(() => {
                    if (!contestantClosed || !interactorClosed) return
                    finishIfReady()
                })
            })
            : () => {}

        contestant.stdout.on('data', (chunk: Buffer) => {
            contestantStdout = appendLimited(contestantStdout, chunk)
            safeWrite(interactor, chunk)
        })
        contestant.stdout.on('end', () => safeEnd(interactor))

        interactor.stdout.on('data', (chunk: Buffer) => safeWrite(contestant, chunk))
        interactor.stdout.on('end', () => safeEnd(contestant))

        contestant.stderr.on('data', (chunk: Buffer) => {
            contestantStderr += chunk.toString()
        })
        interactor.stderr.on('data', (chunk: Buffer) => {
            interactorStderr = appendLimited(interactorStderr, chunk)
        })

        contestant.on('close', (code: number | null) => {
            contestantClosed = true
            contestantCode = code ?? -1
            safeEnd(interactor)
            finishIfReady()
        })
        interactor.on('close', (code: number | null) => {
            interactorClosed = true
            interactorCode = code ?? -1
            safeEnd(contestant)
            if (interactorCode === 0) {
                setTimeout(() => {
                    if (!contestantClosed) cleanup().finally(finishIfReady)
                }, 100)
                finishIfReady()
                return
            }
            cleanup().finally(finishIfReady)
        })
    })
}
