import Clang from '$lib/playground/clang'
import Python from '$lib/playground/python'
import type Sandbox from '$lib/playground/sandbox'

const sandboxCache: { [key: string]: (Sandbox | undefined) } = {}

export const supportedLanguages = ['PYTHON3', 'PYPY3', 'C', 'CPP']

export async function load(language: string) {
    if (sandboxCache[language]) return sandboxCache[language];
    let sandbox;
    switch (language) {
        case 'PYTHON3':
        case 'PYTHON':
        case 'PYPY3':
            sandbox = new Python();
            break
        case 'C':
        case 'CPP':
            sandbox = new Clang();
    }
    sandboxCache[language] = sandbox
    if (sandbox) {
        if (language === 'PYTHON3') sandboxCache['PYPY3'] = sandboxCache['PYTHON'] = sandbox['PYTHON3'];
        if (language === 'PYTHON') sandboxCache['PYTHON3'] = sandboxCache['PYPY3'] = sandbox['PYTHON'];
        if (language === 'PYPY3') sandboxCache['PYTHON3'] = sandboxCache['PYTHON'] = sandbox['PYPY3'];
        if (language === 'C') sandboxCache['C'] = sandbox['C'];
        if (language === 'CPP') sandboxCache['CPP'] = sandbox['C'];
    }
    return sandbox;
}
