import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRuntimeDir = resolve(root, 'dist/runtime');
const lazyCompilerAssemblies = [
	'FSharp.Compiler.Service.wasm',
	'FSharp.Core.wasm',
	'Microsoft.CodeAnalysis.wasm',
	'Microsoft.CodeAnalysis.CSharp.wasm',
	'Microsoft.CodeAnalysis.VisualBasic.wasm'
];

const workerPolyfillSource = `const workerGlobal = globalThis;

workerGlobal.dotnetSidecar = true;
workerGlobal.document ??= {
  addEventListener() {},
  baseURI: workerGlobal.location?.href || "",
  body: { appendChild() {} },
  createElement() {
    return { appendChild() {}, remove() {}, setAttribute() {}, style: {} };
  },
  dispatchEvent() {
    return true;
  },
  head: { appendChild() {} },
  location: workerGlobal.location,
  querySelectorAll() {
    return [];
  },
  removeEventListener() {},
};

await import("./dotnet.native.worker.mjs");
`;

function hashResource(source) {
	return `sha256-${createHash('sha256').update(source).digest('base64')}`;
}

function replaceOnce(source, from, to) {
	const next = source.replace(from, to);
	if (next === source && !source.includes(to)) {
		throw new Error(`Failed to patch dotnet.runtime.js. Pattern was not found: ${from}`);
	}
	return next;
}

export async function patchRuntime({ runtimeDir = defaultRuntimeDir } = {}) {
	const runtimePath = resolve(runtimeDir, 'dotnet.runtime.js');
	const workerPolyfillPath = resolve(runtimeDir, 'dotnet.native.worker.polyfill.mjs');
	const bootPath = resolve(runtimeDir, 'blazor.boot.json');

	let runtimeSource = await readFile(runtimePath, 'utf8');
	runtimeSource = replaceOnce(
		runtimeSource,
		`$n.dispatchEvent(Cn(Rn,jn));const t=new MessageChannel,n=t.port1,r=t.port2;n.addEventListener("message",Pn),n.start(),jn&&jn.portToBrowser&&jn.portToBrowser.close(),jn=new Bn(_n,n),yn`,
		`const t=new MessageChannel,n=t.port1,r=t.port2;n.addEventListener("message",Pn),n.start(),jn&&jn.portToBrowser&&jn.portToBrowser.close(),jn=new Bn(_n,n),($n||($n=new globalThis.EventTarget)).dispatchEvent(Cn(Rn,jn)),yn`
	);
	runtimeSource = replaceOnce(
		runtimeSource,
		`pe(),jn.addEventListenerFromBrowser((e=>{"allAssetsLoaded"==e.data.cmd&&ot.allAssetsInMemory.promise_control.resolve()})),await async function()`,
		`pe(),jn?jn.addEventListenerFromBrowser((e=>{"allAssetsLoaded"==e.data.cmd&&ot.allAssetsInMemory.promise_control.resolve()})):ot.allAssetsInMemory.promise_control.resolve(),await async function()`
	);
	runtimeSource = replaceOnce(
		runtimeSource,
		`case"monoStarted":ot.deputyWorker=e,e.thread&&ot.afterMonoStarted.promise_control.resolve();break;`,
		`case"monoStarted":ot.deputyWorker=e,ot.afterMonoStarted.promise_control.resolve();break;`
	);
	runtimeSource = replaceOnce(
		runtimeSource,
		`case"pthreadCreated":a=s.port,i=new vn(o,e,a),e.thread=i,e.info.isRunning=!0,kn(o,i),e.info=Object.assign(e.info,s.info,{});break;case"monoStarted":ot.deputyWorker=e,ot.afterMonoStarted.promise_control.resolve();break;`,
		`case"pthreadCreated":a=s.port,i=new vn(o,e,a),e.thread=i,e.info.isRunning=!0,kn(o,i),e.info=Object.assign(e.info,s.info,{}),ot.deputyWorker===e&&ot.afterMonoStarted.promise_control.resolve();break;case"monoStarted":ot.deputyWorker=e,ot.afterMonoStarted.promise_control.resolve();break;`
	);
	runtimeSource = replaceOnce(
		runtimeSource,
		`n&&(ot.deputyWorker.thread.postMessageToWorker({type:"deputyThread",cmd:"allAssetsLoaded"}),ot.proxyGCHandle=await ot.afterDeputyReady.promise),nu.registerRuntime(rt)`,
		`n&&(ot.deputyWorker.thread&&ot.deputyWorker.thread.postMessageToWorker({type:"deputyThread",cmd:"allAssetsLoaded"}),ot.proxyGCHandle=await ot.afterDeputyReady.promise),nu.registerRuntime(rt)`
	);
	await writeFile(runtimePath, runtimeSource, 'utf8');
	await writeFile(workerPolyfillPath, workerPolyfillSource, 'utf8');

	const boot = JSON.parse(await readFile(bootPath, 'utf8'));
	boot.resources.jsModuleWorker = {
		'dotnet.native.worker.polyfill.mjs': hashResource(workerPolyfillSource)
	};
	boot.resources.jsModuleRuntime = {
		'dotnet.runtime.js': hashResource(runtimeSource)
	};
	boot.resources.lazyAssembly ??= {};
	for (const name of lazyCompilerAssemblies) {
		const hash = boot.resources.assembly?.[name];
		if (!hash) continue;
		boot.resources.lazyAssembly[name] = hash;
		delete boot.resources.assembly[name];
	}
	boot.pthreadPoolInitialSize = Math.max(boot.pthreadPoolInitialSize || 0, 8);
	boot.pthreadPoolUnusedSize = Math.max(boot.pthreadPoolUnusedSize || 0, 8);
	await writeFile(bootPath, `${JSON.stringify(boot, null, 2)}\n`, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await patchRuntime({
		runtimeDir: process.argv[2] ? resolve(process.argv[2]) : defaultRuntimeDir
	});
}
