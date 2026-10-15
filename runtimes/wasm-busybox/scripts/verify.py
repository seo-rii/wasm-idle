#!/usr/bin/env python3
"""Verify local producer outputs; this does not certify a browser/container backend."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]
if not __debug__:
    raise SystemExit('verify.py checks with assert statements; run it without -O or PYTHONOPTIMIZE')


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def verify(work):
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    receipt = json.loads((work / 'receipt.json').read_text())
    assert receipt['status'] == 'producer-smoke-passed', 'Producer gate has not passed'
    assert receipt['sourceSha256'] == manifest['source']['sha256']
    assert receipt['configSha256'] == manifest['config']['sha256'] == sha(ROOT / 'config/b0.config')
    assert receipt['patches'] == manifest['patches']
    assert receipt['processAbi'] == manifest['processAbi']
    for patch in manifest['patches']:
        assert sha(ROOT / patch['path']) == patch['sha256'], patch['path']
    assert receipt['probeScriptSha256'] == sha(ROOT / 'scripts/probe.py')
    assert receipt['smokeScriptSha256'] == sha(ROOT / 'test/smoke.mjs')
    assert receipt['toolchain']['files'] == manifest['toolchain']['files']
    assert receipt['toolchain']['trees'] == manifest['toolchain']['trees']
    assert receipt['nativeSmokePassed'] and receipt['wasiNodeSmokePassed']
    assert receipt['wasi']['build']['exitCode'] == receipt['native']['build']['exitCode'] == 0
    assert receipt['qualifiedWasiApplets'] == [], 'Browser/container promotion is a separate gate'
    assert receipt['nodeWasiApplets'] == manifest['requestedApplets']
    wasm = work / 'busybox.wasm'
    artifact = receipt['wasi']['artifact']
    assert artifact['sha256'] == sha(wasm) and artifact['size'] == wasm.stat().st_size
    smoke = json.loads((work / 'wasi-smoke.json').read_text())
    assert smoke == receipt['wasi']['smoke'] and smoke['passed']
    assert smoke['artifact'] == artifact
    assert smoke['memory']['maximumPages'] <= 1024
    assert all(entry['kind'] == 'function' and (entry['module'] == 'wasi_snapshot_preview1'
               or (entry['module'] == 'wasm_idle_process_v1' and entry['name'] == 'initial_cwd')) for entry in smoke['imports'])
    assert smoke['processAbi'] == 'wasm_idle_process_v1' and smoke['cwd'] == '/workspace/a b' and smoke['env'] == {}
    assert len(smoke['cases']) == 20 and all(case['passed'] for case in smoke['cases'])
    assert len(smoke['startupCases']) == 4 and all(case['passed'] for case in smoke['startupCases'])
    assert len(receipt['native']['smoke']) == 20 and all(case['passed'] for case in receipt['native']['smoke'])
    for target in ('wasi', 'native'):
        assert sha(work / (target + '.config')) == receipt[target]['generatedConfigSha256']
    pack = receipt['sourcePack']
    assert pack['path'] == 'busybox-source-pack.tar.gz'
    assert sha(work / pack['path']) == pack['sha256']
    with tarfile.open(work / pack['path']) as archive:
        records = archive.getmembers()
        assert len({entry.name for entry in records}) == len(records)
        assert all(entry.isfile() and not entry.name.startswith('/') and '..' not in Path(entry.name).parts for entry in records)
        expected = ['LICENSE', 'producer/manifest.json', 'producer/config/b0.config',
                    'producer/scripts/probe.py', 'producer/test/smoke.mjs',
                    'upstream/' + manifest['source']['filename']]
        for name in expected:
            assert archive.getmember(name).isfile(), name
        assert hashlib.sha256(archive.extractfile(expected[-1]).read()).hexdigest() == manifest['source']['sha256']
        for patch in manifest['patches']:
            assert hashlib.sha256(archive.extractfile('producer/' + patch['path']).read()).hexdigest() == patch['sha256']
        for target in ('wasi', 'native'):
            name = 'producer/config/generated-' + target + '.config'
            assert hashlib.sha256(archive.extractfile(name).read()).hexdigest() == receipt[target]['generatedConfigSha256']
    return {'producer': 'passed', 'browser': 'not-qualified', 'artifact': artifact,
            'nativeCases': 20, 'wasiCases': 24, 'sourcePack': pack}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('work_dir', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.work_dir.resolve()), indent=2))
