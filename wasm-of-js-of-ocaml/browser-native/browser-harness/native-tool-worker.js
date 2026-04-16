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
    const mountNeedle = 'this.content={};this.root=a;';
    const mountReplacement = 'this.content={};this.root=a;(globalThis.__jsoo_mounts||(globalThis.__jsoo_mounts=[])).push(this);';
    if (!source.includes(mountNeedle)) {
        throw new Error('failed to patch browser tool source for virtual fs mount exposure');
    }
    const createFileNeedle = /([A-Za-z$_][\w$]*)\.jsoo_create_file=([A-Za-z$_][\w$]*);\1\.jsoo_fs_tmp=\[\];return 0/;
    const forcedBrowserSource = source
        .replace('const isNode = globalThis.process?.versions?.node;', 'const isNode = false;')
        .replace(createFileNeedle, '(globalThis.__jsoo_created_files||(globalThis.__jsoo_created_files={}));$1.jsoo_create_file=(name,content)=>{globalThis.__jsoo_created_files[name]=content;return $2(name,content)};$1.jsoo_fs_tmp=[];return 0');
    return forcedBrowserSource.replace(mountNeedle, mountReplacement);
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
            if (!bestMatch || normalizedRoot.length > ensureTrailingSlash(normalizePath(bestMatch.root)).length) {
                bestMatch = mount;
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
    const normalizedRoot = ensureTrailingSlash(normalizePath(mount.root));
    const relativePath = normalizedTarget.slice(normalizedRoot.length).replace(/^\/+/, '');
    const lookedUpEntry = typeof mount.lookup === 'function' ? mount.lookup(relativePath) : undefined;
    const entry = (mount.content[relativePath] || lookedUpEntry);
    if (!entry || typeof entry.length !== 'function' || typeof entry.read !== 'function') {
        return undefined;
    }
    const length = entry.length();
    const data = new Uint8Array(length);
    entry.read(0, data, 0, length);
    return data;
}
function describeVirtualFile(runtimeGlobal, targetPath) {
    const mount = findMount(runtimeGlobal, targetPath);
    if (!mount) {
        return `${targetPath}: mount missing`;
    }
    const normalizedTarget = normalizePath(targetPath);
    const normalizedRoot = ensureTrailingSlash(normalizePath(mount.root));
    const relativePath = normalizedTarget.slice(normalizedRoot.length).replace(/^\/+/, '');
    const lookedUpEntry = typeof mount.lookup === 'function' ? mount.lookup(relativePath) : undefined;
    const entry = mount.content[relativePath] || lookedUpEntry;
    const entryRecord = entry;
    const constructorName = entry && typeof entry === 'object' && 'constructor' in entry
        ? String(entry.constructor?.name || '(anonymous)')
        : typeof entry;
    return [
        `target=${normalizedTarget}`,
        `mount=${mount.root}`,
        `relative=${relativePath}`,
        `hasEntry=${entry ? 'yes' : 'no'}`,
        `constructor=${constructorName}`,
        `hasLength=${entryRecord && typeof entryRecord.length === 'function' ? 'yes' : 'no'}`,
        `hasRead=${entryRecord && typeof entryRecord.read === 'function' ? 'yes' : 'no'}`
    ].join(', ');
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
    const createdFiles = runtimeGlobal['__jsoo_created_files'];
    for (const filePath of paths) {
        const normalizedPath = normalizePath(filePath);
        const createdFile = createdFiles?.[normalizedPath];
        if (typeof createdFile === 'string') {
            files.push({
                path: normalizedPath,
                data: binaryStringToBytes(createdFile)
            });
            continue;
        }
        if (createdFile instanceof Uint8Array) {
            files.push({
                path: normalizedPath,
                data: createdFile
            });
            continue;
        }
        if (createdFile instanceof ArrayBuffer) {
            files.push({
                path: normalizedPath,
                data: new Uint8Array(createdFile)
            });
            continue;
        }
        const data = readVirtualFile(runtimeGlobal, filePath);
        if (!data) {
            continue;
        }
        files.push({
            path: normalizedPath,
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
function loadBinaryenToolSource(runtimeGlobal, toolUrl) {
    let sourceCache = runtimeGlobal['__binaryen_tool_source_cache'];
    if (!sourceCache) {
        sourceCache = new Map();
        runtimeGlobal['__binaryen_tool_source_cache'] = sourceCache;
    }
    const cached = sourceCache.get(toolUrl);
    if (cached) {
        return cached;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('GET', toolUrl, false);
    xhr.responseType = 'text';
    xhr.send(null);
    if (xhr.status !== 200) {
        throw new Error(`failed to fetch static Binaryen tool: ${toolUrl} (${xhr.status})`);
    }
    const source = xhr.responseText || '';
    sourceCache.set(toolUrl, source);
    return source;
}
function ensureBinaryenCliDirectory(fs, targetPath) {
    const normalizedPath = normalizePath(targetPath);
    const directory = normalizedPath.replace(/\/[^/]+$/, '') || '/';
    if (directory === '/') {
        return;
    }
    if (typeof fs.mkdirTree === 'function') {
        fs.mkdirTree(directory);
        return;
    }
    const segments = directory.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
        current += `/${segment}`;
        try {
            fs.mkdir(current);
        }
        catch {
            // Directory may already exist.
        }
    }
}
function parseBinaryenCommand(command) {
    const rawTokens = shellSplit(command);
    const tokens = [];
    for (let index = 0; index < rawTokens.length; index += 1) {
        const token = rawTokens[index] || '';
        if (/^\d+$/.test(token) && rawTokens[index + 1] === '>') {
            tokens.push(`${token}>`);
            index += 1;
            continue;
        }
        tokens.push(token);
    }
    if (tokens.length === 0) {
        throw new Error('binaryen command is empty');
    }
    const toolName = tokens[0] || '';
    const argv = [];
    const pathTokens = new Set();
    const outputPaths = new Set();
    let stdoutRedirect = '';
    let stderrRedirect = '';
    for (let index = 1; index < tokens.length; index += 1) {
        const token = tokens[index] || '';
        const nextToken = tokens[index + 1] || '';
        if ((token === '>' || token === '1>') && nextToken) {
            stdoutRedirect = nextToken;
            if (nextToken.startsWith('/')) {
                pathTokens.add(nextToken);
                outputPaths.add(nextToken);
            }
            index += 1;
            continue;
        }
        if (token === '2>' && nextToken) {
            stderrRedirect = nextToken;
            index += 1;
            continue;
        }
        argv.push(token);
        if (token.startsWith('/')) {
            pathTokens.add(token);
        }
        if ((token === '-o' ||
            token === '--graph-file' ||
            token === '--output-source-map' ||
            token === '--input-source-map') &&
            nextToken.startsWith('/')) {
            pathTokens.add(nextToken);
            if (token === '-o' || token === '--output-source-map') {
                outputPaths.add(nextToken);
            }
        }
    }
    return {
        toolName,
        argv,
        stdoutRedirect,
        stderrRedirect,
        inputPaths: [...pathTokens].filter((filePath) => !outputPaths.has(filePath)),
        outputPaths: [...outputPaths]
    };
}
function runBinaryenTool(runtimeGlobal, command, toolUrls) {
    if (!toolUrls) {
        throw new Error('browser-native Binaryen tools are missing from the tool request');
    }
    const parsed = parseBinaryenCommand(command);
    const toolUrl = (parsed.toolName === 'wasm-opt'
        ? toolUrls.wasm_opt
        : parsed.toolName === 'wasm-merge'
            ? toolUrls.wasm_merge
            : parsed.toolName === 'wasm-metadce'
                ? toolUrls.wasm_metadce
                : '') || '';
    if (!toolUrl) {
        throw new Error(`unsupported static Binaryen tool: ${parsed.toolName}`);
    }
    if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
        const rootMount = getMounts(runtimeGlobal).find((mount) => normalizePath(mount.root) === '/');
        pushBinaryenBridgeMessage(runtimeGlobal, `binaryen static command: ${command}\nmounts: ${getMounts(runtimeGlobal)
            .map((mount) => mount.root)
            .join(', ') || '(none)'}\nroot tmp keys: ${rootMount ? Object.keys(rootMount.content).filter((key) => key.includes('tmp')).slice(0, 20).join(', ') || '(none)' : '(missing root)'}\ninputs: ${parsed.inputPaths.sort().join(', ') || '(none)'}\noutputs: ${parsed.outputPaths.sort().join(', ') || '(none)'}`);
    }
    const originalModule = runtimeGlobal['Module'];
    const originalBinaryenCliRuntime = runtimeGlobal['__binaryen_cli_runtime'];
    const originalBinaryenCliQuit = runtimeGlobal['__binaryen_cli_quit'];
    const stdoutParts = [];
    const stderrParts = [];
    let exitCode = 0;
    try {
        try {
            runtimeGlobal['Module'] = {
                arguments: parsed.argv,
                thisProgram: parsed.toolName,
                print: (...args) => {
                    stdoutParts.push(args.map((value) => String(value)).join(' '));
                },
                printErr: (...args) => {
                    stderrParts.push(args.map((value) => String(value)).join(' '));
                }
            };
            runtimeGlobal['__binaryen_cli_runtime'] = undefined;
            runtimeGlobal['__binaryen_cli_quit'] = (status) => {
                throw new ToolExit(status);
            };
            new Function(`${loadBinaryenToolSource(runtimeGlobal, toolUrl)}\n//# sourceURL=${toolUrl}`)();
            const cliRuntime = runtimeGlobal['__binaryen_cli_runtime'];
            const fs = cliRuntime?.FS;
            if (!fs || typeof fs.writeFile !== 'function') {
                throw new Error(`static Binaryen tool did not expose FS: ${parsed.toolName}`);
            }
            if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
                for (const inputPath of parsed.inputPaths) {
                    pushBinaryenBridgeMessage(runtimeGlobal, `binaryen input probe: ${describeVirtualFile(runtimeGlobal, inputPath)}`);
                }
            }
            for (const file of collectVirtualFiles(runtimeGlobal, parsed.inputPaths)) {
                if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
                    pushBinaryenBridgeMessage(runtimeGlobal, `binaryen input ready: ${file.path} (${file.data.byteLength} bytes, magic=${[...file.data.subarray(0, 4)].map((value) => value.toString(16).padStart(2, '0')).join(' ')})`);
                }
                ensureBinaryenCliDirectory(fs, file.path);
                fs.writeFile(file.path, file.data);
            }
            for (const outputPath of parsed.outputPaths) {
                ensureBinaryenCliDirectory(fs, outputPath);
            }
            if (cliRuntime?.Module) {
                cliRuntime.Module.arguments = parsed.argv;
                cliRuntime.Module.thisProgram = parsed.toolName;
            }
            if (typeof cliRuntime?.run !== 'function') {
                throw new Error(`static Binaryen tool did not expose run(): ${parsed.toolName}`);
            }
            cliRuntime.run(parsed.argv);
        }
        catch (error) {
            if (error instanceof ToolExit) {
                exitCode = error.code;
            }
            else {
                throw error;
            }
        }
        const cliRuntime = runtimeGlobal['__binaryen_cli_runtime'];
        const fs = cliRuntime?.FS;
        if (!fs || typeof fs.readFile !== 'function') {
            throw new Error(`static Binaryen tool did not leave behind a readable FS: ${parsed.toolName}`);
        }
        const redirectedStdout = stdoutParts.length > 0 ? `${stdoutParts.join('\n')}\n` : '';
        if (parsed.stdoutRedirect && parsed.stdoutRedirect !== '/dev/null') {
            writeVirtualFiles(runtimeGlobal, [
                {
                    path: parsed.stdoutRedirect,
                    data: new TextEncoder().encode(redirectedStdout)
                }
            ]);
        }
        if (parsed.stderrRedirect && parsed.stderrRedirect !== '/dev/null') {
            writeVirtualFiles(runtimeGlobal, [
                {
                    path: parsed.stderrRedirect,
                    data: new TextEncoder().encode(stderrParts.length > 0 ? `${stderrParts.join('\n')}\n` : '')
                }
            ]);
        }
        const outputFiles = [];
        for (const outputPath of parsed.outputPaths) {
            try {
                const outputData = new Uint8Array(fs.readFile(outputPath, { encoding: 'binary' }));
                outputFiles.push({
                    path: outputPath,
                    data: outputData
                });
                if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
                    pushBinaryenBridgeMessage(runtimeGlobal, `binaryen output ready: ${outputPath} (${outputData.byteLength} bytes)`);
                }
            }
            catch {
                if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
                    const rootListing = typeof fs.readdir === 'function'
                        ? (() => {
                            try {
                                return fs.readdir('/').join(', ');
                            }
                            catch {
                                return '(unavailable)';
                            }
                        })()
                        : '(unsupported)';
                    const tmpListing = typeof fs.readdir === 'function'
                        ? (() => {
                            try {
                                return fs.readdir('/tmp').join(', ');
                            }
                            catch {
                                return '(unavailable)';
                            }
                        })()
                        : '(unsupported)';
                    pushBinaryenBridgeMessage(runtimeGlobal, `binaryen output missing: ${outputPath}\ncli fs /: ${rootListing}\ncli fs /tmp: ${tmpListing}`);
                }
                // Ignore optional outputs.
            }
        }
        if (outputFiles.length > 0) {
            writeVirtualFiles(runtimeGlobal, outputFiles);
        }
        if (exitCode === 1 && outputFiles.length > 0 && stderrParts.length === 0) {
            if (isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
                pushBinaryenBridgeMessage(runtimeGlobal, `binaryen normalized exit: ${parsed.toolName} reported 1 after producing ${outputFiles.length} output file(s)`);
            }
            exitCode = 0;
        }
        if (exitCode !== 0 || isBinaryenBridgeDebugEnabled(runtimeGlobal)) {
            pushBinaryenBridgeMessage(runtimeGlobal, `binaryen exit: ${exitCode}`);
        }
        if (exitCode !== 0 && stdoutParts.length > 0) {
            pushBinaryenBridgeMessage(runtimeGlobal, stdoutParts.join('\n'));
        }
        else if (exitCode !== 0 && redirectedStdout) {
            pushBinaryenBridgeMessage(runtimeGlobal, redirectedStdout.trimEnd());
        }
        if (exitCode !== 0 && stderrParts.length > 0 && parsed.stderrRedirect !== '/dev/null') {
            pushBinaryenBridgeMessage(runtimeGlobal, stderrParts.join('\n'));
        }
        return exitCode;
    }
    finally {
        if (typeof originalModule === 'undefined') {
            delete runtimeGlobal['Module'];
        }
        else {
            runtimeGlobal['Module'] = originalModule;
        }
        if (typeof originalBinaryenCliRuntime === 'undefined') {
            delete runtimeGlobal['__binaryen_cli_runtime'];
        }
        else {
            runtimeGlobal['__binaryen_cli_runtime'] = originalBinaryenCliRuntime;
        }
        if (typeof originalBinaryenCliQuit === 'undefined') {
            delete runtimeGlobal['__binaryen_cli_quit'];
        }
        else {
            runtimeGlobal['__binaryen_cli_quit'] = originalBinaryenCliQuit;
        }
    }
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
    const originalModule = runtimeSlots['Module'];
    const originalBinaryenCliRuntime = runtimeSlots['__binaryen_cli_runtime'];
    const originalBinaryenCliQuit = runtimeSlots['__binaryen_cli_quit'];
    const originalCreatedFiles = runtimeSlots['__jsoo_created_files'];
    try {
        const preloadFiles = await materializePreloadFiles(request.preloadFiles);
        const toolResponse = await fetch(request.toolUrl, { cache: 'no-store' });
        if (!toolResponse.ok) {
            throw new Error(`failed to fetch browser tool: ${request.toolUrl}`);
        }
        const toolSource = patchToolSource(await toolResponse.text());
        const patchedToolSource = toolSource;
        runtimeSlots['__jsoo_mounts'] = [];
        runtimeSlots['__jsoo_created_files'] = {};
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
        if (request.env['WASM_OF_JS_DEBUG_BINARYEN'] === '1') {
            pushBinaryenBridgeMessage(runtimeGlobal, `mount roots: ${getMounts(runtimeGlobal)
                .map((mount) => mount.root)
                .join(', ')}`);
        }
        if (request.systemBridge === 'binaryen') {
            runtimeSlots['__wasm_bridge_messages'] = [];
            runtimeSlots['__wasm_bridge_debug'] = request.env['WASM_OF_JS_DEBUG_BINARYEN'] === '1';
            runtimeSlots['__wasm_of_js_system_command'] = (command) => {
                if (runtimeSlots['__wasm_bridge_debug'] === true) {
                    pushBinaryenBridgeMessage(runtimeGlobal, `binaryen system command invoked: ${command}`);
                }
                return runBinaryenTool(runtimeGlobal, command, request.binaryenTools);
            };
            const browserRequire = Object.assign((specifier) => {
                if (specifier === 'node:child_process') {
                    return {
                        execSync: (command) => {
                            const exitCode = runBinaryenTool(runtimeGlobal, String(command), request.binaryenTools);
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
                            const status = runBinaryenTool(runtimeGlobal, commandLine, request.binaryenTools);
                            return {
                                status,
                                signal: null,
                                error: null
                            };
                        }
                    };
                }
                if (specifier === 'node:path') {
                    const isUrlPath = (value) => /^[a-zA-Z]+:\/\//.test(value);
                    const normalizeRelativePath = (value) => {
                        const normalized = normalizePath(`/${value}`);
                        return normalized === '/' ? '.' : normalized.slice(1);
                    };
                    const normalizeBrowserPath = (value) => {
                        if (isUrlPath(value)) {
                            const url = new URL(value);
                            url.pathname = normalizePath(url.pathname);
                            return url.toString();
                        }
                        return value.startsWith('/')
                            ? normalizePath(value)
                            : normalizeRelativePath(value);
                    };
                    const joinBrowserPath = (...parts) => {
                        const filtered = parts.filter(Boolean);
                        if (filtered.length === 0) {
                            return '.';
                        }
                        const [rawFirstPart, ...restParts] = filtered;
                        const firstPart = rawFirstPart || '';
                        if (isUrlPath(firstPart)) {
                            const base = firstPart.endsWith('/') ? firstPart : `${firstPart}/`;
                            return new URL(restParts.join('/'), base).toString();
                        }
                        const joined = filtered.join('/');
                        return firstPart.startsWith('/')
                            ? normalizePath(joined)
                            : normalizeRelativePath(joined);
                    };
                    const dirnameBrowserPath = (value) => {
                        if (isUrlPath(value)) {
                            const url = new URL(value);
                            url.pathname = url.pathname.replace(/\/[^/]*$/, '/') || '/';
                            return url.toString().replace(/\/$/, '');
                        }
                        const normalized = normalizeBrowserPath(value);
                        const absolutePath = value.startsWith('/')
                            ? normalized
                            : `/${normalized === '.' ? '' : normalized}`;
                        const directory = absolutePath.replace(/\/[^/]*$/, '') || '/';
                        return value.startsWith('/')
                            ? directory
                            : directory === '/'
                                ? '.'
                                : directory.slice(1);
                    };
                    const basenameBrowserPath = (value) => {
                        const normalized = normalizeBrowserPath(value).replace(/\/+$/, '');
                        return normalized.split('/').pop() || '';
                    };
                    const resolvePosixPath = (...parts) => {
                        const segments = [];
                        for (const part of parts) {
                            if (!part) {
                                continue;
                            }
                            const normalizedPart = normalizePath(part);
                            for (const segment of normalizedPart.split('/')) {
                                if (!segment) {
                                    continue;
                                }
                                segments.push(segment);
                            }
                        }
                        return `/${segments.join('/')}`.replace(/\/+$/, '') || '/';
                    };
                    const relativePosixPath = (from, to) => {
                        const fromParts = normalizePath(from).split('/').filter(Boolean);
                        const toParts = normalizePath(to).split('/').filter(Boolean);
                        let index = 0;
                        while (fromParts[index] && fromParts[index] === toParts[index]) {
                            index += 1;
                        }
                        const up = new Array(fromParts.length - index).fill('..');
                        const down = toParts.slice(index);
                        return [...up, ...down].join('/') || '.';
                    };
                    return {
                        isAbsolute: (value) => value.startsWith('/') || isUrlPath(value),
                        normalize: normalizeBrowserPath,
                        dirname: dirnameBrowserPath,
                        basename: basenameBrowserPath,
                        join: joinBrowserPath,
                        posix: {
                            resolve: (...parts) => resolvePosixPath(...parts),
                            relative: (from, to) => relativePosixPath(from, to)
                        }
                    };
                }
                if (specifier === 'node:tty') {
                    return {
                        isatty: () => false
                    };
                }
                if (specifier === 'node:crypto') {
                    return {
                        randomFillSync: (view) => {
                            globalThis.crypto.getRandomValues(view);
                            return view;
                        }
                    };
                }
                if (specifier === 'node:fs/promises') {
                    return {
                        readFile: async (filePath) => {
                            const response = await fetch(filePath, {
                                cache: 'no-store',
                                credentials: 'same-origin'
                            });
                            if (!response.ok) {
                                throw new Error(`failed to read browser file: ${filePath}`);
                            }
                            return new Uint8Array(await response.arrayBuffer());
                        }
                    };
                }
                if (specifier === 'node:os') {
                    return {
                        tmpdir: () => '/tmp'
                    };
                }
                if (specifier === 'node:util') {
                    return {
                        getSystemErrorMap: () => new Map(),
                        getSystemErrorMessage: (errno) => `Unknown system error ${errno}`
                    };
                }
                throw new Error(`unsupported require in browser tool worker: ${specifier}`);
            }, {
                main: {
                    filename: request.toolUrl
                }
            });
            runtimeSlots['require'] = browserRequire;
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
        if (typeof originalModule === 'undefined') {
            delete runtimeSlots['Module'];
        }
        else {
            runtimeSlots['Module'] = originalModule;
        }
        if (typeof originalBinaryenCliRuntime === 'undefined') {
            delete runtimeSlots['__binaryen_cli_runtime'];
        }
        else {
            runtimeSlots['__binaryen_cli_runtime'] = originalBinaryenCliRuntime;
        }
        if (typeof originalBinaryenCliQuit === 'undefined') {
            delete runtimeSlots['__binaryen_cli_quit'];
        }
        else {
            runtimeSlots['__binaryen_cli_quit'] = originalBinaryenCliQuit;
        }
        if (typeof originalCreatedFiles === 'undefined') {
            delete runtimeSlots['__jsoo_created_files'];
        }
        else {
            runtimeSlots['__jsoo_created_files'] = originalCreatedFiles;
        }
        delete runtimeSlots['__wasm_of_js_system_command'];
    }
});
