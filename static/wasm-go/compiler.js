import { createBrowserGoBuildPlan } from './build-planner.js';
import { resolveVersionedAssetUrl } from './asset-url.js';
import { fetchRuntimeAssetBytes, loadRuntimePackEntries, loadRuntimePackIndex } from './runtime-asset.js';
import { executeGoToolInvocation } from './tool-runtime.js';
import { createSysrootDependency, normalizeCompileRequestSource, normalizePackageImportPath, normalizeRequestedTarget, parseCompilerDiagnostics, validateCompileRequest } from './compiler-support.js';
import { loadRuntimeManifest, normalizeRuntimeManifest, resolveTargetManifest } from './runtime-manifest.js';
const DEFAULT_RUNTIME_MANIFEST_URL = new URL('./runtime/runtime-manifest.v1.json', import.meta.url);
const DEFAULT_RUNTIME_BASE_URL = new URL('./runtime/', import.meta.url);
function createRuntimeFetch() {
    return (async (input) => {
        const url = new URL(input.toString());
        if (url.protocol !== 'file:') {
            return fetch(url);
        }
        const [{ readFile }, { fileURLToPath }] = await Promise.all([
            import('node:fs/promises'),
            import('node:url')
        ]);
        try {
            return new Response(await readFile(fileURLToPath(url)));
        }
        catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
            return new Response(null, {
                status: code === 'ENOENT' ? 404 : 500
            });
        }
    });
}
function toStandaloneBytes(value) {
    return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}
function normalizeToolOutputs(outputs) {
    if (!outputs) {
        return {};
    }
    return Object.fromEntries(Object.entries(outputs).map(([path, bytes]) => [path, toStandaloneBytes(bytes)]));
}
async function resolveCompilerRuntime(options, dependencies = {}) {
    const runtimeBaseUrl = options.runtimeBaseUrl || DEFAULT_RUNTIME_BASE_URL;
    if (options.manifest) {
        return {
            manifest: normalizeRuntimeManifest(options.manifest),
            runtimeBaseUrl
        };
    }
    const manifestUrl = options.runtimeManifestUrl || DEFAULT_RUNTIME_MANIFEST_URL;
    return {
        manifest: await (dependencies.loadManifest || loadRuntimeManifest)(manifestUrl, dependencies.fetchImpl),
        runtimeBaseUrl: options.runtimeBaseUrl || new URL('./', manifestUrl.toString())
    };
}
function createProgressEmitter(request) {
    let lastPercent = 0;
    return (stage, completed, total, message) => {
        if (!request.onProgress) {
            return;
        }
        const safeTotal = Math.max(1, total);
        const safeCompleted = Math.max(0, Math.min(completed, safeTotal));
        const stageRanges = {
            manifest: [0, 15],
            plan: [15, 35],
            compile: [35, 75],
            link: [75, 95],
            done: [100, 100]
        };
        const [start, end] = stageRanges[stage];
        const percent = stage === 'done'
            ? 100
            : Math.max(lastPercent, Math.min(99, start + ((end - start) * safeCompleted) / safeTotal));
        lastPercent = percent;
        request.onProgress({
            stage,
            completed: safeCompleted,
            total: safeTotal,
            percent,
            ...(message ? { message } : {})
        });
    };
}
function createLogBuffer(enabled) {
    const records = [];
    return {
        records,
        push(message, level = 'log') {
            if (!enabled) {
                return;
            }
            records.push({
                level,
                message
            });
        }
    };
}
function failure(message, logs, plan, stdout, diagnostics) {
    return {
        success: false,
        stderr: message,
        ...(stdout ? { stdout } : {}),
        ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
        ...(plan ? { plan } : {}),
        ...(logs.length > 0
            ? {
                logRecords: logs,
                logs: logs.map((entry) => entry.message)
            }
            : {})
    };
}
function success(artifact, logs, plan, stdout, stderr) {
    return {
        success: true,
        artifact,
        plan,
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
        ...(logs.length > 0
            ? {
                logRecords: logs,
                logs: logs.map((entry) => entry.message)
            }
            : {})
    };
}
export async function preloadBrowserGoRuntime(options = {}) {
    const fetchImpl = options.fetchImpl || createRuntimeFetch();
    const { manifest, runtimeBaseUrl } = await resolveCompilerRuntime(options, {
        fetchImpl
    });
    const target = resolveTargetManifest(manifest, options.target);
    const fetchedAssets = [];
    const preloadAsset = async (assetPath, label) => {
        await fetchRuntimeAssetBytes(resolveVersionedAssetUrl(runtimeBaseUrl, assetPath), label, fetchImpl);
        fetchedAssets.push(resolveVersionedAssetUrl(runtimeBaseUrl, assetPath).toString());
    };
    await preloadAsset(manifest.compiler.compile.asset, 'compile.wasm');
    await preloadAsset(manifest.compiler.link.asset, 'link.wasm');
    if (options.includeSysroot !== false) {
        if (target.sysrootPack) {
            await loadRuntimePackEntries(runtimeBaseUrl, target.sysrootPack, fetchImpl);
            fetchedAssets.push(resolveVersionedAssetUrl(runtimeBaseUrl, target.sysrootPack.index).toString());
            fetchedAssets.push(resolveVersionedAssetUrl(runtimeBaseUrl, target.sysrootPack.asset).toString());
        }
        else {
            for (const entry of target.sysrootFiles || []) {
                await preloadAsset(entry.asset, `sysroot asset ${entry.runtimePath}`);
            }
        }
    }
    if (target.execution.kind === 'js-wasm-exec' && target.execution.wasmExecJs) {
        await preloadAsset(target.execution.wasmExecJs, 'wasm_exec.js');
    }
    return {
        manifest,
        target,
        runtimeBaseUrl: runtimeBaseUrl.toString(),
        fetchedAssets
    };
}
async function resolveAutoDependencies(manifest, runtimeBaseUrl, request, fetchImpl) {
    if (request.dependencies && request.dependencies.length > 0) {
        return request.dependencies;
    }
    if (request.autoDependencies === 'none') {
        return [];
    }
    const target = resolveTargetManifest(manifest, normalizeRequestedTarget(request));
    if (target.sysrootFiles && target.sysrootFiles.length > 0) {
        return target.sysrootFiles
            .map((entry) => createSysrootDependency(entry.runtimePath))
            .filter((entry) => entry !== null);
    }
    if (target.sysrootPack) {
        const index = await loadRuntimePackIndex(runtimeBaseUrl, target.sysrootPack, fetchImpl);
        return index.entries
            .map((entry) => createSysrootDependency(entry.runtimePath))
            .filter((entry) => entry !== null);
    }
    return [];
}
async function resolveCompileRequest(request, manifest, runtimeBaseUrl, fetchImpl) {
    const validationError = validateCompileRequest(request);
    if (validationError) {
        return {
            error: validationError
        };
    }
    return {
        request: {
            ...request,
            target: normalizeRequestedTarget(request),
            files: normalizeCompileRequestSource(request),
            packageImportPath: normalizePackageImportPath(request),
            dependencies: await resolveAutoDependencies(manifest, runtimeBaseUrl, request, fetchImpl)
        }
    };
}
export async function compileGo(request, options = {}) {
    const dependencies = options.dependencies || {};
    const fetchImpl = dependencies.fetchImpl || createRuntimeFetch();
    const progress = createProgressEmitter(request);
    const logs = createLogBuffer(Boolean(request.log));
    progress('manifest', 0, 1, 'loading runtime manifest');
    const { manifest, runtimeBaseUrl } = await resolveCompilerRuntime(options, {
        ...dependencies,
        fetchImpl
    });
    progress('manifest', 1, 1, `loaded runtime manifest for ${manifest.defaultTarget}`);
    const resolvedRequest = await resolveCompileRequest(request, manifest, runtimeBaseUrl, fetchImpl);
    if ('error' in resolvedRequest) {
        return failure(resolvedRequest.error || 'invalid compile request', logs.records);
    }
    progress('plan', 0, 1, 'building compile plan');
    const plan = createBrowserGoBuildPlan(resolvedRequest.request, manifest);
    logs.push(`[wasm-go] plan target=${plan.target} package=${plan.packageImportPath} kind=${plan.packageKind}`);
    progress('plan', 1, 1, 'compile plan ready');
    const runTool = dependencies.runTool ||
        (!options.manifest
            ? ((invocation) => executeGoToolInvocation(invocation, plan, runtimeBaseUrl, fetchImpl))
            : undefined);
    if (!runTool) {
        return failure('wasm-go phase 0-1 scaffolding is ready, but compile.wasm/link.wasm execution is not wired yet. Provide dependencies.runTool to execute the generated build plan.', logs.records, plan);
    }
    progress('compile', 0, 1, 'running compile');
    logs.push(`[wasm-go] compile ${plan.compile.args.join(' ')}`);
    const compileResult = await runTool(plan.compile);
    const compileOutputs = normalizeToolOutputs(compileResult.outputs);
    if (compileResult.exitCode !== 0) {
        return failure(compileResult.stderr || 'go compile failed', logs.records, plan, compileResult.stdout, parseCompilerDiagnostics(compileResult.stdout || compileResult.stderr));
    }
    progress('compile', 1, 1, 'compile finished');
    let stdout = compileResult.stdout || '';
    let stderr = compileResult.stderr || '';
    if (!plan.link) {
        const archive = compileOutputs[plan.compile.outputPath];
        if (!archive) {
            return failure(`compile completed without producing ${plan.compile.outputPath}`, logs.records, plan, stdout);
        }
        progress('done', 1, 1, 'archive ready');
        return success({
            bytes: archive,
            target: plan.target,
            format: 'go-archive'
        }, logs.records, plan, stdout, stderr);
    }
    progress('link', 0, 1, 'running link');
    logs.push(`[wasm-go] link ${plan.link.args.join(' ')}`);
    const linkInputs = {
        ...plan.link,
        inputFiles: [
            ...plan.link.inputFiles,
            {
                path: plan.compile.outputPath,
                contents: compileOutputs[plan.compile.outputPath]
            }
        ]
    };
    const linkResult = await runTool(linkInputs);
    const linkOutputs = normalizeToolOutputs(linkResult.outputs);
    stdout += linkResult.stdout || '';
    stderr += linkResult.stderr || '';
    if (linkResult.exitCode !== 0) {
        return failure(linkResult.stderr || 'go link failed', logs.records, plan, stdout, parseCompilerDiagnostics(linkResult.stderr || stdout));
    }
    const linkedArtifact = linkOutputs[plan.link.outputPath];
    if (!linkedArtifact) {
        return failure(`link completed without producing ${plan.link.outputPath}`, logs.records, plan, stdout);
    }
    progress('link', 1, 1, 'link finished');
    progress('done', 1, 1, 'artifact ready');
    return success({
        bytes: linkedArtifact,
        wasm: linkedArtifact,
        target: plan.target,
        format: plan.artifactFormat
    }, logs.records, plan, stdout, stderr);
}
export async function createGoCompiler(options = {}) {
    return {
        plan: async (request) => {
            const fetchImpl = options.dependencies?.fetchImpl || createRuntimeFetch();
            const { manifest, runtimeBaseUrl } = await resolveCompilerRuntime(options, {
                ...options.dependencies,
                fetchImpl
            });
            const resolvedRequest = await resolveCompileRequest(request, manifest, runtimeBaseUrl, fetchImpl);
            if ('error' in resolvedRequest) {
                throw new Error(resolvedRequest.error);
            }
            return createBrowserGoBuildPlan(resolvedRequest.request, manifest);
        },
        compile: async (request) => compileGo(request, options)
    };
}
//# sourceMappingURL=compiler.js.map