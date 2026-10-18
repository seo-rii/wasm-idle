// Offline distribution assembly. Runtime adapters are selected by application code only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { validateDistribution } from '../packages/container/dist/packages/distribution.js';

const MAX_FILE = 256 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024, MAX_FILES = 16384;
const digestPattern = /^[a-f0-9]{64}$/u;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = bytes => ({ bytes: bytes.length, sha256: digest(bytes) });
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const jsonBytes = value => Buffer.from(JSON.stringify(canonical(value), null, 2) + '\n');
const shape = (value, keys, label) => {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label}: object required`);
  assert(Object.keys(value).every(key => keys.includes(key)), `${label}: unknown field`);
};
const list = (value, label, max = MAX_FILES) => {
  assert(Array.isArray(value) && value.length <= max, `${label}: bounded array required`); return value;
};
const relative = value => typeof value === 'string' && value.length <= 4096 && !value.includes('\\') &&
  !value.includes('\0') && value.split('/').every(part => part && part !== '.' && part !== '..') && !isAbsolute(value);
function baseURL(value) {
  const url = new URL(value);
  assert(url.href === value && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password &&
    !url.search && !url.hash && url.pathname.endsWith('/'), 'Canonical uncredentialed base URL ending in / required');
  return value;
}
function metadata(value, label) {
  assert(value && digestPattern.test(value.sha256) && Number.isSafeInteger(value.bytes) && value.bytes >= 0 &&
    value.bytes <= MAX_FILE, `${label}: bounded independent identity required`);
}
async function pinned(path, expected, limit = MAX_FILE) {
  metadata(expected, path);
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size === expected.bytes && info.size <= limit, `Input size/type: ${path}`);
  const bytes = await readFile(path);
  assert.deepEqual(identity(bytes), { bytes: expected.bytes, sha256: expected.sha256 }, `Input identity: ${path}`);
  return bytes;
}
async function readJSON(path, max = 4 * 1024 * 1024) {
  const info = await lstat(path);
  assert(info.isFile() && !info.isSymbolicLink() && info.size <= max, 'Bounded regular JSON input required');
  const bytes = await readFile(path);
  assert(bytes.length <= max); return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes };
}
function checkLogical(delivery, asset) {
  const logical = asset.encoding === 'gzip' ? gunzipSync(delivery, { maxOutputLength: Math.max(1, asset.logical.bytes) }) : delivery;
  assert.deepEqual(identity(logical), { sha256: asset.logical.sha256, bytes: asset.logical.bytes }, `Logical identity: ${asset.id}`);
}
const mediaPath = mediaType => {
  assert(typeof mediaType === 'string' && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mediaType), 'Canonical MIME type required');
  return mediaType.replace('/', '-');
};
const objectPath = (id, mediaType) => `objects/${id.sha256}/${mediaPath(mediaType)}`;

/** Source and notice status is the release owner's review, never inferred from a hash. */
function validateProvenance(provenance, distribution, files) {
  const packages = new Map(distribution.packages.map(pkg => [pkg.id, pkg]));
  assert(list(provenance, 'provenance', 128).length === packages.size, 'Exactly one provenance record per package required');
  const seen = new Set();
  for (const record of provenance) {
    shape(record, ['package', 'license', 'sourceStatus', 'receipt', 'sources', 'notices'], 'provenance');
    const pkg = packages.get(record.package);
    assert(pkg && !seen.has(record.package), 'Unique known provenance package required'); seen.add(record.package);
    assert(typeof record.license === 'string' && record.license.length > 0 && record.license.length <= 256 && !record.license.includes('\0'), 'License description required');
    assert(['reviewed-complete', 'incomplete'].includes(record.sourceStatus), 'Explicit source completeness status required');
    const receipt = files.get(record.receipt);
    assert(receipt && receipt.sha256 === pkg.producer.receiptSha256, 'Producer receipt must match the pinned package');
    for (const key of ['sources', 'notices']) {
      assert(list(record[key], key, 256).length > 0, `${key} inventory required`);
      assert(new Set(record[key]).size === record[key].length && record[key].every(path => files.has(path)), `${key} must reference packaged files`);
    }
  }
}

export async function prepareContainerDistribution({ input, output }) {
  input = resolve(input); output = resolve(output);
  const { value: recipe } = await readJSON(input);
  shape(recipe, ['schemaVersion', 'baseURL', 'distribution', 'adapterIds', 'inputs', 'provenance', 'hostFiles'], 'recipe');
  assert.equal(recipe.schemaVersion, 1);
  const base = baseURL(recipe.baseURL), sourceDirectory = dirname(input);
  const distribution = structuredClone(recipe.distribution);
  assert(distribution && Array.isArray(distribution.packages));
  const inputs = new Map();
  for (const entry of list(recipe.inputs, 'inputs')) {
    shape(entry, ['package', 'asset', 'path'], 'asset input');
    const key = JSON.stringify([entry.package, entry.asset]);
    assert(!inputs.has(key) && typeof entry.path === 'string', 'Unique asset input required'); inputs.set(key, entry.path);
  }
  const assets = [];
  for (const pkg of distribution.packages) for (const asset of pkg.assets) {
    const key = JSON.stringify([pkg.id, asset.id]), path = inputs.get(key);
    assert(path, `Missing local input for ${pkg.id}/${asset.id}`); inputs.delete(key);
    asset.url = new URL(objectPath(asset.delivery, asset.delivery.mediaType), base).href;
    assets.push({ asset, path: resolve(sourceDirectory, path) });
  }
  assert.equal(inputs.size, 0, 'Unused asset inputs rejected');
  const manifestBytes = jsonBytes(distribution), manifestIdentity = identity(manifestBytes);
  const allowedAssetURLs = [...new Set(assets.map(({ asset }) => asset.url))].sort();
  const validated = await validateDistribution({ bytes: manifestBytes, expectedSha256: manifestIdentity.sha256,
    adapterIds: recipe.adapterIds, allowedAssetURLs });
  const manifestPath = `manifests/${manifestIdentity.sha256}.json`;
  const files = new Map(); let totalBytes = 0, created = false;
  const put = async (path, bytes, mediaType) => {
    assert(relative(path), 'Canonical output path required');
    const record = { path, ...identity(bytes), mediaType };
    const existing = files.get(path);
    if (existing) { assert.deepEqual(existing, record); return path; }
    totalBytes += bytes.length;
    assert(totalBytes <= MAX_TOTAL && files.size < MAX_FILES, 'Distribution output budget exceeded');
    await mkdir(dirname(join(output, path)), { recursive: true });
    await writeFile(join(output, path), bytes, { flag: 'wx' }); files.set(path, record); return path;
  };
  const source = async (entry, mediaType) => {
    shape(entry, ['path', 'sha256', 'bytes'], 'pinned provenance input');
    assert(typeof entry.path === 'string');
    const bytes = await pinned(resolve(sourceDirectory, entry.path), entry);
    return put(objectPath(entry, mediaType), bytes, mediaType);
  };
  // A fresh directory prevents mixing the current release with any previous release.
  await mkdir(output); created = true;
  try {
    for (const { asset, path } of assets) {
      const bytes = await pinned(path, asset.delivery); checkLogical(bytes, asset);
      await put(objectPath(asset.delivery, asset.delivery.mediaType), bytes, asset.delivery.mediaType);
    }
    const provenance = [];
    for (const item of list(recipe.provenance, 'provenance', 128)) {
      shape(item, ['package', 'license', 'sourceStatus', 'receipt', 'sources', 'notices'], 'provenance input');
      const record = { package: item.package, license: item.license, sourceStatus: item.sourceStatus,
        receipt: await source(item.receipt, 'application/json'), sources: [], notices: [] };
      for (const entry of list(item.sources, 'sources', 256)) record.sources.push(await source(entry, 'application/octet-stream'));
      for (const entry of list(item.notices, 'notices', 256)) record.notices.push(await source(entry, 'text/plain'));
      record.sources.sort(); record.notices.sort(); provenance.push(record);
    }
    validateProvenance(provenance, validated, files);
    // Host code is an explicit application bundle, not a runtime manifest import.
    const host = new Map();
    for (const entry of list(recipe.hostFiles ?? [], 'host files', 1024)) {
      shape(entry, ['path', 'destination', 'sha256', 'bytes', 'mediaType'], 'host input');
      assert(relative(entry.destination) && !host.has(entry.destination), 'Unique canonical host destination required');
      mediaPath(entry.mediaType);
      const bytes = await pinned(resolve(sourceDirectory, entry.path), entry);
      host.set(entry.destination, { bytes, mediaType: entry.mediaType });
    }
    const hostInventory = [...host].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => ({ path, ...identity(entry.bytes), mediaType: entry.mediaType }));
    const hostIdentity = digest(jsonBytes(hostInventory));
    for (const [path, entry] of host) await put(`host/${hostIdentity}/${path}`, entry.bytes, entry.mediaType);
    await put(manifestPath, manifestBytes, 'application/json');
    const lock = { schemaVersion: 1, distributionId: validated.distributionId, baseURL: base,
      manifest: files.get(manifestPath), adapterIds: [...recipe.adapterIds].sort(), allowedAssetURLs,
      provenance: provenance.sort((a, b) => a.package < b.package ? -1 : a.package > b.package ? 1 : 0),
      host: { sha256: hostIdentity, files: hostInventory },
      files: [...files.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
    const lockBytes = jsonBytes(lock), lockSha256 = digest(lockBytes);
    // Publish the trust-root handoff only after the entire closure is prepared.
    await writeFile(join(output, 'application-lock.json'), lockBytes, { flag: 'wx' });
    const verification = await verifyContainerDistribution({ directory: output, expectedSha256: lockSha256 });
    return { ...verification, directory: output, lockSha256 };
  } catch (error) {
    if (created) await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyContainerDistribution({ directory, expectedSha256 }) {
  directory = resolve(directory);
  assert(digestPattern.test(expectedSha256), 'Independently supplied lock SHA-256 required');
  const { value: lock, bytes: lockBytes } = await readJSON(join(directory, 'application-lock.json'), 16 * 1024 * 1024);
  assert.equal(digest(lockBytes), expectedSha256, 'Application lock integrity');
  shape(lock, ['schemaVersion', 'distributionId', 'baseURL', 'manifest', 'adapterIds', 'allowedAssetURLs', 'provenance', 'host', 'files'], 'lock');
  assert.equal(lock.schemaVersion, 1); const base = baseURL(lock.baseURL);
  const files = new Map(); let totalBytes = 0;
  for (const entry of list(lock.files, 'files')) {
    shape(entry, ['path', 'sha256', 'bytes', 'mediaType'], 'file'); metadata(entry, 'file'); mediaPath(entry.mediaType);
    assert(relative(entry.path) && !files.has(entry.path), 'Unique canonical output path required');
    totalBytes += entry.bytes; assert(totalBytes <= MAX_TOTAL, 'Distribution byte budget exceeded');
    files.set(entry.path, entry);
    // Reject a symlink at any intermediate directory, not just the final component.
    let parent = directory;
    for (const part of entry.path.split('/').slice(0, -1)) {
      parent = join(parent, part); const info = await lstat(parent);
      assert(info.isDirectory() && !info.isSymbolicLink(), 'Regular distribution directories required');
    }
    await pinned(join(directory, entry.path), entry);
  }
  const names = []; let directories = 0;
  const visit = async (path, prefix = '', depth = 0) => {
    assert(depth <= 64 && ++directories <= MAX_FILES && names.length <= MAX_FILES + 1, 'Inventory budget exceeded');
    for (const entry of await readdir(path, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), 'Distribution symlinks rejected');
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(path, entry.name), name + '/', depth + 1);
      else { assert(entry.isFile()); names.push(name); }
    }
  };
  await visit(directory);
  assert.deepEqual(names.sort(), [...files.keys(), 'application-lock.json'].sort(), 'Complete output inventory');
  assert.deepEqual(files.get(lock.manifest?.path), lock.manifest, 'Manifest must be in the closure');
  assert.equal(lock.manifest.path, `manifests/${lock.manifest.sha256}.json`, 'Content-addressed manifest path');
  const manifestBytes = await pinned(join(directory, lock.manifest.path), lock.manifest, 2 * 1024 * 1024);
  const distribution = await validateDistribution({ bytes: manifestBytes, expectedSha256: lock.manifest.sha256,
    adapterIds: lock.adapterIds, allowedAssetURLs: lock.allowedAssetURLs });
  assert.equal(lock.distributionId, distribution.distributionId);
  const assetURLs = new Set();
  for (const pkg of distribution.packages) for (const asset of pkg.assets) {
    const path = objectPath(asset.delivery, asset.delivery.mediaType);
    assert.equal(asset.url, new URL(path, base).href, 'Content-addressed asset URL'); assetURLs.add(asset.url);
    assert.deepEqual(files.get(path), { path, ...asset.delivery }, 'Asset closure matches manifest');
    checkLogical(await pinned(join(directory, path), asset.delivery), asset);
  }
  assert.deepEqual([...assetURLs].sort(), lock.allowedAssetURLs, 'Exact URL closure');
  validateProvenance(lock.provenance, distribution, files);
  shape(lock.host, ['sha256', 'files'], 'host'); list(lock.host.files, 'host files', 1024);
  assert.equal(digest(jsonBytes(lock.host.files)), lock.host.sha256, 'Host tree identity');
  const hostNames = new Set();
  for (const entry of lock.host.files) {
    assert(relative(entry.path) && !hostNames.has(entry.path), 'Unique host path required'); hostNames.add(entry.path);
    assert.deepEqual(files.get(`host/${lock.host.sha256}/${entry.path}`), { ...entry, path: `host/${lock.host.sha256}/${entry.path}` });
  }
  return { schemaVersion: 1, verified: true, distributionId: distribution.distributionId,
    manifestSha256: lock.manifest.sha256, files: files.size, bytes: totalBytes,
    sourceClosureReviewed: lock.provenance.every(item => item.sourceStatus === 'reviewed-complete'),
    qualification: 'local-byte-closure-only', deployed: false };
}
