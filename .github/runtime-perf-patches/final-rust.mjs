import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from '/tmp/test-tools/node_modules/typescript/lib/typescript.js';
import {format} from '/tmp/test-tools/node_modules/prettier/index.mjs';
const root=process.cwd();
const {inspectRustExecutableGraph,parseRustExecutableGraphLock,createRustExecutableGraphLockSource,syncWasmRustDist}=await import(pathToFileURL(path.join(root,'scripts/sync-wasm-rust.mjs')));
const hash=b=>createHash('sha256').update(b).digest('hex');
const lockPath='scripts/wasm-rust-assets.lock.json';
const lockBytes=await readFile(lockPath); const raw=JSON.parse(lockBytes); const locked=parseRustExecutableGraphLock(lockBytes);
const published=path.join(root,'static/wasm-rust'); const explicit='/tmp/rust-explicit-view';
const baseline=await inspectRustExecutableGraph(published,'published-static');
if(baseline.fingerprint!==locked.authorities['published-static'].fingerprint)throw Error('Baseline published graph differs from lock');
await cp(published,explicit,{recursive:true});
for(const entry of raw.authorities['published-static'].modules){
 const storage=await readFile(path.join(published,entry.delivery.storagePath));
 if(storage.length!==entry.storage.bytes||hash(storage)!==entry.storage.sha256)throw Error('Baseline receipt failed: '+entry.path);
 const target=raw.authorities['explicit-dist'].modules.find(x=>x.path===entry.path);
 if(!target||target.delivery.encoding!==entry.delivery.encoding||target.storage.sha256!==entry.storage.sha256)throw Error('Unexpected explicit/published storage conversion: '+entry.path);
 const out=path.join(explicit,target.delivery.storagePath);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,storage);
}
const baselineExplicit=await inspectRustExecutableGraph(explicit,'explicit-dist');
if(baselineExplicit.fingerprint!==locked.authorities['explicit-dist'].fingerprint)throw Error('Baseline explicit graph differs from lock');
const emit=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
// The existing compiler was built with the same emit settings; verify before replacing it.
const original=execFileSync('git',['show','b45847d10f059463aa313dd61a7c12f4abec19bd:runtimes/wasm-rust/src/compiler-worker.ts'],{encoding:'utf8'});
if(hash(emit(original))!==baseline.modules['compiler-worker.js'].logical.sha256)throw Error('Compiler emit settings differ from published baseline');
for(const stem of ['compiler-worker','rustc-module']){
 const output=emit(await readFile('runtimes/wasm-rust/src/'+stem+'.ts','utf8'));
 await writeFile(path.join(published,stem+'.js.bin'),output);
 await writeFile(path.join(explicit,stem+'.js'),output);
}
const nextPublished=await inspectRustExecutableGraph(published,'published-static');
const nextExplicit=await inspectRustExecutableGraph(explicit,'explicit-dist');
for(const [prior,next] of [[baseline,nextPublished],[baselineExplicit,nextExplicit]]){
 for(const [name,module] of Object.entries(prior.modules)){
  if(name==='compiler-worker.js')continue;
  if(JSON.stringify(module)!==JSON.stringify(next.modules[name]))throw Error('Unrelated graph module changed: '+name);
 }
 if(Object.keys(next.modules).length!==Object.keys(prior.modules).length+1)throw Error('Unexpected graph closure size');
}
const lockSource=createRustExecutableGraphLockSource({publishedStaticProfile:nextPublished,explicitDistProfile:nextExplicit});
await writeFile(lockPath,await format(lockSource,{parser:'json',useTabs:true,tabWidth:4,printWidth:100,trailingComma:'none'}));
const result=await syncWasmRustDist();
console.log('Published verified Rust graph:',result.executableGraphProfile.fingerprint,'modules:',Object.keys(result.executableGraphProfile.modules).length);
const packagePath='runtimes/wasm-rust/package.json';let text=await readFile(packagePath,'utf8');
if(!text.includes('test/rustc-module.test.ts'))text=text.replace('test/rustc-runtime.test.ts','test/rustc-runtime.test.ts test/rustc-module.test.ts');
await writeFile(packagePath,text);
