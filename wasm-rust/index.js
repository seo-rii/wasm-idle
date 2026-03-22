import { compileRust } from './compiler.js';
import { executeBrowserRustArtifact } from './browser-execution.js';
export { executeBrowserRustArtifact };
export async function createRustCompiler(options) {
    return {
        compile: async (request) => compileRust(request, options?.dependencies)
    };
}
const defaultFactory = createRustCompiler;
export default defaultFactory;
