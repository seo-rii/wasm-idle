import { compileRust, createBrowserRustCompileRequestIdentity, preloadBrowserRustRuntime as preloadBrowserRustRuntimeInternal, resolveBrowserRustDebugMode } from './compiler.js';
import { executeBrowserRustArtifact as executeBrowserRustArtifactInternal } from './browser-execution.js';
import { loadBundledRuntimeContext } from './compiler-runtime.js';
import { parseWasmRustRuntimeProfileFromModuleUrl } from './runtime-manifest.js';
export { createBrowserRustCompileRequestIdentity, resolveBrowserRustDebugMode };
const bundledRuntimeProfile = parseWasmRustRuntimeProfileFromModuleUrl(import.meta.url);
function assertMatchingRuntimeProfile(provided, bundled) {
    if (!provided)
        return;
    if (provided.protocolVersion !== bundled.protocolVersion ||
        provided.profileId !== bundled.profileId ||
        provided.manifestPath !== bundled.manifestPath ||
        provided.manifestFingerprint !== bundled.manifestFingerprint ||
        provided.manifestReceipt.bytes !== bundled.manifestReceipt.bytes ||
        provided.manifestReceipt.sha256 !== bundled.manifestReceipt.sha256 ||
        provided.moduleUrl !== bundled.moduleUrl) {
        throw new Error('wasm-rust runtime dependency profile conflicts with the bundled profile');
    }
}
function sealCompileDependencies(dependencies, profile) {
    assertMatchingRuntimeProfile(dependencies?.runtimeProfile, profile);
    const { loadManifest: _loadManifest, runtimeProfile: _runtimeProfile, ...sealed } = dependencies || {};
    return { ...sealed, runtimeProfile: profile };
}
export async function preloadBrowserRustRuntime(options = {}) {
    if (bundledRuntimeProfile) {
        assertMatchingRuntimeProfile(options.dependencies?.runtimeProfile, bundledRuntimeProfile);
    }
    const { loadManifest: _loadManifest, runtimeProfile: _runtimeProfile, ...preloadDependencies } = options.dependencies || {};
    return preloadBrowserRustRuntimeInternal({
        ...options,
        ...(bundledRuntimeProfile
            ? {
                dependencies: {
                    ...preloadDependencies,
                    runtimeProfile: bundledRuntimeProfile
                }
            }
            : {})
    });
}
export async function executeBrowserRustArtifact(artifact, runtimeBaseUrlOrOptions, options) {
    if (typeof runtimeBaseUrlOrOptions === 'string') {
        return executeBrowserRustArtifactInternal(artifact, runtimeBaseUrlOrOptions, options);
    }
    if (artifact.format === 'component' && bundledRuntimeProfile) {
        const context = await loadBundledRuntimeContext(undefined, artifact.targetTriple, bundledRuntimeProfile);
        return executeBrowserRustArtifactInternal(artifact, context.versionedRuntimeBaseUrl.toString(), runtimeBaseUrlOrOptions);
    }
    return executeBrowserRustArtifactInternal(artifact, runtimeBaseUrlOrOptions);
}
export async function createRustCompiler(options) {
    return {
        compile: async (request) => compileRust(request, bundledRuntimeProfile
            ? sealCompileDependencies(options?.dependencies, bundledRuntimeProfile)
            : options?.dependencies)
    };
}
const defaultFactory = createRustCompiler;
export default defaultFactory;
