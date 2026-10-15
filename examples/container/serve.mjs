import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = dirname(fileURLToPath(import.meta.url)), root = resolve(directory, '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const EXAMPLE_CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

/** Shared trusted host bundler for the fixture and actual Bash application profiles. */
export async function buildWorkbenchModules(options) {
  const resources = new Map(), sourceHashes = {};
  if (options.sdkImportURL !== undefined && !/^(?:\/sdk\/sha256-[a-f0-9]{64}|\.\/sdk)\/index\.mjs$/u.test(options.sdkImportURL)) throw new Error('Only an explicit pinned SDK package or relative immutable SDK module can be imported');
  const aliases = Object.fromEntries([
    ['@wasm-idle/core', 'packages/core/src/index.ts'],
    ['@wasm-idle/llvm-core/tool-host', 'packages/llvm-core/runtime/clang/src/tool-host.ts'],
    ['@wasm-idle/container', 'packages/container/src/index.ts'],
    ['@wasm-idle/container/adapters/wasix', 'packages/container/src/adapters/wasix/index.ts'],
    ['@wasm-idle/container/adapters/clang', 'packages/container/src/adapters/clang/index.ts'],
    ['@wasm-idle/container/adapters/clang-live', 'packages/container/src/adapters/clang-live/index.ts'],
    ['@wasm-idle/container/adapters/wasi-live', 'packages/container/src/adapters/wasi-live/index.ts'],
    ['@wasm-idle/container/persistence', 'packages/container/src/fs/persistence/index.ts'],
    ['@wasm-idle/container/workspace', 'packages/container/src/workspace/index.ts'],
    ['@wasm-idle/container/terminal', 'packages/container/src/terminal/index.ts']
  ].map(([name, path]) => [name, resolve(root, path)]));
  const output = await build({ absWorkingDir: root, entryPoints: { main: resolve(directory, 'main.mjs'), owner: options.ownerEntry, 'live-worker': resolve(root, 'packages/container/src/adapters/wasi-live/worker.ts'), ...options.entries },
    outdir: resolve(directory, '.build'), outExtension: { '.js': '.mjs' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, metafile: true,
    alias: { ...aliases, ...options.alias }, define: { __CONTAINER_WORKBENCH_PROFILE__: JSON.stringify(options.profile), ...options.define }, logLevel: 'silent',
    plugins: [{ name: 'record-example-source-bytes', setup(builder) {
      if (options.sdkImportURL) builder.onResolve({ filter: /^@wasm-idle\/pinned-wasix-sdk$/ }, () => ({ path: options.sdkImportURL, external: true }));
      builder.onLoad({ filter: /\.[cm]?[jt]s$/ }, async ({ path }) => {
        const contents = await readFile(path), name = relative(root, path), digest = hash(contents);
        if (sourceHashes[name] && sourceHashes[name] !== digest) throw new Error(`Source changed between bundle entry points: ${name}`);
        sourceHashes[name] = digest;
        return { contents, loader: path.endsWith('.ts') ? 'ts' : 'js' };
      });
    } }]
  });
  const external = Object.values(output.metafile.outputs).flatMap(entry => entry.imports.filter(item => item.external));
  if (external.some(entry => entry.kind !== 'import-statement' || entry.path !== options.sdkImportURL)) throw new Error('Unexpected external host import in workbench graph');
  if (options.sdkImportURL && !external.some(entry => entry.path === options.sdkImportURL)) throw new Error('The pinned SDK must remain an external static module at its fixed package URL');
  for (const file of output.outputFiles) resources.set(`/${file.path.split('/').pop()}`, { type: 'text/javascript', bytes: file.contents });
  for (const [pathname, name, type] of [['/', 'index.html', 'text/html; charset=utf-8'], ['/style.css', 'style.css', 'text/css']]) {
    const bytes = await readFile(resolve(directory, name)); sourceHashes[relative(root, resolve(directory, name))] = hash(bytes); resources.set(pathname, { type, bytes });
  }
  return { resources, sourceHashes: Object.freeze(sourceHashes) };
}

/** Local-only server; changing ownerEntry selects trusted host code at build time, never through a remote manifest. */
export async function createExampleServer(options = {}) {
  const resources = new Map(), requests = [];
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    requests.push(pathname);
    if (requests.length > 10000) requests.shift();
    response.setHeader('Content-Security-Policy', EXAMPLE_CSP);
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('X-Content-Type-Options', 'nosniff'); response.setHeader('Cache-Control', 'no-store');
    const entry = resources.get(pathname);
    if (!entry) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', entry.type); response.end(entry.bytes);
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(options.port ?? 0, '127.0.0.1', yes); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const fixturePath = 'packages/container/test/fixtures/terminal.wasm';
    const bytes = await readFile(resolve(root, fixturePath)), digest = hash(bytes);
    const sourcePath = 'packages/container/test/fixtures/terminal.c';
    const revision = execFileSync('git', ['log', '-1', '--format=%H', '--', sourcePath], { cwd: root, encoding: 'utf8' }).trim();
    // A truthful inventory receipt for checked-in ABI fixtures. It does not claim a compiler rebuild or producer qualification.
    const receipt = Buffer.from(JSON.stringify({ schemaVersion: 1, kind: 'checked-in-wasi-ui-fixture', repository: 'https://github.com/seo-rii/wasm-idle', sourceRevision: revision,
      source: { path: sourcePath, sha256: hash(await readFile(resolve(root, sourcePath))) },
      artifact: { path: fixturePath, sha256: digest, bytes: bytes.length },
      buildInstructions: { path: 'packages/container/scripts/build-fixtures.mjs', sha256: hash(await readFile(resolve(root, 'packages/container/scripts/build-fixtures.mjs'))) },
      compilerBuildReproducedByThisExample: false
    }));
    const assetURL = `${origin}/assets/terminal.${digest}.wasm`;
    const identity = { sha256: digest, bytes: bytes.length, mediaType: 'application/wasm' };
    const manifest = Buffer.from(JSON.stringify({ schemaVersion: 1, distributionId: `workbench-${digest.slice(0, 32)}`,
      packages: [{ id: 'byte-guest', identity: `sha256:${digest}`, producer: { repository: 'https://github.com/seo-rii/wasm-idle', revision, receiptSha256: hash(receipt) }, dependencies: [], mount: `/opt/toolchains/byte-guest-${digest.slice(0, 16)}`, capabilities: ['wasi-preview1'],
        assets: [{ id: 'guest', url: assetURL, encoding: 'identity', delivery: identity, logical: identity }], files: [{ path: 'terminal.wasm', asset: 'guest', executable: true }] }],
      commands: [{ name: 'byte-guest', package: 'byte-guest', adapter: 'wasi-preview1-live', path: 'terminal.wasm', argv0: 'byte-guest', prefixArgs: [] }]
    }));
    const lock = { manifestURL: `${origin}/fixture-distribution.json`, manifestSha256: hash(manifest), assetURL, assetSha256: digest };
    const profile = options.profile ?? {
      profileLabel: 'WASI byte-guest fixture profile',
      terminalDescription: 'This small real Wasm program copies stdin to stdout and /workspace/input.bin until EOF. It is not a shell or compiler. A host can bind this view to the qualified Bash session separately.'
    };
    const bundled = await buildWorkbenchModules({ ownerEntry: options.ownerEntry ?? resolve(directory, 'worker.mjs'), profile, define: { __CONTAINER_FIXTURE_LOCK__: JSON.stringify(lock) } });
    for (const [pathname, entry] of bundled.resources) resources.set(pathname, entry);
    resources.set('/fixture-distribution.json', { type: 'application/json', bytes: manifest });
    resources.set('/fixture-receipt.json', { type: 'application/json', bytes: receipt });
    resources.set(new URL(assetURL).pathname, { type: 'application/wasm', bytes });
    return { origin, server, requests, lock, receipt: JSON.parse(receipt), sourceHashes: bundled.sourceHashes, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
  } catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const example = await createExampleServer({ port: Number(process.env.PORT ?? 4174) });
  console.log(`Container example: ${example.origin}`);
  const close = async () => { await example.close(); process.exit(0); };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
