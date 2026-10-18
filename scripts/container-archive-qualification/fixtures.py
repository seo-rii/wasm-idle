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


def tar(name, members):
    with tarfile.open(root / name, 'w', format=tarfile.USTAR_FORMAT) as output:
        for filename, kind, body in members:
            item = tarfile.TarInfo(filename)
            item.mtime = 1700000000
            item.type = kind
            item.mode = 0o755 if kind == tarfile.DIRTYPE else 0o644
            if kind == tarfile.REGTYPE:
                item.size = len(body)
                output.addfile(item, io.BytesIO(body))
            else:
                if kind in [tarfile.SYMTYPE, tarfile.LNKTYPE]:
                    item.linkname = body
                output.addfile(item)


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
print('Created deterministic archive fixtures')
