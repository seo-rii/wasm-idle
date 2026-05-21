#!/usr/bin/env node

const {randomUUID} = require('crypto')
const fs = require('fs')
const Module = require('module')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')
const ts = require('typescript')

const csharp = require('../../build/languages/csharp.js')

const {detectErrorCode, sanitizeCompileMessage} = (() => {
    const utilPath = path.join(__dirname, '../../src/judge/util.ts')
    const compiled = ts.transpileModule(fs.readFileSync(utilPath, 'utf-8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText
    const loadedModule = {exports: {}}
    const wrapped = new Function('require', 'module', 'exports', '__filename', '__dirname', compiled)
    wrapped(Module.createRequire(utilPath), loadedModule, loadedModule.exports, utilPath, path.dirname(utilPath))
    return loadedModule.exports
})()

const bannedTokens = [
    'Welcome to .NET',
    'Installed an ASP.NET Core HTTPS development certificate.',
    'The template "Console App" was created successfully.',
    'An issue was encountered verifying workloads.',
]

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

function verifyCompileError(result) {
    if (result.status === 0) {
        console.error('expected compile failure, but build succeeded')
        return 1
    }
    const message = sanitizeCompileMessage(`${result.stdout || ''}\n${result.stderr || ''}`)
    for (const token of bannedTokens) {
        if (message.includes(token)) {
            console.error(`unexpected dotnet banner text in compile error output: ${token}`)
            return 1
        }
    }
    if (!message.includes('member names cannot be the same as their enclosing type')) {
        console.error('expected Main name conflict compiler message in build output')
        return 1
    }
    const errorCode = detectErrorCode(message)
    if (errorCode !== 'MainNameConflict') {
        console.error(`unexpected compile error code: ${errorCode || '<undefined>'}`)
        return 1
    }
    return 0
}

async function main() {
    if (csharp.init) await csharp.init()

    const tmpPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dool-csharp-compile-error-'))
    let cleanupUser = ''
    try {
        fs.writeFileSync(
            path.join(tmpPath, 'Main.cs'),
            fs.readFileSync(path.join(__dirname, 'main_name_conflict.cs'), 'utf-8'),
            {mode: 0o644}
        )

        const buildCommand = csharp.build(tmpPath, randomUUID(), ['Main.cs'], 'Main')

        const getentCommand = resolveCommand('getent')
        const addgroupCommand = resolveCommand('addgroup')
        const adduserCommand = resolveCommand('adduser')
        const chownCommand = resolveCommand('chown')
        const suCommand = resolveCommand('su')
        const shCommand = resolveCommand('sh')

        console.log(`tmpPath: ${tmpPath}`)
        console.log(`buildCommand: ${buildCommand}`)

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
            return verifyCompileError(
                runStep('build compile error (root -> su)', suCommand, ['-m', cleanupUser, '-c', buildCommand], {
                    cwd: tmpPath,
                    env,
                })
            )
        }

        console.log('root가 아니라 adduser/su 재현은 생략하고 현재 사용자로 동일 build 명령만 검사합니다.')
        const env = createEnv(process.env.USER || 'unknown')
        return verifyCompileError(
            runStep('build compile error (current user)', shCommand, ['-c', buildCommand], {
                cwd: tmpPath,
                env,
            })
        )
    } finally {
        if (cleanupUser) runStep('deluser', resolveCommand('deluser'), [cleanupUser])
        fs.rmSync(tmpPath, {recursive: true, force: true})
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
}).then((code) => {
    process.exit(code || 0)
})
