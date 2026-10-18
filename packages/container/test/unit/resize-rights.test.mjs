import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFileSystem } from '../../dist/fs/index.js';

test('resize-only descriptions preserve byte I/O restrictions, dup and quota accounting', () => {
  const fs = new MemoryFileSystem({ maxBytes: 4 });
  fs.writeFile('file', new Uint8Array([1, 2, 3, 4]));
  const fd = fs.open('file', { resize: true }), duplicate = fs.dup(fd);
  try {
    assert.throws(() => fs.read(fd, 1), { code: 'EBADF' });
    assert.throws(() => fs.write(fd, new Uint8Array([9])), { code: 'EBADF' });
    assert.throws(() => fs.ftruncate(fd, 5), { code: 'ENOSPC' });
    assert.deepEqual(fs.readFile('file'), new Uint8Array([1, 2, 3, 4]));
    fs.ftruncate(duplicate, 2);
    assert.equal(fs.fstat(fd).size, 2);
    assert.equal(fs.byteLength, 2);
    fs.ftruncate(fd, 4);
    assert.deepEqual(fs.readFile('file'), new Uint8Array([1, 2, 0, 0]));
  } finally { fs.close(duplicate); fs.close(fd); }
});

test('resize rights do not make directories writable and still reject readonly files', () => {
  const fs = new MemoryFileSystem();
  fs.mountReadonly('/usr/share/resize', [{ path: 'file', type: 'file', mode: 0o444, data: new Uint8Array([1]) }]);
  assert.throws(() => fs.open('/usr/share/resize/file', { resize: true }), { code: 'EROFS' });
  for (const path of ['/workspace', '/usr/share/resize']) {
    for (const directory of [false, true]) {
      const fd = fs.open(path, { directory, resize: true });
      try {
        assert.equal(fs.fstat(fd).type, 'directory');
        assert.equal(fs.getDirectoryPath(fd), path);
        assert.throws(() => fs.ftruncate(fd, 0), { code: 'EISDIR' });
      } finally { fs.close(fd); }
    }
  }
});
