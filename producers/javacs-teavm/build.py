#!/usr/bin/env python3
"""Build the original javacs and OpenJDK compiler for a browser WasmGC worker."""
import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import zipfile
from toolchain import CACHE, HERE, INPUTS, ROOT, digest, packaging_environment, pinned_gradle, pinned_jdk, verify_file, verify_jdk


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--refresh-dependency-verification', action='store_true',
        help='Maintainer-only: regenerate Gradle SHA-256 metadata for review')
    args = parser.parse_args()
    java_home = pinned_jdk()
    gradle = pinned_gradle()
    env = packaging_environment()
    env['JAVA_HOME'] = str(java_home)
    env['PATH'] = str(java_home / 'bin') + os.pathsep + env.get('PATH', '')
    env['GRADLE_USER_HOME'] = str(CACHE / 'gradle-user-home')
    subprocess.run([sys.executable, str(HERE / 'prepare.py'), '--jdk-home', str(java_home)], check=True, env=env)
    metadata = HERE / 'gradle/verification-metadata.xml'
    options = ['--write-verification-metadata', 'sha256'] if args.refresh_dependency_verification else [
        '--dependency-verification', 'strict']
    if not args.refresh_dependency_verification and not metadata.is_file():
        raise ValueError('Reviewed Gradle verification metadata is missing')
    subprocess.run([str(gradle), '--no-daemon', '--max-workers=2', *options, 'buildWasmGC'],
        check=True, env=env, cwd=HERE)
    dist = HERE / 'build/dist'
    dist.mkdir(parents=True, exist_ok=True)
    generated = HERE / 'build/generated/teavm/wasm-gc'
    for source, target in [
        (generated / 'wasm-idle-javacs-teavm.wasm', dist / 'javacs.wasm'),
        (generated / 'wasm-idle-javacs-teavm.wasm-runtime.js', dist / 'javacs-runtime.mjs'),
        (CACHE / 'jdk-platform.zip', dist / 'jdk-platform.zip')]:
        shutil.copyfile(source, target)

    # Reject invalid generated Wasm before it can become an SDK asset. V8 13.x
    # exposes Wasm exnref behind this flag; newer Node versions enable it by default.
    v8_options = subprocess.run(['node', '--v8-options'], check=True, capture_output=True, text=True).stdout
    flags = ['--experimental-wasm-exnref'] if '--experimental-wasm-exnref' in v8_options else []
    subprocess.run(['node', *flags, str(HERE / 'collect-bodies.mjs')], check=True, cwd=ROOT, env=env)
    notices = dist / 'notices'
    if notices.exists(): shutil.rmtree(notices)
    notices.mkdir()
    shutil.copyfile(CACHE / 'javacs/LICENSE.md', notices / 'javacs-LICENSE.md')
    for item in INPUTS['jdk']['modules']:
        module = pathlib.Path(item['path']).stem
        with zipfile.ZipFile(java_home / item['path']) as archive:
            for name in archive.namelist():
                if name.startswith('legal/') and not name.endswith('/'):
                    target = notices / 'openjdk' / module / name[6:]
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(name))
    for name in ['THIRD_PARTY_NOTICES.md', 'browser-platform.patch', 'inputs.lock.json']:
        shutil.copyfile(HERE / name, notices / name)
    for receipt in INPUTS['licenses']:
        source = HERE / receipt['path']
        verify_file(source, receipt)
        shutil.copyfile(source, notices / source.name)
    shutil.copyfile(CACHE / 'downloads/StringJoiner.java', notices / 'OpenJDK8-StringJoiner.java')
    shutil.copyfile(CACHE / 'zlib/usr/share/doc/zlib1g/copyright', notices / 'build-zlib-copyright.txt')
    recipe_files = sorted(path for path in HERE.rglob('*') if path.is_file()
        and not any(part in {'build', '.gradle', '__pycache__'} for part in path.relative_to(HERE).parts))
    provenance = {
        'schemaVersion': 1,
        'sourceRevision': INPUTS['javacs']['revision'],
        'teavmVersion': INPUTS['teavm']['version'],
        'target': 'wasm-gc',
        'optimization': 'NONE',
        'javaVersion': verify_jdk(java_home),
        'gradleVersion': INPUTS['gradle']['version'],
        'inputs': INPUTS,
        'recipe': [{'path': str(path.relative_to(HERE)), 'bytes': path.stat().st_size, 'sha256': digest(path)}
            for path in recipe_files],
        'assets': [{'path': name, 'bytes': (dist / name).stat().st_size, 'sha256': digest(dist / name)}
            for name in ['javacs-runtime.mjs', 'javacs.wasm', 'jdk-platform.zip', 'jso-bodies.json']]
    }
    (dist / 'provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
    print(json.dumps({'dist': str(dist.relative_to(ROOT)), 'assets': provenance['assets']}, indent=2))


if __name__ == '__main__': main()
