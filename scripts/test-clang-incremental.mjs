import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { test } from 'node:test';
import { webcrypto } from 'node:crypto';

const require = createRequire(import.meta.url);
const ts = require('typescript'); // pnpm's pinned dependency, or explicitly provided NODE_PATH locally.
const root = path.resolve(import.meta.dirname, '..');
function load(relative, imports = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true, fileName: relative
  });
  assert.equal(diagnostics?.length ?? 0, 0);
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    exports: module.exports, module,
    require: (name) => {
      if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
      return imports[name];
    }, TextEncoder, TextDecoder, Uint8Array, Map, Set, WeakMap, crypto: webcrypto
  }, { filename: relative });
  return module.exports;
}
const core = load('packages/llvm-core/runtime/clang/src/incremental-compilation.ts');
const { IncrementalCompilationCache, parseClangDependencies, incrementalArgumentsEligible } = core;
const bytes = (text) => new TextEncoder().encode(text);
const wasm = Uint8Array.of(0, 97, 115, 109, 1, 0, 0, 0);
const argsFor = (input = 'main.cpp', output = 'main.o', extra = []) => [
  'clang', '-cc1', '-triple', 'wasm32-unknown-wasi', '-emit-obj', '-disable-free',
  '-O2', '-std=c++17', '-x', 'c++', '-o', output, input, ...extra
];
function fixture() {
  const files = new Map([['main.cpp', bytes('int x;')], ['header.hpp', bytes('int y;')]]);
  const calls = [], output = [];
  let malformed = false, failPreprocess = false, failCompile = false;
  const host = {
    read: (name) => {
      if (!files.has(name)) throw new Error(`Missing ${name}`);
      return files.get(name);
    },
    write: (name, data) => { files.set(name, Uint8Array.from(data)); },
    replay: (message) => { output.push(message); },
    execute: async (args, emit) => {
      const preprocessing = args.includes('-E');
      calls.push(preprocessing ? 'preprocess' : 'object');
      if (preprocessing && failPreprocess) throw new Error('preprocess failed');
      if (!preprocessing && failCompile) throw new Error('compile failed');
      files.set(args[args.indexOf('-o') + 1], preprocessing ? bytes('int x; int y;') : Uint8Array.from(wasm));
      if (preprocessing) files.set('__wasm_idle_build/incremental/current.d', bytes(
        malformed ? 'unexpected: x' : 'wasm_idle_cache: main.cpp header.hpp\n'));
      if (emit) output.push('warning: fixture\n');
      return { value: null, diagnostics: 'warning: fixture\n', cacheable: true };
    }
  };
  return { host, files, calls, output, setMalformed: (x) => { malformed = x; },
    setPreprocessFailure: (x) => { failPreprocess = x; }, setCompileFailure: (x) => { failCompile = x; } };
}
const run = (cache, f, args = argsFor(), id = 'compiler-1') => cache.compile(f.host, args, 'main.cpp', 'main.o', id);

test('depfile parser handles compiler escapes and rejects ambiguous Make syntax', () => {
  assert.deepEqual(Array.from(parseClangDependencies('wasm_idle_cache: main.cpp a\\ b.hpp \\\n c\\#d.hpp cash$$.hpp\n')), ['a b.hpp', 'c#d.hpp', 'cash$.hpp', 'main.cpp']);
  for (const value of ['x: main.cpp', 'wasm_idle_cache:', 'wasm_idle_cache: a#b', 'wasm_idle_cache: $(wildcard x)', 'wasm_idle_cache: a\\q', 'wasm_idle_cache: a\nother: b']) assert.equal(parseClangDependencies(value), undefined);
});

test('unknown, action, response-file and module flags bypass the experimental path', () => {
  assert.equal(incrementalArgumentsEligible(['-O2', '-std=c++20', '-DVALUE=42', '-Iinclude', '-Wall']), true);
  for (const flag of ['@args', '-emit-pch', '-fsyntax-only', '-fmodules', '-include-pch', '-o', '-I', null]) assert.equal(incrementalArgumentsEligible([flag]), false);
});

test('hits reuse defensive objects and replay diagnostics; raw dependencies and compiler identity invalidate', async () => {
  const c = new IncrementalCompilationCache(); const f = fixture();
  await run(c, f); f.files.get('main.o')[4] = 99; await run(c, f);
  assert.equal(f.files.get('main.o')[4], 1);
  assert.deepEqual(f.calls, ['preprocess', 'object', 'preprocess']);
  assert.equal(f.output.length, 2); assert.equal(c.stats.hits, 1);
  f.files.set('header.hpp', bytes('int y; // diagnostic/source change'));
  await run(c, f); await run(c, f, argsFor(), 'compiler-2');
  assert.equal(c.stats.misses, 3);
  assert.equal(f.files.get('__wasm_idle_build/incremental/current.ii').length, 0);
});

test('invalid dependencies, preprocessing errors, time macros and budgets bypass safely', async () => {
  for (const setup of [(f) => f.setMalformed(true), (f) => f.setPreprocessFailure(true),
    (f) => f.files.set('header.hpp', bytes('#pragma clang diagnostic ignored "-Wdate-time"\nconst char* t=__TIME__;'))]) {
    const f = fixture(); setup(f); const c = new IncrementalCompilationCache(); await run(c, f);
    assert.equal(c.stats.entries, 0); assert.equal(c.stats.bypasses, 1);
    assert.equal(f.calls.at(-1), 'object'); assert.equal(f.output.length, 1);
  }
  const f = fixture(); const c = new IncrementalCompilationCache({ maxPreprocessedBytes: 1 });
  await run(c, f); assert.equal(c.stats.bypasses, 1);
});

test('failed and oversized compilations are never inserted; retry can succeed', async () => {
  const f = fixture(); const c = new IncrementalCompilationCache(); f.setCompileFailure(true);
  await assert.rejects(run(c, f), /compile failed/); assert.equal(c.stats.entries, 0);
  f.setCompileFailure(false); await run(c, f); assert.equal(c.stats.entries, 1);
  const tiny = new IncrementalCompilationCache({ maxBytes: 1 }); await run(tiny, f);
  assert.equal(tiny.stats.entries, 0);
});

test('LRU bounds, explicit clear, invalid limits and abort preserve correctness', async () => {
  const f = fixture(); const c = new IncrementalCompilationCache({ maxEntries: 1 });
  await run(c, f); await run(c, f, argsFor(), 'compiler-2'); await run(c, f);
  assert.equal(c.stats.hits, 0); assert.equal(c.stats.entries, 1);
  c.clear(); assert.equal(c.stats.accountedBytes, 0);
  for (const n of [0, -1, NaN, Infinity, 1.5]) assert.throws(() => new IncrementalCompilationCache({ maxEntries: n }), /positive safe integer/);
  const controller = new AbortController(); controller.abort(new Error('cancelled'));
  f.host.signal = controller.signal; const before = f.calls.length;
  await assert.rejects(run(c, f), /cancelled/); assert.equal(f.calls.length, before);
});

test('existing PCH invocations bypass unchanged', async () => {
  const f = fixture(); const c = new IncrementalCompilationCache();
  await run(c, f, argsFor('main.cpp', 'main.o', ['-include-pch', 'std.pch']));
  assert.deepEqual(f.calls, ['object']); assert.equal(c.stats.bypasses, 1);
});

const clang = process.env.CLANG ?? 'clang';
const linker = process.env.WASM_LD ?? 'wasm-ld';
const nativeAvailable = spawnSync(clang, ['--version']).status === 0 && spawnSync(linker, ['--version']).status === 0;
function nativeFixture(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-idle-object-cache-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const full = (name) => path.isAbsolute(name) ? name : path.join(cwd, name);
  const calls = [], output = [];
  const host = {
    read: (name) => new Uint8Array(fs.readFileSync(full(name))),
    write: (name, value) => { fs.mkdirSync(path.dirname(full(name)), { recursive: true }); fs.writeFileSync(full(name), value); },
    replay: (message) => { output.push(message); },
    execute: async (args, emit) => {
      calls.push(args.includes('-E') ? 'preprocess' : 'object');
      const p = spawnSync(clang, args.slice(1), { cwd, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      if (emit && p.stderr) output.push(p.stderr);
      if (p.status !== 0) throw new Error(p.error?.message ?? p.stderr);
      return { value: null, diagnostics: p.stderr, cacheable: true };
    }
  };
  const write = (name, text) => host.write(name, bytes(text));
  const answer = async (objects) => {
    const linked = spawnSync(linker, ['--no-entry', '--export=answer', ...objects, '-o', 'run.wasm'], { cwd, encoding: 'utf8' });
    assert.equal(linked.status, 0, linked.stderr);
    const { instance } = await WebAssembly.instantiate(host.read('run.wasm'));
    return instance.exports.answer();
  };
  return { cwd, host, calls, output, write, answer };
}

test('native Clang: per-TU reuse, header/source/options invalidation and real linked Wasm execution', { skip: !nativeAvailable }, async (t) => {
  const f = nativeFixture(t); const c = new IncrementalCompilationCache();
  f.write('values.hpp', '#pragma once\n#define VALUE 40\n');
  f.write('main.cpp', '#include "values.hpp"\nextern "C" int helper(); extern "C" int answer(){return VALUE+helper();}\n');
  f.write('helper.cpp', 'extern "C" int helper(){return 2;}\n');
  const compile = (input, output) => c.compile(f.host, argsFor(input, output), input, output, 'native-clang');
  await compile('main.cpp', 'main.o'); await compile('helper.cpp', 'helper.o');
  assert.equal(await f.answer(['main.o', 'helper.o']), 42);
  f.write('helper.cpp', 'extern "C" int helper(){return 3;}\n');
  await compile('main.cpp', 'moved.o'); await compile('helper.cpp', 'helper.o');
  assert.equal(c.stats.hits, 1); assert.equal(await f.answer(['moved.o', 'helper.o']), 43);
  f.write('values.hpp', '#pragma once\n#define VALUE 50\n');
  await compile('main.cpp', 'main.o'); assert.equal(await f.answer(['main.o', 'helper.o']), 53);
  await c.compile(f.host, argsFor('main.cpp', 'main.o', ['-O0']), 'main.cpp', 'main.o', 'native-clang');
  assert.equal(c.stats.misses, 5); assert.equal(c.stats.bypasses, 0);
});

test('native Clang: newly present and removed __has_include headers cannot produce stale hits', { skip: !nativeAvailable }, async (t) => {
  const f = nativeFixture(t); const c = new IncrementalCompilationCache();
  f.write('main.cpp', '#if __has_include("optional.hpp")\n#include "optional.hpp"\n#else\n#define VALUE 1\n#endif\nextern "C" int answer(){return VALUE;}\n');
  const compile = () => c.compile(f.host, argsFor(), 'main.cpp', 'main.o', 'native-clang');
  await compile(); assert.equal(await f.answer(['main.o']), 1);
  f.write('optional.hpp', '#define VALUE 9\n'); await compile(); assert.equal(await f.answer(['main.o']), 9);
  fs.unlinkSync(path.join(f.cwd, 'optional.hpp')); await compile(); assert.equal(await f.answer(['main.o']), 1);
  assert.equal(c.stats.hits, 1); // Reusing the correctly matching original no-header artifact is safe.
});

test('native Clang: Unicode/space dependencies, warnings and recovery use real diagnostics', { skip: !nativeAvailable }, async (t) => {
  const f = nativeFixture(t); const c = new IncrementalCompilationCache();
  f.write('한 글.hpp', '#warning native diagnostic\n#define VALUE 42\n');
  f.write('main.cpp', '#include "한 글.hpp"\nextern "C" int answer(){return VALUE;}\n');
  const compile = () => c.compile(f.host, argsFor(), 'main.cpp', 'main.o', 'native-clang');
  await compile(); const first = f.output.join(''); f.output.length = 0;
  await compile(); assert.equal(f.output.join(''), first); assert.equal(c.stats.hits, 1);
  assert.equal(await f.answer(['main.o']), 42);
  f.write('main.cpp', 'this is invalid syntax'); await assert.rejects(compile());
  f.write('main.cpp', 'extern "C" int answer(){return 11;}\n'); await compile();
  assert.equal(await f.answer(['main.o']), 11);
});

test('native Clang: volatile time macros bypass even with diagnostic suppression', { skip: !nativeAvailable }, async (t) => {
  const f = nativeFixture(t); const c = new IncrementalCompilationCache();
  f.write('main.cpp', '#pragma clang diagnostic ignored "-Wdate-time"\nextern "C" int answer(){return __TIME__[0];}\n');
  await c.compile(f.host, argsFor(), 'main.cpp', 'main.o', 'native-clang');
  assert.equal(c.stats.entries, 0); assert.equal(c.stats.bypasses, 1);
});

const workspace = load('packages/llvm-core/runtime/clang/src/workspace.ts');
const types = load('packages/llvm-core/runtime/clang/src/types.ts');
class BaseRuntime {
  constructor(options) {
    this.assetUrls = { clang: 'verified-clang' };
    this.moduleCache = { 'verified-clang': {} };
    this.files = new Map(); this.calls = []; this.output = [];
    this.memfs = {
      out: true, stdout: (chunk) => this.output.push(chunk),
      getFileContents: (file) => {
        const contents = this.files.get(file);
        if (!contents) throw new Error(`missing ${file}`);
        return contents;
      },
      addFile: (file, contents) => this.files.set(file, typeof contents === 'string' ? bytes(contents) : Uint8Array.from(contents))
    };
    this.options = options;
  }
  addWorkspaceDirectories() {}
  async compile(options) {
    this.input = workspace.normalizeWorkspacePath(options.input || 'main.cc');
    this.memfs.addFile(this.input, options.code);
    this.memfs.addFile(options.obj, new Uint8Array());
    return this.run(this.moduleCache[this.assetUrls.clang], true,
      ...argsFor(this.input, options.obj, options.precompiledHeader ? ['-include-pch', 'std.pch'] : options.compileArgs ?? []));
  }
  async compileLink(code) {
    await this.compile({ code, input: 'main.cpp', obj: 'main.o' });
    this.lastBuildKey = 'successful-build'; this.wasm = {};
    return this.wasm;
  }
  async run(module, out, ...args) {
    const preprocessing = args.includes('-E'); this.calls.push(preprocessing ? 'preprocess' : 'object');
    this.memfs.out = out;
    if (this.fail && !preprocessing) { this.memfs.stdout('error\n'); throw new Error('failed object'); }
    const output = args[args.indexOf('-o') + 1];
    this.memfs.addFile(output, preprocessing ? this.memfs.getFileContents(this.input) : wasm);
    if (preprocessing) this.memfs.addFile('__wasm_idle_build/incremental/current.d', `wasm_idle_cache: ${this.input}\n`);
    if (out) this.memfs.stdout('diagnostic\n');
    return null;
  }
}
const { default: IncrementalRuntime } = load('packages/llvm-core/runtime/clang/src/incremental-runtime.ts', {
  './runtime.js': { __esModule: true, default: BaseRuntime },
  './incremental-compilation.js': core, './types.js': types, './workspace.js': workspace
});

test('actual runtime adapter intercepts only eligible object calls and restores stdout', async () => {
  const runtime = new IncrementalRuntime({ runtimeBaseUrl: '/clang' });
  const callback = runtime.memfs.stdout;
  const options = { input: 'main.cpp', obj: 'main.o', code: 'int value;', language: 'CPP' };
  await runtime.compile(options); await runtime.compile(options);
  assert.deepEqual(runtime.calls, ['preprocess', 'object', 'preprocess']);
  assert.equal(runtime.memfs.stdout, callback); assert.deepEqual(runtime.output, ['diagnostic\n', 'diagnostic\n']);
  assert.equal(runtime.incrementalCompilationStats.hits, 1);
  runtime.clearIncrementalCompilationCache(); assert.equal(runtime.incrementalCompilationStats.entries, 0);
});

test('actual runtime adapter preserves trace/LLDB/Objective-C/PCH and unknown-flag paths', async () => {
  for (const extra of [{ debugMode: 'trace' }, { debugMode: 'lldb' }, { language: 'OBJC' },
    { precompiledHeader: {} }, { compileArgs: ['-fmodules'] }, { transformSource: (text) => text }]) {
    const runtime = new IncrementalRuntime({ runtimeBaseUrl: '/clang' });
    await runtime.compile({ input: 'main.cpp', obj: 'main.o', code: 'int value;', ...extra });
    assert.deepEqual(runtime.calls, ['object']); assert.equal(runtime.incrementalCompilationStats.entries, 0);
  }
});

test('actual runtime adapter does not overwrite a caller-owned reserved scratch input', async () => {
  const runtime = new IncrementalRuntime({ runtimeBaseUrl: '/clang' });
  const input = '__wasm_idle_build/incremental/current.ii';
  await runtime.compile({ input, obj: 'main.o', code: 'int value;' });
  assert.deepEqual(runtime.calls, ['object']);
  assert.equal(new TextDecoder().decode(runtime.files.get(input)), 'int value;');
});

test('actual runtime adapter invalidates the inherited whole-build cache after failure', async () => {
  const runtime = new IncrementalRuntime({ runtimeBaseUrl: '/clang' });
  await runtime.compileLink('int first;'); const callback = runtime.memfs.stdout;
  runtime.fail = true; await assert.rejects(runtime.compileLink('int changed;'), /failed object/);
  assert.equal(runtime.lastBuildKey, ''); assert.equal(runtime.wasm, undefined);
  assert.equal(runtime.memfs.stdout, callback);
  runtime.fail = false; await runtime.compileLink('int first;');
  assert.equal(runtime.lastBuildKey, 'successful-build');
});

test('explicit clear during an in-flight compilation prevents late cache insertion', async () => {
  const f = fixture(); const c = new IncrementalCompilationCache();
  const execute = f.host.execute;
  f.host.execute = async (args, emit) => { const result = await execute(args, emit); if (emit) c.clear(); return result; };
  await run(c, f); assert.equal(c.stats.entries, 0);
});

test('native Clang: ordinary main-file PCH is not a safe editable preamble', { skip: !nativeAvailable }, (t) => {
  const f = nativeFixture(t);
  f.write('preamble.hpp', '#pragma once\nconstexpr int value = __INCLUDE_LEVEL__ + 40;\n');
  const prefix = '#define TEST 1\n#include "preamble.hpp"\n';
  f.write('preamble.cpp', prefix);
  const flags = ['-cc1', '-triple', 'wasm32-unknown-wasi', '-x', 'c++', '-std=c++17', '-O2'];
  const pch = spawnSync(clang, [...flags, '-emit-pch', '-o', 'main.pch', 'preamble.cpp'], { cwd: f.cwd, encoding: 'utf8' });
  assert.equal(pch.status, 0, pch.stderr);
  f.write('preamble.cpp', prefix + 'extern "C" int answer(){return value + TEST;}\n');
  const compile = spawnSync(clang, [...flags, '-emit-obj', '-include-pch', 'main.pch',
    `-preamble-bytes=${Buffer.byteLength(prefix)},0`, '-o', 'main.o', 'preamble.cpp'], { cwd: f.cwd, encoding: 'utf8' });
  assert.notEqual(compile.status, 0, 'Ordinary PCH must not silently stand in for a validated preamble');
  assert.match(compile.stderr, /modified since|rebuild|changed|size of the file/i);
});
