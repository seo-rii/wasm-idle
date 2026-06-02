#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const defaultOutputDir = resolve(projectDir, 'build/generated/teavm/wasm-gc');
const defaultReportPath = resolve(projectDir, '.cache/probes/last-wasm-runtime.json');

const args = process.argv.slice(2);
let wasmPath = resolve(defaultOutputDir, 'kotlin-compiler-probe.wasm');
let runtimePath = resolve(defaultOutputDir, 'kotlin-compiler-probe-runtime.js');
let reportPath = defaultReportPath;

for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case '--wasm':
            wasmPath = resolve(args[++i]);
            break;
        case '--runtime':
            runtimePath = resolve(args[++i]);
            break;
        case '--report':
            reportPath = resolve(args[++i]);
            break;
        default:
            throw new Error(`Unknown argument: ${args[i]}`);
    }
}

const report = {
    wasmPath,
    runtimePath,
    node: process.version,
    startedAt: new Date().toISOString(),
    module: null,
    runtimeLoad: null,
    finishedAt: null
};

try {
    const bytes = await readFile(wasmPath);
    const module = new WebAssembly.Module(bytes, { builtins: ['js-string'] });
    report.module = {
        ok: true,
        exports: WebAssembly.Module.exports(module).map((entry) => ({
            name: entry.name,
            kind: entry.kind
        }))
    };
} catch (error) {
    report.module = {
        ok: false,
        error: error?.stack || String(error)
    };
}

if (report.module?.ok) {
    try {
        const runtime = await import(pathToFileURL(runtimePath).href);
        const module = await runtime.load(wasmPath, {
            stackDeobfuscator: { enabled: false }
        });
        report.runtimeLoad = {
            ok: true,
            exports: Object.keys(module.exports).sort()
        };
    } catch (error) {
        report.runtimeLoad = {
            ok: false,
            error: error?.stack || String(error)
        };
    }
}

report.finishedAt = new Date().toISOString();
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote runtime probe report to ${reportPath}`);
if (!report.module?.ok || !report.runtimeLoad?.ok) {
    console.error(report.runtimeLoad?.error || report.module?.error);
    process.exit(1);
}
