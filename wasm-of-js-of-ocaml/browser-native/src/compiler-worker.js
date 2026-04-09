import { MemoryFileSystem } from '../runtime/fs/memory-fs.js';
export function createCompileHandler(options = {}) {
    return async (request, manifest) => {
        const fs = options.createFileSystem ? options.createFileSystem() : new MemoryFileSystem();
        const stdoutParts = [];
        const stderrParts = [];
        const diagnostics = [];
        const toolchainRoot = (options.toolchainRoot || manifest?.toolchainRoot || '/toolchain').replace(/\/+$/, '');
        const inputEntries = Object.entries(request.files || {});
        if (inputEntries.length === 0) {
            return {
                success: false,
                stdout: '',
                stderr: 'compile request must include at least one source file',
                diagnostics: [
                    {
                        severity: 'error',
                        message: 'compile request must include at least one source file'
                    }
                ],
                artifacts: []
            };
        }
        if (!(request.entry in request.files)) {
            return {
                success: false,
                stdout: '',
                stderr: `entry file is missing from request.files: ${request.entry}`,
                diagnostics: [
                    {
                        file: request.entry,
                        severity: 'error',
                        message: 'entry file is missing from request.files'
                    }
                ],
                artifacts: []
            };
        }
        const normalizedEntries = inputEntries
            .map(([filePath, source]) => {
            const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
            if (!normalized || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
                throw new Error(`invalid workspace file path: ${filePath}`);
            }
            return [normalized, source];
        })
            .sort(([left], [right]) => left.localeCompare(right));
        const entry = request.entry.replace(/\\/g, '/').replace(/^\/+/, '');
        const packages = [...new Set((request.packages || []).map((value) => value.trim()).filter(Boolean))];
        const entryFileName = entry.split('/').at(-1) || entry;
        const entryStem = entryFileName.replace(/\.(ml|mli)$/, '') || 'program';
        const effectsMode = request.effectsMode || 'cps';
        fs.mkdirp('/workspace');
        fs.mkdirp('/workspace/_build');
        for (const [filePath, source] of normalizedEntries) {
            fs.writeText(`/workspace/${filePath}`, source);
        }
        const compilePlan = [];
        const sourceArgs = normalizedEntries.map(([filePath]) => `/workspace/${filePath}`);
        const bytecodeOutput = `/workspace/_build/${entryStem}.byte`;
        if (packages.length > 0) {
            compilePlan.push({
                stage: 'ocamlc',
                cwd: '/workspace',
                argv: [
                    'ocamlfind',
                    'ocamlc',
                    '-package',
                    packages.join(','),
                    '-linkpkg',
                    '-o',
                    bytecodeOutput,
                    ...sourceArgs
                ]
            });
        }
        else {
            compilePlan.push({
                stage: 'ocamlc',
                cwd: '/workspace',
                argv: ['ocamlc', '-o', bytecodeOutput, ...sourceArgs]
            });
        }
        const jsOutput = `/workspace/_build/${entryStem}.js`;
        if (request.target === 'js') {
            compilePlan.push({
                stage: 'js_of_ocaml',
                cwd: '/workspace',
                argv: ['js_of_ocaml', bytecodeOutput, '-o', jsOutput]
            });
        }
        else {
            compilePlan.push({
                stage: 'wasm_of_ocaml',
                cwd: '/workspace',
                argv: [
                    'wasm_of_ocaml',
                    bytecodeOutput,
                    '-o',
                    jsOutput,
                    '--effects',
                    effectsMode
                ]
            });
            if (request.sourcemap) {
                diagnostics.push({
                    file: entry,
                    severity: 'warning',
                    message: 'browser preset keeps wasm_of_ocaml sourcemaps disabled during bring-up'
                });
                stderrParts.push('warning: browser preset keeps wasm_of_ocaml sourcemaps disabled during bring-up');
            }
        }
        const compilePlanArtifact = {
            path: '/workspace/_build/compile-plan.json',
            kind: 'text',
            data: JSON.stringify({
                entry,
                target: request.target,
                packages,
                effectsMode,
                sourcemap: !!request.sourcemap,
                toolchainRoot,
                commands: compilePlan
            }, null, 2)
        };
        fs.writeText(compilePlanArtifact.path, typeof compilePlanArtifact.data === 'string'
            ? compilePlanArtifact.data
            : new TextDecoder().decode(compilePlanArtifact.data));
        if (!options.system) {
            stderrParts.push('compile pipeline is scaffolded, but no bytecode tool runner is configured yet');
            return {
                success: false,
                stdout: stdoutParts.join(''),
                stderr: stderrParts.join('\n'),
                diagnostics,
                artifacts: [compilePlanArtifact]
            };
        }
        for (const command of compilePlan) {
            const result = await options.system(command.argv, {
                cwd: command.cwd,
                env: {
                    TOOLCHAIN_ROOT: toolchainRoot,
                    WASM_OF_JS_OF_OCAML_EFFECTS: effectsMode
                },
                fs
            });
            if (result.stdout) {
                stdoutParts.push(result.stdout);
            }
            if (result.stderr) {
                stderrParts.push(result.stderr);
            }
            if (result.exitCode !== 0) {
                const combinedStderr = stderrParts.join('\n');
                const stderrLines = combinedStderr.split('\n');
                for (let lineIndex = 0; lineIndex < stderrLines.length; lineIndex += 1) {
                    const currentLine = stderrLines[lineIndex] || '';
                    const locationMatch = currentLine.match(/^File "([^"]+)", line (\d+), characters (\d+)-(\d+):$/);
                    if (!locationMatch) {
                        continue;
                    }
                    const rawFile = (locationMatch[1] || '').replace(/\\/g, '/');
                    let file = rawFile;
                    if (rawFile.includes('/workspace/')) {
                        file = rawFile.split('/workspace/').at(-1) || rawFile;
                    }
                    else {
                        const matchedWorkspaceFile = normalizedEntries
                            .map(([filePath]) => filePath)
                            .find((filePath) => rawFile === filePath ||
                            rawFile.endsWith(`/${filePath}`) ||
                            rawFile.endsWith(`/workspace/${filePath}`));
                        if (matchedWorkspaceFile) {
                            file = matchedWorkspaceFile;
                        }
                    }
                    const messageLines = [];
                    let cursor = lineIndex + 1;
                    for (; cursor < stderrLines.length; cursor += 1) {
                        const messageLine = stderrLines[cursor] || '';
                        if (/^File "([^"]+)", line (\d+), characters (\d+)-(\d+):$/.test(messageLine)) {
                            break;
                        }
                        if (!messageLine.trim() && messageLines.length === 0) {
                            continue;
                        }
                        if (!messageLine.trim()) {
                            break;
                        }
                        messageLines.push(messageLine.trim());
                    }
                    lineIndex = cursor - 1;
                    const primaryMessageIndex = messageLines.findIndex((messageLine) => messageLine.startsWith('Error:') || messageLine.startsWith('Warning'));
                    const relevantMessageLines = primaryMessageIndex >= 0 ? messageLines.slice(primaryMessageIndex) : messageLines;
                    let message = relevantMessageLines.join(' ').trim();
                    let severity = 'other';
                    if (message.startsWith('Error:')) {
                        severity = 'error';
                        message = message.slice('Error:'.length).trim();
                    }
                    else if (message.startsWith('Warning')) {
                        severity = 'warning';
                    }
                    diagnostics.push({
                        file,
                        line: Number.parseInt(locationMatch[2] || '1', 10),
                        column: Number.parseInt(locationMatch[3] || '0', 10) + 1,
                        severity,
                        message: message || currentLine
                    });
                }
                if (diagnostics.length === 0) {
                    diagnostics.push({
                        file: entry,
                        severity: 'error',
                        message: combinedStderr || `${command.stage} failed`
                    });
                }
                return {
                    success: false,
                    stdout: stdoutParts.join(''),
                    stderr: combinedStderr,
                    diagnostics,
                    artifacts: [compilePlanArtifact]
                };
            }
        }
        const artifacts = [compilePlanArtifact];
        for (const filePath of fs.listFiles('/workspace/_build')) {
            if (filePath === compilePlanArtifact.path) {
                continue;
            }
            if (filePath.endsWith('.js')) {
                artifacts.push({
                    path: filePath,
                    kind: 'js',
                    data: fs.readText(filePath)
                });
                continue;
            }
            if (filePath.endsWith('.wasm')) {
                artifacts.push({
                    path: filePath,
                    kind: 'wasm',
                    data: fs.readFile(filePath)
                });
                continue;
            }
            if (filePath.endsWith('.map')) {
                artifacts.push({
                    path: filePath,
                    kind: 'map',
                    data: fs.readText(filePath)
                });
                continue;
            }
            artifacts.push({
                path: filePath,
                kind: 'asset',
                data: fs.readFile(filePath)
            });
        }
        return {
            success: true,
            stdout: stdoutParts.join(''),
            stderr: stderrParts.join('\n'),
            diagnostics,
            artifacts
        };
    };
}
const workerLikeGlobal = globalThis;
if (typeof workerLikeGlobal.addEventListener === 'function' && typeof workerLikeGlobal.postMessage === 'function') {
    const handleCompile = createCompileHandler();
    workerLikeGlobal.addEventListener('message', async (event) => {
        const message = event.data;
        if (!message || message.type !== 'compile') {
            return;
        }
        try {
            const result = await handleCompile(message.request, message.manifest);
            workerLikeGlobal.postMessage?.({
                type: 'result',
                result
            });
        }
        catch (error) {
            workerLikeGlobal.postMessage?.({
                type: 'error',
                error: error instanceof Error ? error.message : String(error)
            });
        }
    });
}
