import { fetchRuntimeAssetJson } from './runtime-asset.js';
function isNormalizedRuntimeManifest(value) {
    for (const target of Object.values(value.targets)) {
        if (target && 'target' in target) {
            return true;
        }
    }
    return false;
}
function expectObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function expectString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function expectStringArray(value, label) {
    if (!Array.isArray(value) ||
        value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function expectPositiveInteger(value, label) {
    if (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value <= 0 ||
        !Number.isFinite(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function expectNonNegativeInteger(value, label) {
    if (typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        !Number.isFinite(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function expectTarget(value, label) {
    if (value !== 'wasip1/wasm' &&
        value !== 'wasip2/wasm' &&
        value !== 'wasip3/wasm' &&
        value !== 'js/wasm') {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function expectArtifactFormat(value, label) {
    if (value !== 'wasi-core-wasm' && value !== 'js-wasm') {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function parseRuntimeAssetFileArray(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value.map((entry, index) => {
        const object = expectObject(entry, `${label}[${index}]`);
        return {
            asset: expectString(object.asset, `${label}[${index}].asset`),
            runtimePath: expectString(object.runtimePath, `${label}[${index}].runtimePath`),
            ...(typeof object.readonly === 'boolean' ? { readonly: object.readonly } : {})
        };
    });
}
function expectSha256(value, label) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    return value;
}
function parseRuntimeChunks(value, label) {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`invalid ${label} in wasm-go runtime manifest`);
    }
    const paths = new Set();
    return value.map((entry, index) => {
        const object = expectObject(entry, `${label}[${index}]`);
        const reference = parseRuntimePackReference(object, `${label}[${index}]`);
        const runtimePaths = expectStringArray(object.runtimePaths, `${label}[${index}].runtimePaths`);
        if (runtimePaths.length !== reference.fileCount ||
            !reference.sha256 ||
            !reference.indexSha256 ||
            (reference.delta && reference.decodedTotalBytes === undefined)) {
            throw new Error(`invalid ${label}[${index}] chunk paths or integrity`);
        }
        for (let base = reference.delta?.base; base; base = base.delta?.base) {
            if (!base.sha256 || !base.indexSha256) {
                throw new Error(`invalid ${label}[${index}] delta base integrity`);
            }
        }
        for (const path of runtimePaths) {
            if (!path.startsWith('/sysroot/') ||
                path
                    .slice(1)
                    .split('/')
                    .some((part) => !part || part === '..' || part === '.') ||
                path.includes('\\') ||
                paths.has(path)) {
                throw new Error(`invalid or duplicate ${label} runtime path ${path}`);
            }
            paths.add(path);
        }
        return { ...reference, runtimePaths };
    });
}
function parseRuntimePackReference(value, label, ancestors = new Set()) {
    const object = expectObject(value, label);
    if (ancestors.has(object)) {
        throw new Error(`invalid recursive ${label} in wasm-go runtime manifest`);
    }
    ancestors.add(object);
    try {
        let delta;
        if (object.delta !== undefined) {
            const deltaObject = expectObject(object.delta, `${label}.delta`);
            if (deltaObject.format !== 'copy-literal-v1') {
                throw new Error(`invalid ${label}.delta.format in wasm-go runtime manifest`);
            }
            delta = {
                format: 'copy-literal-v1',
                base: parseRuntimePackReference(deltaObject.base, `${label}.delta.base`, ancestors)
            };
        }
        return {
            asset: expectString(object.asset, `${label}.asset`),
            index: expectString(object.index, `${label}.index`),
            fileCount: expectNonNegativeInteger(object.fileCount, `${label}.fileCount`),
            totalBytes: expectNonNegativeInteger(object.totalBytes, `${label}.totalBytes`),
            ...(object.sha256 !== undefined
                ? { sha256: expectSha256(object.sha256, `${label}.sha256`) }
                : {}),
            ...(object.indexSha256 !== undefined
                ? { indexSha256: expectSha256(object.indexSha256, `${label}.indexSha256`) }
                : {}),
            ...(object.decodedTotalBytes !== undefined
                ? {
                    decodedTotalBytes: expectNonNegativeInteger(object.decodedTotalBytes, `${label}.decodedTotalBytes`)
                }
                : {}),
            ...(delta ? { delta } : {})
        };
    }
    finally {
        ancestors.delete(object);
    }
}
function parseRuntimeStdlibIndexAsset(value, label) {
    const object = expectObject(value, label);
    return {
        asset: expectString(object.asset, `${label}.asset`),
        packageCount: expectNonNegativeInteger(object.packageCount, `${label}.packageCount`)
    };
}
function parseRuntimeToolConfig(value, label) {
    const object = expectObject(value, label);
    const memory = expectObject(object.memory, `${label}.memory`);
    return {
        asset: expectString(object.asset, `${label}.asset`),
        argv0: expectString(object.argv0, `${label}.argv0`),
        memory: {
            initialPages: expectPositiveInteger(memory.initialPages, `${label}.memory.initialPages`),
            maximumPages: expectPositiveInteger(memory.maximumPages, `${label}.memory.maximumPages`)
        }
    };
}
function parseRuntimeHostConfig(value, label) {
    const object = expectObject(value, label);
    return {
        rootDirectory: expectString(object.rootDirectory, `${label}.rootDirectory`),
        pwd: expectString(object.pwd, `${label}.pwd`),
        tmpDirectory: expectString(object.tmpDirectory, `${label}.tmpDirectory`),
        env: expectStringArray(object.env, `${label}.env`)
    };
}
function parseRuntimePlannerConfig(value, label) {
    const object = expectObject(value, label);
    return {
        workspaceRoot: expectString(object.workspaceRoot, `${label}.workspaceRoot`),
        importcfgPath: expectString(object.importcfgPath, `${label}.importcfgPath`),
        embedcfgPath: expectString(object.embedcfgPath, `${label}.embedcfgPath`),
        compileOutputPath: expectString(object.compileOutputPath, `${label}.compileOutputPath`),
        linkOutputPath: expectString(object.linkOutputPath, `${label}.linkOutputPath`),
        defaultLang: expectString(object.defaultLang, `${label}.defaultLang`),
        defaultTrimpath: expectString(object.defaultTrimpath, `${label}.defaultTrimpath`)
    };
}
function parseRuntimeCompilerConfig(value, label) {
    const object = expectObject(value, label);
    return {
        compile: parseRuntimeToolConfig(object.compile, `${label}.compile`),
        link: parseRuntimeToolConfig(object.link, `${label}.link`),
        compileTimeoutMs: expectPositiveInteger(object.compileTimeoutMs, `${label}.compileTimeoutMs`),
        linkTimeoutMs: expectPositiveInteger(object.linkTimeoutMs, `${label}.linkTimeoutMs`),
        host: parseRuntimeHostConfig(object.host, `${label}.host`)
    };
}
function parseExecutionConfig(value, label) {
    const object = expectObject(value, label);
    if (object.kind !== 'wasi-preview1' && object.kind !== 'js-wasm-exec') {
        throw new Error(`invalid ${label}.kind in wasm-go runtime manifest`);
    }
    if (object.kind === 'js-wasm-exec') {
        return {
            kind: 'js-wasm-exec',
            wasmExecJs: expectString(object.wasmExecJs, `${label}.wasmExecJs`)
        };
    }
    return {
        kind: 'wasi-preview1'
    };
}
function expectedTargetShape(target) {
    if (target === 'wasip1/wasm') {
        return {
            goos: ['wasip1'],
            goarch: 'wasm'
        };
    }
    if (target === 'wasip2/wasm') {
        return {
            goos: ['wasip1', 'wasip2'],
            goarch: 'wasm'
        };
    }
    if (target === 'wasip3/wasm') {
        return {
            goos: ['wasip1', 'wasip3'],
            goarch: 'wasm'
        };
    }
    return {
        goos: ['js'],
        goarch: 'wasm'
    };
}
function parseTargetConfig(target, value, label) {
    const object = expectObject(value, label);
    const expected = expectedTargetShape(target);
    const goos = expectString(object.goos, `${label}.goos`);
    const goarch = expectString(object.goarch, `${label}.goarch`);
    if (!expected.goos.includes(goos) || goarch !== expected.goarch) {
        throw new Error(`invalid ${label}.goos/goarch in wasm-go runtime manifest`);
    }
    return {
        target,
        goos,
        goarch,
        artifactFormat: expectArtifactFormat(object.artifactFormat, `${label}.artifactFormat`),
        ...(object.sysrootFiles !== undefined
            ? {
                sysrootFiles: parseRuntimeAssetFileArray(object.sysrootFiles, `${label}.sysrootFiles`)
            }
            : {}),
        ...(object.sysrootPack !== undefined
            ? { sysrootPack: parseRuntimePackReference(object.sysrootPack, `${label}.sysrootPack`) }
            : {}),
        ...(object.sysrootChunks !== undefined
            ? { sysrootChunks: parseRuntimeChunks(object.sysrootChunks, `${label}.sysrootChunks`) }
            : {}),
        ...(object.stdlibIndex !== undefined
            ? {
                stdlibIndex: parseRuntimeStdlibIndexAsset(object.stdlibIndex, `${label}.stdlibIndex`)
            }
            : {}),
        execution: parseExecutionConfig(object.execution, `${label}.execution`),
        planner: parseRuntimePlannerConfig(object.planner, `${label}.planner`)
    };
}
export function parseRuntimeManifest(value) {
    const root = expectObject(value, 'root');
    if (root.manifestVersion !== 1) {
        throw new Error('invalid root.manifestVersion in wasm-go runtime manifest');
    }
    const targetsObject = expectObject(root.targets, 'root.targets');
    const targets = {};
    for (const [targetKey, targetValue] of Object.entries(targetsObject)) {
        const target = expectTarget(targetKey, `root.targets.${targetKey}`);
        targets[target] = parseTargetConfig(target, targetValue, `root.targets.${target}`);
    }
    return {
        manifestVersion: 1,
        version: expectString(root.version, 'root.version'),
        goVersion: expectString(root.goVersion, 'root.goVersion'),
        defaultTarget: expectTarget(root.defaultTarget, 'root.defaultTarget'),
        compiler: parseRuntimeCompilerConfig(root.compiler, 'root.compiler'),
        targets
    };
}
export function normalizeRuntimeManifest(value) {
    const parsed = isNormalizedRuntimeManifest(value)
        ? value
        : (() => {
            const manifest = parseRuntimeManifest(value);
            const normalizedTargets = {};
            for (const target of Object.keys(manifest.targets)) {
                const config = manifest.targets[target];
                if (!config) {
                    continue;
                }
                normalizedTargets[target] = {
                    target,
                    ...config
                };
            }
            return {
                manifestVersion: 1,
                version: manifest.version,
                goVersion: manifest.goVersion,
                defaultTarget: manifest.defaultTarget,
                compiler: manifest.compiler,
                targets: normalizedTargets
            };
        })();
    if (!parsed.targets[parsed.defaultTarget]) {
        throw new Error(`default target ${parsed.defaultTarget} is not present in wasm-go runtime manifest`);
    }
    return parsed;
}
export function resolveTargetManifest(manifest, target) {
    const normalized = normalizeRuntimeManifest(manifest);
    const resolvedTarget = target || normalized.defaultTarget;
    const targetConfig = normalized.targets[resolvedTarget];
    if (!targetConfig) {
        throw new Error(`unsupported wasm-go target ${resolvedTarget}`);
    }
    return targetConfig;
}
export async function loadRuntimeManifest(manifestUrl, fetchImpl = fetch, reportProgress, options = {}) {
    try {
        return normalizeRuntimeManifest(await fetchRuntimeAssetJson(manifestUrl, 'wasm-go runtime manifest', fetchImpl, reportProgress, options));
    }
    catch (error) {
        if (options.signal?.aborted) {
            throw (options.signal.reason ??
                new DOMException('wasm-go runtime manifest load aborted', 'AbortError'));
        }
        if (error instanceof DOMException &&
            (error.name === 'AbortError' || error.name === 'TimeoutError')) {
            throw error;
        }
        throw new Error(`failed to load wasm-go runtime manifest from ${manifestUrl.toString()}: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=runtime-manifest.js.map