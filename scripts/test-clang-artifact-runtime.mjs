import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
const ts = createRequire(import.meta.url)('typescript');
function load(file, imports = {}, extra = {}) {
 const exports = {};
 const result = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
 assert.equal(result.diagnostics.length, 0);
 vm.runInNewContext(result.outputText, { exports, Uint8Array, WebAssembly, ...extra, require(id) { if (!(id in imports)) throw new Error(id); return imports[id]; } });
 return exports;
}
const dir = new URL('../packages/llvm-core/runtime/clang/src/', import.meta.url);
const normalize = (s) => s.replaceAll('\\', '/').split('/').filter((part) => part && part !== '.' && part !== '..').join('/');
const workspace = { normalizeWorkspacePath: normalize, normalizeDwarfWorkspacePath: (s) => normalize(s).replace(/^workspace\//, ''),
 resolveBuildArtifactNames(language, input) { input ||= language === 'C' ? 'main.c' : 'main.cc'; const stem = input.split('/').pop().replace(/\.[^.]+$/, ''); return { input, obj: stem + '.o', wasm: stem + '.wasm' }; } };
const resolveDebugMode = (o) => o.debugMode ?? (o.debug ? 'trace' : 'none');
const wasmBytes = new Uint8Array([0,97,115,109,1,0,0,0]);
class LegacyRuntime {
 constructor() {
  this.ready = Promise.resolve(); this.assetUrls = { lld: 'lld' }; this.compiles = []; this.links = []; this.runs = [];
  this.files = new Map(); this.memfs = { addFile: (name, bytes) => this.files.set(name, bytes), getFileContents: (name) => this.files.get(name), addDirectory() {} };
 }
 async compile(options) { this.compiles.push(options); if (this.failCompile) throw new Error('compile failure'); this.files.set(options.obj, wasmBytes); }
 async link(objects, output, mode, language) {
  this.links.push({ objects, output, mode, language });
  await this.run({}, false, 'wasm-ld', '--export-dynamic', ...objects, '-o', output);
  if (this.failLink) throw new Error('link failure');
  this.files.set(output, wasmBytes);
 }
 async run(module, out, ...args) { this.runs.push(args); return null; }
 async getModule() { return {}; }
 addWorkspaceFiles(files) { for (const file of files) this.files.set(file.path, file.content); }
 beginTrace() {} trace() {}
 async hostLogAsync(message, promise) { return promise; }
}
let moduleCompiles = 0;
const Runtime = load(new URL('artifact-runtime.ts', dir), {
 './runtime.js': { default: LegacyRuntime }, './workspace.js': workspace, './types.js': { resolveDebugMode },
 './dwarf.js': { createDwarfDebugDescriptor: async (request) => ({ kind: 'dwarf', sourceRoot: '/workspace', files: [], requested: request }) }
}, { WebAssembly: { compile: async (bytes) => { moduleCompiles++; return WebAssembly.compile(bytes); } } }).default;

test('LLDB returns defensive bytes and a descriptor without browser compilation', async () => {
 const r = new Runtime(); const before = moduleCompiles;
 const a = await r.compileArtifact('int main(){}', { debugMode: 'lldb' });
 assert.equal(a.wasm, undefined); assert.equal(a.debug.kind, 'dwarf');
 assert.equal(moduleCompiles, before); a.bytes[0] = 99;
 const b = await r.compileArtifact('int main(){}', { debugMode: 'lldb' });
 assert.equal(b.bytes[0], 0); assert.equal(r.compiles.length, 1); assert.equal(r.links.length, 1);
});
test('normal compile caches both linked bytes and a real native V8 Module', async () => {
 const r = new Runtime(); const before = moduleCompiles;
 const a = await r.compileArtifact('int main(){}');
 const b = await r.compileArtifact('int main(){}');
 assert.ok(a.wasm instanceof WebAssembly.Module); assert.equal(a.wasm, b.wasm);
 assert.equal(moduleCompiles, before + 1); assert.equal(r.compiles.length, 1);
 assert.ok(!r.runs[0].includes('--export-dynamic'));
});
test('debug links preserve exports and changing export policy invalidates the build', async () => {
 const r = new Runtime(); await r.compileArtifact('source', { debugMode: 'trace' });
 assert.ok(r.runs[0].includes('--export-dynamic')); assert.ok(r.debugBreakpoints);
 await r.compileArtifact('source'); r.exportDynamic = true; await r.compileArtifact('source');
 assert.equal(r.links.length, 3); assert.ok(r.runs.at(-1).includes('--export-dynamic'));
});
test('minimal export filtering cannot affect user program argv or compiler flags', async () => {
 const r = new Runtime(); await r.run({}, true, 'main.wasm', '--export-dynamic');
 assert.ok(r.runs[0].includes('--export-dynamic'));
 r.failLink = true; await assert.rejects(r.link(['a.o'], 'a.wasm'), /link failure/);
 await r.run({}, false, 'wasm-ld', '--export-dynamic');
 assert.ok(r.runs.at(-1).includes('--export-dynamic'));
});
test('failed rebuilds invalidate the prior result and never return stale bytes', async () => {
 const r = new Runtime(); await r.compileArtifact('A');
 r.failCompile = true; await assert.rejects(r.compileArtifact('B'), /compile failure/);
 r.failCompile = false; await r.compileArtifact('A'); assert.equal(r.compiles.length, 3);
 r.failLink = true; await assert.rejects(r.compileArtifact('C'), /link failure/);
 r.failLink = false; await r.compileArtifact('A'); assert.equal(r.compiles.length, 5);
});
test('direct compile and direct link invalidate immutable build reuse', async () => {
 const r = new Runtime(); await r.compileArtifact('A');
 await r.compile({ code: 'B', obj: 'other.o' }); await r.compileArtifact('A');
 assert.equal(r.compiles.length, 3);
 await r.link(['other.o'], 'other.wasm'); await r.compileArtifact('A');
 assert.equal(r.compiles.length, 4);
});
test('multi-file compilation keeps per-unit languages and selects C++ linking conservatively', async () => {
 const r = new Runtime(); await r.compileArtifact('A', { language: 'C', activePath: 'src/main.c', workspaceFiles: [{ path: 'helper.cpp', content: 'B' }] });
 assert.equal(r.compiles.length, 2); assert.equal(r.links[0].language, 'CPP');
 assert.deepEqual(r.compiles.map((o) => o.language), ['CPP', 'C']);
 const c = new Runtime(); await c.compileArtifact('A', { language: 'C' }); assert.equal(c.links[0].language, 'C');
 const overridden = new Runtime(); await overridden.compileArtifact('A', { language: 'C', compileArgs: ['-xc++'] }); assert.equal(overridden.links[0].language, 'CPP');
});
test('reserved paths and multi-file trace debug are rejected', async () => {
 const r = new Runtime(); await assert.rejects(r.compileArtifact('A', { activePath: '__wasm_idle_build/a.c' }), /reserved/);
 await assert.rejects(r.compileArtifact('A', { debugMode: 'trace', workspaceFiles: [{ path: 'helper.c', content: 'B' }] }), /multiple/);
 assert.equal(r.compiles.length, 0);
});
test('LLVM native producer experiment verifies export removal and execution equivalence', async (t) => {
 let clang, lld;
 try { clang = execFileSync('clang', ['--version'], { encoding: 'utf8' }); lld = execFileSync('wasm-ld', ['--version'], { encoding: 'utf8' }); }
 catch { t.skip('native clang/wasm-ld unavailable'); return; }
 const dir = mkdtempSync(path.join(tmpdir(), 'clang-export-'));
 try {
  writeFileSync(path.join(dir, 'main.c'), 'int result; int unused(int x){return x*7;} void _start(void){result=42;}');
  execFileSync('clang', ['--target=wasm32-unknown-unknown', '-fvisibility=default', '-O2', '-c', path.join(dir,'main.c'), '-o',path.join(dir,'main.o')]);
  for (const [name, flags] of [['dynamic',['--export-dynamic']],['minimal',[]]]) {
   execFileSync('wasm-ld', [path.join(dir,'main.o'), '--export=result', ...flags, '-o',path.join(dir,name+'.wasm')]);
  }
  const dynamic = readFileSync(path.join(dir,'dynamic.wasm')), minimal = readFileSync(path.join(dir,'minimal.wasm'));
  const a = await WebAssembly.compile(dynamic), b = await WebAssembly.compile(minimal);
  assert.ok(WebAssembly.Module.exports(a).some((e) => e.name === 'unused'));
  assert.ok(!WebAssembly.Module.exports(b).some((e) => e.name === 'unused'));
  assert.ok(minimal.length < dynamic.length);
  for (const module of [a,b]) { const instance = await WebAssembly.instantiate(module); instance.exports._start(); assert.equal(new DataView(instance.exports.memory.buffer).getInt32(Number(instance.exports.result.value), true), 42); }
  t.diagnostic(JSON.stringify({ nativeClang: clang.split('\n')[0], nativeLld: lld.trim(), dynamicBytes: dynamic.length, minimalBytes: minimal.length, browserMeasurement: false }));
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
