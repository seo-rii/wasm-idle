const e=`WasmIdleStdin`,t=`// wasm-idle Scanner compatibility shim`,n=`${t}
final class Scanner implements AutoCloseable {
    private final java.io.InputStream input;
    private int bufferedChar = Integer.MIN_VALUE;
    private String bufferedToken = null;
    private boolean closed = false;

    Scanner(java.io.InputStream input) {
        this.input = input;
    }

    Scanner(String source) {
        this(
            new java.io.ByteArrayInputStream(
                source != null ? source.getBytes() : new byte[0]
            )
        );
    }

    private void ensureOpen() {
        if (closed) {
            throw new IllegalStateException("Scanner closed");
        }
    }

    private int readByteInternal() {
        try {
            return input.read();
        } catch (java.io.IOException error) {
            throw new RuntimeException(error);
        }
    }

    private int readByte() {
        ensureOpen();
        if (bufferedChar != Integer.MIN_VALUE) {
            int value = bufferedChar;
            bufferedChar = Integer.MIN_VALUE;
            return value;
        }
        return readByteInternal();
    }

    private int peekByte() {
        ensureOpen();
        if (bufferedChar == Integer.MIN_VALUE) {
            bufferedChar = readByteInternal();
        }
        return bufferedChar;
    }

    private boolean isWhitespace(int value) {
        return value == ' ' || value == '\\n' || value == '\\r' || value == '\\t' || value == '\\f';
    }

    private boolean skipWhitespace() {
        int value = peekByte();
        while (value != -1 && isWhitespace(value)) {
            readByte();
            value = peekByte();
        }
        return value != -1;
    }

    private String readTokenValue() {
        java.lang.StringBuilder token = new java.lang.StringBuilder();
        int value = peekByte();
        while (value != -1 && !isWhitespace(value)) {
            token.append((char) readByte());
            value = peekByte();
        }
        return token.toString();
    }

    public boolean hasNext() {
        ensureOpen();
        if (bufferedToken != null) {
            return true;
        }
        if (!skipWhitespace()) {
            return false;
        }
        bufferedToken = readTokenValue();
        return true;
    }

    public String next() {
        ensureOpen();
        if (bufferedToken != null) {
            String token = bufferedToken;
            bufferedToken = null;
            return token;
        }
        if (!skipWhitespace()) {
            throw new RuntimeException("No more tokens");
        }
        return readTokenValue();
    }

    public String nextLine() {
        ensureOpen();
        java.lang.StringBuilder line = new java.lang.StringBuilder();
        if (bufferedToken != null) {
            line.append(bufferedToken);
            bufferedToken = null;
        }
        int value = peekByte();
        if (line.length() == 0 && value == -1) {
            return "";
        }
        if (line.length() == 0 && value == '\\r') {
            readByte();
            if (peekByte() == '\\n') {
                readByte();
            }
            return "";
        }
        if (line.length() == 0 && value == '\\n') {
            readByte();
            return "";
        }
        while (true) {
            value = readByte();
            if (value == -1 || value == '\\n' || value == '\\r') {
                break;
            }
            line.append((char) value);
        }
        if (value == '\\r' && peekByte() == '\\n') {
            readByte();
        }
        return line.toString();
    }

    public int nextInt() {
        return Integer.parseInt(next());
    }

    public long nextLong() {
        return Long.parseLong(next());
    }

    public float nextFloat() {
        return Float.parseFloat(next());
    }

    public double nextDouble() {
        return Double.parseDouble(next());
    }

    public boolean hasNextInt() {
        if (!hasNext()) {
            return false;
        }
        try {
            Integer.parseInt(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean hasNextLong() {
        if (!hasNext()) {
            return false;
        }
        try {
            Long.parseLong(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean hasNextFloat() {
        if (!hasNext()) {
            return false;
        }
        try {
            Float.parseFloat(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public boolean hasNextDouble() {
        if (!hasNext()) {
            return false;
        }
        try {
            Double.parseDouble(bufferedToken);
            return true;
        } catch (RuntimeException error) {
            return false;
        }
    }

    public void close() {
        if (closed) {
            return;
        }
        closed = true;
        try {
            input.close();
        } catch (java.io.IOException error) {
            throw new RuntimeException(error);
        }
    }
}`,r=(r,i,a)=>{let o=r.includes(`System.in`),s=/\bScanner\b/.test(r)&&!r.includes(t)&&!/\b(?:class|interface|enum|record)\s+Scanner\b/.test(r)&&!/^[ \t]*import[ \t]+(?!java\.util\.Scanner\b)(?!static\b)[\w.]+\.Scanner[ \t]*;[ \t]*$/m.test(r);if(!o)return s?{usesStdin:!1,stdinCacheKey:``,transformedCode:`${r.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`).trimEnd()}\n\n${n}\n`,helperSourcePath:null,helperSource:null}:{usesStdin:!1,stdinCacheKey:``,transformedCode:r,helperSourcePath:null,helperSource:null};let c=r.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)?.[1]||``,l=c?`${c.replaceAll(`.`,`/`)}/${e}.java`:`${e}.java`,u=r.replaceAll(`System.in`,`${e}.open()`);s&&(u=u.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`),u=`${u.trimEnd()}\n\n${n}\n`);let d=[...new TextEncoder().encode(i)].map(e=>e>127?e-256:e).join(`, `);return{usesStdin:!0,stdinCacheKey:JSON.stringify([a,i]),transformedCode:u,helperSourcePath:l,helperSource:`${c?`package ${c};\n\n`:``}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;

final class ${e} extends InputStream {
    private static final byte[] INITIAL_DATA = new byte[] { ${d} };
    private static final boolean HAS_EXPLICIT_INPUT = ${a?`true`:`false`};
    private static final ${e} INSTANCE = new ${e}();
    private int position = 0;

    private ${e}() {
    }

    static InputStream open() {
        return INSTANCE;
    }

    private int readFromHost() {
        Window current = Window.current();
        if (current == null) {
            return -1;
        }
        JSMapLike<JSObject> globals = current.cast();
        JSObject stdin = globals.get("wasmIdleJavaStdin");
        if (stdin == null) {
            return -1;
        }
        JSFunction readByte = stdin.<JSMapLike<JSObject>>cast().get("readByte").cast();
        Object value = readByte.call(stdin);
        return value != null ? Integer.parseInt(value.toString()) : -1;
    }

    @Override
    public int read(byte[] b, int off, int len) {
        if (b == null) {
            throw new NullPointerException();
        }
        if (off < 0 || len < 0 || len > b.length - off) {
            throw new IndexOutOfBoundsException();
        }
        if (len == 0) {
            return 0;
        }
        if (position < INITIAL_DATA.length) {
            int count = Math.min(len, INITIAL_DATA.length - position);
            System.arraycopy(INITIAL_DATA, position, b, off, count);
            position += count;
            return count;
        }
        if (HAS_EXPLICIT_INPUT) {
            return -1;
        }
        int next = readFromHost();
        if (next == -1) {
            return -1;
        }
        b[off] = (byte) next;
        return 1;
    }

    @Override
    public int read() {
        if (position < INITIAL_DATA.length) {
            return INITIAL_DATA[position++] & 0xff;
        }
        return HAS_EXPLICIT_INPUT ? -1 : readFromHost();
    }
}
`}};function i(e){let t=e.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m),n=(e.match(/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m)||e.match(/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m))?.[1];if(!n)throw Error(`Java source must define a top-level class, record, enum, or interface`);let r=t?.[1]||``;return{sourcePath:r?`${r.replaceAll(`.`,`/`)}/${n}.java`:`${n}.java`,mainClass:r?`${r}.${n}`:n}}const a=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,o=e=>a(e?.buffer),s=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const c=new TextDecoder,l=e=>e instanceof Int32Array?e:new Int32Array(e),u=e=>new Uint8Array(e.buffer,e.byteOffset+s,e.byteLength-s),d=e=>{let t=l(e),n=Atomics.load(t,1);if(n===-1)return null;let r=u(t);return c.decode(r.slice(0,n))},f=(e,t)=>{if(!e||!o(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return d(e)},p=new TextDecoder,m=globalThis.fetch.bind(globalThis),h=globalThis.XMLHttpRequest;let g=null,_=!1,v=0;const y=new Map,b=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},x=()=>{if(!g)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(g.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${g.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${g.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${g.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},S=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},C=e=>{let t=x();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},w=e=>{let t=x();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`},T=e=>w(e)!==null,E=async e=>{let t=++v;return await new Promise((n,r)=>{y.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},D=async(e,t)=>{let n=C(e);if(!n||w(n)!==t||!g)throw Error(`Untracked runtime asset request`);let r=g.maxAssetBytes??134217728,i=await m(n,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`});if(i.url){let e;try{e=new URL(i.url)}catch{let e=Error(`Runtime asset response URL is invalid: ${i.url}`);throw b(i,e),e}if(e.href!==n){let t=Error(`Runtime asset response URL mismatch: expected ${n}, received ${e.href}`);throw b(i,t),t}}if(!i.ok){let e=Error(`Failed to load ${t}: ${i.status}`);throw b(i,e),e}let a=i.headers.get(`content-length`),o;if(a!==null){let e=Number(a);if(!/^\d+$/u.test(a.trim())||!Number.isSafeInteger(e)){let e=Error(`Runtime asset ${t} has an invalid Content-Length`);throw b(i,e),e}o=e||void 0}if(o!==void 0&&o>r){let e=Error(`Runtime asset ${t} exceeds the ${r} byte limit`);throw b(i,e),e}let s=i.headers.get(`content-type`)||void 0;if(!i.body){let e=new Uint8Array(await i.arrayBuffer());if(e.byteLength>r)throw Error(`Runtime asset ${t} exceeds the ${r} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:o??e.byteLength}}),{bytes:e,mimeType:s}}let c=i.body.getReader(),l=!1,u=e=>{if(!l){l=!0;try{Promise.resolve(c.cancel(e)).catch(()=>void 0)}catch{}}},d=0,f,p;try{for(f=new Uint8Array(o||Math.min(65536,r));;){let{done:e,value:n}=await c.read();if(e)break;if(!n)continue;let i=d+n.byteLength;if(i>r){let e=Error(`Runtime asset ${t} exceeds the ${r} byte limit`);throw u(e),e}if(i>f.byteLength){let e=Math.min(r,Math.max(i,f.byteLength*2)),t=new Uint8Array(e);t.set(f.subarray(0,d)),f=t}f.set(n,d),d=i,self.postMessage({assetProgress:{asset:t,loaded:d,total:o}})}}catch(e){throw u(e),e}finally{try{c.releaseLock()}catch(e){p={error:e}}}if(p)throw p.error;return d!==f.byteLength&&(f=f.slice(0,d)),self.postMessage({assetProgress:{asset:t,loaded:d,total:o??d}}),{bytes:f,mimeType:s}};async function O(e){let t=w(e);if(!t||!g)throw Error(`Untracked runtime asset request`);return g.useAssetBridge?await E(t):await D(e,t)}function k(e){return new Response(S(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function A(){if(h===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=C(t);if(!n||!T(n)){let r=n||(t instanceof URL?t.href:String(t));this.native=new h,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await O(this.url),t=S(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=p.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function j(){_||(_=!0,globalThis.fetch=(async(e,t)=>{let n=C(e);return!n||!T(n)?m(e,t):k(await O(n))}),A())}function M(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);g=e,j()}function N(e){let t=e?.assetResponse;if(!t)return!1;let n=y.get(t.id);return n?(y.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}async function P(e){if(!g)throw Error(`Runtime asset config unavailable`);let t=C(e);if(!t||!T(t))throw Error(`Untracked runtime asset request`);return await O(t)}let F=null,I=null,L=null,R=``,z=``,B=``,V=null,H=new Uint8Array,U=0,W=``,G=``,K=``,q=null,J=``,Y=[],X=new Set;const ee=new TextDecoder,Z=e=>new Int8Array(e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)),Q=()=>{z&&=(self.postMessage({output:z}),``)},$=()=>{B&&=(self.postMessage({output:B}),``)},te=e=>{z+=String.fromCharCode(e),e===10&&Q()},ne=e=>{B+=String.fromCharCode(e),e===10&&$()};self.addEventListener(`message`,async e=>{if(N(e.data))return;let{load:t,assets:n,buffer:a,code:o,prepare:s,args:c=[],stdin:l=``,hasExplicitStdin:u=!1,activePath:d,workspaceFiles:p=[]}=e.data;try{if(t){let e=n;M(e||null);let t=e?.baseUrl||``;if(!I||R!==t){R=t;let e=ee.decode((await P(`compiler.wasm-runtime.js`)).bytes),n=URL.createObjectURL(new Blob([e],{type:`text/javascript;charset=utf-8`})),r=await import(n);URL.revokeObjectURL(n);let i=r.load;L=i;let a=(await P(`compiler.wasm`)).bytes;F=(await i(a,{stackDeobfuscator:{enabled:!1}})).exports,I=F.createCompiler();let[o,s]=await Promise.all([P(`compile-classlib-teavm.bin`).then(({bytes:e})=>Z(e)),P(`runtime-classlib-teavm.bin`).then(({bytes:e})=>Z(e))]);I.setSdk(o),I.setTeaVMClasslib(s),W=``,G=``,K=``,q=null,J=``,Y=[],X=new Set}self.postMessage({load:!0});return}if(!I||!L)throw Error(`TeaVM compiler not loaded`);z=``,B=``;let e=u===!0,m=r(o,l,e),h=i(o),g=typeof d==`string`&&d?d:h.sourcePath,_=g.split(`/`).pop()||g;if(!Array.isArray(p)||!p.every(e=>e&&typeof e.path==`string`&&typeof e.content==`string`))throw Error(`Invalid Java workspace files`);let v=p,y=J!==g||Y.length!==v.length||Y.some((e,t)=>e.path!==v[t]?.path||e.content!==v[t]?.content);if(m.usesStdin&&m.helperSourcePath&&(g===m.helperSourcePath||v.some(e=>e.path===m.helperSourcePath)))throw Error(`Java workspace conflicts with generated stdin helper: ${m.helperSourcePath}`);if(s||W!==o||G!==m.stdinCacheKey||y||!q){let e=h.mainClass;X=new Set([g,...v.map(e=>e.path)].flatMap(e=>[e,e.split(`/`).pop()||e]));let t=[],n=I.onDiagnostic(e=>{let n=e.severity?String(e.severity).toLowerCase():`error`,r=e.fileName?`${e.fileName}:${e.lineNumber||0}${e.columnNumber?`:${e.columnNumber}`:``}`:`TeaVM`;t.push(`${r}: ${n}: ${e.message}`);let i=e.fileName?String(e.fileName):null;i&&!X.has(i)||self.postMessage({diagnostic:{fileName:i,lineNumber:Number(e.lineNumber)||1,columnNumber:Number(e.columnNumber)||1,severity:n===`warning`?`warning`:n===`other`?`other`:`error`,message:String(e.message||``)}})}),r=()=>{if(typeof n==`function`){n();return}n?.destroy?.()};I.clearSourceFiles?.(),I.clearInputClassFiles?.(),I.clearOutputFiles?.(),I.addSourceFile(_,m.transformedCode);for(let e of v)I.addSourceFile(e.path.split(`/`).pop()||e.path,e.content);if(m.usesStdin&&m.helperSourcePath&&m.helperSource&&(I.addSourceFile(m.helperSourcePath.split(`/`).pop()||m.helperSourcePath,m.helperSource),X.add(m.helperSourcePath),X.add(m.helperSourcePath.split(`/`).pop()||m.helperSourcePath)),!I.compile())throw r(),Error(t.join(`
`)||`TeaVM javac compilation failed`);let i=Array.from(I.detectMainClasses());if(i.length!==1)throw r(),Error(i.length===0?`Main method not found`:`Multiple main methods found`);let a=I.generateWebAssembly({outputName:`app`,mainClass:e});if(r(),!a)throw Error(t.join(`
`)||`TeaVM WebAssembly generation failed`);W=o,G=m.stdinCacheKey,K=e,q=new Uint8Array(I.getWebAssemblyOutputFile(`app.wasm`)),J=g,Y=v.map(e=>({...e}))}if(s){self.postMessage({results:!0});return}V=new Int32Array(a),H=e?new Uint8Array:new TextEncoder().encode(l),U=0;let b=globalThis,x=b.window;b.window=b,b.wasmIdleJavaStdin={readByte(){for(;;){if(U<H.length)return H[U++]??-1;if(e)return-1;let t=f(V,()=>self.postMessage({buffer:!0}));if(t===null)return-1;H=new TextEncoder().encode(t),U=0}}};try{(await L(q,{installImports(e){e.teavmConsole.putcharStdout=te,e.teavmConsole.putcharStderr=ne},stackDeobfuscator:{enabled:!1}})).exports.main(c),Q(),$(),self.postMessage({results:!0,mainClass:K})}finally{delete b.wasmIdleJavaStdin,x===void 0?Reflect.deleteProperty(b,`window`):b.window=x,H=new Uint8Array,U=0,V=null}}catch(e){Q(),$(),self.postMessage({error:e instanceof Error?e.message:String(e)})}});