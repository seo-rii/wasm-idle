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
async function twoGenerations(id) {
  const owner = await openPersistentWorkspace({ id });
  owner.fs.writeFile('/workspace/file', encode('version-one')); await owner.flush();
  owner.fs.writeFile('/workspace/file', encode('version-two')); await owner.flush();
  await owner.dispose();
  return (await opfs.getDirectoryHandle('wasm-idle-workspaces-v1')).directories.get(id);
}

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
