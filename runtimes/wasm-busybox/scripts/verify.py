#!/usr/bin/env python3
"""Verify local producer outputs; this does not certify a browser/container backend."""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

ROOT = Path(__file__).resolve().parents[1]


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
    assert receipt['configSha256'] == manifest['config']['sha256'] == sha(ROOT / manifest['config']['path'])
    assert receipt['patches'] == manifest['patches']
    assert receipt['processAbi'] == manifest['processAbi']
    for patch in manifest['patches']:
        assert sha(ROOT / patch['path']) == patch['sha256'], patch['path']
    assert receipt['probeScriptSha256'] == sha(ROOT / 'scripts/probe.py')
    assert receipt['smokeScriptSha256'] == sha(ROOT / 'test/smoke.mjs')
    assert receipt['b1Scripts'] == {path: sha(ROOT / path) for path in ('test/b1-smoke.mjs', 'test/b1-cases.mjs')}
    assert receipt['toolchain']['files'] == manifest['toolchain']['files']
    assert receipt['toolchain']['trees'] == manifest['toolchain']['trees']
    assert receipt['nativeSmokePassed'] and receipt['wasiNodeSmokePassed'] and receipt['b1SmokePassed']
    if 'nativeContinuation' in receipt:
        continuation = receipt['nativeContinuation']
        assert continuation['scriptSha256'] == sha(ROOT / 'scripts/resume-native.py')
        assert continuation['previousReceipt'] == 'receipt-before-native-resume.json'
        assert continuation['previousReceiptSha256'] == sha(work / continuation['previousReceipt'])
        prior = json.loads((work / continuation['previousReceipt']).read_text())
        assert prior['native']['build'] == receipt['native']['previousBuild']
        assert prior['native']['build']['timeout'] and prior['wasi']['artifact'] == receipt['wasi']['artifact']
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
    b1 = json.loads((work / 'b1-smoke.json').read_text())
    assert b1 == receipt['b1'] and b1['passed'] and receipt['b1Run']['exitCode'] == 0
    assert b1['artifact'] == artifact and b1['nativeSha256'] == receipt['native']['artifact']['sha256']
    assert b1['nativeSha256'] == sha(work / 'native-build/busybox')
    assert b1['matrix']['path'] == 'b1-cases.json'
    matrix_path = work / 'b1-smoke/b1-cases.json'
    assert b1['matrix']['sha256'] == sha(matrix_path)
    matrix = json.loads(matrix_path.read_text())
    assert matrix['profile'] == b1['profile'] == 'busybox-b1-subset'
    assert len(matrix['cases']) == b1['matrix']['cases'] and len(matrix['cases']) >= 40
    expected_cases = {(case['id'], invocation) for case in matrix['cases'] for invocation in ('argv0', 'multicall')}
    assert len(expected_cases) == len(matrix['cases']) * 2
    assert {(case['id'], case['invocation']) for case in b1['cases']} == expected_cases
    assert len(b1['cases']) == len(expected_cases) and all(case['passed'] for case in b1['cases'])
    assert {case['applet'] for case in matrix['cases']} == {'grep', 'mkdir', 'cp', 'mv', 'rm'}
    assert b1['imports'] == smoke['imports']
    for target in ('wasi', 'native'):
        assert sha(work / (target + '.config')) == receipt[target]['generatedConfigSha256']
    pack = receipt['sourcePack']
    assert pack['path'] == 'busybox-source-pack.tar.gz'
    assert sha(work / pack['path']) == pack['sha256']
    with tarfile.open(work / pack['path']) as archive:
        records = archive.getmembers()
        assert len({entry.name for entry in records}) == len(records)
        assert all(entry.isfile() and not entry.name.startswith('/') and '..' not in Path(entry.name).parts for entry in records)
        expected = ['LICENSE', 'producer/manifest.json', 'producer/config/b1.config',
                    'producer/scripts/probe.py', 'producer/test/smoke.mjs',
                    'producer/test/b1-smoke.mjs', 'producer/test/b1-cases.mjs',
                    'upstream/' + manifest['source']['filename']]
        for name in expected:
            assert archive.getmember(name).isfile(), name
        assert hashlib.sha256(archive.extractfile(expected[-1]).read()).hexdigest() == manifest['source']['sha256']
        for relative in ('manifest.json', manifest['config']['path'], 'scripts/probe.py',
                         'scripts/verify.py', 'test/smoke.mjs', 'test/b1-smoke.mjs', 'test/b1-cases.mjs',
                         'README.md', 'NOTICE', 'patches/README.md'):
            assert hashlib.sha256(archive.extractfile('producer/' + relative).read()).hexdigest() == sha(ROOT / relative)
        if 'nativeContinuation' in receipt:
            assert hashlib.sha256(archive.extractfile('producer/scripts/resume-native.py').read()).hexdigest() == receipt['nativeContinuation']['scriptSha256']
        for patch in manifest['patches']:
            assert hashlib.sha256(archive.extractfile('producer/' + patch['path']).read()).hexdigest() == patch['sha256']
        for target in ('wasi', 'native'):
            name = 'producer/config/generated-' + target + '.config'
            assert hashlib.sha256(archive.extractfile(name).read()).hexdigest() == receipt[target]['generatedConfigSha256']
    return {'producer': 'passed', 'browser': 'not-qualified', 'artifact': artifact,
            'nativeB0Cases': 20, 'wasiB0Cases': 24, 'b1Cases': len(b1['cases']), 'sourcePack': pack}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('work_dir', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.work_dir.resolve()), indent=2))
