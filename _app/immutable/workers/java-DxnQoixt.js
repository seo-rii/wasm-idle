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
}`,r=(r,i)=>{let a=r.includes(`System.in`),o=/\bScanner\b/.test(r)&&!r.includes(t)&&!/\b(?:class|interface|enum|record)\s+Scanner\b/.test(r)&&!/^[ \t]*import[ \t]+(?!java\.util\.Scanner\b)(?!static\b)[\w.]+\.Scanner[ \t]*;[ \t]*$/m.test(r);if(!a)return o?{usesStdin:!1,stdinCacheKey:``,transformedCode:`${r.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`).trimEnd()}\n\n${n}\n`,helperSourcePath:null,helperSource:null}:{usesStdin:!1,stdinCacheKey:``,transformedCode:r,helperSourcePath:null,helperSource:null};let s=r.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)?.[1]||``,c=s?`${s.replaceAll(`.`,`/`)}/${e}.java`:`${e}.java`,l=r.replaceAll(`System.in`,`${e}.open()`);o&&(l=l.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`),l=`${l.trimEnd()}\n\n${n}\n`);let u=[...new TextEncoder().encode(i)].join(`, `);return{usesStdin:!0,stdinCacheKey:i,transformedCode:l,helperSourcePath:c,helperSource:`${s?`package ${s};\n\n`:``}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;

final class ${e} extends InputStream {
    private static final byte[] INITIAL_DATA = new byte[] { ${u} };
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
`}},i=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,a=e=>i(e?.buffer),o=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const s=new TextDecoder,c=e=>e instanceof Int32Array?e:new Int32Array(e),l=e=>new Uint8Array(e.buffer,e.byteOffset+o,e.byteLength-o),u=e=>{let t=c(e),n=Atomics.load(t,1);if(n===-1)return null;let r=l(t);return s.decode(r.slice(0,n))},d=(e,t)=>{if(!e||!a(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return u(e)},f=new TextDecoder,p=globalThis.fetch.bind(globalThis),m=globalThis.XMLHttpRequest;let h=null,g=!1,_=0;const v=new Map,y=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},b=e=>h?typeof e==`string`?new URL(e,h.baseUrl).href:e instanceof URL?e.href:e.url:null,x=e=>!h||!e.startsWith(h.baseUrl)?null:e.slice(h.baseUrl.length),S=e=>x(e)!==null,C=async e=>{let t=++_;return await new Promise((n,r)=>{v.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},w=async(e,t)=>{let n=await p(e);if(!n.ok)throw Error(`Failed to load ${t}: ${n.status}`);let r=Number(n.headers.get(`content-length`)||0)||void 0,i=n.headers.get(`content-type`)||void 0;if(!n.body){let e=new Uint8Array(await n.arrayBuffer());return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:r??e.byteLength}}),{bytes:e,mimeType:i}}let a=n.body.getReader(),o=0,s=[];for(;;){let{done:e,value:n}=await a.read();if(e)break;if(!n)continue;let i=Uint8Array.from(n);s.push(i),o+=i.byteLength,self.postMessage({assetProgress:{asset:t,loaded:o,total:r}})}let c=new Uint8Array(o),l=0;for(let e of s)c.set(e,l),l+=e.byteLength;return self.postMessage({assetProgress:{asset:t,loaded:o,total:r??o}}),{bytes:c,mimeType:i}};async function T(e){let t=x(e);if(!t||!h)throw Error(`Untracked runtime asset request`);return h.useAssetBridge?await C(t):await w(e,t)}function E(e){return new Response(y(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function D(){if(m===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=b(t);if(!n||!S(n)){let r=n||(t instanceof URL?t.href:String(t));this.native=new m,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await T(this.url),t=y(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=f.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function O(){g||(g=!0,globalThis.fetch=(async(e,t)=>{let n=b(e);return!n||!S(n)?p(e,t):E(await T(n))}),D())}function k(e){h=e,O()}function A(e){let t=e?.assetResponse;if(!t)return!1;let n=v.get(t.id);return n?(v.delete(t.id),t.ok?(n.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(n.reject(Error(t.error||`Runtime asset request failed`)),!0)):!0}async function j(e){if(!h)throw Error(`Runtime asset config unavailable`);return await T(new URL(e,h.baseUrl).href)}let M=null,N=null,P=null,F=``,I=``,L=``,R=null,z=new Uint8Array,B=0,V=``,H=``,U=``,W=null,G=``;const K=new TextDecoder,q=e=>new Int8Array(e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)),J=()=>{I&&=(self.postMessage({output:I}),``)},Y=()=>{L&&=(self.postMessage({output:L}),``)},X=e=>{I+=String.fromCharCode(e),e===10&&J()},Z=e=>{L+=String.fromCharCode(e),e===10&&Y()};self.addEventListener(`message`,async e=>{if(A(e.data))return;let{load:t,assets:n,buffer:i,code:a,prepare:o,args:s=[],stdin:c=``}=e.data;try{if(t){let e=n;k(e||null);let t=e?.baseUrl||``;if(!N||F!==t){F=t;let e=K.decode((await j(`compiler.wasm-runtime.js`)).bytes),n=URL.createObjectURL(new Blob([e],{type:`text/javascript;charset=utf-8`})),r=await import(n);URL.revokeObjectURL(n);let i=r.load;P=i;let a=(await j(`compiler.wasm`)).bytes;M=(await i(a,{stackDeobfuscator:{enabled:!1}})).exports,N=M.createCompiler();let[o,s]=await Promise.all([j(`compile-classlib-teavm.bin`).then(({bytes:e})=>q(e)),j(`runtime-classlib-teavm.bin`).then(({bytes:e})=>q(e))]);N.setSdk(o),N.setTeaVMClasslib(s),V=``,H=``,U=``,W=null}self.postMessage({load:!0});return}if(!N||!P)throw Error(`TeaVM compiler not loaded`);I=``,L=``;let e=r(a,c);if(o||V!==a||H!==e.stdinCacheKey||!W){let t=a.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m),n=(a.match(/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m)||a.match(/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m))?.[1];if(!n)throw Error(`Java source must define a top-level class, record, enum, or interface`);let r=t?.[1]||``,i=r?`${r.replaceAll(`.`,`/`)}/${n}.java`:`${n}.java`,o=r?`${r}.${n}`:n;G=i;let s=[],c=N.onDiagnostic(e=>{let t=e.severity?String(e.severity).toLowerCase():`error`,n=e.fileName?`${e.fileName}:${e.lineNumber||0}${e.columnNumber?`:${e.columnNumber}`:``}`:`TeaVM`;s.push(`${n}: ${t}: ${e.message}`);let r=e.fileName?String(e.fileName):null;r&&r!==G&&r!==G.split(`/`).pop()||self.postMessage({diagnostic:{fileName:r,lineNumber:Number(e.lineNumber)||1,columnNumber:Number(e.columnNumber)||1,severity:t===`warning`?`warning`:t===`other`?`other`:`error`,message:String(e.message||``)}})}),l=()=>{if(typeof c==`function`){c();return}c?.destroy?.()};if(N.clearSourceFiles?.(),N.clearInputClassFiles?.(),N.clearOutputFiles?.(),N.addSourceFile(i,e.transformedCode),e.usesStdin&&e.helperSourcePath&&e.helperSource&&N.addSourceFile(e.helperSourcePath,e.helperSource),!N.compile())throw l(),Error(s.join(`
`)||`TeaVM javac compilation failed`);let u=Array.from(N.detectMainClasses());if(u.length!==1)throw l(),Error(u.length===0?`Main method not found`:`Multiple main methods found`);let d=N.generateWebAssembly({outputName:`app`,mainClass:o});if(l(),!d)throw Error(s.join(`
`)||`TeaVM WebAssembly generation failed`);V=a,H=e.stdinCacheKey,U=o,W=new Uint8Array(N.getWebAssemblyOutputFile(`app.wasm`))}if(o){self.postMessage({results:!0});return}R=new Int32Array(i),z=new TextEncoder().encode(c),B=0;let l=globalThis,u=l.window;l.window=l,l.wasmIdleJavaStdin={readByte(){for(;;){if(B<z.length)return z[B++]??-1;let e=d(R,()=>self.postMessage({buffer:!0}));if(e===null)return-1;z=new TextEncoder().encode(e),B=0}}};try{(await P(W,{installImports(e){e.teavmConsole.putcharStdout=X,e.teavmConsole.putcharStderr=Z},stackDeobfuscator:{enabled:!1}})).exports.main(s),J(),Y(),self.postMessage({results:!0,mainClass:U})}finally{delete l.wasmIdleJavaStdin,u===void 0?Reflect.deleteProperty(l,`window`):l.window=u,z=new Uint8Array,B=0,R=null}}catch(e){J(),Y(),self.postMessage({error:e instanceof Error?e.message:String(e)})}});