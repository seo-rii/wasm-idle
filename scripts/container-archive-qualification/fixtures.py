from pathlib import Path
import gzip
import io
import stat
import tarfile
import zipfile

import sys
assert len(sys.argv) == 2, 'Usage: python3 fixtures.py NEW_FIXTURE_DIRECTORY'
root = Path(sys.argv[1]).resolve()
root.mkdir()
payload = bytes(range(256)) + b'archive payload\n' * 50
(root / 'payload.bin').write_bytes(payload)
(root / 'payload.bin.gz').write_bytes(gzip.compress(payload, mtime=0))
(root / 'broken.gz').write_bytes(b'\x1f\x8b' + b'not a gzip stream')


def tar(name, members, compact=False):
    with tarfile.open(root / name, 'w', format=tarfile.USTAR_FORMAT) as output:
        for member in members:
            filename, kind, body = member[:3]
            item = tarfile.TarInfo(filename)
            item.mtime = member[3] if len(member) == 4 else 1700000000
            item.type = kind
            item.mode = 0o755 if kind == tarfile.DIRTYPE else 0o644
            if kind == tarfile.REGTYPE:
                item.size = len(body)
                output.addfile(item, io.BytesIO(body))
            else:
                if kind in [tarfile.SYMTYPE, tarfile.LNKTYPE]:
                    item.linkname = body
                output.addfile(item)
        end = output.offset
    if compact:
        # Retain both required zero blocks without tarfile's optional record padding.
        (root / name).write_bytes((root / name).read_bytes()[:end + 1024])


tar('input.tar', [
    ('tree', tarfile.DIRTYPE, ''),
    ('tree/text.txt', tarfile.REGTYPE, b'alpha\nbeta\n'),
    ('tree/payload.bin', tarfile.REGTYPE, payload),
    ('tree/link', tarfile.SYMTYPE, 'text.txt'),
])
tar('hardlink.tar', [('hard', tarfile.LNKTYPE, 'existing.txt')])
tar('special.tar', [('fifo', tarfile.FIFOTYPE, '')])
tar('parent-link.tar', [('parent/child.txt', tarfile.REGTYPE, b'new bytes')])
(root / 'short.tar').write_bytes(b'too short')

tar('directory-only.tar', [('data/', tarfile.DIRTYPE, '')], compact=True)
tar('directory-tree.tar', [
    ('data/', tarfile.DIRTYPE, ''),
    ('data/file.txt', tarfile.REGTYPE, b'child'),
], compact=True)
tar('directory-duplicate.tar', [
    ('data/', tarfile.DIRTYPE, ''),
    ('data/file.txt', tarfile.REGTYPE, b'child'),
    ('./data/', tarfile.DIRTYPE, '', 1700000200),
], compact=True)
tar('directory-deferred-link.tar', [
    ('data/', tarfile.DIRTYPE, ''),
    ('data/link', tarfile.SYMTYPE, '../sibling'),
], compact=True)

with zipfile.ZipFile(root / 'input.zip', 'w') as output:
    for name, mode, body, codec in [
        ('tree/', stat.S_IFDIR | 0o755, b'', zipfile.ZIP_STORED),
        ('tree/text.txt', stat.S_IFREG | 0o644, b'alpha\nbeta\n', zipfile.ZIP_STORED),
        ('tree/payload.bin', stat.S_IFREG | 0o644, payload, zipfile.ZIP_DEFLATED),
        ('tree/link', stat.S_IFLNK | 0o777, b'text.txt', zipfile.ZIP_STORED),
    ]:
        item = zipfile.ZipInfo(name, (2020, 1, 2, 3, 4, 6))
        item.create_system = 3
        item.external_attr = mode << 16
        item.compress_type = codec
        output.writestr(item, body)

with zipfile.ZipFile(root / 'stored-bad-crc.zip', 'w') as output:
    item = zipfile.ZipInfo('data.txt', (2020, 1, 2, 3, 4, 6))
    item.create_system = 3
    item.external_attr = (stat.S_IFREG | 0o644) << 16
    item.compress_type = zipfile.ZIP_STORED
    output.writestr(item, b'expected bytes\n')
with zipfile.ZipFile(root / 'stored-bad-crc.zip') as archive:
    item = archive.getinfo('data.txt')
    offset = item.header_offset + 30 + len(item.filename.encode()) + len(item.extra)
corrupted = bytearray((root / 'stored-bad-crc.zip').read_bytes())
corrupted[offset] ^= 1
(root / 'stored-bad-crc.zip').write_bytes(corrupted)
with zipfile.ZipFile(root / 'stored-bad-crc.zip') as archive:
    assert archive.testzip() == 'data.txt'

with zipfile.ZipFile(root / 'stored-symlink-bad-crc.zip', 'w') as output:
    item = zipfile.ZipInfo('link', (2020, 1, 2, 3, 4, 6))
    item.create_system = 3
    item.external_attr = (stat.S_IFLNK | 0o777) << 16
    item.compress_type = zipfile.ZIP_STORED
    output.writestr(item, b'target')
with zipfile.ZipFile(root / 'stored-symlink-bad-crc.zip') as archive:
    item = archive.getinfo('link')
    offset = item.header_offset + 30 + len(item.filename.encode()) + len(item.extra)
corrupted = bytearray((root / 'stored-symlink-bad-crc.zip').read_bytes())
corrupted[offset] ^= 1
(root / 'stored-symlink-bad-crc.zip').write_bytes(corrupted)
with zipfile.ZipFile(root / 'stored-symlink-bad-crc.zip') as archive:
    assert archive.testzip() == 'link'

boundary_payload = bytes(range(256)) * 32 + b'\0'
(root / 'stored-boundary.bin').write_bytes(boundary_payload)
with zipfile.ZipFile(root / 'stored-boundary.zip', 'w', compression=zipfile.ZIP_STORED) as output:
    for name, body in [('stored.bin', boundary_payload), ('empty.txt', b'')]:
        item = zipfile.ZipInfo(name, (2020, 1, 2, 3, 4, 6))
        item.create_system = 3
        item.external_attr = (stat.S_IFREG | 0o644) << 16
        item.compress_type = zipfile.ZIP_STORED
        output.writestr(item, body)
print('Created deterministic archive fixtures')
