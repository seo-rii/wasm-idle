#!/usr/bin/env node

const {randomUUID} = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {spawnSync} = require('child_process')

const golang = require('../../build/languages/golang.js')

const source = `package main

import (
    "bufio"
    "fmt"
    "os"
    "sort"
)

func main() {
    reader := bufio.NewReader(os.Stdin)
    _, _ = reader.Peek(0)
    fmt.Println(sort.IntsAreSorted([]int{1, 2, 3}))
}
`

function createEnv() {
    const env = {
        ...process.env,
        GOCACHE: '/tmp/gocache',
        GOENV: 'off',
        HOME: '/tmp',
        LANG: 'C.utf8',
        LC_ALL: 'C.utf8',
    }
    delete env.GOROOT
    return env
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

function runStep(label, cmd, args, options) {
    console.log(`\n== ${label} ==`)
    console.log([cmd, ...args].join(' '))
    const result = spawnSync(cmd, args, {
        encoding: 'utf-8',
        stdio: 'pipe',
        ...options,
    })
    console.log(`exitCode: ${result.status}`)
    if (result.signal) {
        console.log(`signal: ${result.signal}`)
    }
    if (result.error) {
        console.log(`error: ${result.error.message}`)
    }
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

async function main() {
    if (golang.init) await golang.init()

    const tmpPath = fs.mkdtempSync(path.join(os.tmpdir(), 'dool-go-judge-'))
    let cleanupUser = ''
    let exitCode = 0
    fs.mkdirSync('/tmp/gocache', {recursive: true})
    try {
        fs.chmodSync('/tmp/gocache', 0o777)
    } catch (e) {
    }

    fs.writeFileSync(path.join(tmpPath, 'Main.go'), source, {mode: 0o644})

    const buildCommand = golang.build(tmpPath, randomUUID(), ['Main.go'], 'Main')
    const runCommand = `ulimit -v ${1024 * 1024}; ulimit -s unlimited; ${path.join(tmpPath, 'Main')}`
    const env = createEnv()
    const getentCommand = resolveCommand('getent')
    const adduserCommand = resolveCommand('adduser')
    const deluserCommand = resolveCommand('deluser')
    const chownCommand = resolveCommand('chown')
    const suCommand = resolveCommand('su')
    const shCommand = resolveCommand('sh')
    const envCommand = resolveCommand('env')
    const idCommand = resolveCommand('id')
    const lsCommand = resolveCommand('ls')
    const readlinkCommand = resolveCommand('readlink')
    const catCommand = resolveCommand('cat')
    const goCommand = buildCommand.match(/(?:^|\s)((?:"[^"]+"|[^"\s]+))\s+build\b/)?.[1] || '/usr/bin/go'
    const diagnoseCommand = [
        'set -e',
        'echo "HOME=${HOME-}"',
        'echo "USER=${USER-}"',
        'echo "PATH=${PATH-}"',
        `echo "id: $(${idCommand})"`,
        `GOROOT="$(${envCommand} -u GOROOT GOENV=off ${goCommand} env GOROOT)"`,
        'echo "GOROOT=$GOROOT"',
        `GOROOT_SRC_REAL="$(${readlinkCommand} -f "$GOROOT/src")"`,
        'echo "GOROOT_SRC_REAL=$GOROOT_SRC_REAL"',
        `${lsCommand} -ld "$GOROOT" "$GOROOT/src" "$GOROOT_SRC_REAL" || true`,
        `${lsCommand} -ld "$GOROOT/src/bufio" "$GOROOT/src/sort" "$GOROOT_SRC_REAL/bufio" "$GOROOT_SRC_REAL/sort" || true`,
        `${envCommand} -u GOROOT GOENV=off ${goCommand} env || true`,
        `if ${envCommand} -u GOROOT GOENV=off ${goCommand} list std >/tmp/dool-go-list-std.out 2>/tmp/dool-go-list-std.err; then LIST_STD_EXIT=0; else LIST_STD_EXIT=$?; fi; echo "go list std exit=$LIST_STD_EXIT"; if [ -s /tmp/dool-go-list-std.err ]; then ${catCommand} /tmp/dool-go-list-std.err; fi`,
    ].join('; ')

    console.log(`tmpPath: ${tmpPath}`)
    console.log(`buildCommand: ${buildCommand}`)
    console.log(`runCommand: ${runCommand}`)

    try {
        if (process.getuid && process.getuid() === 0) {
            cleanupUser = `doolgo${randomUUID().replaceAll('-', '').slice(0, 10)}`
            const hasExecuteGroup = spawnSync(getentCommand, ['group', 'execute'], {stdio: 'ignore'}).status === 0
            const addUserArgs = hasExecuteGroup
                ? ['--ingroup', 'execute', '--gecos', '', '--disabled-password', '--no-create-home', cleanupUser]
                : ['--gecos', '', '--disabled-password', '--no-create-home', cleanupUser]
            const addUserResult = runStep('adduser', adduserCommand, addUserArgs)
            if (addUserResult.status !== 0) return addUserResult.status || 1

            const chownResult = runStep('chown', chownCommand, [cleanupUser, tmpPath])
            if (chownResult.status !== 0) return chownResult.status || 1

            const buildResult = runStep('build (root -> su)', suCommand, ['-m', cleanupUser, '-c', buildCommand], {cwd: tmpPath, env})
            if (buildResult.status !== 0) {
                runStep('diagnose go stdlib (root -> su)', suCommand, ['-m', cleanupUser, '-c', diagnoseCommand], {cwd: tmpPath, env})
                return buildResult.status || 1
            }

            const runResult = runStep('run (root -> su)', suCommand, ['-m', cleanupUser, '-c', runCommand], {cwd: tmpPath, env})
            return runResult.status || 0
        }

        console.log('root가 아니라 adduser/su 재현은 생략하고 현재 사용자로 동일 build/run 명령만 검사합니다.')
        const buildResult = runStep('build (current user)', shCommand, ['-c', buildCommand], {cwd: tmpPath, env})
        if (buildResult.status !== 0) {
            runStep('diagnose go stdlib (current user)', shCommand, ['-c', diagnoseCommand], {cwd: tmpPath, env})
            return buildResult.status || 1
        }

        const runResult = runStep('run (current user)', shCommand, ['-c', runCommand], {cwd: tmpPath, env})
        return runResult.status || 0
    } finally {
        if (cleanupUser) {
            runStep('deluser', deluserCommand, [cleanupUser])
        }
        fs.rmSync(tmpPath, {recursive: true, force: true})
    }
}

main().catch((error) => {
    console.error(error)
    process.exit(1)
}).then((code) => {
    process.exit(code || 0)
})
