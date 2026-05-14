import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSystemDispatcher } from '../runtime/system-dispatch.js';
import { compile } from './index.js';
export function createNodeHostSystemDispatcher(options) {
    const switchPrefix = path.resolve(options.switchPrefix);
    return createSystemDispatcher({
        toolchainRoot: options.toolchainRoot || switchPrefix,
        commandMap: {
            ocamlc: 'bin/ocamlc',
            ocamlfind: 'bin/ocamlfind',
            js_of_ocaml: 'bin/js_of_ocaml',
            wasm_of_ocaml: 'bin/wasm_of_ocaml'
        },
        runBytecodeTool: async (toolPath, invocation) => {
            const stagingRoot = await mkdtemp(path.join(tmpdir(), 'wasm-of-js-of-ocaml-'));
            try {
                for (const filePath of invocation.fs.listFiles('/')) {
                    const hostPath = path.join(stagingRoot, filePath.slice(1));
                    await mkdir(path.dirname(hostPath), { recursive: true });
                    await writeFile(hostPath, invocation.fs.readFile(filePath));
                }
                const commandPath = path.resolve(toolPath);
                const translatedArgv = invocation.argv.slice(1).map((value) => {
                    if (value === '/workspace' || value === '/tmp') {
                        return path.join(stagingRoot, value.slice(1));
                    }
                    if (value.startsWith('/workspace/') || value.startsWith('/tmp/')) {
                        return path.join(stagingRoot, value.slice(1));
                    }
                    return value;
                });
                const translatedCwd = invocation.cwd === '/workspace' || invocation.cwd === '/tmp'
                    ? path.join(stagingRoot, invocation.cwd.slice(1))
                    : invocation.cwd.startsWith('/workspace/') || invocation.cwd.startsWith('/tmp/')
                        ? path.join(stagingRoot, invocation.cwd.slice(1))
                        : invocation.cwd;
                await mkdir(translatedCwd, { recursive: true });
                const result = await new Promise((resolve, reject) => {
                    const stdoutParts = [];
                    const stderrParts = [];
                    const child = spawn(commandPath, translatedArgv, {
                        cwd: translatedCwd,
                        env: {
                            ...process.env,
                            ...(options.extraEnv || {}),
                            ...invocation.env,
                            PATH: `${options.binaryenBin ? `${options.binaryenBin}:` : ''}${path.join(switchPrefix, 'bin')}:${process.env.PATH || ''}`
                        }
                    });
                    child.stdout.on('data', (chunk) => {
                        stdoutParts.push(Buffer.from(chunk));
                    });
                    child.stderr.on('data', (chunk) => {
                        stderrParts.push(Buffer.from(chunk));
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
                const directories = ['workspace', 'tmp'];
                for (const rootEntry of directories) {
                    const pending = [path.join(stagingRoot, rootEntry)];
                    while (pending.length > 0) {
                        const currentPath = pending.pop();
                        if (!currentPath) {
                            continue;
                        }
                        let entries;
                        try {
                            entries = await readdir(currentPath, { withFileTypes: true });
                        }
                        catch {
                            continue;
                        }
                        for (const entry of entries) {
                            const absolutePath = path.join(currentPath, entry.name);
                            if (entry.isDirectory()) {
                                pending.push(absolutePath);
                                continue;
                            }
                            if (!entry.isFile()) {
                                continue;
                            }
                            const relativePath = path.relative(stagingRoot, absolutePath).replace(/\\/g, '/');
                            invocation.fs.writeFile(`/${relativePath}`, new Uint8Array(await readFile(absolutePath)));
                        }
                    }
                }
                return result;
            }
            finally {
                await rm(stagingRoot, { recursive: true, force: true });
            }
        }
    });
}
export async function compileOnHost(request, options) {
    const compileOptions = {
        toolchainRoot: options.toolchainRoot || path.resolve(options.switchPrefix),
        system: createNodeHostSystemDispatcher({
            switchPrefix: options.switchPrefix,
            toolchainRoot: options.toolchainRoot || path.resolve(options.switchPrefix),
            ...(options.binaryenBin ? { binaryenBin: options.binaryenBin } : {}),
            ...(options.extraEnv ? { extraEnv: options.extraEnv } : {})
        })
    };
    if (options.manifest) {
        compileOptions.manifest = options.manifest;
    }
    if (options.createFileSystem) {
        compileOptions.createFileSystem = options.createFileSystem;
    }
    return await compile(request, compileOptions);
}
