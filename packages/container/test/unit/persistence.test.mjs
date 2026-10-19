import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

// Minimal in-process OPFS, IndexedDB and Web Locks doubles. Chromium coverage lives in
// scripts/test-persistence-browser.mjs; these cases inject storage faults a browser cannot.
const notFound = () => new DOMException('Entry is missing', 'NotFoundError');
let readFault;
class FileHandle {
  constructor(directory, name) { this.directory = directory; this.name = name; }
  async getFile() {
    const fault = readFault?.(this.name);
    if (fault) throw fault;
    const bytes = this.directory.files.get(this.name);
    if (!bytes) throw notFound();
    return { size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
  }
  async createWritable() {
    const chunks = [];
    return {
      write: async (data) => { chunks.push(Uint8Array.from(data)); },
      close: async () => { this.directory.files.set(this.name, Uint8Array.from(chunks.flatMap((chunk) => [...chunk]))); },
      abort: async () => {}
    };
  }
}
class DirectoryHandle {
  files = new Map(); directories = new Map();
  async getDirectoryHandle(name, { create = false } = {}) {
    if (!this.directories.has(name)) { if (!create) throw notFound(); this.directories.set(name, new DirectoryHandle()); }
    return this.directories.get(name);
  }
  async getFileHandle(name, { create = false } = {}) {
    if (!this.files.has(name)) { if (!create) throw notFound(); this.files.set(name, new Uint8Array()); }
    return new FileHandle(this, name);
  }
}
const opfs = new DirectoryHandle();
const databases = new Map();
function database(stores) {
  return {
    onversionchange: null,
    close() {},
    createObjectStore(name, { keyPath }) { stores.set(name, { keyPath, records: new Map() }); },
    transaction(name, mode) {
      const store = stores.get(name);
      if (!store) throw notFound();
      const working = new Map(store.records), operations = [];
      let aborted = false;
      const transaction = {
        error: null, oncomplete: null, onerror: null, onabort: null,
        abort() { aborted = true; },
        objectStore: () => ({
          clear() { operations.push(() => working.clear()); },
          put(value) { operations.push(() => working.set(value[store.keyPath], structuredClone(value))); },
          openCursor(_range, direction) {
            const request = { result: null, onsuccess: null };
            operations.push(() => {
              const keys = [...working.keys()].sort((a, b) => direction === 'prev' ? b - a : a - b);
              const step = (index) => {
                request.result = index < keys.length ? { value: structuredClone(working.get(keys[index])), continue: () => step(index + 1) } : null;
                if (!aborted) request.onsuccess?.();
              };
              step(0);
            });
            return request;
          }
        })
      };
      setTimeout(() => {
        for (const operation of operations) if (!aborted) operation();
        if (aborted) { transaction.onabort?.(); return; }
        if (mode === 'readwrite') store.records = working;
        transaction.oncomplete?.();
      });
      return transaction;
    }
  };
}
const held = new Set();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
  storage: { getDirectory: async () => opfs },
  locks: {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); } finally { held.delete(name); }
    }
  }
} });
globalThis.isSecureContext = true;
globalThis.indexedDB = {
  open(name) {
    const request = { result: undefined, error: null, transaction: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
    setTimeout(() => {
      let stores = databases.get(name);
      if (!stores) { databases.set(name, stores = new Map()); request.result = database(stores); request.onupgradeneeded?.(); }
      request.result ??= database(stores);
      request.onsuccess?.();
    });
    return request;
  }
};

const { openPersistentWorkspace } = await import('../../dist/fs/persistence/index.js');
const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);
const digest = (text) => createHash('sha256').update(text).digest('hex');

test('workspace exports and saves copy no package or temporary file contents', async (t) => {
  let owner = await openPersistentWorkspace({ id: 'scoped-snapshot' });
  try {
    owner.fs.mkdir('project');
    owner.fs.writeFile('project/main.c', encode('int main() {}'));
    owner.fs.setTimes('project/main.c', { atimeMs: 123, mtimeMs: 456 });
    owner.fs.symlink('main.c', 'project/entry');
    owner.fs.writeFile('/tmp/scratch', new Uint8Array(2048).fill(9));
    owner.fs.mountReadonly('/opt/toolchain', [
      { path: 'compiler.wasm', type: 'file', mode: 0o444, data: new Uint8Array(1024 * 1024).fill(7) }
    ]);
    const full = owner.fs.exportSnapshot();
    const slice = Uint8Array.prototype.slice;
    let copiedBytes = 0;
    const spy = t.mock.method(Uint8Array.prototype, 'slice', function (...args) {
      copiedBytes += this.byteLength;
      return slice.apply(this, args);
    });
    let snapshot;
    try { snapshot = owner.exportSnapshot(); } finally { spy.mock.restore(); }
    assert.equal(copiedBytes, encode('int main() {}').length, 'copy only workspace file bytes');
    assert.equal(snapshot.generation, full.generation);
    assert.equal(snapshot.nextInode, full.nextInode);
    const workspace = (entries) => entries.filter((entry) => entry.path === '/workspace' || entry.path.startsWith('/workspace/'));
    assert.deepEqual(workspace(snapshot.entries), workspace(full.entries));
    assert.equal(snapshot.entries.some((entry) => entry.path.startsWith('/opt/toolchain')), false);
    assert.equal(snapshot.entries.some((entry) => entry.path === '/tmp/scratch'), false);
    assert.equal(snapshot.mounts.some((mount) => mount.path === '/opt/toolchain'), false);

    const saving = t.mock.method(Uint8Array.prototype, 'slice', function (...args) {
      assert.ok(this.byteLength < 2048, 'saving must not copy package or scratch buffers');
      return slice.apply(this, args);
    });
    try { await owner.flush(); } finally { saving.mock.restore(); }
    await owner.dispose();
    owner = await openPersistentWorkspace({ id: 'scoped-snapshot' });
    assert.deepEqual(workspace(owner.exportSnapshot().entries), workspace(snapshot.entries));
    assert.throws(() => owner.fs.stat('/opt/toolchain'), { code: 'ENOENT' });
    assert.throws(() => owner.fs.stat('/tmp/scratch'), { code: 'ENOENT' });
    owner.fs.writeFile('new', encode('next'));
    assert.ok(owner.fs.stat('new').inode >= snapshot.nextInode, 'preserve the global inode high watermark');
  } finally { await owner.dispose(); }
});

async function twoGenerations(id) {
  const owner = await openPersistentWorkspace({ id });
  owner.fs.writeFile('/workspace/file', encode('version-one')); await owner.flush();
  owner.fs.writeFile('/workspace/file', encode('version-two')); await owner.flush();
  await owner.dispose();
  return (await opfs.getDirectoryHandle('wasm-idle-workspaces-v1')).directories.get(id);
}

test('metadata-only saves retain explicit atime/mtime after reopen without replacing file contents', async () => {
  let owner = await openPersistentWorkspace({ id: 'explicit-timestamps' });
  owner.fs.writeFile('file', encode('preserved')); await owner.flush();
  owner.fs.setTimes('file', { atimeMs: 123, mtimeMs: 456 });
  const info = owner.fs.stat('file'); assert.equal(owner.inspect().dirty, true);
  await owner.flush(); await owner.dispose();
  owner = await openPersistentWorkspace({ id: 'explicit-timestamps' });
  try {
    assert.equal(owner.fs.stat('file').atimeMs, 123); assert.equal(owner.fs.stat('file').mtimeMs, 456);
    assert.equal(owner.fs.stat('file').ctimeMs, info.ctimeMs); assert.equal(decode(owner.fs.readFile('file')), 'preserved');
    assert.equal(owner.inspect().dirty, false);
  } finally { await owner.dispose(); }
});

test('a transient blob read failure fails opening without selecting or retiring an older root', async () => {
  await twoGenerations('transient');
  readFault = (name) => name === digest('version-two') ? new DOMException('Busy storage', 'NotReadableError') : undefined;
  try { await assert.rejects(openPersistentWorkspace({ id: 'transient' }), { code: 'STORAGE' }); }
  finally { readFault = undefined; }
  const owner = await openPersistentWorkspace({ id: 'transient' });
  try {
    assert.equal(decode(owner.fs.readFile('/workspace/file')), 'version-two');
    assert.deepEqual([owner.inspect().state, owner.inspect().recovered, owner.inspect().committedSequence], ['saved', false, 2]);
  } finally { await owner.dispose(); }
});

test('missing or mismatched newest blobs still fall back to the previous verified root', async () => {
  for (const [id, damage] of [
    ['missing', (blobs) => blobs.files.delete(digest('version-two'))],
    ['mismatched', (blobs) => blobs.files.set(digest('version-two'), encode('corrupt-two'))]
  ]) {
    damage(await twoGenerations(id));
    const owner = await openPersistentWorkspace({ id });
    try {
      assert.equal(decode(owner.fs.readFile('/workspace/file')), 'version-one');
      assert.deepEqual([owner.inspect().state, owner.inspect().recovered, owner.inspect().committedSequence], ['recovered', true, 1]);
    } finally { await owner.dispose(); }
  }
});

for (const [id, edit, limits] of [
  ['file-bytes', (fs) => fs.writeFile('file', encode('NEW DATA THAT MUST NOT BE LOST')), { maxBytes: 10 }],
  ['aggregate-bytes', (fs) => fs.writeFile('other', encode('more')), { maxBytes: 6 }],
  ['symlink-bytes', (fs) => fs.symlink('a-long-target', 'link'), { maxBytes: 6 }],
  ['file-and-symlink-bytes', (fs) => fs.symlink('file', 'link'), { maxBytes: 6 }],
  ['inodes-with-base', (fs) => fs.mkdir('other'), (fs) => ({ maxInodes: fs.inodeCount - 1 })],
  ['workspace-inodes', (fs) => { for (let i = 0; i < 20; i++) fs.mkdir(`dir-${i}`); }, { maxInodes: 14 }],
  ['metadata-characters', (fs) => { for (let i = 0; i < 10; i++) fs.mkdir(`dir-${i}`); }, { maxMetadataBytes: 1024 }],
  ['metadata-utf8', (fs) => fs.mkdir('한'.repeat(300)), { maxMetadataBytes: 1024 }]
]) {
  test(`lower ${id} budget rejects admission and preserves both committed roots`, async () => {
    let owner = await openPersistentWorkspace({ id });
    owner.fs.writeFile('file', encode('old')); await owner.flush();
    edit(owner.fs); await owner.flush();
    const expected = owner.exportSnapshot();
    const budget = typeof limits === 'function' ? limits(owner.fs) : limits;
    await owner.dispose();
    const records = databases.get(`wasm-idle-workspaces-v1:${id}`).get('roots').records;
    const blobs = (await opfs.getDirectoryHandle('wasm-idle-workspaces-v1')).directories.get(id).files;
    const originalRecords = structuredClone(records), originalBlobs = structuredClone(blobs);
    if (id === 'metadata-utf8') {
      assert.ok(records.get(2).manifest.length < 1024);
      assert.ok(encode(records.get(2).manifest).length > 1024);
    }
    // Repeated failed admission must release the writer lock and never return an
    // older writable generation whose flush would retire the valid newest save.
    for (let attempt = 0; attempt < 2; attempt++) {
      let admitted;
      try {
        await assert.rejects(async () => { admitted = await openPersistentWorkspace({ id, ...budget }); }, { code: 'RESOURCE_LIMIT' });
      } finally { await admitted?.dispose(); }
      assert.deepEqual(databases.get(`wasm-idle-workspaces-v1:${id}`).get('roots').records, originalRecords);
      assert.deepEqual(blobs, originalBlobs);
    }
    owner = await openPersistentWorkspace({ id });
    try {
      assert.deepEqual(owner.exportSnapshot().entries.filter((entry) => entry.path.startsWith('/workspace/')),
        expected.entries.filter((entry) => entry.path.startsWith('/workspace/')));
      assert.deepEqual([owner.inspect().state, owner.inspect().recovered, owner.inspect().committedSequence], ['saved', false, 2]);
    } finally { await owner.dispose(); }
  });
}
