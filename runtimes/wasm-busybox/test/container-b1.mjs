// Runs unchanged in Node and Chromium against actual container processes.
// The producer's pinned JSON matrix contains data, never executable host code.
export async function exerciseBusyboxB1(container, config) {
  const fs = container.fs;
  const cwd = '/workspace/a b';
  const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const unhex = (value) => Uint8Array.from(value.match(/../g) ?? [], (byte) => parseInt(byte, 16));
  const stable = (tree) => Object.fromEntries(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const digest = async (bytes) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
  const treeDigest = (tree) => digest(new TextEncoder().encode(JSON.stringify(stable(tree))));

  function clear(path) {
    for (const name of fs.readdir(path)) {
      const child = `${path}/${name}`;
      if (fs.lstat(child).type === 'directory') { clear(child); fs.rmdir(child); }
      else fs.unlink(child);
    }
  }

  function prepare(tree) {
    clear(cwd);
    for (const [path, entry] of Object.entries(stable(tree))) {
      const full = `${cwd}/${path}`;
      if (entry.type === 'directory') fs.mkdir(full);
      else if (entry.type === 'symlink') fs.symlink(entry.target, full);
      else fs.writeFile(full, unhex(entry.hex));
    }
  }

  function snapshot(prefix = '') {
    const tree = {};
    for (const name of fs.readdir(prefix ? `${cwd}/${prefix}` : cwd)) {
      const path = prefix ? `${prefix}/${name}` : name;
      const full = `${cwd}/${path}`, info = fs.lstat(full);
      if (info.type === 'directory') { tree[path] = { type: 'directory' }; Object.assign(tree, snapshot(path)); }
      else if (info.type === 'symlink') tree[path] = { type: 'symlink', target: fs.readlink(full) };
      else tree[path] = { type: 'file', hex: hex(fs.readFile(full)) };
    }
    return stable(tree);
  }

  const cases = [];
  for (const test of config.matrix.cases) {
    for (const alias of [false, true]) {
      prepare(test.before);
      const invocation = alias ? 'argv0' : 'multicall';
      const result = await container.run(alias ? test.applet : 'busybox', alias ? test.args : [test.applet, ...test.args],
        { cwd, env: {}, stdin: unhex(test.stdinHex), timeoutMs: 30000, maxCaptureBytes: 1024 * 1024 });
      const stdoutHex = hex(result.stdout), stderrHex = hex(result.stderr);
      const tree = snapshot(), treeSha256 = await treeDigest(tree);
      const reference = config.reference.find((entry) => entry.id === test.id && entry.invocation === invocation);
      const native = reference?.native;
      const expectedTreeSha256 = await treeDigest(test.after);
      const nativeCompared = reference?.comparison === 'native-differential';
      const nativeEqual = !nativeCompared || !!native && result.code === native.code && stdoutHex === native.stdoutHex
        && treeSha256 === native.treeSha256 && (test.stderrMode !== 'exact' || stderrHex === native.stderrHex);
      const stderrPassed = test.stderrMode === 'exact' ? stderrHex === test.stderrHex : stderrHex.length > 0;
      const passed = result.reason === 'exited' && result.code === test.code && stdoutHex === test.stdoutHex
        && stderrPassed && treeSha256 === expectedTreeSha256 && nativeEqual && !!reference?.passed;
      cases.push({ id: test.id, invocation, comparison: reference?.comparison,
        code: result.code, reason: result.reason, stdoutHex, stderrHex, treeSha256, nativeCompared, nativeEqual, passed,
        ...(treeSha256 !== expectedTreeSha256 ? { expectedTreeSha256, actualPaths: Object.keys(tree) } : {}) });
    }
  }

  // Node's host-backed preopen uses one disk. The container has separate mounts,
  // so EXDEV and immutable package protection need independent guest fixtures.
  prepare({ source: { type: 'file', hex: '0001ff' } });
  fs.writeFile('/tmp/existing', Uint8Array.of(5, 6, 7));
  const moved = await container.run('mv', ['source', '/tmp/existing'], { cwd, timeoutMs: 30000 });
  const crossMountMove = { code: moved.code, reason: moved.reason, stderrHex: hex(moved.stderr),
    passed: moved.code === 1 && moved.reason === 'exited' && moved.stderr.length > 0
      && hex(fs.readFile(`${cwd}/source`)) === '0001ff' && hex(fs.readFile('/tmp/existing')) === '050607' };
  const copied = await container.run('cp', ['source', '/tmp/existing'], { cwd, timeoutMs: 30000 });
  const crossMountCopy = { code: copied.code, reason: copied.reason, stderrHex: hex(copied.stderr),
    passed: copied.code === 0 && copied.reason === 'exited' && copied.stderr.length === 0
      && hex(fs.readFile(`${cwd}/source`)) === '0001ff' && hex(fs.readFile('/tmp/existing')) === '0001ff' };
  const packagePath = '/opt/toolchains/busybox/bin/busybox';
  const packageBefore = await digest(fs.readFile(packagePath));
  const readonly = [];
  for (const [command, args] of [['cp', ['source', packagePath]], ['rm', [packagePath]]]) {
    const result = await container.run(command, args, { cwd, timeoutMs: 30000 });
    readonly.push({ command, code: result.code, reason: result.reason, stderrHex: hex(result.stderr),
      passed: result.reason === 'exited' && result.code === 1 && result.stderr.length > 0
        && await digest(fs.readFile(packagePath)) === packageBefore });
  }
  return { matrixSha256: config.matrixSha256, cases, crossMountMove, crossMountCopy, readonly,
    passed: cases.every((test) => test.passed) && crossMountMove.passed && crossMountCopy.passed && readonly.every((test) => test.passed) };
}
