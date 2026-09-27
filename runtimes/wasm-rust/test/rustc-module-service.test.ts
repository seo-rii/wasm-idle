import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { clearRustcModuleCache, compileRustcThroughPort, createRustcModuleService } from '../src/rustc-module-service.js';
// Initialize Node's HTTP parser before spying on native Wasm compilation.
void new Response();
const empty=new Uint8Array([0,97,115,109,1,0,0,0]);
const receipt=(bytes=empty)=>({bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
function service(bytes=empty){const s=createRustcModuleService(receipt(bytes))!;return {s,compile:()=>compileRustcThroughPort(bytes.slice(),s.port,1000)};}
afterEach(()=>{clearRustcModuleCache();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('cross-worker rustc module service',()=>{
 it('reuses a compiled module across separate private message channels',async()=>{
  const compile=vi.spyOn(WebAssembly,'compile');
  const a=service(),b=service();const ma=await a.compile(),mb=await b.compile();
  expect(ma).toBeInstanceOf(WebAssembly.Module);expect(mb).toBeInstanceOf(WebAssembly.Module);
  expect(compile).toHaveBeenCalledTimes(1);
  expect(await WebAssembly.instantiate(ma)).not.toBe(await WebAssembly.instantiate(mb));
 });
 it('deduplicates concurrent compilation without caching execution state',async()=>{
  const compile=vi.spyOn(WebAssembly,'compile');await Promise.all([service().compile(),service().compile()]);expect(compile).toHaveBeenCalledTimes(1);
 });
 it('uses an owned exact view when caller storage contains unrelated bytes',async()=>{
  const data=new Uint8Array([8,9,...empty,9]);const s=service();const view=data.subarray(2,10);
  expect(await compileRustcThroughPort(view,s.s.port,1000)).toBeInstanceOf(WebAssembly.Module);expect(data.length).toBe(11);
 });
 it('transfers a standalone download rather than copying it',async()=>{
  const bytes=empty.slice();const s=service();const result=compileRustcThroughPort(bytes,s.s.port,1000);expect(bytes.byteLength).toBe(0);await result;
 });
 it('checks logical checksum even when a module is already cached',async()=>{
  await service().compile();const s=service();const altered=empty.slice();altered[4]=2;
  await expect(compileRustcThroughPort(altered,s.s.port,1000)).rejects.toThrow('integrity');
 });
 it('rejects a wrong byte length before native compilation',async()=>{
  const compile=vi.spyOn(WebAssembly,'compile');const s=service();
  await expect(compileRustcThroughPort(new Uint8Array(9),s.s.port,1000)).rejects.toThrow('Invalid rustc module request');expect(compile).not.toHaveBeenCalled();
 });
 it('never accepts a caller-supplied Module or a claimed hash',async()=>{
  const s=service();const response=new Promise<any>(resolve=>s.s.port.onmessage=e=>resolve(e.data));
  s.s.port.postMessage({type:'compile',module:await WebAssembly.compile(empty),sha256:receipt().sha256});
  expect((await response).type).toBe('error');s.s.close();
 });
 it('evicts a failed compile and allows retry of the same receipt',async()=>{
  const compile=vi.spyOn(WebAssembly,'compile').mockRejectedValueOnce(new Error('compile failed'));
  await expect(service().compile()).rejects.toThrow('compile failed');await service().compile();expect(compile).toHaveBeenCalledTimes(2);
 });
 it('supports compressed-asset receipts using their decoded identity',async()=>{
  const r=receipt();const s=createRustcModuleService({bytes:3,sha256:'f'.repeat(64),uncompressedBytes:r.bytes,uncompressedSha256:r.sha256})!;
  expect(await compileRustcThroughPort(empty.slice(),s.port,1000)).toBeInstanceOf(WebAssembly.Module);
 });
 it('bounds cache retention to two compiler modules',async()=>{
  const compile=vi.spyOn(WebAssembly,'compile');const a=empty,b=new Uint8Array([...empty,0,2,1,65]),c=new Uint8Array([...empty,0,2,1,66]);
  for(const bytes of [a,b,c,b,a])await service(bytes).compile();expect(compile).toHaveBeenCalledTimes(4);
 });
 it('times out a missing peer and closes its endpoint',async()=>{
  const channel=new MessageChannel();await expect(compileRustcThroughPort(empty.slice(),channel.port1,5)).rejects.toThrow('timed out');channel.port2.close();
 });
 it('rejects invalid receipts and gracefully falls back without required APIs',()=>{
  expect(()=>createRustcModuleService({bytes:1e9,sha256:'0'.repeat(64)})).toThrow('receipt');
  expect(createRustcModuleService(undefined)).toBeUndefined();vi.stubGlobal('crypto',undefined);expect(createRustcModuleService(receipt())).toBeUndefined();
 });
 it('actually shares a Module with a new native worker per operation',async()=>{
  const compile=vi.spyOn(WebAssembly,'compile');
  for(let i=0;i<2;i++){
   const s=service();const worker=new Worker(`const {parentPort}=require('node:worker_threads'); parentPort.once('message',port=>{port.once('message',async m=>{if(m.type!=='module')throw Error(m.message);const instance=await WebAssembly.instantiate(m.module);parentPort.postMessage(instance instanceof WebAssembly.Instance);port.close();});const b=new Uint8Array([0,97,115,109,1,0,0,0]);port.postMessage({type:'compile',bytes:b.buffer},[b.buffer]);});`,{eval:true});
   const done=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
   worker.postMessage(s.s.port,[s.s.port]);expect(await done).toBe(true);await worker.terminate();s.s.close();
  }
  expect(compile).toHaveBeenCalledTimes(1);
 });
 it('keeps verified asset loading ahead of reuse and confines service to verified topologies',()=>{
  const child=readFileSync(new URL('../src/compiler-worker.ts',import.meta.url),'utf8');const host=readFileSync(new URL('../src/compiler.ts',import.meta.url),'utf8');
  expect(child.indexOf('const rustcBytes = await fetchRuntimeAssetBytes')).toBeLessThan(child.indexOf('? compileRustcThroughPort(rustcBytes'));
  expect(host).toContain('const moduleService = executableGraph ?');expect(host).toContain('finally { activeWorkerCleanup?.(); }');
 });
});
