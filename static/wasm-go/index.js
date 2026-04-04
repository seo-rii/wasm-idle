import { compileGo, createGoCompiler, preloadBrowserGoRuntime } from './compiler.js';
import { createBrowserGoBuildPlan } from './build-planner.js';
import { executeBrowserGoArtifact, createBrowserWasiHost } from './browser-execution.js';
import { clearRuntimePackCache, fetchRuntimeAssetBytes, fetchRuntimeAssetJson, loadRuntimePackEntries, parseRuntimePackIndex } from './runtime-asset.js';
import { loadRuntimeManifest, normalizeRuntimeManifest, parseRuntimeManifest, resolveTargetManifest } from './runtime-manifest.js';
export { clearRuntimePackCache, compileGo, createBrowserGoBuildPlan, createBrowserWasiHost, createGoCompiler, executeBrowserGoArtifact, fetchRuntimeAssetBytes, fetchRuntimeAssetJson, loadRuntimeManifest, loadRuntimePackEntries, normalizeRuntimeManifest, parseRuntimeManifest, parseRuntimePackIndex, preloadBrowserGoRuntime, resolveTargetManifest };
const defaultFactory = createGoCompiler;
export default defaultFactory;
//# sourceMappingURL=index.js.map