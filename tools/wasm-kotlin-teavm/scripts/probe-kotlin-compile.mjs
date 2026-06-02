#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptDir, '..');
const defaultOutputDir = resolve(projectDir, 'build/generated/teavm/wasm-gc');
const defaultReportPath = resolve(projectDir, '.cache/probes/last-kotlin-compile.json');

const args = process.argv.slice(2);
let wasmPath = resolve(defaultOutputDir, 'kotlin-compiler-probe.wasm');
let runtimePath = resolve(defaultOutputDir, 'kotlin-compiler-probe-runtime.js');
let sourcePath = resolve(projectDir, 'fixtures/hello/Main.kt');
let outputDir = resolve(projectDir, 'build/browser-probe-out');
let classpath = resolve('/tmp/wasm-idle-kotlin-teavm-poc/package/lib/kotlin-stdlib.jar');
let reportPath = defaultReportPath;

for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
        case '--wasm':
            wasmPath = resolve(args[++i]);
            break;
        case '--runtime':
            runtimePath = resolve(args[++i]);
            break;
        case '--source':
            sourcePath = resolve(args[++i]);
            break;
        case '--out':
            outputDir = resolve(args[++i]);
            break;
        case '--classpath':
            classpath = args[++i].split(':').map((entry) => resolve(entry)).join('\n');
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
    sourcePath,
    outputDir,
    classpath,
    node: process.version,
    startedAt: new Date().toISOString(),
    load: null,
    compile: null,
    finishedAt: null
};

try {
    const runtime = await import(pathToFileURL(runtimePath).href);
    const module = await runtime.load(wasmPath, {
        stackDeobfuscator: { enabled: false }
    });
    report.load = {
        ok: true,
        exports: Reflect.ownKeys(module.exports).sort()
    };
    try {
        report.compile = {
            ok: true,
            result: module.exports.compileKotlinSource(sourcePath, outputDir, classpath)
        };
    } catch (error) {
        report.compile = {
            ok: false,
            error: error?.stack || String(error)
        };
    }
} catch (error) {
    report.load = {
        ok: false,
        error: error?.stack || String(error)
    };
}

report.finishedAt = new Date().toISOString();
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Wrote Kotlin compile probe report to ${reportPath}`);
if (!report.load?.ok || !report.compile?.ok || report.compile.result !== true) {
    console.error(report.compile?.error || report.load?.error || `compile result: ${report.compile?.result}`);
    process.exit(1);
}
