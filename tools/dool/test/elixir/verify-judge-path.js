#!/usr/bin/env node

const {randomUUID} = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')

const elixir = require('../../build/languages/elixir.js')

const source = fs.readFileSync(path.join(__dirname, 'test.exs'), 'utf-8')
const expectedOutput = '241330\n2413.3\n821.6'
const testInput = [
    '100',
    '1362',
    '1262',
    '1374',
    '1266',
    '1829',
    '3532',
    '2724',
    '3775',
    '3975',
    '1821',
    '2087',
    '3574',
    '3240',
    '1396',
    '1240',
    '2849',
    '3177',
    '1101',
    '1828',
    '2732',
    '1383',
    '1584',
    '1238',
    '1531',
    '1978',
    '2487',
    '3354',
    '3056',
    '1291',
    '3789',
    '1674',
    '3126',
    '1523',
    '3600',
    '3555',
    '3027',
    '1703',
    '2530',
    '2814',
    '1447',
    '2683',
    '3013',
    '2454',
    '2198',
    '2651',
    '1746',
    '1153',
    '1064',
    '3741',
    '2574',
    '1893',
    '1461',
    '2924',
    '3507',
    '1859',
    '2285',
    '2077',
    '3445',
    '2342',
    '3031',
    '2144',
    '3353',
    '2495',
    '1862',
    '1720',
    '2306',
    '1533',
    '1053',
    '1662',
    '1160',
    '2677',
    '2994',
    '3244',
    '2733',
    '2619',
    '3123',
    '1173',
    '3519',
    '1841',
    '3245',
    '1435',
    '2328',
    '1594',
    '3314',
    '3346',
    '2710',
    '3237',
    '1960',
    '2910',
    '3747',
    '3015',
    '1973',
    '2405',
    '3837',
    '3220',
    '2530',
    '2105',
    '2664',
    '2104',
    '3505',
    '',
].join('\n')

function createEnv(userName) {
    return {
        ...process.env,
        HOME: '/tmp',
        LANG: 'C.utf8',
        LC_ALL: 'C.utf8',
        LOGNAME: userName,
        USER: userName,
    }
}

function resolveCommand(name) {
    const candidates = [
        path.join('/usr/local/sbin', name),
        path.join('/usr/local/bin', name),
        path.join('/usr/sbin', name),
        path.join('/usr/bin', name),
        path.join('/sbin', name),
        path.join('/bin', name),
    ]
    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.X_OK)
            return candidate
        } catch (e) {
        }
    }
    return name
}

function runStep(label, cmd, args, options = {}) {
    console.log(`\n== ${label} ==`)
    console.log([cmd, ...args].join(' '))
    const result = spawnSync(cmd, args, {
        encoding: 'utf-8',
        stdio: 'pipe',
        ...options,
    })
    console.log(`exitCode: ${result.status}`)
    if (result.signal) console.log(`signal: ${result.signal}`)
    if (result.error) console.log(`error: ${result.error.message}`)
    if (result.stdout) {
        console.log('-- stdout --')
        process.stdout.write(result.stdout)
    }
    if (result.stderr) {
        console.log('-- stderr --')
        process.stderr.write(result.stderr)
    }
    return result
}

function runExactJudgePath(executor, cwd, env, runCommand, iterations) {
    for (let i = 0; i < iterations; i++) {
        const runResult = runStep(`run #${i + 1}`, ...executor(runCommand), {
            cwd,
            env,
            input: testInput,
        })
        const normalized = (runResult.stdout || '').replaceAll('\r', '').trim()
        if (runResult.status !== 0) return runResult.status || 1
        if (normalized !== expectedOutput) {
            console.error(`unexpected stdout on iteration ${i + 1}: ${JSON.stringify(runResult.stdout || '')}`)
            return 1
        }
    }
    return 0
}

async function main() {
    if (elixir.init) await elixir.init()

    const tmpPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dool-elixir-judge-'))
    let cleanupUser = ''
    try {
        fs.writeFileSync(path.join(tmpPath, 'Main.exs'), source, {mode: 0o644})

        const buildCommand = elixir.build(tmpPath, randomUUID(), ['Main.exs'], 'Main')
        const runCommand =
            `ulimit -v ${elixir.getMemoryLimit(32) * 1024};` +
            'ulimit -s unlimited;' +
            'ts=$(date +%s%N);' +
            `/usr/bin/time -f "__DOOL_MAXRSS_KB__=%M" ${elixir.getExecuteCommand(tmpPath, randomUUID(), 'Main')};` +
            'ec=$?;' +
            'tt=$((($(date +%s%N) - $ts)/1000000));' +
            'echo "__DOOL_TIME_MS__=$tt" >&2;' +
            'exit $ec'

        const getentCommand = resolveCommand('getent')
        const addgroupCommand = resolveCommand('addgroup')
        const adduserCommand = resolveCommand('adduser')
        const deluserCommand = resolveCommand('deluser')
        const chownCommand = resolveCommand('chown')
        const suCommand = resolveCommand('su')
        const shCommand = resolveCommand('sh')
        const iterations = 40

        console.log(`tmpPath: ${tmpPath}`)
        console.log(`buildCommand: ${buildCommand}`)
        console.log(`runCommand: ${runCommand}`)

        if (process.getuid && process.getuid() === 0) {
            cleanupUser = `d${randomUUID().replaceAll('-', '').slice(0, 10)}`
            const hasExecuteGroup =
                spawnSync(getentCommand, ['group', 'execute'], {stdio: 'ignore'}).status === 0
            if (!hasExecuteGroup) {
                const addGroupResult = runStep('addgroup execute', addgroupCommand, ['execute'])
                if (addGroupResult.status !== 0) return addGroupResult.status || 1
            }
            const addUserResult = runStep(
                'adduser',
                adduserCommand,
                ['--ingroup', 'execute', '--gecos', '', '--disabled-password', '--no-create-home', cleanupUser]
            )
            if (addUserResult.status !== 0) return addUserResult.status || 1

            const chownResult = runStep('chown', chownCommand, [cleanupUser, tmpPath])
            if (chownResult.status !== 0) return chownResult.status || 1

            const env = createEnv(cleanupUser)
            const buildResult = runStep(
                'build (root -> su)',
                suCommand,
                ['-m', cleanupUser, '-c', buildCommand],
                {cwd: tmpPath, env}
            )
            if (buildResult.status !== 0) return buildResult.status || 1

            return runExactJudgePath(
                (command) => [suCommand, ['-m', cleanupUser, '-c', command]],
                tmpPath,
                env,
                runCommand,
                iterations
            )
        }

        console.log('root가 아니라 adduser/su 재현은 생략하고 현재 사용자로 동일 build/run 명령만 검사합니다.')
        const buildResult = runStep('build (current user)', shCommand, ['-c', buildCommand], {
            cwd: tmpPath,
            env: createEnv(process.env.USER || 'unknown'),
        })
        if (buildResult.status !== 0) return buildResult.status || 1

        return runExactJudgePath(
            (command) => [shCommand, ['-c', command]],
            tmpPath,
            createEnv(process.env.USER || 'unknown'),
            runCommand,
            iterations
        )
    } finally {
        if (cleanupUser) runStep('deluser', resolveCommand('deluser'), [cleanupUser])
        fs.rmSync(tmpPath, {recursive: true, force: true})
    }
}

main()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .then((code) => {
        process.exit(code || 0)
    })
