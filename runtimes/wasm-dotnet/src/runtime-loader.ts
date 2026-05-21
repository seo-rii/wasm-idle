import type {
  DotnetRuntimeCompileRequest,
  DotnetRuntimeCompileResponse,
  DotnetRuntimeRunRequest,
  DotnetRuntimeRunResponse,
} from "./types.js";

export interface DotnetCompilerRuntimeOptions {
  runtimeBaseUrl?: string | URL;
  dotnetJsUrl?: string | URL;
  mainAssemblyName?: string;
  dotnetModule?: unknown;
}

export interface DotnetCompilerRuntime {
  compile(
    request: DotnetRuntimeCompileRequest,
  ): Promise<DotnetRuntimeCompileResponse>;
  run(request: DotnetRuntimeRunRequest): Promise<DotnetRuntimeRunResponse>;
}

type DotnetBuilder = {
  withDiagnosticTracing?: (enabled: boolean) => DotnetBuilder;
  create: () => Promise<{
    getAssemblyExports?: (
      assemblyName: string,
    ) => Promise<Record<string, unknown>>;
    getConfig?: () => { mainAssemblyName?: string };
  }>;
};

type RuntimeBridge = {
  Compile?: (requestJson: string) => string | Promise<string>;
  compile?: (requestJson: string) => string | Promise<string>;
  Run?: (requestJson: string) => string | Promise<string>;
  run?: (requestJson: string) => string | Promise<string>;
};

let runtimePromise: Promise<DotnetCompilerRuntime> | null = null;
let runtimeKey = "";

function resolveRuntimeBaseUrl(options: DotnetCompilerRuntimeOptions) {
  return new URL(options.runtimeBaseUrl || "./runtime/", import.meta.url);
}

function resolveDotnetJsUrl(options: DotnetCompilerRuntimeOptions) {
  if (options.dotnetJsUrl) {
    return new URL(
      options.dotnetJsUrl,
      globalThis.location?.href || import.meta.url,
    ).toString();
  }
  return new URL("dotnet.js", resolveRuntimeBaseUrl(options)).toString();
}

function getDotnetBuilder(module: unknown): DotnetBuilder {
  const record = module as Record<string, unknown>;
  const dotnet =
    record?.dotnet ||
    (record?.default as Record<string, unknown> | undefined)?.dotnet;
  if (!dotnet || typeof (dotnet as DotnetBuilder).create !== "function") {
    throw new Error(
      "wasm-dotnet expected a dotnet.js module exporting dotnet.create().",
    );
  }
  return dotnet as DotnetBuilder;
}

function readPath(root: unknown, path: string[]) {
  let current = root;
  for (const part of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function findBridge(exports: Record<string, unknown>): RuntimeBridge {
  const candidates = [
    readPath(exports, ["WasmDotnet", "Compiler", "CompilerHost"]),
    readPath(exports, ["WasmDotnet.Compiler", "CompilerHost"]),
    readPath(exports, ["CompilerHost"]),
    exports,
  ];
  for (const candidate of candidates) {
    const bridge = candidate as RuntimeBridge | undefined;
    if (
      bridge &&
      (typeof bridge.Compile === "function" ||
        typeof bridge.compile === "function") &&
      (typeof bridge.Run === "function" || typeof bridge.run === "function")
    ) {
      return bridge;
    }
  }
  throw new Error(
    "wasm-dotnet runtime did not export CompilerHost.Compile and CompilerHost.Run.",
  );
}

async function callJson<T>(
  method: (requestJson: string) => string | Promise<string>,
  payload: unknown,
) {
  const response = await method(JSON.stringify(payload));
  return JSON.parse(response) as T;
}

export function resetDotnetCompilerRuntimeForTests() {
  runtimePromise = null;
  runtimeKey = "";
}

export async function loadDotnetCompilerRuntime(
  options: DotnetCompilerRuntimeOptions = {},
): Promise<DotnetCompilerRuntime> {
  const dotnetJsUrl = resolveDotnetJsUrl(options);
  const key = `${dotnetJsUrl}\n${options.mainAssemblyName || ""}\n${options.dotnetModule ? "injected" : ""}`;
  if (runtimePromise && runtimeKey === key) return await runtimePromise;
  runtimeKey = key;
  runtimePromise = (async () => {
    const dotnetModule =
      options.dotnetModule || (await import(/* @vite-ignore */ dotnetJsUrl));
    let builder = getDotnetBuilder(dotnetModule);
    if (builder.withDiagnosticTracing) {
      builder = builder.withDiagnosticTracing(false);
    }
    const runtime = await builder.create();
    if (typeof runtime.getAssemblyExports !== "function") {
      throw new Error(
        "wasm-dotnet runtime did not expose getAssemblyExports().",
      );
    }
    const assemblyName =
      options.mainAssemblyName ||
      runtime.getConfig?.().mainAssemblyName ||
      "WasmDotnet.Compiler.dll";
    const exports = await runtime.getAssemblyExports(assemblyName);
    const bridge = findBridge(exports);
    const compile = bridge.Compile || bridge.compile;
    const run = bridge.Run || bridge.run;
    if (!compile || !run) {
      throw new Error("wasm-dotnet compiler bridge is incomplete.");
    }
    return {
      compile(request) {
        return callJson<DotnetRuntimeCompileResponse>(
          compile.bind(bridge),
          request,
        );
      },
      run(request) {
        return callJson<DotnetRuntimeRunResponse>(run.bind(bridge), request);
      },
    };
  })();
  return await runtimePromise;
}
