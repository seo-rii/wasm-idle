import {JudgeRequest, JudgeResult, JudgeResultCode, JudgeProgressCode, JudgeType} from '../types/judgement'
import {detectErrorCode, isSame, representativeResult, sanitizeCompileMessage, uuid} from './util'
import {clearTempEnv, getTmpPath, getUserName, initTempEnv} from "./environment";
import {execute, executeJudge, parseExecuteJudgeStderr} from "./execute";
import {ResultType} from "../types/execute";
import {CommonDataSet, ScoringType} from "../types/dataset";
import {clearSpecialJudge, initSpecialJudge, runSpecialJudge} from "./special";
import {clearInteractor, initInteractor, runInteractiveJudge} from "./interactive";
import {PubEvent} from "../types/socket";
import {sendLiveMessage} from "../server/pub";
import {log} from "../log";
import * as fs from "fs";
import * as path from "path";

const logSize = 2000;
const IMAGE_RUNNER_NAME = '__img_runner__.py';

type BuildErrorOutputMode = 'default' | 'merge'

const resolvePythonEntry = (sources: string[]) => {
    const pySources = sources.filter((name) => name.toLowerCase().endsWith('.py'))
    if (!pySources.length) return 'Main.py'
    const mainSource = pySources.find(
        (name) => path.basename(name).toLowerCase() === 'main.py'
    )
    return mainSource || pySources[0]
}

const writeImageRunner = (tmpPath: string, entryName: string) => {
    const entryLiteral = JSON.stringify(entryName)
    const runner = `import importlib.util\nimport os\nimport runpy\nimport sys\n\n_ROOT = os.path.dirname(__file__)\n_ENTRY = ${entryLiteral}\n\n\ndef _load_sitecustomize():\n    path = os.path.join(_ROOT, 'sitecustomize.py')\n    if not os.path.exists(path):\n        return\n    try:\n        existing = sys.modules.get('sitecustomize')\n        if existing is not None:\n            try:\n                if getattr(existing, '__file__', None) == path:\n                    return\n            except Exception:\n                pass\n        module_name = 'sitecustomize'\n        if 'sitecustomize' in sys.modules:\n            module_name = '_dool_sitecustomize'\n        spec = importlib.util.spec_from_file_location(module_name, path)\n        if spec and spec.loader:\n            module = importlib.util.module_from_spec(spec)\n            sys.modules[module_name] = module\n            spec.loader.exec_module(module)\n    except Exception:\n        pass\n\n\ndef _run():\n    target = os.path.join(_ROOT, _ENTRY)\n    if not os.path.exists(target):\n        raise FileNotFoundError(target)\n    script_dir = os.path.dirname(target)\n    if script_dir and script_dir not in sys.path:\n        sys.path.insert(0, script_dir)\n    sys.argv = [target] + sys.argv[1:]\n    runpy.run_path(target, run_name='__main__')\n\n\nif __name__ == '__main__':\n    _load_sitecustomize()\n    _run()\n`
    const runnerPath = path.join(tmpPath, IMAGE_RUNNER_NAME)
    fs.writeFileSync(runnerPath, runner, {mode: 0o644})
    return IMAGE_RUNNER_NAME
}

const buildPythonCommandWithRunner = (baseCommand: string, runnerName: string) => {
    const parts = baseCommand.split(' ').filter(Boolean)
    if (!parts.length) return baseCommand
    const pythonBin = parts[0]
    if (parts.length === 1) return `${pythonBin} ${runnerName}`
    const args = parts.slice(1)
    if (args.length >= 1) args.pop()
    return [pythonBin, ...args, runnerName].join(' ')
}

export default function commonJudge(
    data: JudgeRequest,
    build: ((path: string, uid: string, sourceName?: string[], targetName?: string) => string) | null,
    getExecuteCommand: (path: string, uid: string) => string,
    extension: string,
    sourceSize: number,
    buildErrorOutputMode: BuildErrorOutputMode = 'default'
) {
    return new Promise<JudgeResult>(async (resolve) => {
        const uid = uuid()
        let promises = []

        const createLiveMessagePayload = (r: JudgeProgressCode | JudgeResultCode, progress: number) => ({
            p: data.problemId,
            id: data.submissionId,
            progress,
            r,
            u: data.additional?.account,
            l: data.language,
            a: data.altLanguage,
            t: data.additional?.time,
            c: data.additional?.contestId,
            i: data.additional?.closed,
            f: data.additional?.sca,
            x: data.additional?.codepass,
        })

        const createPlaceholderResults = () => data.dataSet.map((subtask) => {
            switch (subtask.scoringType) {
                case ScoringType.MAXIMUM:
                case ScoringType.MINIMUM:
                case ScoringType.QUANTIZED:
                    return 0
                case ScoringType.PROPORTIONAL:
                    return Array(subtask.data.length).fill(0)
                default:
                    return 0
            }
        })

        const createFailureResult = (messageText: string) => ({
            m_reason: 'CE' as JudgeResultCode,
            score: 0,
            m_time: 0,
            m_memory: 0,
            result: createPlaceholderResults(),
            reason: Array(data.dataSet.length).fill('CE' as JudgeResultCode),
            time: Array(data.dataSet.length).fill(0),
            memory: Array(data.dataSet.length).fill(0),
            message: messageText,
            e: detectErrorCode(messageText),
            language: data.language,
            altLanguage: data.altLanguage,
            ...(data.additional ? {additional: data.additional} : {}),
            source: data.source,
            size: sourceSize,
        })

        promises.push(sendLiveMessage(
            PubEvent.JUDGE_PROGRESS,
            createLiveMessagePayload('CP', 0)
        ))

        const imageCaptureEnabled = extension === 'py' && Boolean(data.imgRender)
        const {tmpPath, sourcesName} = initTempEnv(uid, data.source, extension, imageCaptureEnabled)
        const imageRunnerName = imageCaptureEnabled
            ? writeImageRunner(tmpPath, resolvePythonEntry(sourcesName))
            : ''
        const baseExecuteCommand = getExecuteCommand(tmpPath, uid)
        const executeCommand = imageRunnerName
            ? buildPythonCommandWithRunner(baseExecuteCommand, imageRunnerName)
            : baseExecuteCommand
        const imageEnv = imageCaptureEnabled
            ? {
                  PYTHONPATH: process.env.PYTHONPATH
                      ? `${tmpPath}:${process.env.PYTHONPATH}`
                      : tmpPath,
                  IMG_OUT_DIR: path.join(tmpPath, '__img__'),
                  MPLCONFIGDIR: path.join(tmpPath, '__img__')
              }
            : undefined
        const imgDir = path.join(tmpPath, '__img__')
        const IMAGE_STORE_LIMIT = 20
        const storedImages: { mime: string; b64: string; ts?: number }[] = []
        const drainImages = () => {
            if (!imageCaptureEnabled) return
            let files: string[] = []
            try {
                files = fs.readdirSync(imgDir)
            } catch (e) {
                return
            }
            const entries = files.filter((name) => name.endsWith('.json')).sort()
            for (const name of entries) {
                const full = path.join(imgDir, name)
                try {
                    const payload = JSON.parse(fs.readFileSync(full, 'utf-8'))
                    if (payload?.b64 && payload?.mime) {
                        const imgTs = typeof payload?.ts === 'number' ? payload.ts : Date.now()
                        storedImages.push({
                            mime: payload.mime,
                            b64: payload.b64,
                            ts: imgTs
                        })
                        if (storedImages.length > IMAGE_STORE_LIMIT) {
                            storedImages.splice(0, storedImages.length - IMAGE_STORE_LIMIT)
                        }
                        promises.push(sendLiveMessage(
                            PubEvent.IMG,
                            {
                                p: data.problemId,
                                id: data.submissionId,
                                mime: payload.mime,
                                b64: payload.b64,
                                ts: imgTs,
                                u: data.additional?.account,
                                l: data.language,
                                t: data.additional?.time ?? Date.now(),
                                c: data.additional?.contestId,
                                i: data.additional?.closed,
                                f: data.additional?.sca,
                                x: data.additional?.codepass,
                                a: data.altLanguage,
                            }
                        ))
                    }
                } catch (e) {
                } finally {
                    try {
                        fs.unlinkSync(full)
                    } catch (e) {
                    }
                }
            }
        }

        let message = '',
            judgedProblemCount = 0,
            specialJudgeUID = '',
            interactorUID = '',
            example,
            score = 0

        const result: (number | number[])[] = [],
            judgeResult: JudgeResultCode[] = [],
            maxMemoryUsage: number[] = [],
            maxTimeUsage: number[] = []
        const problemCount = data.dataSet.reduce(
            (acc, cur) => acc + cur.data.length,
            0
        )
        const ignoreTLE = Boolean(data.ignoreTLE)

        if (build) {
            const buildResult = await execute(
                getUserName(uid),
                build(tmpPath, uid, sourcesName),
                {cwd: tmpPath, ...(imageEnv ? {env: imageEnv} : {})}
            )

            if (buildResult.code) {
                const buildMessage = sanitizeCompileMessage(buildErrorOutputMode === 'merge'
                    ? [buildResult.stdout, buildResult.stderr]
                        .map((output) => output
                            .replaceAll(getTmpPath(uid), '~')
                            .replaceAll(`/${getUserName(uid)}`, '')
                            .replace(/^su: warning: cannot change directory to .*: No such file or directory\s*/gm, '')
                            .trim()
                        )
                        .filter(Boolean)
                        .join('\n')
                    : (buildResult.stderr || buildResult.stdout)
                        .replaceAll(getTmpPath(uid), '~')
                        .replaceAll(`/${getUserName(uid)}`, '')
                ).slice(0, logSize)
                clearTempEnv(uid)
                resolve(createFailureResult(buildMessage || 'Compilation failed'))
                return
            }
        }

        if (data.specialJudge) {
            specialJudgeUID = (await initSpecialJudge(
                data.specialJudge.language,
                await data.specialJudge.source,
                extension
            ))
            if (!specialJudgeUID) {
                resolve(createFailureResult('Initialize special judge failed'))
                return
            }
        }

        if (data.judgeType === JudgeType.InteractiveIOJudge) {
            if (!data.interactor) {
                clearTempEnv(uid)
                resolve(createFailureResult('Interactor is not configured'))
                return
            }
            const interactor = await initInteractor(
                data.interactor.language,
                await data.interactor.source,
                data.static
            )
            interactorUID = interactor.uid
            if (!interactorUID) {
                clearTempEnv(uid)
                resolve(createFailureResult(interactor.message || 'Initialize interactor failed'))
                return
            }
        }

        for (const i of data.static || []) {
            const dest = `${tmpPath}/${i.name}`
            if (!fs.existsSync(path.dirname(dest))) {
                fs.mkdirSync(path.dirname(dest), {recursive: true, mode: 0o777})
            }
            fs.writeFileSync(dest, i.content, {mode: 0o777});
        }


        promises.push(sendLiveMessage(
            PubEvent.JUDGE_PROGRESS,
            createLiveMessagePayload('RUN', 0)
        ))

        if (data.judgeType !== JudgeType.InteractiveIOJudge) {
            await executeJudge(
                {...data, uid, limit: {...data.limit, time: 500}},
                tmpPath,
                executeCommand,
                '',
                imageEnv ? {env: imageEnv} : {}
            )
            drainImages()
        }

        for (const subtaskI in data.dataSet) {
            const subtask = data.dataSet[subtaskI]

            let subtaskResult = [] as any,
                subtaskJudgeResult = [] as JudgeResultCode[],
                subtaskMaxMemoryUsage = 0,
                subtaskMaxTimeUsage = 0,
                prevOk = true;


            if (subtask.prev) {
                const prevRes = subtask.prev.toString().split(',').filter(x => !isNaN(+x)).find((prev) => judgeResult[+prev] !== 'AC');
                if (prevRes) {
                    prevOk = false;
                    subtaskJudgeResult.push(prevRes as JudgeResultCode);
                    subtaskResult.push(0);
                    judgedProblemCount += subtask.data.length;
                }
            }

            if (prevOk) for (const i in subtask.data) {
                const dat = (subtask as CommonDataSet).data[i as any]
                let input: string, output: string
                try {
                    input = (await dat.input).toString()
                    output = (await dat.output).toString()
                } catch (e) {
                    subtaskJudgeResult.push('RE')
                    subtaskResult.push(0)
                    if (!message) message = `Failed to load test data: ${(e as Error)?.message || e}`.slice(0, logSize)
                    if (!example) {
                        example = {
                            case: parseInt(subtaskI),
                            no: parseInt(i),
                            input: '',
                            solution: '',
                        }
                    }
                    promises.push(sendLiveMessage(
                        PubEvent.JUDGE_PROGRESS,
                        createLiveMessagePayload('RUN', ++judgedProblemCount / problemCount)
                    ))
                    if (subtask.scoringType === ScoringType.QUANTIZED || subtask.scoringType === ScoringType.MINIMUM) {
                        judgedProblemCount += subtask.data.length - parseInt(i) - 1
                        break
                    }
                    continue
                }

                if (data.judgeType === JudgeType.InteractiveIOJudge) {
                    const interactiveResult = await runInteractiveJudge({
                        contestantUid: uid,
                        contestantCommand: executeCommand,
                        contestantTmpPath: tmpPath,
                        interactorUid: interactorUID,
                        interactorLanguage: data.interactor!.language,
                        input,
                        answer: output,
                        limit: data.limit,
                        env: imageEnv,
                    })
                    drainImages()

                    subtaskMaxTimeUsage = Math.max(
                        subtaskMaxTimeUsage,
                        interactiveResult.time
                    )
                    subtaskMaxMemoryUsage = Math.max(
                        subtaskMaxMemoryUsage,
                        interactiveResult.memory
                    )

                    const verdict = interactiveResult.verdict
                    subtaskJudgeResult.push(verdict)
                    subtaskResult.push(interactiveResult.score)

                    if (verdict !== 'AC' && !example) {
                        example = {
                            case: parseInt(subtaskI),
                            no: parseInt(i),
                            input: input.slice(0, logSize),
                            solution: output.slice(0, logSize),
                            output: interactiveResult.output.slice(0, logSize),
                        }
                    }
                    if (verdict !== 'AC' && interactiveResult.message && !message) {
                        message = interactiveResult.message.slice(0, logSize)
                    }
                    if (verdict !== 'AC' && (subtask.scoringType === ScoringType.QUANTIZED || subtask.scoringType === ScoringType.MINIMUM)) {
                        judgedProblemCount += subtask.data.length - parseInt(i)
                        break
                    }
                    promises.push(sendLiveMessage(
                        PubEvent.JUDGE_PROGRESS,
                        createLiveMessagePayload('RUN', ++judgedProblemCount / problemCount)
                    ))
                    continue
                }

                const {
                    code,
                    stdout: rOut,
                    stderr,
                    resultType,
                    time: elapsedTime,
                } = await executeJudge(
                    {...data, uid},
                    tmpPath,
                    executeCommand,
                    input,
                    imageEnv ? {env: imageEnv} : {}
                )
                drainImages()
                let stdout = rOut;
                if (data.fileo) {
                    try {
                        stdout = fs.readFileSync(path.join(tmpPath, data.fileo)).toString()
                        fs.unlinkSync(path.join(tmpPath, data.fileo))
                    } catch (e) {
                        stdout = ''
                        console.log(e)
                    }
                }
                const timedOut = resultType === ResultType.timeLimitExceeded
                const runtimeError = !!code && !timedOut
                const {stderr: parsedStderr, memoryKB: memUsage, timeMs: measuredTime} = parseExecuteJudgeStderr(stderr)
                const timeLimit = data.limit?.time || 0
                const time = measuredTime || (timedOut ? (timeLimit || elapsedTime || 0) : (elapsedTime || 0))
                subtaskMaxTimeUsage = Math.max(
                    subtaskMaxTimeUsage,
                    time
                )
                subtaskMaxMemoryUsage = Math.max(
                    subtaskMaxMemoryUsage,
                    memUsage
                )

                if (runtimeError) {
                    const errorMsg = parsedStderr
                    subtaskJudgeResult.push('RE')
                    if (!example) {
                        example = {
                            case: parseInt(subtaskI),
                            no: parseInt(i),
                            input: input.slice(0, logSize),
                            solution: output.slice(0, logSize),
                        }
                    }
                    if (!message)
                        message = errorMsg.replaceAll(getTmpPath(uid), '~').slice(0, logSize)
                    if (subtask.scoringType === ScoringType.QUANTIZED || subtask.scoringType === ScoringType.MINIMUM) {
                        if (subtask.scoringType === ScoringType.MINIMUM) subtaskResult.push(0)
                        judgedProblemCount += subtask.data.length - parseInt(i)
                        break
                    }
                    subtaskResult.push(0)
                    promises.push(sendLiveMessage(
                        PubEvent.JUDGE_PROGRESS,
                        createLiveMessagePayload('RUN', ++judgedProblemCount / problemCount)
                    ))
                } else {
                    const overTime = timedOut || time > timeLimit
                    let verdict: JudgeResultCode = 'WA'
                    let scorePiece = 0
                    let spjScore: number | null = null

                    if (overTime && !ignoreTLE) {
                        if (timedOut && !example) {
                            example = {
                                case: parseInt(subtaskI),
                                no: parseInt(i),
                                input: input.slice(0, logSize),
                                solution: output.slice(0, logSize),
                            }
                        }
                        verdict = 'TLE'
                        subtaskJudgeResult.push(verdict)
                        if (subtask.scoringType === ScoringType.QUANTIZED || subtask.scoringType === ScoringType.MINIMUM) {
                            if (subtask.scoringType === ScoringType.MINIMUM) subtaskResult.push(0)
                            judgedProblemCount += subtask.data.length - parseInt(i)
                            break
                        }
                        subtaskResult.push(0)
                        promises.push(sendLiveMessage(
                            PubEvent.JUDGE_PROGRESS,
                            createLiveMessagePayload('RUN', ++judgedProblemCount / problemCount)
                        ))
                    } else {
                        if (
                            data.judgeType === JudgeType.CommonJudge &&
                            !data?.specialJudge &&
                            isSame(stdout, output)
                        ) {
                            verdict = 'AC'
                            scorePiece = 1
                        } else if (data?.specialJudge) {
                            const spjResult = await runSpecialJudge(
                                specialJudgeUID,
                                data.specialJudge.language,
                                {
                                    input,
                                    solution: output,
                                    output: stdout,
                                }
                            )
                            if (spjResult && spjResult.code === 0) {
                                spjScore = data.specialJudge?.printScore ?
                                    (parseFloat(spjResult.stdout.replaceAll('\n', '').replaceAll('\r', '').trim()) || 0) : 1
                                verdict = spjScore > 0 ? 'AC' : 'WA'
                            }
                        }
                        if (spjScore !== null) scorePiece = spjScore
                        if (overTime && ignoreTLE) {
                            if (spjScore !== null && spjScore < 1) verdict = 'TLE'
                            else if (verdict !== 'AC') verdict = 'TLE'
                        }

                        subtaskJudgeResult.push(verdict)
                        subtaskResult.push(scorePiece)

                        if (verdict !== 'AC' && !example) {
                            example = {
                                case: parseInt(subtaskI),
                                no: parseInt(i),
                                input: input.slice(0, logSize),
                                solution: output.slice(0, logSize),
                                output: stdout.slice(0, logSize),
                            }
                        }
                        if (verdict !== 'AC' && (subtask.scoringType === ScoringType.QUANTIZED || subtask.scoringType === ScoringType.MINIMUM)) {
                            judgedProblemCount += subtask.data.length - parseInt(i)
                            break
                        }
                        promises.push(sendLiveMessage(
                            PubEvent.JUDGE_PROGRESS,
                            createLiveMessagePayload('RUN', ++judgedProblemCount / problemCount)
                        ))
                    }
                }
            }

            subtaskMaxTimeUsage = Math.min(
                subtaskMaxTimeUsage,
                data.limit.time || Infinity
            )
            subtaskMaxMemoryUsage = Math.min(
                subtaskMaxMemoryUsage,
                (data.limit?.memory || Infinity) * 1024
            )
            if (representativeResult(subtaskJudgeResult) === 'TLE') subtaskMaxTimeUsage = data.limit?.time || subtaskMaxTimeUsage

            let currentScore = 0, assignedScore = parseInt(subtask.score as any) || 0
            switch (subtask.scoringType) {
                case ScoringType.QUANTIZED:
                    subtaskResult = subtaskResult.filter((x: number) => x === 1).length;
                    if (subtaskResult === subtask.data.length) currentScore = assignedScore
                    break
                case ScoringType.PROPORTIONAL:
                    currentScore = subtaskResult.reduce((a: number, b: number) => a + b, 0) * assignedScore / subtask.data.length
                    break
                case ScoringType.MINIMUM:
                    currentScore = (subtaskResult.length === subtask.data.length ?
                        subtaskResult.reduce((a: number, b: number) => Math.min(a, b), Infinity) * assignedScore :
                        0)
                    break
                case ScoringType.MAXIMUM:
                    currentScore = subtaskResult.reduce((a: number, b: number) => Math.max(a, b), 0) * assignedScore
                    break
            }
            if (currentScore !== assignedScore) subtaskJudgeResult.push('WA')
            score += currentScore

            result.push(subtaskResult)
            judgeResult.push(representativeResult(subtaskJudgeResult))

            maxTimeUsage.push(subtaskMaxTimeUsage)
            maxMemoryUsage.push(subtaskMaxMemoryUsage)

            promises.push(sendLiveMessage(
                PubEvent.JUDGE_PROGRESS,
                createLiveMessagePayload('RUN', judgedProblemCount / problemCount)
            ))
        }
        clearTempEnv(uid)
        if (data.specialJudge) clearSpecialJudge(specialJudgeUID)
        if (interactorUID) clearInteractor(interactorUID)
        log(data.submissionId, 'Judgement finished')
        const errorCode = detectErrorCode(message)
        let finalReason = representativeResult(judgeResult)
        if (finalReason === 'RE' && errorCode === 'OutOfMemory') finalReason = 'MLE'
        let resultAdditional = data.additional ? {...data.additional} : undefined
        if (storedImages.length) {
            if (resultAdditional) resultAdditional.images = storedImages
            else resultAdditional = {images: storedImages}
        }
        resolve({
            m_reason: finalReason,
            score,
            m_time: Math.max(...maxTimeUsage),
            m_memory: Math.max(...maxMemoryUsage),
            result,
            reason: judgeResult,
            time: maxTimeUsage,
            memory: maxMemoryUsage,
            message,
            e: errorCode,
            example,
            language: data.language,
            altLanguage: data.altLanguage,
            ...(resultAdditional ? {additional: resultAdditional} : {}),
            source: data.source,
            size: sourceSize,
        })
    })
}
