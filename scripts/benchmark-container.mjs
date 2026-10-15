// Real browser acceptance measurements; never substitutes a synthetic compiler workload.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, loadavg, totalmem } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { runProbe } from './probe-container-shell-acceptance.mjs';
import { identity, readPinnedProbeInputs } from './probe-container-shell-acceptance-lib.mjs';

const args = process.argv.slice(2);
assert([4, 6].includes(args.length) && args[0] === '--config' && args[2] === '--output' &&
  (args.length === 4 || args[4] === '--samples'), 'Usage: benchmark-container.mjs --config PINNED_CONFIG --output NEW_DIRECTORY [--samples 3]');
const samples = args[5] === undefined ? 3 : Number(args[5]);
assert(Number.isSafeInteger(samples) && samples >= 1 && samples <= 10, 'Samples must be 1..10');
assert(isAbsolute(args[1]) && isAbsolute(args[3]), 'Absolute configuration/output paths required');
const configuration = JSON.parse(await readFile(args[1])), output = resolve(args[3]);
await mkdir(output, { mode: 0o700 });
const assetDeliveryIdentities = await (async () => {
  const inputs = await readPinnedProbeInputs(configuration);
  return {
    '/assets/sdk': identity(inputs.entries.get('wasmer_js_bg.wasm')),
    '/assets/bash': identity(inputs.bash),
    '/assets/busybox': identity(inputs.busybox),
    ...Object.fromEntries(Object.entries(inputs.clang.assets).map(([name, asset]) => [`/assets/${name}`, identity(asset.delivery)]))
  };
})();
const report = {
  schemaVersion: 1, complete: false, samples,
  scope: 'Actual isolated Chromium Bash/Clang/BusyBox acceptance; cold and retained application-cache scripts in a fresh owner each time',
  timingBoundary: 'Harness elapsed includes bootstrap, script and owned Worker cleanup; compiler dispatch includes preparation, compilation and linking',
  byteBoundary: 'SDK Wasm, Bash WEBc, BusyBox, Clang, LLD and sysroot response counts multiplied by pinned delivery bytes; excludes HTTP headers, host/SDK JavaScript modules, and protocol overhead',
  logicalByteBoundary: 'Verified in-memory asset-service caches, split between compiler/userland and shell runtime; excludes package trees, Worker copies, Wasm memory and compiled modules',
  assetDeliveryIdentities,
  limitations: ['Loopback origin without network shaping', 'No browser RSS/JS heap hard limit measurement',
    'No separate decompression, verification, WebAssembly compilation or instantiation timing', 'No mutable compiler instance reuse'],
  host: { cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), initialLoadAverage: loadavg() },
  runs: []
};
const save = () => writeFile(join(output, 'benchmark.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const duration = (events, begin, finish) => {
  const start = events.find(begin), end = start && events.find(item => finish(item) && item.atMs >= start.atMs);
  return start && end ? end.atMs - start.atMs : null;
};
try {
  await save();
  for (let i = 0; i < samples; i++) {
    const result = await runProbe({ ...configuration, output: join(output, `sample-${i + 1}`) });
    const bytes = await readFile(result.receipt), receipt = JSON.parse(bytes);
    assert(receipt.complete && receipt.shellAcceptancePassed, 'Only passing actual acceptance receipts can qualify a benchmark');
    const identities = { packageId: receipt.packageId, busybox: receipt.busybox, processSysroot: receipt.processSysroot,
      clang: receipt.clang, browser: receipt.browser, host: receipt.host, sourceHashes: receipt.bundleSources };
    if (report.identities) assert.deepEqual(identities, report.identities, 'All samples need identical artifact/browser profiles');
    else report.identities = identities;
    const selected = receipt.runs.filter(run => run.run === 'cold' || run.run === 'warm');
    assert.equal(selected.length, 2);
    for (const run of selected) {
      const events = run.result.timeline ?? run.result.events ?? [];
      const bodies = Object.fromEntries(Object.keys(run.downloads.end).map(path => [path, run.downloads.end[path] - (run.downloads.start[path] ?? 0)]));
      const assetBodies = Object.entries(bodies).filter(([path]) => Object.hasOwn(assetDeliveryIdentities, path));
      assert.equal(assetBodies.length, Object.keys(assetDeliveryIdentities).length, 'All measured asset paths need response counts');
      assert(Object.entries(bodies).every(([path, value]) => Number.isSafeInteger(value) && value >= 0 &&
        (Object.hasOwn(assetDeliveryIdentities, path) || value === 0)), 'Unknown positive asset counts cannot be omitted');
      if (run.run === 'warm') assert(assetBodies.every(([, value]) => value === 0), 'Warm asset bodies must be reused');
      const shellPath = path => path === '/assets/sdk' || path === '/assets/bash';
      const bodyBytes = entries => entries.reduce((sum, [path, count]) => sum + assetDeliveryIdentities[path].bytes * count, 0);
      const compilerLogicalBytes = run.result.assetsAfterShell?.cachedBytes;
      const shellLogicalBytes = run.result.shellAssetsAfter?.cachedBytes;
      assert([compilerLogicalBytes, shellLogicalBytes].every(value => Number.isSafeInteger(value) && value >= 0),
        'Both asset-service cache observations are required');
      report.runs.push({ sample: i + 1, cache: run.run, receiptSha256: hash(bytes), applicationCommit: receipt.applicationCommit,
        distributionSha256: receipt.distributionSha256, elapsedMs: run.elapsedMs,
        clangDispatchMs: duration(events, event => event.type === 'dispatch' && event.path?.endsWith('/clang'),
          event => event.type === 'dispatchEnd' && event.path?.endsWith('/clang')),
        servedAssetBodyBytes: bodyBytes(assetBodies),
        servedCompilerAndUserlandBodyBytes: bodyBytes(assetBodies.filter(([path]) => !shellPath(path))),
        servedShellRuntimeBodyBytes: bodyBytes(assetBodies.filter(([path]) => shellPath(path))),
        bodyResponses: bodies,
        retainedLogicalAssetBytes: compilerLogicalBytes + shellLogicalBytes,
        retainedCompilerAndUserlandLogicalBytes: compilerLogicalBytes,
        retainedShellRuntimeLogicalBytes: shellLogicalBytes,
        remainingWorkers: run.result.remainingWorkerTargets, processResult: run.result.result?.code });
    }
    await save();
  }
  const stats = values => {
    values = values.filter(value => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
    return values.length ? { samples: values.length, min: values[0], median: (values[Math.floor((values.length - 1) / 2)] + values[Math.floor(values.length / 2)]) / 2, max: values.at(-1) } : null;
  };
  report.summary = Object.fromEntries(['cold', 'warm'].map(cache => [cache, Object.fromEntries(
    ['elapsedMs', 'clangDispatchMs', 'servedAssetBodyBytes', 'servedCompilerAndUserlandBodyBytes',
      'servedShellRuntimeBodyBytes', 'retainedLogicalAssetBytes'].map(metric =>
      [metric, stats(report.runs.filter(run => run.cache === cache).map(run => run[metric]))]))]));
  report.complete = true;
} catch (error) { report.error = String(error); throw error; }
finally { report.host.finalLoadAverage = loadavg(); await save(); }
console.log(JSON.stringify({ output, complete: report.complete, summary: report.summary }, null, 2));
