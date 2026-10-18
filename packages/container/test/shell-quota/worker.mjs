import * as sdk from '@wasm-idle/pinned-wasix-sdk';
import { createContainer } from '@wasm-idle/container';
import { createWasixShellSession, installWasixWorkerGroup } from '@wasm-idle/container/adapters/wasix';
import { createLiveWasiAdapter } from '@wasm-idle/container/adapters/wasi-live';
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
const load = async name => new Uint8Array(await (await fetch(`/assets/${name}`)).arrayBuffer());
let container, group, session;
onmessage = async ({ data }) => {
  try {
    const loaded = await Promise.all(['sdk', 'bash', 'live'].map(load));
    const [sdkBytes, bashBytes, liveBytes] = loaded;
    const actualHashes = await Promise.all(loaded.map(hash));
    if (JSON.stringify(actualHashes) !== JSON.stringify(data.hashes)) throw new Error('Pinned fixture asset hashes differ');
    const records = [], directErrors = [], filesystemErrors = [];
    group = installWasixWorkerGroup({ maxWorkers: 32 });
    container = createContainer({ maxBytes: 128, commands: { probe: { bytes: liveBytes, adapter: 'wasi-preview1-live' } },
      adapters: [createLiveWasiAdapter({ workerFactory: () => new Worker('/bundle/live-worker.js', { type: 'module' }) })] });
    const chosenSdk = { ...sdk, Directory: { fromHostFileSystem(delegate) {
      return sdk.Directory.fromHostFileSystem(Object.fromEntries(Object.entries(delegate).map(([name, operation]) => [name, (...args) => {
        try { return operation(...args); }
        catch (error) { if (name === 'write' || name === 'append') filesystemErrors.push({ operation: name, code: error.code }); throw error; }
      }])));
    } }, Runtime: class extends sdk.Runtime {
      registerHostCommand(path, handler) {
        if (!path.endsWith('/raw')) return super.registerHostCommand(path, handler);
        return super.registerHostCommand(path, async invocation => {
          try { await invocation.stdout.write(new Uint8Array(65536)); return 0; }
          catch (error) { directErrors.push({ code: error.code, errno: error.errno, message: error.message }); return error.errno; }
        });
      }
    } };
    session = await createWasixShellSession({
      container, sdk: chosenSdk, workers: group, assets: { async load(_pkg, name) { return name === 'sdk' ? sdkBytes : bashBytes; } },
      sdkAsset: { packageId: 'shell', assetId: 'sdk' }, shellAsset: { packageId: 'shell', assetId: 'bash' },
      shellWasmSha256: data.bashWasmSha256,
      sdkUrl: new URL('/sdk/index.mjs', location.href).href, workerUrl: new URL('/sdk/worker.mjs', location.href).href,
      memory: { initial: 35, maximum: 16384 }, cwd: '/workspace', env: { PATH: '/usr/local/bin:/bin', HOME: '/workspace' },
      routes: { '/usr/local/bin/probe': { command: 'probe' }, '/usr/local/bin/raw': { command: 'probe' } },
      args: ['--noprofile', '--norc', '-c', '/usr/local/bin/probe flood > /workspace/out; printf "guest:%s\\n" "$?"; /usr/local/bin/raw > /workspace/out; printf "raw:%s\\n" "$?"'],
      onRecord: record => records.push(record)
    });
    const stdout = new Response(session.stdout).text(), stderr = new Response(session.stderr).text();
    await session.stdin.close();
    const [result, out, err] = await Promise.all([session.exited, stdout, stderr]);
    postMessage({ type: 'result', result, stdout: out, stderr: err, records, directErrors, filesystemErrors, expectedQuotaErrno: 51, hashes: actualHashes, workers: group.inspect(), isolation: crossOriginIsolated });
  } catch (error) {
    postMessage({ type: 'failure', message: error.message, cause: String(error.cause ?? ''), stack: error.stack });
  } finally { await session?.dispose(); await group?.dispose(); await container?.dispose(); close(); }
};
