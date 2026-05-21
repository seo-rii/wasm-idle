import type {
  BrowserDotnetArtifact,
  DotnetRuntimeRunResponse,
} from "./types.js";
import {
  loadDotnetCompilerRuntime,
  type DotnetCompilerRuntime,
  type DotnetCompilerRuntimeOptions,
} from "./runtime-loader.js";

export interface BrowserDotnetExecutionOptions extends DotnetCompilerRuntimeOptions {
  args?: string[];
  env?: Record<string, string>;
  stdin?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  runtime?: DotnetCompilerRuntime;
}

export interface BrowserDotnetExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function executeBrowserDotnetArtifact(
  artifact: BrowserDotnetArtifact,
  options: BrowserDotnetExecutionOptions = {},
): Promise<BrowserDotnetExecutionResult> {
  if (artifact.format !== "dotnet-browser-assembly") {
    throw new Error(`Unsupported .NET artifact format: ${artifact.format}`);
  }

  const runtime = options.runtime || (await loadDotnetCompilerRuntime(options));
  const response: DotnetRuntimeRunResponse = await runtime.run({
    assemblyId: artifact.assemblyId,
    args: options.args || [],
    env: options.env || {},
    stdin: options.stdin || "",
  });
  if (response.error) {
    throw new Error(response.error);
  }
  if (response.stdout) options.stdout?.(response.stdout);
  if (response.stderr) options.stderr?.(response.stderr);
  return {
    exitCode: typeof response.exitCode === "number" ? response.exitCode : 0,
    stdout: response.stdout || "",
    stderr: response.stderr || "",
  };
}
