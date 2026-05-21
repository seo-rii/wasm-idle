import { dotnet } from "./_framework/dotnet.js";

await dotnet.withDiagnosticTracing(false).create();
