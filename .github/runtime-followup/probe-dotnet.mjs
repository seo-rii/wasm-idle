import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const root=path.resolve(process.argv[2]||new URL('../dist/',import.meta.url).pathname);
const server=createServer(async(req,res)=>{try{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 const file=path.resolve(root,'.'+pathname);if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>.NET reference probe</title>');return;}
 res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true});
const codes={csharp:'using System; class Program { static void Main(string[] args) { Console.WriteLine("registered:" + Console.ReadLine() + ":" + args[0]); }}',fsharp:'open System\n[<EntryPoint>]\nlet main args =\n    printfn "registered:%s:%s" (Console.ReadLine()) args.[0]\n    0',vbnet:'Imports System\nModule Program\n Sub Main(args As String())\n Console.WriteLine("registered:" & Console.ReadLine() & ":" & args(0))\n End Sub\nEnd Module'};
try{
 for(const[language,code]of Object.entries(codes)){
  const context=await browser.newContext();const page=await context.newPage();
  page.on('pageerror',error=>console.error(language,error));page.on('console',message=>{if(message.type()==='error')console.error(language,message.text());});
  await page.goto('http://127.0.0.1:'+server.address().port+'/');console.log('Start actual browser:',language);
  const timer=setTimeout(()=>context.close(),180000);
  try{
   const result=await page.evaluate(async({language,code})=>{
    const api=await import('/index.js');let registrations=0,compiles=0;const ids=[];const stringify=JSON.stringify;
    JSON.stringify=function(value,...rest){
     if(value&&Array.isArray(value.references)&&!value.code&&!value.language)registrations++;
     if(value&&value.referenceSetId&&value.language){compiles++;ids.push(value.referenceSetId);if('references'in value)throw Error('Reference bytes repeated in compile');}
     return stringify.call(this,value,...rest);
    };
    try{
     const compiler=await api.createDotnetCompiler({language});await compiler.prepare({language});const outputs=[];
     for(let i=0;i<2;i++){
      const result=await compiler.compile({language,code});if(!result.success)throw Error(stringify(result));
      const output=await api.executeBrowserDotnetArtifact(result.artifact,{stdin:'input'+i+'\n',args:['arg'+i]});
      if(output.exitCode!==0||output.stdout!==`registered:input${i}:arg${i}\n`||output.stderr)throw Error(stringify(output));outputs.push(output);
     }
     if(registrations!==1||compiles!==2||ids[0]!==ids[1])throw Error('Unexpected reference traffic '+stringify({registrations,compiles,ids}));
     return{language,registrations,compiles,ids,outputs,crossOriginIsolated};
    }finally{JSON.stringify=stringify;}
   },{language,code});
   assert.equal(result.crossOriginIsolated,true);console.log(JSON.stringify(result));
  }finally{clearTimeout(timer);await context.close();}
 }
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
