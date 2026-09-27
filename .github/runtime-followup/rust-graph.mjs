import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import ts from '/tmp/tools/node_modules/typescript/lib/typescript.js';
const root=process.cwd();
const {inspectRustExecutableGraph,parseRustExecutableGraphLock,createRustExecutableGraphLockSource,syncWasmRustDist}=await import(pathToFileURL(path.join(root,'scripts/sync-wasm-rust.mjs')));
const hash=b=>createHash('sha256').update(b).digest('hex');
const lockPath='scripts/wasm-rust-assets.lock.json';
const lockBytes=await readFile(lockPath);const raw=JSON.parse(lockBytes);const locked=parseRustExecutableGraphLock(lockBytes);
const published=path.join(root,'static/wasm-rust');const explicit='/tmp/rust-explicit-view';
const baseline=await inspectRustExecutableGraph(published,'published-static');
if(baseline.fingerprint!==locked.authorities['published-static'].fingerprint)throw Error('Baseline published graph differs from lock');
await cp(published,explicit,{recursive:true});
for(const entry of raw.authorities['published-static'].modules){
 const storage=await readFile(path.join(published,entry.delivery.storagePath));
 if(storage.length!==entry.storage.bytes||hash(storage)!==entry.storage.sha256)throw Error('Baseline receipt failed: '+entry.path);
 const target=raw.authorities['explicit-dist'].modules.find(x=>x.path===entry.path);
 if(!target)throw Error('Missing explicit module');
 const converted=target.delivery.encoding===entry.delivery.encoding?storage:target.delivery.encoding==='identity'&&entry.delivery.encoding==='gzip'?gunzipSync(storage):null;
 if(!converted||converted.length!==target.storage.bytes||hash(converted)!==target.storage.sha256)throw Error('Explicit receipt mismatch');
 const out=path.join(explicit,target.delivery.storagePath);await mkdir(path.dirname(out),{recursive:true});await writeFile(out,converted);
 if(entry.delivery.storagePath!==target.delivery.storagePath)await rm(path.join(explicit,entry.delivery.storagePath));
}
const baselineExplicit=await inspectRustExecutableGraph(explicit,'explicit-dist');
if(baselineExplicit.fingerprint!==locked.authorities['explicit-dist'].fingerprint)throw Error('Explicit graph differs from lock');
const emit=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const changed=['compiler','compiler-worker','rustc-module-service'];
for(const stem of changed){
 if(stem!=='rustc-module-service'){
  const original=execFileSync('git',['show','15d609cf3642a9cd7bd8ff42465468f01a40e629:runtimes/wasm-rust/src/'+stem+'.ts'],{encoding:'utf8'});
  if(hash(emit(original))!==baseline.modules[stem+'.js'].logical.sha256)throw Error('Emit settings differ: '+stem);
 }
 const output=emit(await readFile('runtimes/wasm-rust/src/'+stem+'.ts','utf8'));
 await writeFile(path.join(published,stem+'.js.bin'),output);await writeFile(path.join(explicit,stem+'.js'),output);
}
const nextPublished=await inspectRustExecutableGraph(published,'published-static');const nextExplicit=await inspectRustExecutableGraph(explicit,'explicit-dist');
for(const [prior,next]of [[baseline,nextPublished],[baselineExplicit,nextExplicit]]){
 for(const[name,module]of Object.entries(prior.modules)){
  if(changed.includes(name.replace(/\.js$/,'')))continue;
  if(JSON.stringify(module)!==JSON.stringify(next.modules[name]))throw Error('Unrelated module changed: '+name);
 }
 if(Object.keys(next.modules).length!==Object.keys(prior.modules).length+1)throw Error('Unexpected graph size');
}
await writeFile(lockPath,createRustExecutableGraphLockSource({publishedStaticProfile:nextPublished,explicitDistProfile:nextExplicit}));
const result=await syncWasmRustDist();console.log('Sealed graph:',result.executableGraphProfile.fingerprint,Object.keys(result.executableGraphProfile.modules).length,'modules');
