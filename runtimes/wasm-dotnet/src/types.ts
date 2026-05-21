export type DotnetLanguage = "fsharp" | "csharp";
export type DotnetTarget = "browser-wasm";
export type BrowserDotnetArtifactFormat = "dotnet-browser-assembly";
export type BrowserDotnetCompileStage = "runtime" | "compile" | "done";

export interface CompilerDiagnostic {
  fileName?: string;
  lineNumber?: number;
  columnNumber?: number;
  endColumnNumber?: number;
  severity: "error" | "warning" | "other";
  message: string;
}

export interface BrowserDotnetCompileProgress {
  stage: BrowserDotnetCompileStage;
  completed: number;
  total: number;
  percent: number;
  message?: string;
}

export interface BrowserDotnetCompileRequest {
  code?: string;
  source?: string;
  language?: DotnetLanguage;
  target?: DotnetTarget;
  args?: string[];
  log?: boolean;
  prepare?: boolean;
  onProgress?: (progress: BrowserDotnetCompileProgress) => void;
}

export interface BrowserDotnetArtifact {
  format: BrowserDotnetArtifactFormat;
  assemblyId: string;
  language: DotnetLanguage;
  target: DotnetTarget;
}

export interface CompilerLogRecord {
  level: "log" | "warn" | "error";
  message: string;
}

export interface BrowserDotnetCompilerResult {
  success: boolean;
  artifact?: BrowserDotnetArtifact;
  stdout?: string;
  stderr?: string;
  diagnostics?: CompilerDiagnostic[];
  logs?: string[];
  logRecords?: CompilerLogRecord[];
}

export interface BrowserDotnetCompiler {
  compile(
    request: BrowserDotnetCompileRequest,
  ): Promise<BrowserDotnetCompilerResult>;
}

export interface DotnetReferenceAssembly {
  name: string;
  bytesBase64: string;
}

export interface DotnetRuntimeCompileRequest {
  source: string;
  language: DotnetLanguage;
  target: DotnetTarget;
  args?: string[];
  references?: DotnetReferenceAssembly[];
}

export interface DotnetRuntimeCompileResponse {
  assemblyId?: string;
  success?: boolean;
  stdout?: string;
  stderr?: string;
  diagnostics?: CompilerDiagnostic[];
  logs?: string[];
  error?: string;
}

export interface DotnetRuntimeRunRequest {
  assemblyId: string;
  args?: string[];
  env?: Record<string, string>;
  stdin?: string;
}

export interface DotnetRuntimeRunResponse {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}
