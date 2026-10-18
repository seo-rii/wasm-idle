import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTarPackage } from '../../dist/packages/archive.js';
import { MemoryFileSystem } from '../../dist/fs/index.js';

function tar(items) {
  const result = [];
  for (const [path, value, type = '0'] of items) {
    const body = Buffer.from(value), header = Buffer.alloc(512);
    header.write(path, 0, 100, 'utf8'); header.write('0000644\0', 100);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write(type, 156); header.write('ustar\0' + '00', 257);
    header.fill(32, 148, 156);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    result.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return Buffer.concat([...result, Buffer.alloc(1024)]);
}

test('verified USTAR bytes produce a readonly tree with binary contents and implicit parents', () => {
  const input = tar([['include/binary.h', Buffer.from([0, 255, 10])]]);
  const entries = extractTarPackage(input);
  const fs = new MemoryFileSystem(); fs.mountReadonly('/usr/share/test-sysroot', entries);
  assert.deepEqual(fs.readFile('/usr/share/test-sysroot/include/binary.h'), new Uint8Array([0, 255, 10]));
  input.fill(0);
  assert.deepEqual(fs.readFile('/usr/share/test-sysroot/include/binary.h'), new Uint8Array([0, 255, 10]));
  assert.throws(() => fs.writeFile('/usr/share/test-sysroot/include/binary.h', new Uint8Array()), { code: 'EROFS' });
});

test('header integrity and truncated/end-marker errors fail before any mount publication', () => {
  const input = tar([['a', 'data']]), fs = new MemoryFileSystem(), generation = fs.generation;
  const invalid = Buffer.from(input); invalid[0] ^= 1;
  assert.throws(() => fs.mountReadonly('/usr/share/failed', extractTarPackage(invalid)), { code: 'INVALID_DISTRIBUTION' });
  assert.equal(fs.generation, generation);
  assert.throws(() => extractTarPackage(input.subarray(0, -512)), { code: 'INVALID_DISTRIBUTION' });
});

test('entry, depth and logical byte limits include implicit directories', () => {
  const input = tar([['one/two/file', 'abcd']]);
  for (const limits of [{ maxEntries: 2 }, { maxDepth: 2 }, { maxFileBytes: 3 }, { maxTotalBytes: 3 }, { maxArchiveBytes: 512 }]) {
    assert.throws(() => extractTarPackage(input, limits), { code: 'INVALID_DISTRIBUTION' });
  }
});

test('ambiguous trees and unsupported tar profiles fail explicitly', () => {
  for (const items of [[['same', 'a'], ['same', 'b']], [['parent', 'a'], ['parent/child', 'b']], [['link', '', '2']]]) {
    assert.throws(() => extractTarPackage(tar(items)), { code: 'INVALID_DISTRIBUTION' });
  }
});
