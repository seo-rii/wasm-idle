#!/usr/bin/env python3
"""Pinned upstream BusyBox B0 producer probe; failed WASI ports stay failed."""
import argparse
import hashlib
import gzip
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import tarfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def tree_digest(path):
    value = hashlib.sha256()
    files = sorted(item for item in path.rglob('*') if item.is_file())
    for item in files:
        value.update(item.relative_to(path).as_posix().encode() + b'\0')
        value.update(bytes.fromhex(digest(item)))
    return {'sha256': value.hexdigest(), 'files': len(files)}


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def build_environment():
    """Pass only tool lookup and temporary-file locations to the pinned build.

    BusyBox's Makefile/Kbuild read caller CFLAGS, LDFLAGS, CROSS_COMPILE, MAKEFLAGS
    and similar variables. The receipt does not record them, so they stay out.
    """
    environment = {name: os.environ[name] for name in ('PATH', 'HOME', 'TMPDIR') if name in os.environ}
    environment.update({'LC_ALL': 'C', 'SOURCE_DATE_EPOCH': '1725494400', 'KCONFIG_NOTIMESTAMP': '1'})
    return environment


def implicit_wasm_opt(sdk, environment):
    """Identify the host wasm-opt that clang's WebAssembly driver runs after optimized links.

    The driver looks in its own directory and then PATH. The tool is outside the SDK
    pin and changes output bytes, so the receipt records it.
    """
    found = shutil.which('wasm-opt', path=os.pathsep.join([str(sdk / 'bin'), environment.get('PATH', '')]))
    if not found:
        return None
    path = Path(found).resolve()
    version = subprocess.run([str(path), '--version'], capture_output=True, text=True,
                             env=environment, timeout=30, check=True).stdout.strip()
    return {'path': str(path), 'sha256': digest(path), 'version': version}


def run_logged(command, path, environment, cwd=None, timeout=240):
    print('RUN', json.dumps([str(arg) for arg in command]), flush=True)
    with path.open('xb') as log:
        os.chmod(path, 0o600)
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   stdin=subprocess.DEVNULL, env=environment, cwd=cwd, start_new_session=True)
        timed_out = False
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            code = process.wait()
    # Inspect bounded excerpts only after the command and all owned processes exit.
    diagnostics = []
    with path.open(errors='replace') as log:
        for line in log:
            if re.search(r'(fatal error:|error:|undefined symbol:|Error [0-9]|not found)', line):
                diagnostics.append(line.rstrip()[:2000])
                if len(diagnostics) == 32:
                    break
    print('EXIT', code, 'timeout=' + str(timed_out), 'log=' + str(path), flush=True)
    return {'exitCode': code, 'timeout': timed_out, 'diagnostics': diagnostics,
            'log': path.name, 'logSha256': digest(path)}


def unpack(archive, destination, source):
    if destination.exists():
        raise RuntimeError('Use a fresh work directory; extraction never overwrites prior evidence')
    with tarfile.open(archive) as stream:
        entries = stream.getmembers()
        if len(entries) > 5000 or sum(entry.size for entry in entries) > 32 * 1024 * 1024:
            raise RuntimeError('Pinned source archive exceeds extraction limits')
        seen = set()
        for entry in entries:
            if (entry.name != source['directory'] and not entry.name.startswith(source['directory'] + '/')) \
                    or '..' in Path(entry.name).parts or not (entry.isfile() or entry.isdir()) \
                    or entry.name in seen:
                raise RuntimeError('Unsupported source archive entry: ' + entry.name)
            seen.add(entry.name)
        stream.extractall(destination.parent, members=entries)


def native_smoke(binary, work):
    cwd = work / 'native-fixture' / 'workspace' / 'a b'
    cwd.mkdir(mode=0o700, parents=True)
    fixture = cwd / 'binary file.bin'
    fixture.write_bytes(bytes(range(256)))
    cases = [
        ('printf-binary', ['printf', 'A\\000B\\377\\n'], b'', b'A\0B\xff\n', 0),
        ('printf-numeric', ['printf', '%s:%04d:%x\n', '한글', '7', '255'], b'', '한글:0007:ff\n'.encode(), 0),
        ('cat-binary', ['cat'], bytes(range(256)), bytes(range(256)), 0),
        ('cat-file', ['cat', 'binary file.bin'], b'', bytes(range(256)), 0),
        ('cat-absolute', ['cat', str(fixture)], b'', bytes(range(256)), 0),
        ('cat-missing', ['cat', 'missing.bin'], b'', b'', 1),
        ('echo-utf8', ['echo', '한글 space'], b'', '한글 space\n'.encode(), 0),
        ('true', ['true'], b'', b'', 0),
        ('false', ['false'], b'', b'', 1),
        ('pwd', ['pwd'], b'', str(cwd).encode() + b'\n', 0),
    ]
    results = []
    for name, arguments, stdin, stdout, code in cases:
        for alias in (False, True):
            command = arguments if alias else [str(binary), *arguments]
            result = subprocess.run(command, executable=str(binary) if alias else None,
                                    input=stdin, capture_output=True, cwd=cwd, timeout=10)
            stderr = b"cat: can't open 'missing.bin': No such file or directory\n" if name == 'cat-missing' else b''
            passed = result.returncode == code and result.stdout == stdout and result.stderr == stderr
            results.append({'id': name, 'invocation': 'argv0' if alias else 'multicall',
                            'passed': passed, 'exitCode': result.returncode,
                            'stdoutHex': result.stdout.hex(), 'stderrHex': result.stderr.hex()})
    return results


def source_pack(work, archive, source_dir):
    """Keep the exact upstream archive and all port inputs beside produced bytes."""
    members = {'upstream/' + archive.name: archive, 'LICENSE': source_dir / 'LICENSE'}
    for target in ('wasi', 'native'):
        members['producer/config/generated-' + target + '.config'] = work / (target + '.config')
    for relative in ['manifest.json', 'README.md', 'NOTICE', 'config/b0.config', 'scripts/probe.py', 'scripts/verify.py', 'test/smoke.mjs', 'patches/README.md']:
        members['producer/' + relative] = ROOT / relative
    for patch in sorted((ROOT / 'patches').glob('*.patch')):
        members['producer/patches/' + patch.name] = patch
    output = work / 'busybox-source-pack.tar.gz'
    with output.open('wb') as destination:
        with gzip.GzipFile(fileobj=destination, mode='wb', mtime=0, filename='') as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as stream:
                for name, path in sorted(members.items()):
                    data = path.read_bytes()
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    entry.mode = 0o644
                    stream.addfile(entry, io.BytesIO(data))
    return {'path': output.name, 'sha256': digest(output), 'size': output.stat().st_size}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sdk', type=Path, required=True)
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--source-archive', type=Path)
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    source = manifest['source']
    if digest(ROOT / 'config/b0.config') != manifest['config']['sha256']:
        raise RuntimeError('Configuration fragment does not match its pin')
    for patch in manifest['patches']:
        if digest(ROOT / patch['path']) != patch['sha256']:
            raise RuntimeError('Patch does not match its pin: ' + patch['path'])
    sdk = args.sdk.resolve()
    toolchain = {'version': (sdk / 'VERSION').read_text().strip(), 'files': {}, 'trees': {}}
    for relative, expected in manifest['toolchain']['files'].items():
        actual = digest(sdk / relative)
        if actual != expected:
            raise RuntimeError('Toolchain hash mismatch: ' + relative)
        toolchain['files'][relative] = actual
    for relative, expected in manifest['toolchain']['trees'].items():
        actual = tree_digest(sdk / relative)
        if actual != expected:
            raise RuntimeError('Toolchain tree hash mismatch: ' + relative)
        toolchain['trees'][relative] = actual
    work = args.work_dir.resolve()
    work.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(work, 0o700)
    if args.source_archive:
        archive = args.source_archive.resolve()
    else:
        archive = work / source['filename']
        with urllib.request.urlopen(source['url'], timeout=60) as response:
            if response.geturl() != source['url']:
                raise RuntimeError('Source download unexpectedly redirected')
            data = response.read(source['size'] + 1)
        archive.write_bytes(data)
    if archive.stat().st_size != source['size'] or digest(archive) != source['sha256']:
        raise RuntimeError('Source archive size or hash mismatch')
    source_dir = work / source['directory']
    unpack(archive, source_dir, source)
    environment = build_environment()
    toolchain['implicitWasmOpt'] = implicit_wasm_opt(sdk, environment)
    for index, patch in enumerate(manifest['patches']):
        applied = run_logged(['patch', '-p1', '--forward', '--batch', '--fuzz=0', '-i', str(ROOT / patch['path'])],
                             work / ('patch-' + str(index) + '.log'), environment, cwd=source_dir)
        if applied['exitCode'] != 0:
            raise RuntimeError('Pinned patch did not apply cleanly')
    host_cc = shutil.which('cc')
    if not host_cc:
        raise RuntimeError('Native cc is required for upstream Kconfig and the native baseline')
    receipt = {'schemaVersion': 1, 'probe': 'G0-BUSYBOX', 'sourceSha256': source['sha256'],
               'configSha256': manifest['config']['sha256'], 'patches': manifest['patches'], 'toolchain': toolchain,
               'processAbi': manifest['processAbi'],
               'probeScriptSha256': digest(Path(__file__)),
               'smokeScriptSha256': digest(ROOT / 'test/smoke.mjs'),
               'host': {'system': platform.platform(), 'ccSha256': digest(Path(host_cc)),
                        'ccVersion': subprocess.check_output([host_cc, '--version'], text=True).splitlines()[0]},
               'startedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
               'qualifiedWasiApplets': [], 'browserSmoke': 'not-run'}
    for target in ('wasi', 'native'):
        build = work / (target + '-build')
        build.mkdir()
        common = ['make', '-C', str(source_dir), 'O=' + str(build), 'HOSTCC=' + host_cc,
                  'SKIP_STRIP=y', 'V=1']
        if target == 'wasi':
            common += ['ARCH=wasm32', 'CC=' + str(sdk / 'bin/clang'),
                       'LD=' + str(sdk / 'bin/wasm-ld'), 'AR=' + str(sdk / 'bin/llvm-ar'),
                       'NM=' + str(sdk / 'bin/llvm-nm'), 'STRIP=' + str(sdk / 'bin/llvm-strip')]
        else:
            common += ['CC=' + host_cc]
        configured = run_logged([*common, 'allnoconfig'], work / (target + '-configure.log'), environment)
        result = {'configure': configured}
        if configured['exitCode'] == 0:
            config = build / '.config'
            overrides = {}
            for line in (ROOT / 'config/b0.config').read_text().splitlines():
                match = re.match(r'(?:# )?(CONFIG_[A-Z0-9_]+)(?:=| is not set)', line)
                if match:
                    overrides[match.group(1)] = line
            lines = []
            for line in config.read_text().splitlines():
                match = re.match(r'(?:# )?(CONFIG_[A-Z0-9_]+)(?:=| is not set)', line)
                lines.append(overrides.pop(match.group(1), line) if match else line)
            lines.extend(overrides.values())
            config.write_text('\n'.join(lines) + '\n')
            resolved = run_logged([*common, 'oldconfig'], work / (target + '-resolve-config.log'), environment)
            result['resolveConfig'] = resolved
            if resolved['exitCode'] != 0:
                receipt[target] = result
                write_json(work / 'receipt.json', receipt)
                continue
            selected = set(re.findall(r'^CONFIG_([A-Z0-9_]+)=y$', config.read_text(), re.MULTILINE))
            expected = {'BUSYBOX', *(name.upper() for name in manifest['requestedApplets'])}
            if not expected.issubset(selected) or selected.intersection({'ASH', 'SHELL_ASH', 'HUSH', 'SHELL_HUSH', 'FEATURE_SUID'}):
                raise RuntimeError('Generated configuration did not retain the B0/no-shell profile')
            result['selectedConfigFlags'] = sorted(selected)
            result['generatedConfigSha256'] = digest(config)
            shutil.copyfile(config, work / (target + '.config'))
            result['build'] = run_logged([*common, '-j1', 'busybox'], work / (target + '-build.log'), environment)
            binary = build / 'busybox'
            if result['build']['exitCode'] == 0 and binary.is_file():
                result['artifact'] = {'sha256': digest(binary), 'size': binary.stat().st_size}
                if target == 'native':
                    result['smoke'] = native_smoke(binary, work)
                else:
                    wasm = work / 'busybox.wasm'
                    shutil.copyfile(binary, wasm)
                    result['nodeSmoke'] = run_logged([
                        'node', str(ROOT / 'test/smoke.mjs'), str(wasm), str(work / 'node-smoke'),
                        str(work / 'wasi-smoke.json')], work / 'wasi-smoke.log', environment)
                    if (work / 'wasi-smoke.json').is_file():
                        result['smoke'] = json.loads((work / 'wasi-smoke.json').read_text())
                    result['requiresQualification'] = ['browser-byte-smoke', 'common-container-vfs']
        receipt[target] = result
        write_json(work / 'receipt.json', receipt)
    receipt['status'] = 'blocked' if receipt['wasi'].get('build', {}).get('exitCode') != 0 else 'built-unqualified'
    native = receipt['native']
    receipt['nativeSmokePassed'] = bool(native.get('smoke')) and all(case['passed'] for case in native['smoke'])
    receipt['wasiNodeSmokePassed'] = receipt['wasi'].get('smoke', {}).get('passed', False)
    if receipt['nativeSmokePassed'] and receipt['wasiNodeSmokePassed']:
        receipt['status'] = 'producer-smoke-passed'
        receipt['nodeWasiApplets'] = manifest['requestedApplets']
        receipt['sourcePack'] = source_pack(work, archive, source_dir)
    write_json(work / 'receipt.json', receipt)
    print(json.dumps({'status': receipt['status'], 'nativeSmokePassed': receipt['nativeSmokePassed'],
                      'receipt': str(work / 'receipt.json')}, indent=2))
    # This checks the producer gate. Browser/container qualification remains separate.
    return 0 if receipt['status'] == 'producer-smoke-passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
