let d,u,_;async function g(p){const{loadPyodide:n}=await import("./chunks/pyodide-0f0cbac0.js");_=await n({indexURL:p+"/pyodide"})}self.onmessage=async p=>{const{code:n,buffer:l,load:f,interrupt:c,path:y}=p.data;if(f)await g(y),await _.loadPackagesFromImports(n),postMessage({load:!0});else if(n){const s=Date.now();d=new Int32Array(l),u=new Uint8Array(c),_.setInterruptBuffer(u),self["__pyodide__input_"+s]=o=>{for(o&&postMessage({output:o});;)if(postMessage({buffer:!0}),Atomics.wait(d,0,0,100)==="not-equal")try{const i=new Int32Array(d.byteLength);i.set(d),d.fill(0);const t=new TextDecoder().decode(i).replace(/\x00/g,""),e=parseInt(t.slice(-1));return t.slice(0,-e)}catch(i){postMessage({log:{e:i}})}},self["__pyodide__output_"+s]=(...o)=>{let a=" ",i=`\r
`,r="",t=[];for(const e of o)e.end!==void 0?i=e.end.toString():e.sep!==void 0?a=e.sep.toString():t.push(e);for(let e=0;e<t.length;e++)(typeof t[e]=="string"||!t[e].end&&!t[e].sep)&&(r+=t[e].toString(),e<t.length-1&&(r+=a));r+=i,postMessage({output:r})};try{let o=await _.runPythonAsync(`import asyncio
from js import __pyodide__input_${s}, __pyodide__output_${s}

input = __pyodide__input_${s}
print = __pyodide__output_${s}

__builtins__.input = __pyodide__input_${s}
__builtins__.print = __pyodide__output_${s}

${n}`);self.postMessage({results:!0})}catch(o){self.postMessage({error:o.message})}}};
