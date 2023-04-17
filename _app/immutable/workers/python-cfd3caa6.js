self.document={querySelectorAll(){return[]}};let p,f,n,d="";async function l(_){if(n)return;const{loadPyodide:r}=await import("./chunks/pyodide-0f0cbac0.js");n=await r({indexURL:_+"/pyodide"})}self.onmessage=async _=>{const{code:r,buffer:c,load:g,interrupt:y,path:w,prepare:m}=_.data;if(g)d=w,postMessage({output:"Loading Pyodide..."}),await l(d),postMessage({output:` Done.
\r`}),postMessage({load:!0});else if(m){postMessage({output:"Loading packages..."});try{await l(d),await n.loadPackagesFromImports(r),postMessage({output:` Done.
\r`}),self.postMessage({results:!0})}catch(t){self.postMessage({error:t.message||"Unknown error"})}}else if(r){await l(d),await n.loadPackagesFromImports(r);const t=Date.now();p=new Int32Array(c),f=new Uint8Array(y),n.setInterruptBuffer(f),self["__pyodide__input_"+t]=i=>{for(i&&postMessage({output:i});;)if(postMessage({buffer:!0}),Atomics.wait(p,0,0,100)==="not-equal")try{const o=new Int32Array(p.byteLength);o.set(p),p.fill(0);const s=new TextDecoder().decode(o).replace(/\x00/g,""),e=parseInt(s.slice(-1));return s.slice(0,-e)}catch(o){postMessage({log:{e:o}})}},self["__pyodide__output_"+t]=(...i)=>{let u=" ",o=`\r
`,a="",s=[];for(const e of i)e.end!==void 0?o=e.end.toString():e.sep!==void 0?u=e.sep.toString():s.push(e);for(let e=0;e<s.length;e++)(typeof s[e]=="string"||!s[e].end&&!s[e].sep)&&(a+=s[e].toString(),e<s.length-1&&(a+=u));a+=o,postMessage({output:a})};try{await n.runPythonAsync(`import asyncio
from js import __pyodide__input_${t}, __pyodide__output_${t}

input = __pyodide__input_${t}
print = __pyodide__output_${t}

__builtins__.input = __pyodide__input_${t}
__builtins__.print = __pyodide__output_${t}

${r}`),self.postMessage({results:!0})}catch(i){self.postMessage({error:i.message||"Unknown error"})}}};
