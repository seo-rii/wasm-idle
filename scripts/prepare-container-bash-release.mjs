// Assemble the explicitly selected real Bash workbench; never publish or resolve mutable versions.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkbenchModules } from '../examples/container/serve.mjs';
import { selectClangProfile } from '../examples/container/clang-profile.mjs';
import { manifest } from './probe-container-shell-acceptance.mjs';
import { readPinnedProbeInputs, BASH_WASM_SHA256, MEMORY, COMMAND_TIMEOUT_MS, digest, identity } from './probe-container-shell-acceptance-lib.mjs';
import { jsonBytes, prepareContainerDistribution } from './container-distribution.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Provenance records carry independently reviewed receipt/source/notice identities. */
export async function prepareBashRelease({ configuration, provenance, baseURL, output }) {
  const clangProfile = selectClangProfile(configuration.clangFilesystem);
  assert(isAbsolute(output), 'Absolute fresh output required');
  const base = new URL(baseURL);
  assert(base.href === baseURL && ['http:', 'https:'].includes(base.protocol) && !base.username && !base.password &&
    !base.search && !base.hash && base.pathname.endsWith('/'), 'Canonical release base URL required');
  const inputs = await readPinnedProbeInputs(configuration);
  assert(Array.isArray(provenance), 'Explicit provenance records required');
  for (const record of provenance) for (const entry of [record.receipt, ...record.sources, ...record.notices])
    assert(isAbsolute(entry.path), 'Absolute pinned provenance paths required');
  const distribution = JSON.parse(manifest(base.origin, inputs, 'busybox', clangProfile.filesystem));
  // These are the exact immutable URLs the generic preparer will verify and publish.
  for (const pkg of distribution.packages) for (const asset of pkg.assets)
    asset.url = new URL(`objects/${asset.delivery.sha256}/${asset.delivery.mediaType.replace('/', '-')}`, base).href;
  const { distributionId: _probeIdentity, ...releaseIndex } = distribution;
  distribution.distributionId = `shell-release-${digest(jsonBytes(releaseIndex))}`;
  const bytes = jsonBytes(distribution), manifestSha256 = digest(bytes);
  const config = {
    manifest: bytes.toString('utf8'), manifestSha256,
    assetURLs: distribution.packages.flatMap(pkg => pkg.assets.map(asset => asset.url)),
    sdkUrl: './sdk/index.mjs', sdkWorkerUrl: './sdk/worker.mjs', liveWorkerUrl: './live-worker.mjs', clangWorkerUrl: './clang-worker.mjs',
    sdkAsset: { packageId: 'shell', assetId: 'sdk' }, shellAsset: { packageId: 'shell', assetId: 'bash' },
    bashWasmSha256: BASH_WASM_SHA256, memory: MEMORY,
    clangSha256: inputs.clang.assets.clang.metadata.logical.sha256, linkerSha256: inputs.clang.assets.lld.metadata.logical.sha256,
    cacheNamespace: 'container-workbench-bash', commandTimeoutMs: COMMAND_TIMEOUT_MS, clangFilesystem: clangProfile.filesystem
  };
  const bundled = await buildWorkbenchModules({
    ownerEntry: join(root, 'examples/container/bash-owner.mjs'),
    profile: { profileLabel: `Real GNU Bash · BusyBox · ${clangProfile.filesystem === 'live' ? 'live Clang' : 'Clang'} · persistent workspace`,
      terminalDescription: 'Actual /bin/bash --noprofile --norc reads these bytes as its script. External commands use the common container workspace. Raw streams; no PTY or job control.' },
    sdkImportURL: './sdk/index.mjs',
    entries: { 'clang-worker': join(root, clangProfile.workerPath) },
    define: { __CONTAINER_BASH_CONFIG__: JSON.stringify(config) }
  });
  const localAssets = new Map([
    ['sdk', join(inputs.packageRoot, 'wasmer_js_bg.wasm')], ['bash', configuration.bashWebc],
    ['busybox', configuration.busyboxWasm], ['clang', configuration.clangWasm],
    ['lld', configuration.lldWasm], ['sysroot', configuration.processSysroot]
  ]);
  const staging = await mkdtemp(join(dirname(output), '.container-release-'));
  try {
    const hostFiles = [];
    for (const [name, entry] of bundled.resources) {
      const destination = name === '/' ? 'index.html' : name.slice(1);
      assert(/^[a-zA-Z0-9._-]+$/u.test(destination), 'Single bundled host file required');
      const path = join(staging, destination);
      await writeFile(path, entry.bytes, { flag: 'wx', mode: 0o600 });
      hostFiles.push({ path, destination, ...identity(entry.bytes), mediaType: entry.type.split(';')[0] });
    }
    for (const name of ['index.mjs', 'worker.mjs']) hostFiles.push({
      path: join(inputs.packageRoot, name), destination: `sdk/${name}`,
      ...inputs.receipt.entries[name], mediaType: 'text/javascript'
    });
    const recipe = { schemaVersion: 1, baseURL, distribution,
      adapterIds: ['wasi-preview1-live', clangProfile.adapterId],
      inputs: distribution.packages.flatMap(pkg => pkg.assets.map(asset => {
        const path = localAssets.get(asset.id); assert(path && isAbsolute(path));
        return { package: pkg.id, asset: asset.id, path };
      })), provenance, hostFiles };
    const recipePath = join(staging, 'recipe.json');
    await writeFile(recipePath, jsonBytes(recipe), { flag: 'wx', mode: 0o600 });
    const result = await prepareContainerDistribution({ input: recipePath, output });
    assert.equal(result.manifestSha256, manifestSha256, 'Host and distribution must share one immutable manifest');
    const lockBytes = await readFile(join(output, 'application-lock.json'));
    assert.equal(digest(lockBytes), result.lockSha256, 'Returned application URL must use the verified lock bytes');
    const lock = JSON.parse(lockBytes);
    return { ...result, clangFilesystem: clangProfile.filesystem, applicationURL: new URL(`host/${lock.host.sha256}/index.html`, base).href,
      sourceHashes: bundled.sourceHashes, packageReceiptSha256: configuration.packageReceiptSha256,
      qualification: 'local-real-artifact-closure; browser and hosting response acceptance are separate gates' };
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  assert(args.length === 8 && args[0] === '--config' && args[2] === '--provenance' && args[4] === '--base-url' && args[6] === '--output',
    'Use --config PINNED_CONFIG --provenance PINNED_RECORDS --base-url IMMUTABLE_BASE_URL --output NEW_DIRECTORY');
  assert([args[1], args[3], args[7]].every(isAbsolute), 'Absolute input/output paths required');
  console.log(JSON.stringify(await prepareBashRelease({ configuration: JSON.parse(await readFile(args[1], 'utf8')),
    provenance: JSON.parse(await readFile(args[3], 'utf8')), baseURL: args[5], output: args[7] }), null, 2));
}
