import { loadDotnetCompilerRuntime } from './runtime-loader.js';
export async function executeBrowserDotnetArtifact(artifact, options = {}) {
    if (artifact.format !== 'dotnet-browser-assembly') {
        throw new Error(`Unsupported .NET artifact format: ${artifact.format}`);
    }
    const runtime = options.runtime ||
        (await loadDotnetCompilerRuntime({ ...options, language: artifact.language }));
    const response = await runtime.run({
        assemblyId: artifact.assemblyId,
        args: options.args || [],
        env: options.env || {},
        stdin: options.stdin || ''
    });
    if (response.error) {
        throw new Error(response.error);
    }
    if (response.stdout)
        options.stdout?.(response.stdout);
    if (response.stderr)
        options.stderr?.(response.stderr);
    return {
        exitCode: typeof response.exitCode === 'number' ? response.exitCode : 0,
        stdout: response.stdout || '',
        stderr: response.stderr || ''
    };
}
//# sourceMappingURL=browser-execution.js.map