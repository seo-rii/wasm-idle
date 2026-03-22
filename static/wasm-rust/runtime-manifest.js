import { resolveVersionedAssetUrl } from './asset-url.js';
function isNormalizedRuntimeManifest(value) {
    if (!('compiler' in value) || !('targets' in value) || !('defaultTargetTriple' in value)) {
        return false;
    }
    for (const targetConfig of Object.values(value.targets)) {
        if (targetConfig && !('targetTriple' in targetConfig)) {
            return false;
        }
    }
    return true;
}
function isRuntimeManifestV2(value) {
    return 'manifestVersion' in value && value.manifestVersion === 2;
}
function isRuntimeManifestV3(value) {
    return 'manifestVersion' in value && value.manifestVersion === 3;
}
function expectObject(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectString(value, label) {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectStringArray(value, label) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectTargetTriple(value, label) {
    if (value !== 'wasm32-wasip1' &&
        value !== 'wasm32-wasip2' &&
        value !== 'wasm32-wasip3') {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectArtifactFormat(value, label) {
    if (value !== 'core-wasm' && value !== 'component') {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectCompileKind(value, label) {
    if (value !== 'llvm-wasm' && value !== 'llvm-wasm+component-encoder') {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectExecutionKind(value, label) {
    if (value !== 'preview1' && value !== 'preview2-component') {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value;
}
function expectAssetFileArray(value, label) {
    if (!Array.isArray(value)) {
        throw new Error(`invalid ${label} in wasm-rust runtime manifest`);
    }
    return value.map((entry, index) => {
        const object = expectObject(entry, `${label}[${index}]`);
        return {
            asset: expectString(object.asset, `${label}[${index}].asset`),
            runtimePath: expectString(object.runtimePath, `${label}[${index}].runtimePath`)
        };
    });
}
function parseRuntimeAssetPack(value, label) {
    const object = expectObject(value, label);
    return {
        asset: expectString(object.asset, `${label}.asset`),
        index: expectString(object.index, `${label}.index`),
        fileCount: expectNumber(object.fileCount, `${label}.fileCount`),
        totalBytes: expectNumber(object.totalBytes, `${label}.totalBytes`)
    };
}
function parseRustcMemory(value, label) {
    const object = expectObject(value, label);
    return {
        initialPages: expectNumber(object.initialPages, `${label}.initialPages`),
        maximumPages: expectNumber(object.maximumPages, `${label}.maximumPages`)
    };
}
function parseCompilerConfig(value, label) {
    const object = expectObject(value, label);
    return {
        rustcWasm: expectString(object.rustcWasm, `${label}.rustcWasm`),
        workerBitcodeFile: expectString(object.workerBitcodeFile, `${label}.workerBitcodeFile`),
        workerSharedOutputBytes: expectNumber(object.workerSharedOutputBytes, `${label}.workerSharedOutputBytes`),
        compileTimeoutMs: expectNumber(object.compileTimeoutMs, `${label}.compileTimeoutMs`),
        artifactIdleMs: expectNumber(object.artifactIdleMs, `${label}.artifactIdleMs`),
        rustcMemory: parseRustcMemory(object.rustcMemory, `${label}.rustcMemory`)
    };
}
function parseLinkConfig(value, label) {
    const object = expectObject(value, label);
    const pack = object.pack === undefined ? undefined : parseRuntimeAssetPack(object.pack, `${label}.pack`);
    const files = object.files === undefined ? undefined : expectAssetFileArray(object.files, `${label}.files`);
    const allocatorObjectRuntimePath = object.allocatorObjectRuntimePath === undefined
        ? undefined
        : expectString(object.allocatorObjectRuntimePath, `${label}.allocatorObjectRuntimePath`);
    const allocatorObjectAsset = object.allocatorObjectAsset === undefined
        ? undefined
        : expectString(object.allocatorObjectAsset, `${label}.allocatorObjectAsset`);
    if (!pack && (!allocatorObjectRuntimePath || !allocatorObjectAsset || !files)) {
        throw new Error(`invalid ${label}: missing legacy link asset fields in wasm-rust runtime manifest`);
    }
    return {
        args: expectStringArray(object.args, `${label}.args`),
        ...(allocatorObjectRuntimePath
            ? {
                allocatorObjectRuntimePath
            }
            : {}),
        ...(allocatorObjectAsset
            ? {
                allocatorObjectAsset
            }
            : {}),
        ...(files
            ? {
                files
            }
            : {}),
        ...(pack
            ? {
                pack
            }
            : {})
    };
}
function parseRuntimeTargetConfig(value, label, targetTriple) {
    const object = expectObject(value, label);
    const compile = expectObject(object.compile, `${label}.compile`);
    const llvm = expectObject(compile.llvm, `${label}.compile.llvm`);
    const execution = expectObject(object.execution, `${label}.execution`);
    const sysrootFiles = object.sysrootFiles === undefined
        ? undefined
        : expectAssetFileArray(object.sysrootFiles, `${label}.sysrootFiles`);
    const sysrootPack = object.sysrootPack === undefined
        ? undefined
        : parseRuntimeAssetPack(object.sysrootPack, `${label}.sysrootPack`);
    if (!sysrootFiles && !sysrootPack) {
        throw new Error(`invalid ${label}: missing sysroot assets in wasm-rust runtime manifest`);
    }
    return {
        targetTriple,
        artifactFormat: expectArtifactFormat(object.artifactFormat, `${label}.artifactFormat`),
        ...(sysrootFiles
            ? {
                sysrootFiles
            }
            : {}),
        ...(sysrootPack
            ? {
                sysrootPack
            }
            : {}),
        compile: {
            kind: expectCompileKind(compile.kind, `${label}.compile.kind`),
            llvm: {
                llc: expectString(llvm.llc, `${label}.compile.llvm.llc`),
                lld: expectString(llvm.lld, `${label}.compile.llvm.lld`)
            },
            link: parseLinkConfig(compile.link, `${label}.compile.link`)
        },
        execution: {
            kind: expectExecutionKind(execution.kind, `${label}.execution.kind`)
        }
    };
}
function parseVersionedTargets(root) {
    const targets = expectObject(root.targets, 'targets');
    const parsedTargets = {};
    for (const targetTriple of ['wasm32-wasip1', 'wasm32-wasip2', 'wasm32-wasip3']) {
        const targetValue = targets[targetTriple];
        if (targetValue === undefined) {
            continue;
        }
        const parsedTarget = parseRuntimeTargetConfig(targetValue, `targets.${targetTriple}`, targetTriple);
        parsedTargets[targetTriple] = {
            artifactFormat: parsedTarget.artifactFormat,
            ...(parsedTarget.sysrootFiles
                ? {
                    sysrootFiles: parsedTarget.sysrootFiles
                }
                : {}),
            ...(parsedTarget.sysrootPack
                ? {
                    sysrootPack: parsedTarget.sysrootPack
                }
                : {}),
            compile: parsedTarget.compile,
            execution: parsedTarget.execution
        };
    }
    return parsedTargets;
}
export function parseRuntimeManifest(value) {
    const root = expectObject(value, 'root');
    if (root.manifestVersion === 3) {
        return {
            manifestVersion: 3,
            version: expectString(root.version, 'version'),
            hostTriple: expectString(root.hostTriple, 'hostTriple'),
            defaultTargetTriple: expectTargetTriple(root.defaultTargetTriple, 'defaultTargetTriple'),
            compiler: parseCompilerConfig(root.compiler, 'compiler'),
            targets: parseVersionedTargets(root)
        };
    }
    if (root.manifestVersion === 2) {
        return {
            manifestVersion: 2,
            version: expectString(root.version, 'version'),
            hostTriple: expectString(root.hostTriple, 'hostTriple'),
            defaultTargetTriple: expectTargetTriple(root.defaultTargetTriple, 'defaultTargetTriple'),
            compiler: parseCompilerConfig(root.compiler, 'compiler'),
            targets: parseVersionedTargets(root)
        };
    }
    const llvm = expectObject(root.llvm, 'llvm');
    return {
        version: expectString(root.version, 'version'),
        hostTriple: expectString(root.hostTriple, 'hostTriple'),
        targetTriple: expectTargetTriple(root.targetTriple, 'targetTriple'),
        rustcWasm: expectString(root.rustcWasm, 'rustcWasm'),
        workerBitcodeFile: expectString(root.workerBitcodeFile, 'workerBitcodeFile'),
        workerSharedOutputBytes: expectNumber(root.workerSharedOutputBytes, 'workerSharedOutputBytes'),
        compileTimeoutMs: expectNumber(root.compileTimeoutMs, 'compileTimeoutMs'),
        artifactIdleMs: expectNumber(root.artifactIdleMs, 'artifactIdleMs'),
        rustcMemory: parseRustcMemory(root.rustcMemory, 'rustcMemory'),
        sysrootFiles: expectAssetFileArray(root.sysrootFiles, 'sysrootFiles'),
        llvm: {
            llc: expectString(llvm.llc, 'llvm.llc'),
            lld: expectString(llvm.lld, 'llvm.lld')
        },
        link: parseLinkConfig(root.link, 'link')
    };
}
export function normalizeRuntimeManifest(value) {
    if (isNormalizedRuntimeManifest(value)) {
        return value;
    }
    if (isRuntimeManifestV2(value) || isRuntimeManifestV3(value)) {
        const targets = {};
        for (const [targetTriple, targetConfig] of Object.entries(value.targets)) {
            if (!targetConfig) {
                continue;
            }
            targets[targetTriple] = {
                targetTriple,
                artifactFormat: targetConfig.artifactFormat,
                ...(targetConfig.sysrootFiles
                    ? {
                        sysrootFiles: targetConfig.sysrootFiles
                    }
                    : {}),
                ...(targetConfig.sysrootPack
                    ? {
                        sysrootPack: targetConfig.sysrootPack
                    }
                    : {}),
                compile: targetConfig.compile,
                execution: targetConfig.execution
            };
        }
        return {
            manifestVersion: value.manifestVersion,
            version: value.version,
            hostTriple: value.hostTriple,
            defaultTargetTriple: value.defaultTargetTriple,
            compiler: value.compiler,
            targets
        };
    }
    return {
        manifestVersion: 1,
        version: value.version,
        hostTriple: value.hostTriple,
        defaultTargetTriple: value.targetTriple,
        compiler: {
            rustcWasm: value.rustcWasm,
            workerBitcodeFile: value.workerBitcodeFile,
            workerSharedOutputBytes: value.workerSharedOutputBytes,
            compileTimeoutMs: value.compileTimeoutMs,
            artifactIdleMs: value.artifactIdleMs,
            rustcMemory: value.rustcMemory
        },
        targets: {
            [value.targetTriple]: {
                targetTriple: value.targetTriple,
                artifactFormat: 'core-wasm',
                sysrootFiles: value.sysrootFiles,
                compile: {
                    kind: 'llvm-wasm',
                    llvm: value.llvm,
                    link: value.link
                },
                execution: {
                    kind: 'preview1'
                }
            }
        }
    };
}
export function resolveTargetManifest(manifest, targetTriple = manifest.defaultTargetTriple) {
    const target = manifest.targets[targetTriple];
    if (!target) {
        throw new Error(`unsupported wasm-rust target ${targetTriple}; available targets: ${Object.keys(manifest.targets).join(', ') || 'none'}`);
    }
    return target;
}
export async function loadRuntimeManifest(manifestUrl, fetchImpl = fetch) {
    const response = await fetchImpl(manifestUrl.toString());
    if (!response.ok) {
        throw new Error(`failed to load wasm-rust runtime manifest from ${manifestUrl}`);
    }
    return parseRuntimeManifest(await response.json());
}
export function resolveRuntimeAssetUrl(baseUrl, assetPath) {
    return resolveVersionedAssetUrl(baseUrl, assetPath).toString();
}
