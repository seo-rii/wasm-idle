import corpus from './corpus.json' with { type: 'json' };

const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

// This is Make dependency-file decoding, never shell or compiler-driver parsing.
// Clang escapes spaces, # and backslashes and doubles $ in prerequisite paths.
export function dependencyPaths(contents) {
  check(typeof contents === 'string' && !contents.includes('\0'), 'Invalid dependency file');
  const rule = contents.replaceAll(/\\\r?\n/gu, ' ').trimEnd();
  check(!/[\r\n]/u.test(rule), 'Unexpected dependency rule boundary');
  const prefix = 'container-header-probe:';
  check(rule.startsWith(prefix), 'Invalid header dependency target');
  const paths = [];
  let token = '';
  for (let index = prefix.length; index < rule.length; index++) {
    const char = rule[index];
    if (char === '\\') {
      check(index + 1 < rule.length, 'Dangling dependency escape');
      token += rule[++index];
    } else if (char === '$' && rule[index + 1] === '$') {
      token += '$';
      index++;
    } else if (/\s/u.test(char)) {
      if (token) paths.push(token);
      token = '';
    } else {
      token += char;
    }
  }
  if (token) paths.push(token);
  check(paths.length > 0, 'Empty header dependencies');
  return paths;
}

function absolutePath(path, cwd) {
  const parts = (path.startsWith('/') ? path : `${cwd}/${path}`).split('/'), result = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      check(result.length > 0, 'Dependency escapes guest root');
      result.pop();
    } else result.push(part);
  }
  return `/${result.join('/')}`;
}

export { corpus };

// The Node and Chromium fixtures use the same real compiler cases and checks.
// runCommand must execute the unchanged argv array in the common workspace.
export async function runHeaderCorpus({ fs, runCommand, sysroot, cwd, sha256, evidence }) {
  evidence.profileId = corpus.profileId;
  evidence.qualification = corpus.qualification;
  evidence.passed = false;
  evidence.cases = [];
  evidence.headers = [];
  const headers = new Map();
  for (const [name, source] of Object.entries(corpus.sources)) {
    const bytes = encoder.encode(source.text);
    check(await sha256(bytes) === source.sha256, `Corpus source identity mismatch: ${name}`);
    fs.writeFile(`${cwd}/${name}`, bytes);
  }
  for (const fixture of corpus.cases) {
    const args = [
      '--target=wasm32-wasi', `--sysroot=${sysroot}`, `-resource-dir=${sysroot}/lib/clang/22`,
      '-I', `${sysroot}/include`, '-isystem', `${sysroot}/include/wasm32-wasi`,
      ...(fixture.language === 'c++' ? ['--driver-mode=g++', '-isystem', `${sysroot}/include/c++/v1`, ...corpus.cppFlags] : []),
      `-std=${fixture.standard}`, '-x', fixture.language, '-c', fixture.source,
      '-MD', '-MF', `${fixture.id}.d`, '-MT', 'container-header-probe', '-o', `${fixture.id}.o`
    ];
    const started = performance.now();
    const result = await runCommand(fixture.id, args);
    const record = {
      id: fixture.id, source: fixture.source, sourceSha256: corpus.sources[fixture.source].sha256,
      standard: fixture.standard, args, cwd, code: result.code, reason: result.reason,
      stdout: decoder.decode(result.stdout), stderr: decoder.decode(result.stderr), elapsedMs: performance.now() - started
    };
    evidence.cases.push(record);
    check(result.reason === 'exited' && result.code === 0, `${fixture.id}: compiler failed: ${record.stderr}`);
    const object = fs.readFile(`${cwd}/${fixture.id}.o`);
    check(object.length > 8 && [0, 97, 115, 109, 1, 0, 0, 0].every((byte, i) => object[i] === byte), `${fixture.id}: not a core Wasm object`);
    record.object = { bytes: object.length, sha256: await sha256(object) };
    const dependencies = fs.readFile(`${cwd}/${fixture.id}.d`);
    record.dependencies = { bytes: dependencies.length, sha256: await sha256(dependencies) };
    const paths = dependencyPaths(decoder.decode(dependencies)).map((path) => absolutePath(path, cwd));
    check(paths.includes(`${cwd}/${fixture.source}`), `${fixture.id}: source missing from dependencies`);
    record.headers = [...new Set(paths.filter((path) => path.startsWith(`${sysroot}/`)).map((path) => path.slice(sysroot.length + 1)))].sort();
    for (const required of fixture.requiredHeaders)
      check(record.headers.includes(required), `${fixture.id}: required header not read: ${required}`);
    for (const relative of record.headers) {
      const data = fs.readFile(`${sysroot}/${relative}`), digest = await sha256(data);
      check(!headers.has(relative) || headers.get(relative).sha256 === digest, `Header changed during corpus: ${relative}`);
      headers.set(relative, { path: relative, bytes: data.length, sha256: digest });
    }
  }
  for (const [path, identity] of headers) {
    check(await sha256(fs.readFile(`${sysroot}/${path}`)) === identity.sha256, `Header changed after corpus: ${path}`);
  }
  evidence.headers = [...headers.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  evidence.passed = true;
  return evidence;
}
