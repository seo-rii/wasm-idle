function toArrayBuffer(data) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy.buffer;
}
function toToolchainPath(path) {
    return path;
}
function isSourceArg(value) {
    return /^\/workspace\/.+\.(ml|mli|cmo|cma|cmi)$/.test(value);
}
function resolvePackageClosure(packages, packageMap) {
    const resolved = [];
    const visited = new Set();
    const visit = (packageName) => {
        if (visited.has(packageName)) {
            return;
        }
        const manifestPackage = packageMap.get(packageName);
        if (!manifestPackage) {
            throw new Error(`browser-native bundle does not include package: ${packageName}`);
        }
        visited.add(packageName);
        for (const dependency of manifestPackage.requires) {
            visit(dependency);
        }
        resolved.push(manifestPackage);
    };
    for (const packageName of packages) {
        visit(packageName);
    }
    return resolved;
}
function expandOcamlfindInvocation(argv, packageMap) {
    if (argv[1] !== 'ocamlc') {
        throw new Error(`unsupported browser-native ocamlfind subcommand: ${argv[1] || '(none)'}`);
    }
    const packages = [];
    const forwardedArgs = [];
    let linkpkg = false;
    for (let index = 2; index < argv.length; index += 1) {
        const argument = argv[index] || '';
        if (argument === '-package') {
            const value = argv[index + 1] || '';
            index += 1;
            for (const packageName of value.split(',').map((entry) => entry.trim()).filter(Boolean)) {
                packages.push(packageName);
            }
            continue;
        }
        if (argument === '-linkpkg') {
            linkpkg = true;
            continue;
        }
        forwardedArgs.push(argument);
    }
    const resolvedPackages = resolvePackageClosure(packages, packageMap);
    const includeArgs = resolvedPackages.flatMap((manifestPackage) => [
        '-I',
        toToolchainPath(manifestPackage.rootPath)
    ]);
    const archiveArgs = linkpkg
        ? resolvedPackages.flatMap((manifestPackage) => manifestPackage.archiveBytePath ? [toToolchainPath(manifestPackage.archiveBytePath)] : [])
        : [];
    const firstSourceIndex = forwardedArgs.findIndex((argument) => isSourceArg(argument));
    const beforeSources = firstSourceIndex >= 0 ? forwardedArgs.slice(0, firstSourceIndex) : forwardedArgs;
    const sourceArgs = firstSourceIndex >= 0 ? forwardedArgs.slice(firstSourceIndex) : [];
    return {
        command: 'ocamlc',
        argv: [...includeArgs, ...beforeSources, ...archiveArgs, ...sourceArgs],
        packages: resolvedPackages
    };
}
function getFilePreloadsFromFs(fs, prefix) {
    return fs.listFiles(prefix).map((filePath) => ({
        path: filePath,
        bytes: toArrayBuffer(fs.readFile(filePath))
    }));
}
function getToolchainPreloads(command, manifest, packages) {
    const selectedPackages = command === 'ocamlc' ? packages : manifest.packages;
    const selectedOcamlLibFiles = command === 'ocamlc'
        ? manifest.ocamlLibFiles.filter((file) => !file.path.includes('/compiler-libs/') &&
            !file.path.includes('/ocamldoc/') &&
            !file.path.includes('/runtime_events/'))
        : manifest.ocamlLibFiles;
    return [
        ...selectedOcamlLibFiles.map((file) => ({
            path: toToolchainPath(file.path),
            url: file.url
        })),
        ...selectedPackages.flatMap((manifestPackage) => manifestPackage.files.map((file) => ({
            path: toToolchainPath(file.path),
            url: file.url
        }))),
        {
            path: '/static/toolchain/findlib.conf',
            url: manifest.findlibConf
        }
    ];
}
export async function fetchBrowserNativeManifest() {
    const response = await fetch('/.cache/browser-native-bundle/browser-native-manifest.v1.json', {
        cache: 'no-store'
    });
    if (!response.ok) {
        throw new Error(`failed to fetch browser-native manifest: ${response.status}`);
    }
    return (await response.json());
}
export async function runBrowserNativeTool(request) {
    const worker = new Worker(new URL('../browser-harness/native-tool-worker.js', import.meta.url), {
        type: 'module'
    });
    try {
        return await new Promise((resolve, reject) => {
            const handleMessage = (event) => {
                const response = event.data;
                if (!response || response.type !== 'tool-result') {
                    return;
                }
                worker.removeEventListener('message', handleMessage);
                resolve({
                    exitCode: response.exitCode,
                    stdout: response.stdout,
                    stderr: response.stderr,
                    ...(response.thrown ? { thrown: response.thrown } : {}),
                    files: response.files.map((file) => ({
                        path: file.path,
                        data: new Uint8Array(file.data)
                    }))
                });
            };
            worker.addEventListener('message', handleMessage);
            worker.addEventListener('error', (error) => {
                worker.removeEventListener('message', handleMessage);
                reject(error.error || new Error(error.message));
            }, { once: true });
            worker.postMessage({
                type: 'run-tool',
                toolUrl: request.toolUrl,
                argv: request.argv,
                env: request.env,
                preloadFiles: request.preloadFiles,
                outputPrefixes: request.outputPrefixes,
                ...(request.systemBridge ? { systemBridge: request.systemBridge } : {})
            });
        });
    }
    finally {
        worker.terminate();
    }
}
export function createBrowserWorkerSystemDispatcher(options) {
    const packageMap = new Map(options.manifest.packages.map((manifestPackage) => [manifestPackage.name, manifestPackage]));
    return (async (argv, context) => {
        if (argv.length === 0) {
            throw new Error('browser-native system dispatcher requires at least one argv element');
        }
        let commandName;
        let toolArgv;
        let packageClosure = [];
        if (argv[0] === 'ocamlfind') {
            const expandedInvocation = expandOcamlfindInvocation(argv, packageMap);
            commandName = expandedInvocation.command;
            toolArgv = expandedInvocation.argv;
            packageClosure = expandedInvocation.packages;
        }
        else if (argv[0] === 'ocamlc' || argv[0] === 'js_of_ocaml' || argv[0] === 'wasm_of_ocaml') {
            commandName = argv[0];
            toolArgv = argv.slice(1);
        }
        else {
            throw new Error(`unsupported browser-native subprocess: ${argv[0]}`);
        }
        const env = { ...context.env };
        if (commandName === 'ocamlc') {
            env['OCAMLLIB'] = env['OCAMLLIB'] || '/static/toolchain/lib/ocaml';
        }
        if (commandName === 'js_of_ocaml' || commandName === 'wasm_of_ocaml') {
            env['OCAMLFIND_CONF'] = env['OCAMLFIND_CONF'] || '/static/toolchain/findlib.conf';
        }
        const result = await runBrowserNativeTool({
            toolUrl: options.manifest.tools[commandName],
            argv: toolArgv,
            env,
            preloadFiles: [
                ...getToolchainPreloads(commandName, options.manifest, packageClosure),
                ...getFilePreloadsFromFs(context.fs, '/workspace'),
                ...getFilePreloadsFromFs(context.fs, '/tmp')
            ],
            outputPrefixes: ['/workspace/_build', '/tmp'],
            ...(commandName === 'wasm_of_ocaml' ? { systemBridge: 'binaryen' } : {})
        });
        const toolReportedSuccess = (commandName === 'js_of_ocaml' || commandName === 'wasm_of_ocaml') &&
            result.files.some((file) => file.path.endsWith('.js')) &&
            ((result.thrown || '').includes('tool-exit:0') || result.stderr.includes('tool-exit:0'));
        const normalizedExitCode = toolReportedSuccess ? 0 : result.exitCode;
        const normalizedThrown = toolReportedSuccess && (result.thrown || '').includes('tool-exit:0')
            ? undefined
            : result.thrown;
        const normalizedStderr = toolReportedSuccess
            ? result.stderr
                .split('\n')
                .filter((line) => !line.includes('tool-exit:0'))
                .join('\n')
            : result.stderr;
        for (const file of result.files) {
            context.fs.writeFile(file.path, file.data);
        }
        return {
            exitCode: normalizedExitCode,
            stdout: result.stdout,
            stderr: [normalizedStderr, normalizedThrown].filter(Boolean).join('\n')
        };
    });
}
