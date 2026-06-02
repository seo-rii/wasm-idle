#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
let virtualOutputDir = '/workspace/out';
let classpath = [
    resolve('/tmp/wasm-idle-kotlin-teavm-poc/package/lib/kotlin-stdlib.jar'),
    resolve(projectDir, 'build/libs/wasm-kotlin-teavm-jdk-stubs.jar')
].join('\n');
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
    virtualOutputDir,
    classpath,
    node: process.version,
    startedAt: new Date().toISOString(),
    load: null,
    builtins: null,
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
    if (typeof module.exports.builtinsResourceLength === 'function'
            && typeof module.exports.describeDefaultUnitType === 'function') {
        report.builtins = {
            kotlinLength: module.exports.builtinsResourceLength('kotlin/kotlin.kotlin_builtins'),
            slashKotlinLength: module.exports.builtinsResourceLength('/kotlin/kotlin.kotlin_builtins'),
            unitType: module.exports.describeDefaultUnitType()
        };
    }
    let source = null;
    let classpathPayload = null;
    try {
        source = await readFile(sourcePath, 'utf8');
        classpathPayload = (await Promise.all(
            classpath.split('\n')
                .filter((entry) => entry.length > 0)
                .map(async (entry) => (await readFile(entry)).toString('base64'))
        )).join('\n');
        const result = module.exports.compileKotlinSourceContent(source, virtualOutputDir, classpathPayload);
        report.compile = {
            ok: true,
            result
        };
        if (result !== true && typeof module.exports.describeKotlinCompileContentFailure === 'function') {
            report.compile.description = module.exports.describeKotlinCompileContentFailure(
                source, virtualOutputDir, classpathPayload);
        }
        if (typeof module.exports.listVirtualFiles === 'function') {
            report.compile.virtualFiles = module.exports.listVirtualFiles(virtualOutputDir);
            if (report.compile.virtualFiles) {
                await mkdir(outputDir, { recursive: true });
                for (const line of report.compile.virtualFiles.split('\n')) {
                    if (!line) {
                        continue;
                    }
                    const [virtualPath] = line.split('\t');
                    const relativePath = virtualPath.slice(`${virtualOutputDir}/`.length);
                    const targetPath = resolve(outputDir, relativePath);
                    await mkdir(dirname(targetPath), { recursive: true });
                    const base64 = module.exports.readVirtualFileBase64(virtualPath);
                    await writeFile(targetPath, Buffer.from(base64, 'base64'));
                }
            }
        }
    } catch (error) {
        report.compile = {
            ok: false,
            error: error?.stack || String(error)
        };
        if (source !== null && classpathPayload !== null
                && typeof module.exports.describeKotlinCompileContentFailure === 'function') {
            try {
                report.compile.description = module.exports.describeKotlinCompileContentFailure(
                    source, virtualOutputDir, classpathPayload);
            } catch (describeError) {
                report.compile.descriptionError = describeError?.stack || String(describeError);
            }
        }
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
