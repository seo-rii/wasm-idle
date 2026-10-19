#!/usr/bin/env python3
"""Finish a native build timeout after revalidating the exact pinned source tree."""
import argparse
import gzip
import io
import json
import os
from pathlib import Path
import shutil
import tarfile

import probe

if not __debug__:
    raise SystemExit('resume-native.py validates with assert statements; run it without -O or PYTHONOPTIMIZE')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('work_dir', type=Path)
    parser.add_argument('--source-archive', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=900, choices=range(240, 1801))
    args = parser.parse_args()
    work = args.work_dir.resolve()
    manifest = json.loads((probe.ROOT / 'manifest.json').read_text())
    receipt_path = work / 'receipt.json'
    receipt = json.loads(receipt_path.read_text())
    assert receipt['status'] == 'built-unqualified' and receipt['native']['build']['timeout']
    assert receipt['wasi']['build']['exitCode'] == 0 and receipt['wasi']['smoke']['passed']
    assert receipt['probeScriptSha256'] == probe.digest(probe.ROOT / 'scripts/probe.py')
    assert receipt['smokeScriptSha256'] == probe.digest(probe.ROOT / 'test/smoke.mjs')
    assert receipt['configSha256'] == manifest['config']['sha256'] == probe.digest(probe.ROOT / manifest['config']['path'])
    assert receipt['patches'] == manifest['patches']
    assert receipt['processAbi'] == manifest['processAbi']
    assert receipt['metadataAbi'] == manifest.get('metadataAbi')
    assert receipt['reviewFixes'] == manifest.get('reviewFixes', [])
    assert receipt['b1Scripts'] == {path: probe.digest(probe.ROOT / path) for path in ('test/b1-smoke.mjs', 'test/b1-cases.mjs')}
    stage = manifest['commandStage']
    assert isinstance(stage, int) and 1 <= stage <= 4 and receipt['commandStage'] == stage
    command_sources = ('commands.mjs', 'test/node-wasi-fixture.mjs', 'test/command-cases.mjs',
                       'test/command-smoke.mjs', 'test/command-container.mjs',
                       'test/archive-regression-fixtures.mjs', 'scripts/test-commands.mjs')
    assert receipt['commandScripts'] == {path: probe.digest(probe.ROOT / path) for path in command_sources}
    wasi_smoke = json.loads((work / 'wasi-smoke.json').read_text())
    assert wasi_smoke == receipt['wasi']['smoke'] and receipt['wasiNodeSmokePassed']
    assert wasi_smoke['artifact'] == receipt['wasi']['artifact']
    metadata_abi = stage >= 3
    assert all(entry['kind'] == 'function' and (entry['module'] == 'wasi_snapshot_preview1'
               or (entry['module'] == 'wasm_idle_process_v1' and entry['name'] == 'initial_cwd')
               or (metadata_abi and entry['module'] == 'wasm_idle_fs_v1' and entry['name'] in ('path_mode', 'fd_mode')))
               for entry in wasi_smoke['imports'])
    assert sorted(entry['name'] for entry in wasi_smoke['imports'] if entry['module'] == 'wasm_idle_fs_v1') == (
        ['fd_mode', 'path_mode'] if metadata_abi else [])
    assert sum(entry['module'] == 'wasm_idle_process_v1' for entry in wasi_smoke['imports']) == 1
    for patch in manifest['patches']:
        assert probe.digest(probe.ROOT / patch['path']) == patch['sha256']
    for target in ('native', 'wasi'):
        assert probe.digest(work / (target + '.config')) == receipt[target]['generatedConfigSha256']
        assert probe.digest(work / (target + '-build/.config')) == receipt[target]['generatedConfigSha256']
    wasm = work / 'busybox.wasm'
    assert probe.digest(wasm) == receipt['wasi']['artifact']['sha256']
    assert wasm.stat().st_size == receipt['wasi']['artifact']['size']
    archive = args.source_archive.resolve()
    assert probe.digest(archive) == manifest['source']['sha256'] == receipt['sourceSha256']
    assert archive.stat().st_size == manifest['source']['size']
    cc = Path(shutil.which('cc'))
    assert probe.digest(cc) == receipt['host']['ccSha256']
    environment = probe.build_environment()

    # Preserve the failed attempt. Resume is one-shot and never hides that result.
    for name in ('receipt-before-native-resume.json', 'native-resumed-build.log', 'native-fixture',
                 'b1-smoke', 'b1-smoke.json', 'b1-smoke.log',
                 'command-smoke', 'command-smoke.json', 'command-smoke.log',
                 'busybox-source-pack-before-resume.tar.gz', 'busybox-source-pack-resume-input.tar.gz'):
        assert not (work / name).exists(), f'Existing continuation evidence is preserved: {name}'
    validation = work / 'native-resume-validation'
    validation.mkdir(mode=0o700)
    previous = work / 'receipt-before-native-resume.json'
    with previous.open('xb') as output:
        output.write(receipt_path.read_bytes())
    os.chmod(previous, 0o600)
    expected_source = validation / manifest['source']['directory']
    probe.unpack(archive, expected_source, manifest['source'])
    for index, patch in enumerate(manifest['patches']):
        result = probe.run_logged(['patch', '-p1', '--forward', '--batch', '--fuzz=0', '-i', str(probe.ROOT / patch['path'])],
                                  validation / ('patch-' + str(index) + '.log'), environment, cwd=expected_source)
        assert result['exitCode'] == 0
    source = work / manifest['source']['directory']
    source_identity = probe.tree_digest(expected_source)
    assert probe.tree_digest(source) == source_identity, 'The prepared source changed since the pinned patches were applied'
    receipt['nativeContinuation'] = {'scriptSha256': probe.digest(Path(__file__)),
        'previousReceipt': previous.name, 'previousReceiptSha256': probe.digest(previous),
        'sourceTree': source_identity, 'timeoutSeconds': args.timeout}
    receipt['native']['previousBuild'] = receipt['native']['build']
    receipt['nativeSmokePassed'] = receipt['b1SmokePassed'] = receipt['commandSmokePassed'] = False
    command = ['make', '-C', str(source), 'O=' + str(work / 'native-build'), 'HOSTCC=' + str(cc),
               'SKIP_STRIP=y', 'V=1', 'CC=' + str(cc), '-j1', 'busybox']
    receipt['native']['build'] = probe.run_logged(command, work / 'native-resumed-build.log', environment, timeout=args.timeout)
    probe.write_json(receipt_path, receipt)
    if receipt['native']['build']['exitCode'] != 0:
        return 1
    native = work / 'native-build/busybox'
    receipt['native']['artifact'] = {'sha256': probe.digest(native), 'size': native.stat().st_size}
    receipt['native']['smoke'] = probe.native_smoke(native, work)
    receipt['nativeSmokePassed'] = bool(receipt['native']['smoke']) and all(test['passed'] for test in receipt['native']['smoke'])
    probe.write_json(receipt_path, receipt)
    if receipt['nativeSmokePassed'] and receipt['wasiNodeSmokePassed']:
        receipt['b1Run'] = probe.run_logged(['node', str(probe.ROOT / 'test/b1-smoke.mjs'), str(wasm), str(native),
            str(work / 'b1-smoke'), str(work / 'b1-smoke.json'), str(stage)], work / 'b1-smoke.log', environment)
    if (work / 'b1-smoke.json').is_file():
        receipt['b1'] = json.loads((work / 'b1-smoke.json').read_text())
    receipt['b1SmokePassed'] = (work / 'b1-smoke.json').is_file() and receipt.get('b1Run', {}).get('exitCode') == 0 and receipt.get('b1', {}).get('passed', False)
    probe.write_json(receipt_path, receipt)
    if receipt['nativeSmokePassed'] and receipt['wasiNodeSmokePassed'] and receipt['b1SmokePassed']:
        receipt['commandRun'] = probe.run_logged([
            'node', str(probe.ROOT / 'test/command-smoke.mjs'), '--artifact', str(wasm),
            '--native', str(native), '--stage', str(stage), '--work', str(work / 'command-smoke'),
            '--output', str(work / 'command-smoke.json')], work / 'command-smoke.log', environment, timeout=240)
        if (work / 'command-smoke.json').is_file():
            receipt['commands'] = json.loads((work / 'command-smoke.json').read_text())
    receipt['commandSmokePassed'] = (work / 'command-smoke.json').is_file() and receipt.get('commandRun', {}).get('exitCode') == 0 and receipt.get('commands', {}).get('passed', False)
    probe.write_json(receipt_path, receipt)
    if receipt['nativeSmokePassed'] and receipt['wasiNodeSmokePassed'] and receipt['b1SmokePassed'] and receipt['commandSmokePassed']:
        before_pack = work / 'busybox-source-pack-before-resume.tar.gz'
        if (work / 'busybox-source-pack.tar.gz').exists():
            (work / 'busybox-source-pack.tar.gz').rename(before_pack)
        pack = probe.source_pack(work, archive, source)
        pack_input = work / 'busybox-source-pack-resume-input.tar.gz'
        (work / pack['path']).rename(pack_input)
        with tarfile.open(pack_input) as original:
            members = {entry.name: original.extractfile(entry).read() for entry in original.getmembers()}
        members['producer/scripts/resume-native.py'] = Path(__file__).read_bytes()
        with (work / pack['path']).open('xb') as output:
            with gzip.GzipFile(fileobj=output, mode='wb', mtime=0, filename='') as compressed:
                with tarfile.open(fileobj=compressed, mode='w') as stream:
                    for name, data in sorted(members.items()):
                        entry = tarfile.TarInfo(name)
                        entry.size, entry.mode = len(data), 0o644
                        stream.addfile(entry, io.BytesIO(data))
        receipt['sourcePack'] = {'path': pack['path'], 'sha256': probe.digest(work / pack['path']),
                                 'size': (work / pack['path']).stat().st_size}
        receipt['status'] = 'producer-smoke-passed'
        receipt['nodeWasiApplets'] = manifest['requestedApplets']
    probe.write_json(receipt_path, receipt)
    print(json.dumps({'status': receipt['status'], 'b1SmokePassed': receipt['b1SmokePassed'],
                      'commandSmokePassed': receipt['commandSmokePassed'], 'receipt': str(receipt_path)}))
    return 0 if receipt['status'] == 'producer-smoke-passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
