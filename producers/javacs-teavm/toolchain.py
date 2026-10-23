"""Authenticated, private producer inputs. Never installs or updates the host JDK."""
import hashlib
import json
import os
import pathlib
import subprocess
import urllib.request
import uuid
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CACHE = ROOT / '.cache/javacs-teavm'
INPUTS = json.loads((HERE / 'inputs.lock.json').read_text())


def digest(path):
    result = hashlib.sha256()
    with pathlib.Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def verify_file(path, receipt):
    if path.stat().st_size != receipt['bytes'] or digest(path) != receipt['sha256']:
        raise ValueError('Authenticated producer input differs: ' + path.name)


def download(receipt):
    target = CACHE / 'downloads' / receipt['path']
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        verify_file(target, receipt)
        return target
    temporary = target.with_name(target.name + '.part-' + uuid.uuid4().hex)
    try:
        with urllib.request.urlopen(receipt['url'], timeout=90) as response, temporary.open('xb') as output:
            os.chmod(temporary, 0o600)
            for chunk in iter(lambda: response.read(1024 * 1024), b''):
                output.write(chunk)
        verify_file(temporary, receipt)
        temporary.rename(target)
    finally:
        if temporary.exists(): temporary.unlink()
    return target


def verify_jdk(home):
    for module in INPUTS['jdk']['modules']:
        verify_file(home / module['path'], module)
    version = subprocess.run([str(home / 'bin/java'), '-version'], check=True,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True).stdout
    if '17.0.20.1' not in version:
        raise ValueError('The pinned OpenJDK 17 producer version is required')
    return version.strip()


def pinned_jdk():
    packages = [download(item) for item in INPUTS['jdk']['packages']]
    extraction = CACHE / 'jdk'
    home = extraction / INPUTS['jdk']['javaHome']
    if not home.exists():
        extraction.mkdir(parents=True, exist_ok=True)
        for package in packages:
            subprocess.run(['dpkg-deb', '--extract', str(package), str(extraction)], check=True)
        # Debian's configuration links point to /etc. Keep packaged configuration private.
        for path in home.rglob('*'):
            if path.is_symlink():
                link = os.readlink(path)
                own_target = extraction / link.lstrip('/') if link.startswith('/') else None
                if own_target is not None and own_target.exists():
                    path.unlink()
                    path.symlink_to(os.path.relpath(own_target, path.parent))
    verify_jdk(home)
    return home


def pinned_gradle():
    receipt = INPUTS['gradle']
    archive = download(receipt)
    parent = CACHE / 'gradle'
    home = parent / ('gradle-' + receipt['version'])
    if not home.exists():
        parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive) as packed:
            packed.extractall(parent)
        (home / 'bin/gradle').chmod(0o755)
    # Verify restored distributions as well as their authenticated archive.
    with zipfile.ZipFile(archive) as packed:
        for item in packed.infolist():
            if item.is_dir(): continue
            target = parent / item.filename
            if target.is_symlink() or not target.is_file() or target.read_bytes() != packed.read(item):
                raise ValueError('Extracted Gradle distribution differs: ' + item.filename)
    return home / 'bin/gradle'


def packaging_environment():
    receipt = INPUTS['zlib']
    archive = download(receipt['package'])
    extraction = CACHE / 'zlib'
    library = extraction / receipt['library']['path']
    if not library.exists():
        extraction.mkdir(parents=True, exist_ok=True)
        subprocess.run(['dpkg-deb', '--extract', str(archive), str(extraction)], check=True)
    verify_file(library, receipt['library'])
    if (library.parent / 'libz.so.1').resolve() != library.resolve():
        raise ValueError('The pinned zlib SONAME link differs')
    env = os.environ.copy()
    directory = str(library.parent)
    if env.get('LD_LIBRARY_PATH', '').split(os.pathsep)[0] != directory:
        env['LD_LIBRARY_PATH'] = directory + (os.pathsep + env['LD_LIBRARY_PATH'] if env.get('LD_LIBRARY_PATH') else '')
    return env


if __name__ == '__main__':
    print(pinned_jdk())
