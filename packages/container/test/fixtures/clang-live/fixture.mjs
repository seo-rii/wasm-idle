import { createContainer, extractTarPackage } from '../../../src/index.ts';
import { createLiveClangAdapter } from '../../../src/adapters/clang-live/index.ts';
import { createLiveWasiAdapter } from '../../../src/adapters/wasi-live/index.ts';

const encode = text => new TextEncoder().encode(text), decode = bytes => new TextDecoder().decode(bytes);
const executable = '/opt/toolchains/llvm/bin/llvm';
const profile = ['clang', '--target=wasm32-wasi', '-fuse-ld=/opt/toolchains/llvm/bin/wasm-ld',
  '--sysroot=/usr/share/wasm-sysroot', '-resource-dir=/usr/share/wasm-sysroot/lib/clang/22', '-Wl,--max-memory=67108864'];

/** Same real compiler, owner and fixture in Node Workers and isolated Chromium. */
export async function runLiveClangFixture(input, factory, progress = () => {}) {
  const result = { profile: 'llvm-clang-tool-host-live-v1', passed: false, checks: [], commands: [], createdWorkers: 0, activeWorkers: 0 };
  const check = (id, condition, observed) => {
    result.checks.push({ id, passed: !!condition, observed });
    if (!condition) throw new Error(`Live Clang fixture failed: ${id}`);
  };
  const worker = name => () => {
    const value = factory(name), terminate = value.terminate.bind(value);
    let dead = false; result.createdWorkers++; result.activeWorkers++;
    value.terminate = async () => {
      if (dead) return; dead = true;
      await terminate(); result.activeWorkers--;
    };
    return value;
  };
  const adapter = createLiveClangAdapter({ clangSha256: input.clangSha256, linkerSha256: input.linkerSha256,
    linkerPath: '/opt/toolchains/llvm/bin/wasm-ld', compilerPaths: [executable], executableOutputProfile: 'wasi-preview1-process',
    pipeBytes: 4093, workerFactory: worker('clang-worker') });
  const artifact = createLiveWasiAdapter({ workerFactory: worker('wasi-worker') });
  const c = createContainer({ adapters: [adapter, artifact], artifactAdapter: artifact.id,
    commands: { clang: { adapter: adapter.id, argv0: executable, bytes: input.clang } },
    maxBytes: 256 * 1024 * 1024, maxInodes: 16384, maxMemoryBytes: 2 ** 32 });
  const options = { cwd: '/workspace/한글 project', env: { PWD: '/deliberately-wrong', LANG: 'C', HOME: '/workspace' }, timeoutMs: 120000 };
  const capture = value => ({ code: value.code, reason: value.reason, stdout: decode(value.stdout), stderr: decode(value.stderr) });
  const run = async (args, more = {}) => {
    const value = await c.run('clang', [...profile, ...args], { ...options, ...more });
    result.commands.push({ args, ...capture(value) }); return value;
  };
  const drain = async stream => {
    const reader = stream.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        size += next.value.length;
        if (size > 8 * 1024 * 1024) throw new Error('Fixture capture limit exceeded');
        chunks.push(next.value);
      }
      const value = new Uint8Array(size); let at = 0;
      for (const chunk of chunks) { value.set(chunk, at); at += chunk.length; }
      return value;
    } finally { reader.releaseLock(); }
  };
  try {
    c.fs.mountReadonly('/opt/toolchains/llvm', [{ path: 'bin', type: 'directory', mode: 0o555 },
      { path: 'bin/llvm', type: 'file', mode: 0o555, data: input.clang }, { path: 'bin/wasm-ld', type: 'file', mode: 0o555, data: input.linker }]);
    const sysroot = extractTarPackage(input.sysroot);
    c.fs.mountReadonly('/usr/share/wasm-sysroot', sysroot);
    check('full-selected-target-sysroot', sysroot.length === 2285 && sysroot.filter(item => item.type === 'file').length === 2168);
    c.fs.mkdir(options.cwd);
    c.fs.writeFile(`${options.cwd}/main source.c`, encode('#include <stdio.h>\nint main(void){puts("hello live");return 0;}\n'));
    progress('compile-link');
    const compiled = await run(['main source.c', '-o', 'hello.wasm']);
    check('real-driver-cc1-linker-exit', compiled.reason === 'exited' && compiled.code === 0, capture(compiled));
    const bytes = c.fs.readFile(`${options.cwd}/hello.wasm`);
    result.artifact = { bytes: bytes.length, mode: c.fs.stat(`${options.cwd}/hello.wasm`).mode,
      sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('') };
    check('actual-command-executable-metadata', (result.artifact.mode & 0o111) === 0o111, result.artifact);
    const executed = await c.run('wasm-run', ['hello.wasm'], options);
    check('generated-command-execution', executed.code === 0 && executed.reason === 'exited' && decode(executed.stdout) === 'hello live\n' && !executed.stderr.length, capture(executed));

    progress('streamed-stdin-live-header');
    c.fs.writeFile(`${options.cwd}/live.h`, encode('before_editor\n'));
    const preprocessor = await c.spawn('clang', [...profile, '-E', '-P', '-x', 'c', '-'], options);
    const out = drain(preprocessor.stdout), err = drain(preprocessor.stderr), writer = preprocessor.stdin.getWriter();
    const chunk = encode('/* streamed input */\n'.repeat(16000) + '#include "live.h"\n');
    await writer.write(chunk); // Larger than the channel: actual cc1 must consume input.
    check('streamed-input-before-eof', (await c.inspect()).processes.some(p => p.pid === preprocessor.pid));
    c.fs.writeFile(`${options.cwd}/live.h`, encode('after_editor\n'));
    await writer.close(); writer.releaseLock();
    const preprocessing = await preprocessor.exited, stdout = decode(await out), stderr = decode(await err);
    result.commands.push({ args: ['-E', '-P', '-x', 'c', '-'], ...preprocessing, stdout, stderr });
    check('live-header-editor-visibility', preprocessing.code === 0 && stdout.trim() === 'after_editor' && !stdout.includes('before_editor'), { stdout, stderr, preprocessing });

    progress('partial-file-cancellation');
    c.fs.writeFile(`${options.cwd}/large.c`, encode('int visible_line;\n'.repeat(1000)));
    const stopWatch = new AbortController(), reader = c.fs.watch({ path: options.cwd, signal: stopWatch.signal }).getReader();
    let process, partial;
    const fileEvents = [];
    const observing = (async () => {
      for (;;) {
        const next = await reader.read(); if (next.done) return;
        if (fileEvents.length < 64) fileEvents.push({ kind: next.value.kind, path: next.value.path });
        // Clang may write a temporary file before renaming the requested output.
        if (!next.value.path.includes('partial') || next.value.kind === 'remove') continue;
        const data = c.fs.readFile(next.value.path); if (!data.length) continue;
        partial = { path: next.value.path, bytes: data.length, running: (await c.inspect()).processes.some(p => p.pid === process?.pid) };
        await process.terminate(); return;
      }
    })();
    void observing.catch(() => {});
    try {
      process = await c.spawn('clang', [...profile, '-E', '-P', 'large.c', '-o', 'partial.i'], options);
      const draining = Promise.all([drain(process.stdout), drain(process.stderr)]);
      await process.stdin.getWriter().close();
      const exit = await process.exited; stopWatch.abort(); await observing; const streams = await draining;
      result.cancelled = { exit, fileEvents, stderr: decode(streams[1]), partial };
      check('live-partial-file-before-exit', partial?.running && partial.bytes > 0, result.cancelled);
      check('cancel-keeps-already-visible-writes', exit.reason === 'terminated' && c.fs.readFile(partial.path).length >= partial.bytes && !(c.fs.stat(partial.path).mode & 0o111), exit);
    } finally { stopWatch.abort(); await observing; reader.releaseLock(); }
    check('restart-after-compiler-cancel', (await run(['--version'])).code === 0);

    progress('concurrent-output-edit');
    const editWatch = new AbortController(), edits = c.fs.watch({ path: options.cwd, signal: editWatch.signal }).getReader();
    let edit;
    const editing = (async () => {
      for (;;) {
        const next = await edits.read(); if (next.done) return;
        if (next.value.path !== `${options.cwd}/edited.wasm`) continue;
        const data = c.fs.readFile(next.value.path); if (data.length < 8) continue;
        const before = c.fs.captureFileVersion(next.value.path);
        c.fs.writeFile(next.value.path, data); // Same bytes still represent a foreign revision.
        edit = { bytes: data.length, revisionChanged: c.fs.captureFileVersion(next.value.path) !== before,
          running: (await c.inspect()).processes.length > 0 };
        return;
      }
    })();
    void editing.catch(() => {});
    let edited;
    try { edited = await run(['main source.c', '-o', 'edited.wasm']); }
    finally { editWatch.abort(); await editing; edits.releaseLock(); }
    check('foreign-edit-does-not-grant-executable', edited.code === 0 && edit?.revisionChanged && edit.running && !(c.fs.stat(`${options.cwd}/edited.wasm`).mode & 0o111), edit);
    const editedExecution = await c.run('wasm-run', ['edited.wasm'], options);
    check('explicit-run-retains-valid-output', editedExecution.code === 0 && decode(editedExecution.stdout) === 'hello live\n', capture(editedExecution));
    check('processes-retired', (await c.inspect()).processes.length === 0);
    result.passed = true;
  } catch (error) { result.error = error instanceof Error ? error.stack : String(error); }
  finally {
    await c.dispose();
    result.activeWorkersAfterDispose = result.activeWorkers;
    result.passed &&= result.activeWorkers === 0;
  }
  return result;
}
