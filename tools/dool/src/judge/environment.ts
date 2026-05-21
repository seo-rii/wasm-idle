import fs from 'fs'
import {execSync} from 'child_process'
import base32 from 'hi-base32'
import type {SourceFile} from '../types/source'
import type {UID} from '../types/execute'
import * as path from 'path'

const imgHookCandidates = [
    path.join(__dirname, '../../res/sitecustomize_img.py'),
    path.join(process.cwd(), 'res/sitecustomize_img.py'),
    path.join(process.cwd(), 'build/res/sitecustomize_img.py')
]

let imgHookPath = ''
for (const candidate of imgHookCandidates) {
    if (fs.existsSync(candidate)) {
        imgHookPath = candidate
        break
    }
}

export function getUserName(uid: UID) {
    return (
        'p_' +
        base32
            .encode(Buffer.from(uid.replaceAll('-', ''), 'hex'))
            .replaceAll('=', '')
            .toLowerCase()
    )
}

export function getTmpPath(uid: UID) {
    return '/tmp/DOOL/' + uid
}

export function initTempEnv(
    uid: UID,
    sources: SourceFile[],
    extension: string,
    imageCaptureEnabled = false
) {
    const tmpPath = getTmpPath(uid)
    const sourcesName = []
    execSync(
        `adduser --ingroup execute --disabled-password --no-create-home ${getUserName(
            uid
        )}`,
        {
            stdio: 'ignore',
        }
    )
    fs.mkdirSync(tmpPath, {recursive: true})
    execSync(`chown ${getUserName(uid)} ${tmpPath}`, {stdio: 'ignore'})

    for (const i of sources) {
        const dest = tmpPath + '/' + i.name
        if (!fs.existsSync(path.dirname(dest))) {
            fs.mkdirSync(path.dirname(dest), {recursive: true, mode: 0o777})
        }
        fs.writeFileSync(dest, i.source, {mode: 0o777})
        if (i.name.includes('.' + extension)) {
            sourcesName.push(i.name)
        }
    }

    if (extension === 'py' && imageCaptureEnabled) {
        try {
            const target = path.join(tmpPath, 'sitecustomize.py')
            if (!fs.existsSync(target) && fs.existsSync(imgHookPath)) {
                fs.copyFileSync(imgHookPath, target)
                fs.chmodSync(target, 0o644)
            }
            const imgDir = path.join(tmpPath, '__img__')
            fs.mkdirSync(imgDir, {recursive: true, mode: 0o777})
            try {
                fs.chmodSync(imgDir, 0o777)
                execSync(`chown ${getUserName(uid)} ${imgDir}`, {stdio: 'ignore'})
            } catch (e) {
            }
        } catch (e) {
        }
    }
    return {tmpPath, sourcesName}
}

export function clearTempEnv(uid: UID) {
    try {
        const tmpPath = getTmpPath(uid)
        fs.rmSync(tmpPath, {recursive: true})
        execSync(`deluser ${getUserName(uid)}`, {stdio: 'ignore'})
    } catch (e) {

    }
}
