const y="WasmIdleStdin",Y="// wasm-idle Scanner compatibility shim",H=`${Y}
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
}`,oe=(e,t)=>{const r=e.includes("System.in"),n=/\bScanner\b/.test(e)&&!e.includes(Y)&&!/\b(?:class|interface|enum|record)\s+Scanner\b/.test(e)&&!/^[ \t]*import[ \t]+(?!java\.util\.Scanner\b)(?!static\b)[\w.]+\.Scanner[ \t]*;[ \t]*$/m.test(e);if(!r)return n?{usesStdin:!1,stdinCacheKey:"",transformedCode:`${e.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,c=>c.replace(/[^\r\n]/g," ")).replaceAll(/\bjava\.util\.Scanner\b/g,"Scanner").trimEnd()}

${H}
`,helperSourcePath:null,helperSource:null}:{usesStdin:!1,stdinCacheKey:"",transformedCode:e,helperSourcePath:null,helperSource:null};const l=e.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)?.[1]||"",s=l?`${l.replaceAll(".","/")}/${y}.java`:`${y}.java`;let f=e.replaceAll("System.in",`${y}.open()`);n&&(f=f.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,u=>u.replace(/[^\r\n]/g," ")).replaceAll(/\bjava\.util\.Scanner\b/g,"Scanner"),f=`${f.trimEnd()}

${H}
`);const o=[...new TextEncoder().encode(t)].join(", ");return{usesStdin:!0,stdinCacheKey:t,transformedCode:f,helperSourcePath:s,helperSource:`${l?`package ${l};

`:""}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;

final class ${y} extends InputStream {
    private static final byte[] INITIAL_DATA = new byte[] { ${o} };
    private static final ${y} INSTANCE = new ${y}();
    private int position = 0;

    private ${y}() {
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
        int next = readFromHost();
        if (next == -1) {
            return -1;
        }
        b[off] = (byte) next;
        return 1;
    }

    @Override
    public int read() {
        return position < INITIAL_DATA.length ? INITIAL_DATA[position++] & 0xff : readFromHost();
    }
}
`}},V=0,ie=1,q=Int32Array.BYTES_PER_ELEMENT*2,le=-1;new TextEncoder;const ue=new TextDecoder,ce=e=>e instanceof Int32Array?e:new Int32Array(e),de=e=>new Uint8Array(e.buffer,e.byteOffset+q,e.byteLength-q),pe=e=>{const t=ce(e),r=Atomics.load(t,ie);if(r===le)return null;const n=de(t);return ue.decode(n.slice(0,r))},fe=(e,t)=>{const r=Atomics.load(e,V);for(t();;)if(Atomics.wait(e,V,r,100)==="not-equal")return pe(e)},he=new TextDecoder,Q=globalThis.fetch.bind(globalThis),K=globalThis.XMLHttpRequest;let h=null,X=!1,me=0;const F=new Map,ee=e=>{const t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},te=e=>h?typeof e=="string"?new URL(e,h.baseUrl).href:e instanceof URL?e.href:e.url:null,re=e=>!h||!e.startsWith(h.baseUrl)?null:e.slice(h.baseUrl.length),ne=e=>re(e)!==null,be=async e=>{const t=++me;return await new Promise((r,n)=>{F.set(t,{resolve:r,reject:n}),self.postMessage({assetRequest:{id:t,asset:e}})})},ge=async(e,t)=>{const r=await Q(e);if(!r.ok)throw new Error(`Failed to load ${t}: ${r.status}`);const n=Number(r.headers.get("content-length")||0)||void 0,a=r.headers.get("content-type")||void 0;if(!r.body){const c=new Uint8Array(await r.arrayBuffer());return self.postMessage({assetProgress:{asset:t,loaded:c.byteLength,total:n??c.byteLength}}),{bytes:c,mimeType:a}}const l=r.body.getReader();let s=0;const f=[];for(;;){const{done:c,value:p}=await l.read();if(c)break;if(!p)continue;const m=Uint8Array.from(p);f.push(m),s+=m.byteLength,self.postMessage({assetProgress:{asset:t,loaded:s,total:n}})}const o=new Uint8Array(s);let u=0;for(const c of f)o.set(c,u),u+=c.byteLength;return self.postMessage({assetProgress:{asset:t,loaded:s,total:n??s}}),{bytes:o,mimeType:a}};async function J(e){const t=re(e);if(!t||!h)throw new Error("Untracked runtime asset request");return h.useAssetBridge?await be(t):await ge(e,t)}function ye(e){return new Response(ee(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function ve(){if(typeof K>"u")return;class e{responseType="";response=null;responseText="";readyState=0;status=0;statusText="";timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url="";open(r,n){const a=te(n);if(!a||!ne(a)){const l=a||(n instanceof URL?n.href:String(n));this.native=new K,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=s=>{this.response=this.native?.response,this.responseText=this.native?.responseText||"",this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||"",this.onreadystatechange?.call(this,s),this.onload?.call(this,s)},this.native.onerror=s=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||"",this.onreadystatechange?.call(this,s),this.onerror?.call(this,s)},this.native.onprogress=s=>{this.onprogress?.call(this,s)},this.native.onreadystatechange=s=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,s)},this.native.open(r,l);return}this.url=a,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent("readystatechange"))}setRequestHeader(r,n){this.native?.setRequestHeader(r,n)}async send(r){if(this.native){this.native.send(r);return}try{const n=await J(this.url),a=ee(n.bytes);if(this.status=200,this.statusText="OK",this.readyState=4,this.responseType==="arraybuffer")this.response=a;else if(this.responseType==="blob")this.response=new Blob([a],{type:n.mimeType||"application/octet-stream"});else{const s=he.decode(n.bytes);this.responseText=s,this.response=s}const l=new ProgressEvent("progress",{lengthComputable:!0,loaded:n.bytes.byteLength,total:n.bytes.byteLength});this.onprogress?.call(this,l),this.onreadystatechange?.call(this,new ProgressEvent("readystatechange")),this.onload?.call(this,new ProgressEvent("load"))}catch(n){this.readyState=4,this.status=0,this.statusText=n instanceof Error?n.message:String(n),this.onreadystatechange?.call(this,new ProgressEvent("readystatechange")),this.onerror?.call(this,new ProgressEvent("error"))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||""}getResponseHeader(r){return this.native?.getResponseHeader(r)||null}}globalThis.XMLHttpRequest=e}function we(){X||(X=!0,globalThis.fetch=(async(e,t)=>{const r=te(e);return!r||!ne(r)?Q(e,t):ye(await J(r))}),ve())}function Se(e){h=e,we()}function Ae(e){const t=e?.assetResponse;if(!t)return!1;const r=F.get(t.id);return r?(F.delete(t.id),t.ok?(r.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(r.reject(new Error(t.error||"Runtime asset request failed")),!0)):!0}async function N(e){if(!h)throw new Error("Runtime asset config unavailable");return await J(new URL(e,h.baseUrl).href)}let z=null,i=null,B=null,Z="",T="",k="",j=null,L=new Uint8Array(0),C=0,O="",U="",$="",M=null,_="";const Te=new TextDecoder,G=e=>new Int8Array(e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)),P=()=>{T&&(self.postMessage({output:T}),T="")},D=()=>{k&&(self.postMessage({output:k}),k="")},ke=e=>{T+=String.fromCharCode(e),e===10&&P()},Ie=e=>{k+=String.fromCharCode(e),e===10&&D()};self.addEventListener("message",async e=>{if(Ae(e.data))return;const{load:t,assets:r,buffer:n,code:a,prepare:l,args:s=[],stdin:f=""}=e.data;try{if(t){const p=r;Se(p||null);const m=p?.baseUrl||"";if(!i||Z!==m){Z=m;const b=Te.decode((await N("compiler.wasm-runtime.js")).bytes),g=URL.createObjectURL(new Blob([b],{type:"text/javascript;charset=utf-8"})),I=await import(g);URL.revokeObjectURL(g);const w=I.load;B=w;const S=(await N("compiler.wasm")).bytes;z=(await w(S,{stackDeobfuscator:{enabled:!1}})).exports,i=z.createCompiler();const[A,W]=await Promise.all([N("compile-classlib-teavm.bin").then(({bytes:v})=>G(v)),N("runtime-classlib-teavm.bin").then(({bytes:v})=>G(v))]);i.setSdk(A),i.setTeaVMClasslib(W),O="",U="",$="",M=null}self.postMessage({load:!0});return}if(!i||!B)throw new Error("TeaVM compiler not loaded");T="",k="";const o=oe(a,f);if(l||O!==a||U!==o.stdinCacheKey||!M){const p=a.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m),b=(a.match(/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m)||a.match(/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m))?.[1];if(!b)throw new Error("Java source must define a top-level class, record, enum, or interface");const g=p?.[1]||"",I=g?`${g.replaceAll(".","/")}/${b}.java`:`${b}.java`,w=g?`${g}.${b}`:b;_=I;const S=[],E=i.onDiagnostic(d=>{const R=d.severity?String(d.severity).toLowerCase():"error",ae=d.fileName?`${d.fileName}:${d.lineNumber||0}${d.columnNumber?`:${d.columnNumber}`:""}`:"TeaVM";S.push(`${ae}: ${R}: ${d.message}`);const x=d.fileName?String(d.fileName):null;x&&x!==_&&x!==_.split("/").pop()||self.postMessage({diagnostic:{fileName:x,lineNumber:Number(d.lineNumber)||1,columnNumber:Number(d.columnNumber)||1,severity:R==="warning"?"warning":R==="other"?"other":"error",message:String(d.message||"")}})}),A=()=>{if(typeof E=="function"){E();return}E?.destroy?.()};if(i.clearSourceFiles?.(),i.clearInputClassFiles?.(),i.clearOutputFiles?.(),i.addSourceFile(I,o.transformedCode),o.usesStdin&&o.helperSourcePath&&o.helperSource&&i.addSourceFile(o.helperSourcePath,o.helperSource),!i.compile())throw A(),new Error(S.join(`
`)||"TeaVM javac compilation failed");const v=Array.from(i.detectMainClasses());if(v.length!==1)throw A(),new Error(v.length===0?"Main method not found":"Multiple main methods found");const se=i.generateWebAssembly({outputName:"app",mainClass:w});if(A(),!se)throw new Error(S.join(`
`)||"TeaVM WebAssembly generation failed");O=a,U=o.stdinCacheKey,$=w,M=new Uint8Array(i.getWebAssemblyOutputFile("app.wasm"))}if(l){self.postMessage({results:!0});return}j=new Int32Array(n);const u=globalThis,c=u.window;u.window=u,u.wasmIdleJavaStdin={readByte(){for(;;){if(C<L.length)return L[C++]??-1;const p=fe(j,()=>self.postMessage({buffer:!0}));if(p===null)return-1;L=new TextEncoder().encode(p),C=0}}};try{(await B(M,{installImports(m){m.teavmConsole.putcharStdout=ke,m.teavmConsole.putcharStderr=Ie},stackDeobfuscator:{enabled:!1}})).exports.main(s),P(),D(),self.postMessage({results:!0,mainClass:$})}finally{delete u.wasmIdleJavaStdin,c===void 0?Reflect.deleteProperty(u,"window"):u.window=c,L=new Uint8Array(0),C=0,j=null}}catch(o){P(),D(),self.postMessage({error:o instanceof Error?o.message:String(o)})}});
