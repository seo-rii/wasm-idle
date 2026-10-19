import { BUSYBOX_COMMAND_STAGE } from '../commands.mjs';
// Shared data fixtures: the native producer and real WASI/container executions
// must independently produce these bytes and filesystem trees.
const hex = (data) => Buffer.from(data).toString('hex');
const file = (data) => ({ type: 'file', hex: hex(data) });
const directory = { type: 'directory' };
const symlink = (target) => ({ type: 'symlink', target });
const binary = Buffer.from(Array.from({ length: 8193 }, (_, i) => i % 256));
const cases = [];
function add(id, applet, args, options = {}) {
  const { input = '', tree = {}, after = tree, code = 0, output = '', error = '',
    stderrMode = 'exact', wasiOnly = false, nativeBaseline } = options;
  cases.push({ id, applet, args, stdinHex: hex(input), before: tree, after,
    code, stdoutHex: hex(output), stderrHex: hex(error), stderrMode, wasiOnly, nativeBaseline });
}

add('grep-stdin', 'grep', ['hello'], { input: 'bye\nhello\nhello there\n', output: 'hello\nhello there\n' });
add('grep-basic-regex', 'grep', ['^h.*o$'], { input: 'hello\nhalo\nhello!\n', output: 'hello\nhalo\n' });
add('grep-extended-regex', 'grep', ['-E', '^(hello|world)[0-9]+$'], { input: 'hello42\nworld7\nhello\n', output: 'hello42\nworld7\n' });
add('grep-fixed', 'grep', ['-F', '[x]'], { input: 'x\n[x]\ny[x]z\n', output: '[x]\ny[x]z\n' });
add('grep-utf8', 'grep', ['한글'], { input: 'ASCII\n한글 경로\n', output: '한글 경로\n' });
add('grep-nonutf8-text', 'grep', ['hello'], { input: Buffer.from([104, 101, 108, 108, 111, 255, 10]), output: Buffer.from([104, 101, 108, 108, 111, 255, 10]) });
add('grep-nul-rejected', 'grep', ['hello'], {
  input: Buffer.from([104, 101, 108, 108, 111, 0, 255, 10]), code: 2, wasiOnly: true,
  error: 'grep: NUL input is unsupported by the WASI text profile\n',
  nativeBaseline: { code: 0, stdoutHex: hex('hello\n'), stderrHex: '' },
});
for (const option of ['-a', '-I']) {
  add(`grep-${option.slice(1)}-rejected`, 'grep', [option, 'hello'], {
    input: 'hello\n', code: 2, wasiOnly: true,
    error: 'grep: binary input modes are unsupported by the WASI profile\n',
    nativeBaseline: { code: 0, stdoutHex: hex('hello\n'), stderrHex: '' },
  });
}
add('grep-number-ignore-case', 'grep', ['-n', '-i', 'HELLO'], { input: 'bye\nHello\nhello\n', output: '2:Hello\n3:hello\n' });
add('grep-invert', 'grep', ['-v', 'hello'], { input: 'bye\nhello\nworld\n', output: 'bye\nworld\n' });
add('grep-file', 'grep', ['hello', 'input file.txt'], {
  tree: { 'input file.txt': file('bye\nhello\n') }, output: 'hello\n',
});
add('grep-no-match', 'grep', ['missing'], { input: 'hello\n', code: 1 });
add('grep-missing-file', 'grep', ['hello', 'missing'], { code: 2, error: 'grep: missing: No such file or directory\n' });
add('grep-invalid-regex', 'grep', ['['], { input: 'line\n', code: 2, stderrMode: 'nonempty-libc-diagnostic' });
add('grep-read-boundary', 'grep', ['hello'], { input: 'x'.repeat(8191) + '\nhello\n', output: 'hello\n' });
add('grep-recursive', 'grep', ['-r', 'hello', 'tree'], {
  tree: { tree: directory, 'tree/nested': directory, 'tree/nested/file.txt': file('bye\nhello\n') },
  output: 'tree/nested/file.txt:hello\n',
});

add('mkdir-simple', 'mkdir', ['created dir'], { after: { 'created dir': directory } });
add('mkdir-parents', 'mkdir', ['-p', 'a/b/c'], { after: { a: directory, 'a/b': directory, 'a/b/c': directory } });
add('mkdir-existing-parents', 'mkdir', ['-p', 'existing'], { tree: { existing: directory } });
add('mkdir-existing-error', 'mkdir', ['existing'], {
  tree: { existing: directory }, code: 1, error: "mkdir: can't create directory 'existing': File exists\n",
});
add('mkdir-parent-missing', 'mkdir', ['missing/child'], {
  code: 1, error: "mkdir: can't create directory 'missing/child': No such file or directory\n",
});
add('mkdir-partial-nonzero', 'mkdir', ['created', 'missing/child'], {
  after: { created: directory }, code: 1, error: "mkdir: can't create directory 'missing/child': No such file or directory\n",
});
add('mkdir-symlink-parent', 'mkdir', ['-p', 'link/child'], {
  tree: { tree: directory, link: symlink('tree') },
  after: { tree: directory, link: symlink('tree'), 'tree/child': directory },
});
add('mkdir-mode-rejected', 'mkdir', ['-m', '755', 'new'], {
  code: 1, wasiOnly: true, error: 'mkdir: mode changes are unsupported by the WASI profile\n',
});

add('cp-binary', 'cp', ['input file.bin', 'output file.bin'], {
  tree: { 'input file.bin': file(binary) }, after: { 'input file.bin': file(binary), 'output file.bin': file(binary) },
});
add('cp-truncate', 'cp', ['source', 'dest'], {
  tree: { source: file('short\0\xff'), dest: file(binary) }, after: { source: file('short\0\xff'), dest: file('short\0\xff') },
});
add('cp-multiple', 'cp', ['a', 'b', 'folder'], {
  tree: { a: file('one'), b: file('two'), folder: directory },
  after: { a: file('one'), b: file('two'), folder: directory, 'folder/a': file('one'), 'folder/b': file('two') },
});
add('cp-no-clobber', 'cp', ['-n', 'source', 'dest'], { tree: { source: file('new'), dest: file('old') } });
add('cp-backslash-filename', 'cp', ['a\\b.bin', 'copy.bin'], {
  tree: { 'a\\b.bin': file('literal backslash') }, after: { 'a\\b.bin': file('literal backslash'), 'copy.bin': file('literal backslash') },
});
add('cp-source-symlink', 'cp', ['link', 'copy'], {
  tree: { source: file(binary), link: symlink('source') },
  after: { source: file(binary), link: symlink('source'), copy: file(binary) },
});
add('cp-preserve-symlink', 'cp', ['-d', 'link', 'copy'], {
  tree: { source: file(binary), link: symlink('source') },
  after: { source: file(binary), link: symlink('source'), copy: symlink('source') },
});
add('cp-same-file', 'cp', ['source', 'source'], {
  tree: { source: file(binary) }, code: 1, error: "cp: 'source' and 'source' are the same file\n",
});
add('cp-missing', 'cp', ['missing', 'dest'], { code: 1, error: "cp: can't stat 'missing': No such file or directory\n" });
for (const option of ['-p', '-a', '-l', '-s', ...(BUSYBOX_COMMAND_STAGE < 2 ? ['-r', '-R'] : [])]) {
  add(`cp-${option.slice(1)}-rejected`, 'cp', [option, 'source', 'dest'], {
    tree: { source: file(binary), dest: file('preserve existing destination') },
    code: 1, wasiOnly: true, stderrMode: 'nonempty-profile-diagnostic',
  });
}

add('mv-file', 'mv', ['source', 'dest'], { tree: { source: file(binary) }, after: { dest: file(binary) } });
add('mv-overwrite', 'mv', ['source', 'dest'], {
  tree: { source: file('new'), dest: file(binary) }, after: { dest: file('new') },
});
add('mv-directory', 'mv', ['tree', 'moved'], {
  tree: { tree: directory, 'tree/file.bin': file(binary) }, after: { moved: directory, 'moved/file.bin': file(binary) },
});
add('mv-into-directory', 'mv', ['source', 'folder'], {
  tree: { source: file(binary), folder: directory }, after: { folder: directory, 'folder/source': file(binary) },
});
add('mv-missing', 'mv', ['missing', 'dest'], { code: 1, error: "mv: can't rename 'missing': No such file or directory\n" });
add('mv-no-clobber', 'mv', ['-n', 'source', 'dest'], { tree: { source: file('new'), dest: file('old') } });
add('mv-symlink', 'mv', ['link', 'renamed'], {
  tree: { source: file(binary), link: symlink('source') },
  after: { source: file(binary), renamed: symlink('source') },
});

add('rm-file', 'rm', ['file.bin'], { tree: { 'file.bin': file(binary) }, after: {} });
add('rm-force-missing', 'rm', ['-f', 'missing']);
add('rm-missing', 'rm', ['missing'], { code: 1, error: "rm: can't remove 'missing': No such file or directory\n" });
add('rm-partial-nonzero', 'rm', ['file', 'missing'], {
  tree: { file: file(binary) }, after: {}, code: 1, error: "rm: can't remove 'missing': No such file or directory\n",
});
add('rm-recursive', 'rm', ['-r', 'tree'], {
  tree: { tree: directory, 'tree/nested': directory, 'tree/nested/file.bin': file(binary) }, after: {},
});
const manyFiles = { tree: directory };
for (let i = 0; i < 200; i++) manyFiles[`tree/entry-${String(i).padStart(3, '0')}-long-filename.bin`] = file([i]);
add('rm-large-directory', 'rm', ['-r', 'tree'], { tree: manyFiles, after: {} });
add('rm-symlink', 'rm', ['link'], {
  tree: { target: directory, 'target/file': file(binary), link: symlink('target') },
  after: { target: directory, 'target/file': file(binary) },
});

export const b1Cases = cases;
