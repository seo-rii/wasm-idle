import {spawn} from 'child_process'
import {performance} from 'perf_hooks'
import {ExecuteLimit, ExecuteOption, ExecuteRequest, ExecuteResult, ResultType,} from '../types/execute'
import {getTmpPath, getUserName} from './environment'

const JUDGE_MEMORY_MARKER = '__DOOL_MAXRSS_KB__='
const JUDGE_CPU_TIME_MARKER = '__DOOL_CPU_TIME_SECONDS__='
const JUDGE_LEGACY_TIME_MARKER = '__DOOL_TIME_MS__='
const JUDGE_NOISE_LINE = /^(Command exited with non-zero status \d+|Command terminated by signal \d+)$/

const parseMetricValue = (line: string, marker: string) => {
    const value = parseInt(line.slice(marker.length).trim(), 10)
    if (!Number.isFinite(value) || value < 0) return 0
    return value
}

const parseCpuTimeValue = (line: string) => {
    const parts = line.slice(JUDGE_CPU_TIME_MARKER.length).trim().split(/\s+/)
    const user = Number.parseFloat(parts[0] || '0')
    const system = Number.parseFloat(parts[1] || '0')
    if (!Number.isFinite(user) || user < 0 || !Number.isFinite(system) || system < 0) return 0
    return Math.round((user + system) * 1000)
}

export function parseExecuteJudgeStderr(stderr: string) {
    const cleaned: string[] = []
    let memoryKB = 0
    let timeMs = 0

    for (const rawLine of stderr.split('\n')) {
        const line = rawLine.trim()
        if (line.startsWith(JUDGE_MEMORY_MARKER)) {
            memoryKB = parseMetricValue(line, JUDGE_MEMORY_MARKER)
            continue
        }
        if (line.startsWith(JUDGE_CPU_TIME_MARKER)) {
            timeMs = parseCpuTimeValue(line)
            continue
        }
        if (line.startsWith(JUDGE_LEGACY_TIME_MARKER)) {
            timeMs = parseMetricValue(line, JUDGE_LEGACY_TIME_MARKER)
            continue
        }
        if (JUDGE_NOISE_LINE.test(line)) continue
        cleaned.push(rawLine)
    }
    while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop()

    return {
        stderr: cleaned.join('\n'),
        memoryKB,
        timeMs
    }
}

export async function abort(pid: number | undefined, userName: string) {
    if (!pid) return
    const {stdout} = await execute(`${userName}`, 'ps -o pid= --ppid ' + pid)
    const pids = stdout.split('\n').map((line: string) => parseInt(line.trim()))
    for (const cpid of pids) {
        if (cpid) {
            try {
                await abort(cpid, userName)
            } catch (e) {
            }
        }
    }
    try {
        await execute(`${userName}`, `pkill -9 -P ${pid}`)
    } catch (e) {
    }
}

export function accurateTimeout(timeout: number, onTimeout: () => void) {
    const target = performance.now() + timeout
    const checkpoints = [-10, -3, -1, 0, 3].map((offset) => target + offset)

    let timer: NodeJS.Timeout | null = null
    let immediate: NodeJS.Immediate | null = null
    let cancelled = false

    const clearTimers = () => {
        cancelled = true
        if (timer) {
            clearTimeout(timer)
            timer = null
        }
        if (immediate) {
            clearImmediate(immediate)
            immediate = null
        }
    }

    const tick = (checkpointIndex = 0) => {
        if (cancelled) return
        timer = null
        immediate = null

        const now = performance.now()
        const delta = target - now

        if (delta <= 1) {
            clearTimers()
            onTimeout()
            return
        }

        for (let i = checkpointIndex; i < checkpoints.length; i++) {
            const wait = checkpoints[i] - now
            if (wait > 0) {
                timer = setTimeout(() => tick(i + 1), wait)
                return
            }
        }

        if (delta > 0) {
            if (delta <= 3) {
                immediate = setImmediate(() => tick(0))
            } else {
                timer = setTimeout(() => tick(0), delta)
            }
            return
        }

        clearTimers()
        onTimeout()
    }

    tick()

    return clearTimers
}

export function execute(
    userName: string,
    exePath: string,
    option: ExecuteOption = {},
    recursive = 0
) {
    option = Object.assign({input: '', timeout: 0, cwd: ''}, option)
    return new Promise<ExecuteResult>(async (resolve) => {
        if (recursive > 3) {
            resolve({
                resultType: ResultType.stdioError,
                stdout: '',
                stderr: '',
                code: -1,
                time: 0
            })
            return
        }

        let startTime = performance.now()

        try {
            const baseEnv: Record<string, string | undefined> = {
                PATH: process.env.PATH,
                HOME: '/tmp',
                LOGNAME: userName,
                USER: userName,
                RUSTUP_HOME: '/cargo',
                CARGO_HOME: '/cargo',
                // Let the installed go binary resolve its own GOROOT. A stale parent
                // GOROOT breaks std package lookup on distro-packaged toolchains.
                GOCACHE: '/tmp/gocache',
                GOENV: 'off',
                KONAN_USER_HOME: process.env.KONAN_USER_HOME,
                KONAN_DATA_DIR: process.env.KONAN_DATA_DIR,
                ...(process.env.GOPATH ? {GOPATH: process.env.GOPATH} : {}),
                LANG: 'C.utf8',
                LC_ALL: 'C.utf8',
            }
            const overrideEnv = option.env || {}
            const env: Record<string, string> = {}
            for (const [key, value] of Object.entries({...baseEnv, ...overrideEnv})) {
                if (value !== undefined) env[key] = value
            }

            const child = spawn(`su`, ['-m', userName, '-c', exePath], {
                stdio: ['pipe', 'pipe', 'pipe'],
                ...(option.cwd ? {cwd: option.cwd} : {}),
                detached: true,
                env,
            })

            if (!child.stdin) throw new Error('stdin is null')
            child.stdin.on('error', async () => {
                if (!timeouted) {
                    timeouted = true
                    await abort(child.pid, userName)
                    resolve(await execute(userName, exePath, option, recursive + 1))
                }
            })
            child.on('error', async () => {
                if (!timeouted) {
                    timeouted = true
                    await abort(child.pid, userName)
                    resolve(await execute(userName, exePath, option, recursive + 1))
                }
            })
            child.on('exit', function () {
                child.kill()
            })

            let stdout = '',
                stderr = ''

            let clearAccurateTimer: (() => void) | undefined,
                timeouted = false

            if (option.timeout)
                clearAccurateTimer = accurateTimeout(option.timeout, () => {
                    if (timeouted) return;
                    timeouted = true
                    abort(child.pid, userName).catch(() => {
                    })
                })

            child.stdin.write(option.input || '')
            child.stdin.end()

            child.stdout?.on('data', (data: any) => {
                stdout += data
            })

            child.stderr?.on('data', (data: any) => {
                stderr += data
            })

            child.on('close', (code: number) => {
                const elapsedTime = Math.max(0, Math.round(performance.now() - startTime))
                if (clearAccurateTimer) clearAccurateTimer()
                if (timeouted) {
                    resolve({
                        resultType: ResultType.timeLimitExceeded,
                        code: -1,
                        stdout,
                        stderr,
                        time: elapsedTime
                    })
                } else {
                    resolve({
                        resultType: ResultType.normal,
                        code: code || 0,
                        stdout,
                        stderr: stderr,
                        time: elapsedTime
                    })
                }
            })
            startTime = performance.now()
        } catch (e) {
            resolve({
                resultType: ResultType.stdioError,
                code: -1,
                stdout: '',
                stderr: '',
                time: 0
            })
        }
    })
}

export function getLimitString(limit: ExecuteLimit, command: string) {
    const memoryLimit = limit.memory ? `ulimit -v ${limit.memory * 1024};` : ''
    const stackLimit = 'ulimit -s unlimited;'
    return `${memoryLimit}${stackLimit}${command}`
}

export function getMeasuredCommand(command: string) {
    return `/usr/bin/time -f "${JUDGE_MEMORY_MARKER}%M\\n${JUDGE_CPU_TIME_MARKER}%U %S" ${command};ec=$?;exit $ec`
}

export function executeJudge(
    data: ExecuteRequest,
    root: string,
    exePath: string,
    input: string,
    option: ExecuteOption = {}
) {
    return execute(
        getUserName(data.uid),
        getLimitString(
            {
                memory: data.limit.memory,
            },
            getMeasuredCommand(exePath)
        ),
        {input, timeout: data.limit.time || 0, cwd: getTmpPath(data.uid), ...option}
    )
}
