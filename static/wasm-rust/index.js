import { compileRust, preloadBrowserRustRuntime } from './compiler.js';
import { executeBrowserRustArtifact } from './browser-execution.js';
export { executeBrowserRustArtifact, preloadBrowserRustRuntime };
export async function createRustCompiler(options) {
    return {
        compile: async (request) => compileRust(request, options?.dependencies)
    };
}
const defaultFactory = createRustCompiler;
export default defaultFactory;
