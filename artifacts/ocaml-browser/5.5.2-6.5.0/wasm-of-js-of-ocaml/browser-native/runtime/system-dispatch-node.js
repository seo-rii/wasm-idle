import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
async function walkFiles(rootDir) {
    const files = [];
    for (const entry of await readdir(rootDir, { withFileTypes: true })) {
        const absolutePath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await walkFiles(absolutePath)));
            continue;
        }
        files.push(absolutePath);
    }
    return files.sort((left, right) => left.localeCompare(right));
}
export function createNodeSystemDispatcher(options = {}) {
    return async (argv, context) => {
        if (argv.length === 0) {
            throw new Error('node system dispatcher requires a command name');
        }
        const commandName = argv[0];
        if (commandName !== 'ocamlc' &&
            commandName !== 'ocamlfind' &&
            commandName !== 'js_of_ocaml' &&
            commandName !== 'wasm_of_ocaml') {
            throw new Error(`unsupported subprocess: ${commandName}`);
        }
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wasm-of-js-of-ocaml-'));
        const workspaceRoot = path.join(tempRoot, 'workspace');
        const tempDirRoot = path.join(tempRoot, 'tmp');
        await mkdir(workspaceRoot, { recursive: true });
        await mkdir(tempDirRoot, { recursive: true });
        for (const filePath of context.fs.listFiles('/workspace')) {
            const relativePath = path.relative('/workspace', filePath);
            const targetPath = path.join(workspaceRoot, relativePath);
            await mkdir(path.dirname(targetPath), { recursive: true });
            await writeFile(targetPath, context.fs.readFile(filePath));
        }
        for (const filePath of context.fs.listFiles('/tmp')) {
            const relativePath = path.relative('/tmp', filePath);
            const targetPath = path.join(tempDirRoot, relativePath);
            await mkdir(path.dirname(targetPath), { recursive: true });
            await writeFile(targetPath, context.fs.readFile(filePath));
        }
        const translatePath = (value) => {
            if (value === '/workspace') {
                return workspaceRoot;
            }
            if (value.startsWith('/workspace/')) {
                return path.join(workspaceRoot, value.slice('/workspace/'.length));
            }
            if (value === '/tmp') {
                return tempDirRoot;
            }
            if (value.startsWith('/tmp/')) {
                return path.join(tempDirRoot, value.slice('/tmp/'.length));
            }
            if (options.toolchainRootOnHost && value === '/toolchain') {
                return options.toolchainRootOnHost;
            }
            if (options.toolchainRootOnHost && value.startsWith('/toolchain/')) {
                return path.join(options.toolchainRootOnHost, value.slice('/toolchain/'.length));
            }
            return value;
        };
        const result = await new Promise((resolve, reject) => {
            const stdoutParts = [];
            const stderrParts = [];
            const child = spawn(options.commands?.[commandName] || commandName, argv.slice(1).map(translatePath), {
                cwd: translatePath(context.cwd),
                env: {
                    ...process.env,
                    TMPDIR: tempDirRoot,
                    ...(options.env || {}),
                    ...(context.env || {})
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            child.stdout.on('data', (chunk) => {
                stdoutParts.push(chunk);
            });
            child.stderr.on('data', (chunk) => {
                stderrParts.push(chunk);
            });
            child.on('error', reject);
            child.on('close', (code) => {
                resolve({
                    exitCode: code ?? 1,
                    stdout: Buffer.concat(stdoutParts).toString('utf8'),
                    stderr: Buffer.concat(stderrParts).toString('utf8')
                });
            });
        });
        for (const absolutePath of await walkFiles(workspaceRoot)) {
            const relativePath = path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/');
            context.fs.writeFile(`/workspace/${relativePath}`, new Uint8Array(await readFile(absolutePath)));
        }
        for (const absolutePath of await walkFiles(tempDirRoot)) {
            const relativePath = path.relative(tempDirRoot, absolutePath).replace(/\\/g, '/');
            context.fs.writeFile(`/tmp/${relativePath}`, new Uint8Array(await readFile(absolutePath)));
        }
        if (!options.keepTempDirs) {
            await rm(tempRoot, { recursive: true, force: true });
        }
        return result;
    };
}
