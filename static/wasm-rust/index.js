import { compileRust, createBrowserRustCompileRequestIdentity, preloadBrowserRustRuntime, resolveBrowserRustDebugMode } from './compiler.js';
import { executeBrowserRustArtifact } from './browser-execution.js';
export { createBrowserRustCompileRequestIdentity, executeBrowserRustArtifact, preloadBrowserRustRuntime, resolveBrowserRustDebugMode };
export async function createRustCompiler(options) {
    return {
        compile: async (request) => compileRust(request, options?.dependencies)
    };
}
const defaultFactory = createRustCompiler;
export default defaultFactory;
