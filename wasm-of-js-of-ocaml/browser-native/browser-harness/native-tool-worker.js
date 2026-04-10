"use strict";
class ToolExit extends Error {
    code;
    constructor(code) {
        super(`tool-exit:${code}`);
        this.code = code;
    }
}
function normalizePath(inputPath) {
    const normalized = inputPath.replace(/\\/g, '/');
    const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const parts = [];
    for (const segment of absolute.split('/')) {
        if (!segment || segment === '.') {
            continue;
        }
        if (segment === '..') {
            parts.pop();
            continue;
        }
        parts.push(segment);
    }
    return `/${parts.join('/')}`.replace(/\/+$/, '') || '/';
}
function ensureTrailingSlash(inputPath) {
    return inputPath.endsWith('/') ? inputPath : `${inputPath}/`;
}
function patchToolSource(source) {
    const needle = 'this.content={};this.root=a;';
    const replacement = 'this.content={};(globalThis.__jsoo_mounts||(globalThis.__jsoo_mounts=[])).push({root:a,content:this.content});this.root=a;';
    if (!source.includes(needle)) {
        throw new Error('failed to patch browser tool source for virtual fs mount exposure');
    }
    return source.replace(needle, replacement);
}
function bytesToBinaryString(bytes) {
    let output = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
        output += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return output;
}
function binaryStringToBytes(value) {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
        bytes[index] = value.charCodeAt(index) & 0xff;
    }
    return bytes;
}
function bytesToBase64(bytes) {
    return btoa(bytesToBinaryString(bytes));
}
function base64ToBytes(value) {
    return binaryStringToBytes(atob(value));
}
function isBinaryenBridgeDebugEnabled(runtimeGlobal) {
    return runtimeGlobal['__wasm_bridge_debug'] === true;
}
function pushBinaryenBridgeMessage(runtimeGlobal, message) {
    const bridgeMessages = runtimeGlobal['__wasm_bridge_messages'] || [];
    bridgeMessages.push(message);
    runtimeGlobal['__wasm_bridge_messages'] = bridgeMessages;
}
function shellSplit(command) {
    const tokens = [];
    let current = '';
    let quote = '';
    for (let index = 0; index < command.length; index += 1) {
        const char = command[index] || '';
        if (quote) {
            if (char === quote) {
                quote = '';
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        if (char === '>') {
            if (current) {
                tokens.push(current);
                current = '';
            }
            tokens.push(char);
            continue;
        }
        current += char;
    }
    if (current) {
        tokens.push(current);
    }
    return tokens;
}
function getMounts(runtimeGlobal) {
    return runtimeGlobal['__jsoo_mounts'] || [];
}
function findMount(runtimeGlobal, targetPath) {
    const normalizedTarget = normalizePath(targetPath);
    let bestMatch;
    for (const mount of getMounts(runtimeGlobal)) {
        const normalizedRoot = ensureTrailingSlash(normalizePath(mount.root));
        if (normalizedTarget === normalizedRoot.slice(0, -1) ||
            normalizedTarget.startsWith(normalizedRoot)) {
            if (!bestMatch || normalizedRoot.length > bestMatch.root.length) {
                bestMatch = {
                    root: normalizedRoot,
                    content: mount.content
                };
            }
        }
    }
    return bestMatch;
}
function readVirtualFile(runtimeGlobal, targetPath) {
    const mount = findMount(runtimeGlobal, targetPath);
    if (!mount) {
        return undefined;
    }
    const normalizedTarget = normalizePath(targetPath);
    const relativePath = normalizedTarget.slice(mount.root.length).replace(/^\/+/, '');
    const entry = mount.content[relativePath];
    if (!entry || typeof entry.length !== 'function' || typeof entry.read !== 'function') {
        return undefined;
    }
    const length = entry.length();
    const data = new Uint8Array(length);
    entry.read(0, data, 0, length);
    return data;
}
function listVirtualFiles(runtimeGlobal, prefixes) {
    const normalizedPrefixes = prefixes.map((prefix) => normalizePath(prefix));
    const results = new Map();
    for (const mount of getMounts(runtimeGlobal)) {
        const normalizedRoot = ensureTrailingSlash(normalizePath(mount.root));
        for (const [relativePath, entry] of Object.entries(mount.content)) {
            const candidate = entry;
            if (!candidate ||
                typeof candidate.length !== 'function' ||
                typeof candidate.read !== 'function') {
                continue;
            }
            const fullPath = normalizePath(`${normalizedRoot}${relativePath}`);
            const matchesPrefix = normalizedPrefixes.some((prefix) => {
                const prefixWithSlash = ensureTrailingSlash(prefix);
                return fullPath === prefix || fullPath.startsWith(prefixWithSlash);
            });
            if (!matchesPrefix) {
                continue;
            }
            const data = new Uint8Array(candidate.length());
            candidate.read(0, data, 0, data.byteLength);
            results.set(fullPath, data);
        }
    }
    return [...results.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([path, data]) => ({
        path,
        data: (() => {
            const copy = new Uint8Array(data.byteLength);
            copy.set(data);
            return copy.buffer;
        })()
    }));
}
function collectVirtualFiles(runtimeGlobal, paths) {
    const files = [];
    for (const filePath of paths) {
        const data = readVirtualFile(runtimeGlobal, filePath);
        if (!data) {
            continue;
        }
        files.push({
            path: normalizePath(filePath),
            data
        });
    }
    return files;
}
function writeVirtualFiles(runtimeGlobal, files) {
    const createFile = runtimeGlobal['jsoo_create_file'];
    if (typeof createFile !== 'function') {
        throw new Error('jsoo_create_file is not available for system bridge outputs');
    }
    for (const file of files) {
        const mount = findMount(runtimeGlobal, file.path);
        if (mount) {
            const normalizedTarget = normalizePath(file.path);
            const relativePath = normalizedTarget.slice(mount.root.length).replace(/^\/+/, '');
            delete mount.content[relativePath];
        }
        createFile(file.path, bytesToBinaryString(file.data));
    }
}
function runBinaryenBridge(runtimeGlobal, command, endpointUrl) {
    const tokens = shellSplit(command);
    const pathTokens = new Set();
    const outputPaths = new Set();
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] || '';
        if (token.startsWith('/tmp/') || token.startsWith('/static/')) {
            pathTokens.add(token);
        }
        if ((token === '-o' || token === '--graph-file' || token === '--output-source-map' || token === '--input-source-map' || token === '>') &&
            (tokens[index + 1] || '').startsWith('/')) {
            pathTokens.add(tokens[index + 1] || '');
        }
        if ((token === '-o' || token === '--output-source-map' || token === '>') &&
            (tokens[index + 1] || '').startsWith('/')) {
            outputPaths.add(tokens[index + 1] || '');
        }
    }
    const bridgeMessages = runtimeGlobal['__wasm_bridge_messages'] || [];
    const inputPaths = [...pathTokens].filter((filePath) => !outputPaths.has(filePath));
    if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
        bridgeMessages.push(`binaryen bridge command: ${command}`, `binaryen bridge files: ${inputPaths.sort().join(', ') || '(none)'}`, `binaryen bridge outputs: ${[...outputPaths].sort().join(', ') || '(none)'}`);
        runtimeGlobal['__wasm_bridge_messages'] = bridgeMessages;
    }
    const requestBody = JSON.stringify({
        command,
        files: collectVirtualFiles(runtimeGlobal, inputPaths).map((file) => ({
            path: file.path,
            dataBase64: bytesToBase64(file.data)
        })),
        outputPaths: [...outputPaths]
    });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpointUrl, false);
    xhr.setRequestHeader('content-type', 'application/json');
    xhr.send(requestBody);
    if (xhr.status !== 200) {
        pushBinaryenBridgeMessage(runtimeGlobal, `binaryen bridge http ${xhr.status}: ${xhr.responseText}`);
        return 1;
    }
    const response = JSON.parse(xhr.responseText || '{}');
    if (response.exitCode !== 0 || isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
        pushBinaryenBridgeMessage(runtimeGlobal, `binaryen bridge exit: ${response.exitCode}`);
    }
    if (response.stdout && (response.exitCode !== 0 || isBinaryenBridgeDebugEnabled(runtimeGlobal))) {
        pushBinaryenBridgeMessage(runtimeGlobal, response.stdout);
    }
    if (response.stderr) {
        pushBinaryenBridgeMessage(runtimeGlobal, response.stderr);
    }
    writeVirtualFiles(runtimeGlobal, (response.outputs || []).map((output) => ({
        path: output.path,
        data: base64ToBytes(output.dataBase64)
    })));
    return response.exitCode;
}
async function materializePreloadFiles(preloadFiles) {
    const encoder = new TextEncoder();
    const materialized = [];
    for (let index = 0; index < preloadFiles.length; index += 24) {
        const batch = preloadFiles.slice(index, index + 24);
        const batchResults = await Promise.all(batch.map(async (preloadFile) => {
            if (typeof preloadFile.text === 'string') {
                return {
                    name: preloadFile.path,
                    content: encoder.encode(preloadFile.text)
                };
            }
            if (preloadFile.bytes instanceof ArrayBuffer) {
                return {
                    name: preloadFile.path,
                    content: bytesToBinaryString(new Uint8Array(preloadFile.bytes))
                };
            }
            if (preloadFile.url) {
                const response = await fetch(preloadFile.url, { cache: 'force-cache' });
                if (!response.ok) {
                    throw new Error(`failed to fetch preload file: ${preloadFile.url} (${response.status})`);
                }
                return {
                    name: preloadFile.path,
                    content: bytesToBinaryString(new Uint8Array(await response.arrayBuffer()))
                };
            }
            throw new Error(`preload file is missing data: ${preloadFile.path}`);
        }));
        materialized.push(...batchResults);
    }
    return materialized;
}
self.addEventListener('message', async (event) => {
    const request = event.data;
    if (!request || request.type !== 'run-tool') {
        return;
    }
    const runtimeGlobal = globalThis;
    const runtimeSlots = runtimeGlobal;
    const stdoutParts = [];
    const stderrParts = [];
    const originalConsole = globalThis.console;
    const originalProcess = runtimeSlots['process'];
    const originalQuit = runtimeSlots['quit'];
    const originalPrint = runtimeSlots['print'];
    const originalPrintErr = runtimeSlots['printErr'];
    const originalJsooEnv = runtimeSlots['jsoo_env'];
    const originalJsooFsTmp = runtimeSlots['jsoo_fs_tmp'];
    const originalMounts = runtimeSlots['__jsoo_mounts'];
    const originalBridgeMessages = runtimeSlots['__wasm_bridge_messages'];
    const originalBridgeDebug = runtimeSlots['__wasm_bridge_debug'];
    const originalRequire = runtimeSlots['require'];
    try {
        const preloadFiles = await materializePreloadFiles(request.preloadFiles);
        const toolResponse = await fetch(request.toolUrl, { cache: 'no-store' });
        if (!toolResponse.ok) {
            throw new Error(`failed to fetch browser tool: ${request.toolUrl}`);
        }
        const toolSource = patchToolSource(await toolResponse.text());
        const patchedToolSource = toolSource;
        runtimeSlots['__jsoo_mounts'] = [];
        runtimeSlots['jsoo_env'] = { ...request.env };
        runtimeSlots['jsoo_fs_tmp'] = preloadFiles;
        runtimeSlots['process'] = {
            argv: ['browser', request.toolUrl.split('/').at(-1) || 'tool', ...request.argv],
            env: { ...request.env },
            exit(code) {
                throw new ToolExit(code);
            }
        };
        runtimeSlots['quit'] = (code) => {
            throw new ToolExit(code);
        };
        runtimeSlots['print'] = (...args) => {
            stdoutParts.push(args.map((value) => String(value)).join(' '));
        };
        runtimeSlots['printErr'] = (...args) => {
            stderrParts.push(args.map((value) => String(value)).join(' '));
        };
        if (request.systemBridge === 'binaryen') {
            runtimeSlots['__wasm_bridge_messages'] = [];
            runtimeSlots['__wasm_bridge_debug'] = request.env['WASM_OF_JS_DEBUG_BINARYEN'] === '1';
            runtimeSlots['__wasm_of_js_system_command'] = (command) => {
                if (runtimeSlots['__wasm_bridge_debug'] === true) {
                    pushBinaryenBridgeMessage(runtimeGlobal, `binaryen system bridge invoked: ${command}`);
                }
                return runBinaryenBridge(runtimeGlobal, command, '/api/binaryen-command');
            };
            runtimeSlots['require'] = (specifier) => {
                if (specifier === 'node:child_process') {
                    return {
                        execSync: (command) => {
                            const exitCode = runBinaryenBridge(runtimeGlobal, String(command), '/api/binaryen-command');
                            if (exitCode !== 0) {
                                const error = new Error(`execSync failed with exit code ${exitCode}`);
                                error.status = exitCode;
                                throw error;
                            }
                            return '';
                        },
                        spawnSync: (command, argsOrOptions, maybeOptions) => {
                            const args = Array.isArray(argsOrOptions) ? argsOrOptions : [];
                            const options = (Array.isArray(argsOrOptions) ? maybeOptions : argsOrOptions) || {};
                            const commandLine = options && options.shell === true
                                ? String(command)
                                : [String(command), ...args.map((arg) => JSON.stringify(arg))].join(' ');
                            const status = runBinaryenBridge(runtimeGlobal, commandLine, '/api/binaryen-command');
                            return {
                                status,
                                signal: null,
                                error: null
                            };
                        }
                    };
                }
                if (specifier === 'node:tty') {
                    return {
                        isatty: () => false
                    };
                }
                if (specifier === 'node:os') {
                    return {
                        tmpdir: () => '/tmp'
                    };
                }
                throw new Error(`unsupported require in browser tool worker: ${specifier}`);
            };
        }
        globalThis.console = {
            ...originalConsole,
            log: (...args) => {
                stdoutParts.push(args.map((value) => String(value)).join(' '));
            },
            info: (...args) => {
                stdoutParts.push(args.map((value) => String(value)).join(' '));
            },
            warn: (...args) => {
                stderrParts.push(args.map((value) => String(value)).join(' '));
            },
            error: (...args) => {
                stderrParts.push(args.map((value) => String(value)).join(' '));
            }
        };
        let thrown = '';
        let exitCode = 0;
        try {
            new Function(`${patchedToolSource}\n//# sourceURL=${request.toolUrl}`)();
        }
        catch (error) {
            if (error instanceof ToolExit) {
                exitCode = error.code;
            }
            else {
                thrown = error instanceof Error ? error.stack || error.message : String(error);
                const matchedExit = thrown.match(/tool-exit:(\d+)/);
                if (matchedExit) {
                    exitCode = Number.parseInt(matchedExit[1] || '1', 10);
                    thrown = '';
                }
                else {
                    exitCode = 1;
                }
            }
        }
        const normalizedStderr = stderrParts
            .join('\n')
            .split('\n')
            .filter((line) => !(exitCode === 0 && line.includes('tool-exit:0')))
            .join('\n');
        const response = {
            type: 'tool-result',
            exitCode,
            stdout: stdoutParts.join('\n'),
            stderr: [normalizedStderr, ...((runtimeSlots['__wasm_bridge_messages'] || []).filter(Boolean))].filter(Boolean).join('\n'),
            files: listVirtualFiles(runtimeGlobal, request.outputPrefixes)
        };
        if (thrown) {
            response.thrown = thrown;
        }
        self.postMessage(response, response.files.map((file) => file.data));
    }
    catch (error) {
        const response = {
            type: 'tool-result',
            exitCode: 1,
            stdout: stdoutParts.join('\n'),
            stderr: stderrParts.join('\n'),
            thrown: error instanceof Error ? error.stack || error.message : String(error),
            files: []
        };
        self.postMessage(response);
    }
    finally {
        globalThis.console = originalConsole;
        if (typeof originalProcess === 'undefined') {
            delete runtimeSlots['process'];
        }
        else {
            runtimeSlots['process'] = originalProcess;
        }
        if (typeof originalRequire === 'undefined') {
            delete runtimeSlots['require'];
        }
        else {
            runtimeSlots['require'] = originalRequire;
        }
        if (typeof originalQuit === 'undefined') {
            delete runtimeSlots['quit'];
        }
        else {
            runtimeSlots['quit'] = originalQuit;
        }
        if (typeof originalPrint === 'undefined') {
            delete runtimeSlots['print'];
        }
        else {
            runtimeSlots['print'] = originalPrint;
        }
        if (typeof originalPrintErr === 'undefined') {
            delete runtimeSlots['printErr'];
        }
        else {
            runtimeSlots['printErr'] = originalPrintErr;
        }
        if (typeof originalJsooEnv === 'undefined') {
            delete runtimeSlots['jsoo_env'];
        }
        else {
            runtimeSlots['jsoo_env'] = originalJsooEnv;
        }
        if (typeof originalJsooFsTmp === 'undefined') {
            delete runtimeSlots['jsoo_fs_tmp'];
        }
        else {
            runtimeSlots['jsoo_fs_tmp'] = originalJsooFsTmp;
        }
        if (typeof originalMounts === 'undefined') {
            delete runtimeSlots['__jsoo_mounts'];
        }
        else {
            runtimeSlots['__jsoo_mounts'] = originalMounts;
        }
        if (typeof originalBridgeMessages === 'undefined') {
            delete runtimeSlots['__wasm_bridge_messages'];
        }
        else {
            runtimeSlots['__wasm_bridge_messages'] = originalBridgeMessages;
        }
        if (typeof originalBridgeDebug === 'undefined') {
            delete runtimeSlots['__wasm_bridge_debug'];
        }
        else {
            runtimeSlots['__wasm_bridge_debug'] = originalBridgeDebug;
        }
        delete runtimeSlots['__wasm_of_js_system_command'];
    }
});
