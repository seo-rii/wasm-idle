const e=Object.freeze({"compiler.wasm-runtime.js":Object.freeze({bytes:17358,sha256:`f93b235747aa178cff6f28101b507d4956ea740c36a5987f642c1e457e8d6b8e`}),"compiler.wasm":Object.freeze({bytes:4758621,sha256:`c4591010aa649660abe547728076ba395dbc97f47d67527fd2dc99f85b510dbf`}),"compiler.wasm-deobfuscator.wasm":Object.freeze({bytes:48583,sha256:`6462127c5e078700d08f06956545750b7db7f6055bb4a92bf4bf60925b413aa4`}),"compile-classlib-teavm.bin":Object.freeze({bytes:211725,sha256:`b7724b0d1e730f7cade5fa06e64a291bc8c530199ef1a2b1f2fb8f932ff0757b`}),"runtime-classlib-teavm.bin":Object.freeze({bytes:2415541,sha256:`d0d9ecb456ae91efbbe6888430010e9c0da93497a8c47c2c92dfb498f140c761`})}),t=globalThis.fetch?.bind(globalThis),n=e[`compiler.wasm`];async function r(e,t,n,r){if(!Number.isSafeInteger(n)||n<1||t.bytes>n||!Number.isSafeInteger(t.bytes)||t.bytes<1||!/^[a-f0-9]{64}$/.test(t.sha256))throw e.body?.cancel().catch(()=>{}),Error(`Java compiler exceeds its asset limit or has an invalid receipt`);if(!e.ok||!e.body||!globalThis.crypto?.subtle)throw e.body?.cancel().catch(()=>{}),Error(`Java compiler streaming requires a successful body and Web Crypto`);let i=e.body.getReader(),a=new Uint8Array(t.bytes),o=0,s=!1,c=()=>{s||(s=!0,i.releaseLock())},l=async e=>{if(!s)try{await i.cancel(e)}finally{c()}},u=new ReadableStream({async pull(e){try{let{done:n,value:s}=await i.read();if(n){if(o!==t.bytes)throw Error(`Java compiler length mismatch`);let n=await crypto.subtle.digest(`SHA-256`,a);if(Array.from(new Uint8Array(n),e=>e.toString(16).padStart(2,`0`)).join(``)!==t.sha256)throw Error(`Java compiler SHA-256 mismatch`);c(),e.close();return}if(o+s.byteLength>t.bytes)throw Error(`Java compiler exceeds its receipt byte limit`);a.set(s,o),o+=s.byteLength,e.enqueue(Uint8Array.from(s)),r?.(o,t.bytes)}catch(t){e.error(t),await l(t).catch(()=>{})}},cancel:l});try{return await WebAssembly.compileStreaming(new Response(u,{headers:{"Content-Type":`application/wasm`}}),{builtins:[`js-string`]})}catch(e){throw await l(e).catch(()=>{}),e}}async function i(e,i){if(typeof WebAssembly.compileStreaming!=`function`||!globalThis.crypto?.subtle||!t)return;let a=new URL(`compiler.wasm`,e);if(![`http:`,`https:`].includes(a.protocol)||a.username||a.password||a.hash)throw Error(`Invalid Java compiler URL`);let o=await t(a.href,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`});if(o.url&&new URL(o.url).href!==a.href)throw o.body?.cancel().catch(()=>{}),Error(`Java compiler response URL mismatch`);if(o.status===404){o.body?.cancel().catch(()=>{});return}return await r(o,n,i,(e,t)=>{globalThis.postMessage?.({assetProgress:{asset:`compiler.wasm`,loaded:e,total:t}})})}function a(e){let t=`async function C(e,t){if(typeof e!=="string"){return await WebAssembly.compile(e,{builtins:["js-string"]})}`;if(e.split(t).length!==2)throw Error(`Unsupported TeaVM loader for compiled-module input`);return e.replace(t,t.replace(`{if(`,`{if(e instanceof WebAssembly.Module)return e;if(`))}function o(e,t={}){let n=t.maxChars??16384,r=t.maxDelayMs??16,i=t.now??(()=>performance.now());if(!Number.isSafeInteger(n)||n<2||!Number.isFinite(r)||r<0)throw RangeError(`Invalid Java output batch limits`);let a=``,o=!1,s=i(),c,l=!1;function u(){if(c!==void 0&&clearTimeout(c),c=void 0,!a)return;let t=a;a=``,o=!0,s=i(),e(t)}return{write(e){l||(a.length>=n-1&&!(e>=56320&&e<=57343)&&u(),a+=String.fromCharCode(e),!(e>=55296&&e<=56319)&&(a.length>=n||!o||i()-s>=r?u():c===void 0&&(c=setTimeout(u,r))))},flush:u,flushIfDue(){a&&i()-s>=r&&u()},close(){u(),l=!0}}}const s=`WasmIdleStdin`,c=`// wasm-idle Scanner compatibility shim`,l=`${c}
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
}`,u=(e,t,n)=>{let r=e.includes(`System.in`),i=/\bScanner\b/.test(e)&&!e.includes(c)&&!/\b(?:class|interface|enum|record)\s+Scanner\b/.test(e)&&!/^[ \t]*import[ \t]+(?!java\.util\.Scanner\b)(?!static\b)[\w.]+\.Scanner[ \t]*;[ \t]*$/m.test(e);if(!r)return i?{usesStdin:!1,stdinCacheKey:``,transformedCode:`${e.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`).trimEnd()}\n\n${l}\n`,helperSourcePath:null,helperSource:null}:{usesStdin:!1,stdinCacheKey:``,transformedCode:e,helperSourcePath:null,helperSource:null};let a=e.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m)?.[1]||``,o=a?`${a.replaceAll(`.`,`/`)}/${s}.java`:`${s}.java`,u=e.replaceAll(`System.in`,`${s}.open()`);i&&(u=u.replace(/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,e=>e.replace(/[^\r\n]/g,` `)).replaceAll(/\bjava\.util\.Scanner\b/g,`Scanner`),u=`${u.trimEnd()}\n\n${l}\n`);let d=[...new TextEncoder().encode(t)].map(e=>e>127?e-256:e).join(`, `);return{usesStdin:!0,stdinCacheKey:JSON.stringify([n,t]),transformedCode:u,helperSourcePath:o,helperSource:`${a?`package ${a};\n\n`:``}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;

final class ${s} extends InputStream {
    private static final byte[] INITIAL_DATA = new byte[] { ${d} };
    private static final boolean HAS_EXPLICIT_INPUT = ${n?`true`:`false`};
    private static final ${s} INSTANCE = new ${s}();
    private int position = 0;

    private ${s}() {
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
`}};function d(e){let t=u(e,``,!1);if(!t.usesStdin||!t.helperSourcePath)return t;let n=t.helperSourcePath.split(`/`),r=n.pop().replace(/\.java$/,``),i=n.join(`.`);return{...t,stdinCacheKey:`host-chunks-v2-jso`,helperSource:`${i?`package ${i};\n\n`:``}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;
import org.teavm.jso.core.JSObjects;
import org.teavm.jso.typedarrays.Int8Array;

final class ${r} extends InputStream {
    private static final ${r} INSTANCE = new ${r}();
    private byte[] chunk = new byte[0];
    private int position = 0;
    private boolean ended = false;

    private ${r}() {}

    static InputStream open() {
        return INSTANCE;
    }

    // Use classlib overlay methods: the pinned source compiler cannot compile @JSBody.
    // A host call obtains a block; copying its bytes keeps Java array ownership explicit.
    private static byte[] readFromHost() {
        Window current = Window.current();
        if (current == null) return null;
        JSMapLike<JSObject> globals = current.cast();
        JSObject stdin = globals.get("wasmIdleJavaStdin");
        if (stdin == null) return null;
        JSMapLike<JSObject> input = stdin.cast();
        if (JSObjects.hasProperty(stdin, "readChunk")) {
            JSFunction readChunk = input.get("readChunk").cast();
            JSObject result = (JSObject) readChunk.call(stdin);
            if (result == null) return null;
            Int8Array array = result.cast();
            byte[] next = new byte[array.getLength()];
            for (int i = 0; i < next.length; i++) next[i] = array.get(i);
            return next;
        }
        JSFunction readByte = input.get("readByte").cast();
        Object value = readByte.call(stdin);
        int next = value != null ? Integer.parseInt(value.toString()) : -1;
        return next < 0 ? null : new byte[] { (byte) next };
    }

    private boolean ensureChunk() {
        while (position == chunk.length && !ended) {
            byte[] next = readFromHost();
            position = 0;
            if (next == null) {
                chunk = new byte[0];
                ended = true;
            } else {
                chunk = next;
            }
        }
        return position < chunk.length;
    }

    @Override
    public int read() {
        return ensureChunk() ? chunk[position++] & 0xff : -1;
    }

    @Override
    public int read(byte[] bytes, int offset, int length) {
        if (bytes == null) throw new NullPointerException();
        if (offset < 0 || length < 0 || length > bytes.length - offset) {
            throw new IndexOutOfBoundsException();
        }
        if (length == 0) return 0;
        if (!ensureChunk()) return -1;
        int count = Math.min(length, chunk.length - position);
        System.arraycopy(chunk, position, bytes, offset, count);
        position += count;
        return count;
    }

    @Override
    public int available() {
        return chunk.length - position;
    }
}
`}}function f(e,t,n,r=4096){if(!Number.isSafeInteger(r)||r<1)throw RangeError(`Java stdin chunk size must be a positive safe integer`);let i=new TextEncoder,a=i.encode(e),o=0,s=!1;function c(){for(;o===a.length&&!s;){let e=t?null:n();a=e===null?/* @__PURE__ */ new Uint8Array:i.encode(e),o=0,s=e===null}return o<a.length}function l(){o===a.length&&(a=/* @__PURE__ */ new Uint8Array,o=0)}return{readByte(){if(!c())return-1;let e=a[o++];return l(),e},readChunk(){if(!c())return null;let e=Math.min(r,a.length-o),t=new Int8Array(a.buffer,a.byteOffset+o,e);return o+=e,l(),t},dispose(){a=/* @__PURE__ */ new Uint8Array,o=0,s=!0}}}function p(e,t){let n=e.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m),r=(e.match(/^\s*public\s+(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m)||e.match(/^\s*(?:final\s+|abstract\s+)?(?:class|record|enum|interface)\s+([A-Za-z_]\w*)\b/m))?.[1];if(!r){let e=t||`Main.java`;return{sourcePath:e,mainClass:(e.split(`/`).pop()||e).replace(/\.java$/,``)}}let i=n?.[1]||``;return{sourcePath:i?`${i.replaceAll(`.`,`/`)}/${r}.java`:`${r}.java`,mainClass:i?`${i}.${r}`:r}}function m(e,t,n,r=`static-args`){let i=e.slice(0,Math.max(0,e.lastIndexOf(`.`))),a=i?`${i.replaceAll(`.`,`/`)}/`:``,o=e.slice(e.lastIndexOf(`.`)+1),s=i?`package ${i};\n\n`:``,c=`WasmIdleJavaEntryPoint`;for(;n.some(e=>e===`${a}${c}.class`||e.startsWith(`${a}${c}$`));)c+=`_`;let l=`WasmIdleJavaExceptionBridge`;for(;n.some(e=>e===`${a}${l}.class`||e.startsWith(`${a}${l}$`));)l+=`_`;let u=t.map(e=>e.replace(/\\u+([0-9a-f]{4})/gi,(e,t)=>String.fromCharCode(parseInt(t,16)))),d=`wasmIdleFormatJavaException`;for(;u.some(e=>e.includes(d));)d+=`_`;let f=o===`args`?`args_`:`args`,p={"static-args":`${o}::main`,"instance-args":`${f} -> new ${o}().main(${f})`,"static-noargs":`${f} -> ${o}.main()`,"instance-noargs":`${f} -> new ${o}().main()`}[r];return{mainClass:i?`${i}.${l}`:l,sourceFileName:`${c}.java`,formatterSourceFileName:`${l}.java`,formatExport:d,source:`${s}final class ${c} {
    static ${l}.Program program() {
        return ${p};
    }
}
`,formatterSource:`${s}import java.lang.String;
import java.lang.Throwable;
import java.io.StringWriter;
import java.io.PrintWriter;
import java.io.PrintStream;
import org.teavm.jso.JSExport;
import org.teavm.jso.JSObject;
import org.teavm.jso.JSExceptions;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;
import org.teavm.jso.core.JSObjects;

final class ${l} {
    interface Program {
        void run(String[] args) throws Throwable;
    }

    public static void main(String[] args) throws Throwable {
        PrintStream out = System.out;
        PrintStream err = System.err;
        System.setOut(new Output(out));
        System.setErr(new Output(err));
        try {
            ${c}.program().run(args);
        } finally {
            System.out.flush();
            System.err.flush();
        }
    }

    // A real PrintStream keeps Java formatting/encoding semantics. Only an
    // explicit flush crosses the host batch boundary; println is not auto-flushed.
    private static final class Output extends PrintStream {
        Output(PrintStream delegate) { super(delegate, false); }

        @Override
        public void flush() {
            super.flush();
            Window current = Window.current();
            if (current == null || !JSObjects.hasProperty(current, "wasmIdleJavaOutput")) return;
            JSMapLike<JSObject> globals = current.cast();
            JSObject output = globals.get("wasmIdleJavaOutput");
            if (output == null) return;
            JSMapLike<JSObject> bridge = output.cast();
            JSFunction flush = bridge.get("flush").cast();
            flush.call(output);
        }
    }

    @JSExport
    public static String ${d}(JSObject error) {
        Throwable exception = JSExceptions.getJavaException(error);
        if (exception == null) return null;
        StringWriter text = new StringWriter();
        exception.printStackTrace(new PrintWriter(text));
        return text.toString();
    }
}
`}}var h;(function(e){e[e.AALOAD=50]=`AALOAD`,e[e.AASTORE=83]=`AASTORE`,e[e.ACONST_NULL=1]=`ACONST_NULL`,e[e.ALOAD=25]=`ALOAD`,e[e.ALOAD_0=42]=`ALOAD_0`,e[e.ALOAD_1=43]=`ALOAD_1`,e[e.ALOAD_2=44]=`ALOAD_2`,e[e.ALOAD_3=45]=`ALOAD_3`,e[e.ANEWARRAY=189]=`ANEWARRAY`,e[e.ARETURN=176]=`ARETURN`,e[e.ARRAYLENGTH=190]=`ARRAYLENGTH`,e[e.ASTORE=58]=`ASTORE`,e[e.ASTORE_0=75]=`ASTORE_0`,e[e.ASTORE_1=76]=`ASTORE_1`,e[e.ASTORE_2=77]=`ASTORE_2`,e[e.ASTORE_3=78]=`ASTORE_3`,e[e.ATHROW=191]=`ATHROW`,e[e.BALOAD=51]=`BALOAD`,e[e.BASTORE=84]=`BASTORE`,e[e.BIPUSH=16]=`BIPUSH`,e[e.CALOAD=52]=`CALOAD`,e[e.CASTORE=85]=`CASTORE`,e[e.CHECKCAST=192]=`CHECKCAST`,e[e.D2F=144]=`D2F`,e[e.D2I=142]=`D2I`,e[e.D2L=143]=`D2L`,e[e.DADD=99]=`DADD`,e[e.DALOAD=49]=`DALOAD`,e[e.DASTORE=82]=`DASTORE`,e[e.DCMPG=152]=`DCMPG`,e[e.DCMPL=151]=`DCMPL`,e[e.DCONST_0=14]=`DCONST_0`,e[e.DCONST_1=15]=`DCONST_1`,e[e.DDIV=111]=`DDIV`,e[e.DLOAD=24]=`DLOAD`,e[e.DLOAD_0=38]=`DLOAD_0`,e[e.DLOAD_1=39]=`DLOAD_1`,e[e.DLOAD_2=40]=`DLOAD_2`,e[e.DLOAD_3=41]=`DLOAD_3`,e[e.DMUL=107]=`DMUL`,e[e.DNEG=119]=`DNEG`,e[e.DREM=115]=`DREM`,e[e.DRETURN=175]=`DRETURN`,e[e.DSTORE=57]=`DSTORE`,e[e.DSTORE_0=71]=`DSTORE_0`,e[e.DSTORE_1=72]=`DSTORE_1`,e[e.DSTORE_2=73]=`DSTORE_2`,e[e.DSTORE_3=74]=`DSTORE_3`,e[e.DSUB=103]=`DSUB`,e[e.DUP=89]=`DUP`,e[e.DUP_X1=90]=`DUP_X1`,e[e.DUP_X2=91]=`DUP_X2`,e[e.DUP2=92]=`DUP2`,e[e.DUP2_X1=93]=`DUP2_X1`,e[e.DUP2_X2=94]=`DUP2_X2`,e[e.F2D=141]=`F2D`,e[e.F2I=139]=`F2I`,e[e.F2L=140]=`F2L`,e[e.FADD=98]=`FADD`,e[e.FALOAD=48]=`FALOAD`,e[e.FASTORE=81]=`FASTORE`,e[e.FCMPG=150]=`FCMPG`,e[e.FCMPL=149]=`FCMPL`,e[e.FCONST_0=11]=`FCONST_0`,e[e.FCONST_1=12]=`FCONST_1`,e[e.FCONST_2=13]=`FCONST_2`,e[e.FDIV=110]=`FDIV`,e[e.FLOAD=23]=`FLOAD`,e[e.FLOAD_0=34]=`FLOAD_0`,e[e.FLOAD_1=35]=`FLOAD_1`,e[e.FLOAD_2=36]=`FLOAD_2`,e[e.FLOAD_3=37]=`FLOAD_3`,e[e.FMUL=106]=`FMUL`,e[e.FNEG=118]=`FNEG`,e[e.FREM=114]=`FREM`,e[e.FRETURN=174]=`FRETURN`,e[e.FSTORE=56]=`FSTORE`,e[e.FSTORE_0=67]=`FSTORE_0`,e[e.FSTORE_1=68]=`FSTORE_1`,e[e.FSTORE_2=69]=`FSTORE_2`,e[e.FSTORE_3=70]=`FSTORE_3`,e[e.FSUB=102]=`FSUB`,e[e.GETFIELD=180]=`GETFIELD`,e[e.GETSTATIC=178]=`GETSTATIC`,e[e.GOTO=167]=`GOTO`,e[e.GOTO_W=200]=`GOTO_W`,e[e.I2B=145]=`I2B`,e[e.I2C=146]=`I2C`,e[e.I2D=135]=`I2D`,e[e.I2F=134]=`I2F`,e[e.I2L=133]=`I2L`,e[e.I2S=147]=`I2S`,e[e.IADD=96]=`IADD`,e[e.IALOAD=46]=`IALOAD`,e[e.IAND=126]=`IAND`,e[e.IASTORE=79]=`IASTORE`,e[e.ICONST_M1=2]=`ICONST_M1`,e[e.ICONST_0=3]=`ICONST_0`,e[e.ICONST_1=4]=`ICONST_1`,e[e.ICONST_2=5]=`ICONST_2`,e[e.ICONST_3=6]=`ICONST_3`,e[e.ICONST_4=7]=`ICONST_4`,e[e.ICONST_5=8]=`ICONST_5`,e[e.IDIV=108]=`IDIV`,e[e.IF_ACMPEQ=165]=`IF_ACMPEQ`,e[e.IF_ACMPNE=166]=`IF_ACMPNE`,e[e.IF_ICMPEQ=159]=`IF_ICMPEQ`,e[e.IF_ICMPNE=160]=`IF_ICMPNE`,e[e.IF_ICMPLT=161]=`IF_ICMPLT`,e[e.IF_ICMPGE=162]=`IF_ICMPGE`,e[e.IF_ICMPGT=163]=`IF_ICMPGT`,e[e.IF_ICMPLE=164]=`IF_ICMPLE`,e[e.IFEQ=153]=`IFEQ`,e[e.IFNE=154]=`IFNE`,e[e.IFLT=155]=`IFLT`,e[e.IFGE=156]=`IFGE`,e[e.IFGT=157]=`IFGT`,e[e.IFLE=158]=`IFLE`,e[e.IFNONNULL=199]=`IFNONNULL`,e[e.IFNULL=198]=`IFNULL`,e[e.IINC=132]=`IINC`,e[e.ILOAD=21]=`ILOAD`,e[e.ILOAD_0=26]=`ILOAD_0`,e[e.ILOAD_1=27]=`ILOAD_1`,e[e.ILOAD_2=28]=`ILOAD_2`,e[e.ILOAD_3=29]=`ILOAD_3`,e[e.IMUL=104]=`IMUL`,e[e.INEG=116]=`INEG`,e[e.INSTANCEOF=193]=`INSTANCEOF`,e[e.INVOKEDYNAMIC=186]=`INVOKEDYNAMIC`,e[e.INVOKEINTERFACE=185]=`INVOKEINTERFACE`,e[e.INVOKESPECIAL=183]=`INVOKESPECIAL`,e[e.INVOKESTATIC=184]=`INVOKESTATIC`,e[e.INVOKEVIRTUAL=182]=`INVOKEVIRTUAL`,e[e.IOR=128]=`IOR`,e[e.IREM=112]=`IREM`,e[e.IRETURN=172]=`IRETURN`,e[e.ISHL=120]=`ISHL`,e[e.ISHR=122]=`ISHR`,e[e.ISTORE=54]=`ISTORE`,e[e.ISTORE_0=59]=`ISTORE_0`,e[e.ISTORE_1=60]=`ISTORE_1`,e[e.ISTORE_2=61]=`ISTORE_2`,e[e.ISTORE_3=62]=`ISTORE_3`,e[e.ISUB=100]=`ISUB`,e[e.IUSHR=124]=`IUSHR`,e[e.IXOR=130]=`IXOR`,e[e.JSR=168]=`JSR`,e[e.JSR_W=201]=`JSR_W`,e[e.L2D=138]=`L2D`,e[e.L2F=137]=`L2F`,e[e.L2I=136]=`L2I`,e[e.LADD=97]=`LADD`,e[e.LALOAD=47]=`LALOAD`,e[e.LAND=127]=`LAND`,e[e.LASTORE=80]=`LASTORE`,e[e.LCMP=148]=`LCMP`,e[e.LCONST_0=9]=`LCONST_0`,e[e.LCONST_1=10]=`LCONST_1`,e[e.LDC=18]=`LDC`,e[e.LDC_W=19]=`LDC_W`,e[e.LDC2_W=20]=`LDC2_W`,e[e.LDIV=109]=`LDIV`,e[e.LLOAD=22]=`LLOAD`,e[e.LLOAD_0=30]=`LLOAD_0`,e[e.LLOAD_1=31]=`LLOAD_1`,e[e.LLOAD_2=32]=`LLOAD_2`,e[e.LLOAD_3=33]=`LLOAD_3`,e[e.LMUL=105]=`LMUL`,e[e.LNEG=117]=`LNEG`,e[e.LOOKUPSWITCH=171]=`LOOKUPSWITCH`,e[e.LOR=129]=`LOR`,e[e.LREM=113]=`LREM`,e[e.LRETURN=173]=`LRETURN`,e[e.LSHL=121]=`LSHL`,e[e.LSHR=123]=`LSHR`,e[e.LSTORE=55]=`LSTORE`,e[e.LSTORE_0=63]=`LSTORE_0`,e[e.LSTORE_1=64]=`LSTORE_1`,e[e.LSTORE_2=65]=`LSTORE_2`,e[e.LSTORE_3=66]=`LSTORE_3`,e[e.LSUB=101]=`LSUB`,e[e.LUSHR=125]=`LUSHR`,e[e.LXOR=131]=`LXOR`,e[e.MONITORENTER=194]=`MONITORENTER`,e[e.MONITOREXIT=195]=`MONITOREXIT`,e[e.MULTIANEWARRAY=197]=`MULTIANEWARRAY`,e[e.NEW=187]=`NEW`,e[e.NEWARRAY=188]=`NEWARRAY`,e[e.NOP=0]=`NOP`,e[e.POP=87]=`POP`,e[e.POP2=88]=`POP2`,e[e.PUTFIELD=181]=`PUTFIELD`,e[e.PUTSTATIC=179]=`PUTSTATIC`,e[e.RET=169]=`RET`,e[e.RETURN=177]=`RETURN`,e[e.SALOAD=53]=`SALOAD`,e[e.SASTORE=86]=`SASTORE`,e[e.SIPUSH=17]=`SIPUSH`,e[e.SWAP=95]=`SWAP`,e[e.TABLESWITCH=170]=`TABLESWITCH`,e[e.WIDE=196]=`WIDE`})(h||={});var g;(function(e){e[e.PUBLIC=1]=`PUBLIC`,e[e.PRIVATE=2]=`PRIVATE`,e[e.PROTECTED=4]=`PROTECTED`,e[e.STATIC=8]=`STATIC`,e[e.FINAL=16]=`FINAL`,e[e.OPEN=32]=`OPEN`,e[e.TRANSITIVE=32]=`TRANSITIVE`,e[e.SUPER=32]=`SUPER`,e[e.SYNCHRONIZED=32]=`SYNCHRONIZED`,e[e.STATIC_PHASE=64]=`STATIC_PHASE`,e[e.VOLATILE=64]=`VOLATILE`,e[e.BRIDGE=64]=`BRIDGE`,e[e.TRANSIENT=128]=`TRANSIENT`,e[e.VARARGS=128]=`VARARGS`,e[e.NATIVE=256]=`NATIVE`,e[e.INTERFACE=512]=`INTERFACE`,e[e.ABSTRACT=1024]=`ABSTRACT`,e[e.STRICT=2048]=`STRICT`,e[e.SYNTHETIC=4096]=`SYNTHETIC`,e[e.ANNOTATION=8192]=`ANNOTATION`,e[e.ENUM=16384]=`ENUM`,e[e.MANDATED=32768]=`MANDATED`,e[e.MODULE=32768]=`MODULE`})(g||={});var _;(function(e){e.CONSTANT_VALUE=`ConstantValue`,e.CODE=`Code`,e.STACK_MAP_TABLE=`StackMapTable`,e.EXCEPTIONS=`Exceptions`,e.INNER_CLASSES=`InnerClasses`,e.ENCLOSING_METHOD=`EnclosingMethod`,e.SYNTHETIC=`Synthetic`,e.SIGNATURE=`Signature`,e.SOURCE_FILE=`SourceFile`,e.SOURCE_DEBUG_EXTENSION=`SourceDebugExtension`,e.LINE_NUMBER_TABLE=`LineNumberTable`,e.LOCAL_VARIABLE_TABLE=`LocalVariableTable`,e.LOCAL_VARIABLE_TYPE_TABLE=`LocalVariableTypeTable`,e.DEPRECATED=`Deprecated`,e.RUNTIME_VISIBLE_ANNOTATIONS=`RuntimeVisibleAnnotations`,e.RUNTIME_INVISIBLE_ANNOTATIONS=`RuntimeInvisibleAnnotations`,e.RUNTIME_VISIBLE_PARAMETER_ANNOTATIONS=`RuntimeVisibleParameterAnnotations`,e.RUNTIME_INVISIBLE_PARAMETER_ANNOTATIONS=`RuntimeInvisibleParameterAnnotations`,e.RUNTIME_VISIBLE_TYPE_ANNOTATIONS=`RuntimeVisibleTypeAnnotations`,e.RUNTIME_INVISIBLE_TYPE_ANNOTATIONS=`RuntimeInvisibleTypeAnnotations`,e.ANNOTATION_DEFAULT=`AnnotationDefault`,e.BOOTSTRAP_METHODS=`BootstrapMethods`,e.METHOD_PARAMETERS=`MethodParameters`,e.MODULE=`Module`,e.MODULE_PACKAGES=`ModulePackages`,e.MODULE_MAIN_CLASS=`ModuleMainClass`,e.NEST_HOST=`NestHost`,e.NEST_MEMBERS=`NestMembers`,e.RECORD=`Record`,e.PERMITTED_SUBCLASSES=`PermittedSubclasses`})(_||={});var v;(function(e){e[e.UTF8=1]=`UTF8`,e[e.INTEGER=3]=`INTEGER`,e[e.FLOAT=4]=`FLOAT`,e[e.LONG=5]=`LONG`,e[e.DOUBLE=6]=`DOUBLE`,e[e.CLASS=7]=`CLASS`,e[e.STRING=8]=`STRING`,e[e.FIELDREF=9]=`FIELDREF`,e[e.METHODREF=10]=`METHODREF`,e[e.INTERFACE_METHODREF=11]=`INTERFACE_METHODREF`,e[e.NAME_AND_TYPE=12]=`NAME_AND_TYPE`,e[e.METHOD_HANDLE=15]=`METHOD_HANDLE`,e[e.METHOD_TYPE=16]=`METHOD_TYPE`,e[e.DYNAMIC=17]=`DYNAMIC`,e[e.INVOKE_DYNAMIC=18]=`INVOKE_DYNAMIC`,e[e.MODULE=19]=`MODULE`,e[e.PACKAGE=20]=`PACKAGE`})(v||={});var y;(function(e){e[e.GET_FIELD=1]=`GET_FIELD`,e[e.GET_STATIC=2]=`GET_STATIC`,e[e.PUT_FIELD=3]=`PUT_FIELD`,e[e.PUT_STATIC=4]=`PUT_STATIC`,e[e.INVOKE_VIRTUAL=5]=`INVOKE_VIRTUAL`,e[e.INVOKE_STATIC=6]=`INVOKE_STATIC`,e[e.INVOKE_SPECIAL=7]=`INVOKE_SPECIAL`,e[e.NEW_INVOKE_SPECIAL=8]=`NEW_INVOKE_SPECIAL`,e[e.INVOKE_INTERFACE=9]=`INVOKE_INTERFACE`})(y||={});var b;(function(e){e[e.BOOLEAN=4]=`BOOLEAN`,e[e.CHAR=5]=`CHAR`,e[e.FLOAT=6]=`FLOAT`,e[e.DOUBLE=7]=`DOUBLE`,e[e.BYTE=8]=`BYTE`,e[e.SHORT=9]=`SHORT`,e[e.INT=10]=`INT`,e[e.LONG=11]=`LONG`})(b||={});var x;(function(e){e.BYTE=`B`,e.CHAR=`C`,e.DOUBLE=`D`,e.FLOAT=`F`,e.INT=`I`,e.LONG=`J`,e.SHORT=`S`,e.BOOLEAN=`Z`,e.STRING=`s`,e.ENUM=`e`,e.CLASS=`c`,e.ANNOTATION=`@`,e.ARRAY=`[`})(x||={});const S=e=>new Uint8Array(e.buffer,e.byteOffset,e.byteLength),C=(e,t)=>{if(t<=0)return;let n=e.offset+t;if(n>e.view.buffer.byteLength){let t=new ArrayBuffer(n+32);new Uint8Array(t,0,e.view.byteLength).set(S(e.view)),e.view=new DataView(t,0,n)}else e.view=new DataView(e.view.buffer,e.view.byteOffset,n)},w=(e,t=!1)=>({view:new DataView(e.buffer,e.byteOffset,e.byteLength),offset:0,littleEndian:t,get arrayView(){return S(this.view)},get(e,t=!1){if(this.offset+e>this.view.byteLength)throw Error(`Wanted ${e} byte(s), ${this.view.byteLength-this.offset} remaining`);let n=this.view.byteOffset+this.offset,r=t?new Uint8Array(this.view.buffer.slice(n,n+e)):new Uint8Array(this.view.buffer,n,e);return this.offset+=e,r},getBigInt64(){let e=this.view.getBigInt64(this.offset,this.littleEndian);return this.offset+=8,e},getBigUint64(){let e=this.view.getBigUint64(this.offset,this.littleEndian);return this.offset+=8,e},getFloat32(){let e=this.view.getFloat32(this.offset,this.littleEndian);return this.offset+=4,e},getFloat64(){let e=this.view.getFloat64(this.offset,this.littleEndian);return this.offset+=8,e},getInt16(){let e=this.view.getInt16(this.offset,this.littleEndian);return this.offset+=2,e},getInt32(){let e=this.view.getInt32(this.offset,this.littleEndian);return this.offset+=4,e},getInt8(){let e=this.view.getInt8(this.offset);return this.offset+=1,e},getUint16(){let e=this.view.getUint16(this.offset,this.littleEndian);return this.offset+=2,e},getUint32(){let e=this.view.getUint32(this.offset,this.littleEndian);return this.offset+=4,e},getUint8(){let e=this.view.getUint8(this.offset);return this.offset+=1,e},set(e){C(this,e.length),new Uint8Array(this.view.buffer,this.view.byteOffset+this.offset,e.length).set(e),this.offset+=e.length},setBigInt64(e){C(this,8),this.view.setBigInt64(this.offset,e,this.littleEndian),this.offset+=8},setBigUint64(e){C(this,8),this.view.setBigUint64(this.offset,e,this.littleEndian),this.offset+=8},setFloat32(e){C(this,4),this.view.setFloat32(this.offset,e,this.littleEndian),this.offset+=4},setFloat64(e){C(this,8),this.view.setFloat64(this.offset,e,this.littleEndian),this.offset+=8},setInt16(e){C(this,2),this.view.setInt16(this.offset,e,this.littleEndian),this.offset+=2},setInt32(e){C(this,4),this.view.setInt32(this.offset,e,this.littleEndian),this.offset+=4},setInt8(e){C(this,1),this.view.setInt8(this.offset,e),this.offset+=1},setUint16(e){C(this,2),this.view.setUint16(this.offset,e,this.littleEndian),this.offset+=2},setUint32(e){C(this,4),this.view.setUint32(this.offset,e,this.littleEndian),this.offset+=4},setUint8(e){C(this,1),this.view.setUint8(this.offset,e),this.offset+=1}});var T;(function(e){e[e.OBJECT=0]=`OBJECT`,e[e.PRIMITIVE=1]=`PRIMITIVE`,e[e.METHOD=2]=`METHOD`,e[e.ARRAY=3]=`ARRAY`,e[e.TYPE_VARIABLE=4]=`TYPE_VARIABLE`,e[e.TYPE_PARAMETER=5]=`TYPE_PARAMETER`,e[e.PARAMETERIZED=6]=`PARAMETERIZED`,e[e.WILDCARD=7]=`WILDCARD`,e[e.CLASS=8]=`CLASS`})(T||={});const E={VOID:{kind:T.PRIMITIVE,get value(){return`V`},get name(){return`void`}},BOOLEAN:{kind:T.PRIMITIVE,get value(){return`Z`},get name(){return`boolean`}},BYTE:{kind:T.PRIMITIVE,get value(){return`B`},get name(){return`byte`}},CHAR:{kind:T.PRIMITIVE,get value(){return`C`},get name(){return`char`}},SHORT:{kind:T.PRIMITIVE,get value(){return`S`},get name(){return`short`}},INT:{kind:T.PRIMITIVE,get value(){return`I`},get name(){return`int`}},LONG:{kind:T.PRIMITIVE,get value(){return`J`},get name(){return`long`}},FLOAT:{kind:T.PRIMITIVE,get value(){return`F`},get name(){return`float`}},DOUBLE:{kind:T.PRIMITIVE,get value(){return`D`},get name(){return`double`}}};var D;(function(e){e[e.UNBOUNDED=0]=`UNBOUNDED`,e[e.EXTENDS=1]=`EXTENDS`,e[e.SUPER=2]=`SUPER`})(D||={}),E.BYTE,E.CHAR,E.DOUBLE,E.FLOAT,E.INT,E.LONG,E.SHORT,E.BOOLEAN,E.VOID;const O=(e,t,n)=>{let r=t.getUint16();return{tag:e,value:r,valueEntry:n[r]}},k=(e,t)=>{let n=e.getUint16(),r=e.getUint16();return{tag:x.ENUM,typeName:n,constName:r,typeNameEntry:t[n],constNameEntry:t[r]}},A=(e,t)=>{let n=e.getUint16();return{tag:x.CLASS,classInfo:n,classInfoEntry:t[n]}},j=(e,t)=>{let n=N(e,t);return{tag:x.ANNOTATION,annotation:n}},ee=(e,t)=>{let n=e.getUint16(),r=Array(n);for(let i=0;i<n;i++)r[i]=M(e,t);return{tag:x.ARRAY,values:r}},M=(e,t)=>{let n=String.fromCharCode(e.getUint8());switch(n){case x.BYTE:case x.CHAR:case x.DOUBLE:case x.FLOAT:case x.INT:case x.LONG:case x.SHORT:case x.BOOLEAN:case x.STRING:return O(n,e,t);case x.ENUM:return k(e,t);case x.CLASS:return A(e,t);case x.ANNOTATION:return j(e,t);case x.ARRAY:return ee(e,t);default:throw Error(`Unknown element value tag ${n}`)}},N=(e,t)=>{let n=e.getUint16(),r=e.getUint16(),i=Array(r);for(let n=0;n<r;n++){let r=e.getUint16(),a=M(e,t);i[n]={name:r,nameEntry:t[r],value:a}}return{type:n,typeEntry:t[n],values:i}},te=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++)i[e]=N(n,t);return{...e,type:e.name.string,annotations:i}},ne=(e,t)=>{let n=w(e.data),r=n.getUint8(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16(),a=Array(r);for(let e=0;e<r;e++)a[e]=N(n,t);i[e]=a}return{...e,type:e.name.string,parameters:i}},re=(e,t)=>{let n=w(e.data),r=M(n,t);return{...e,type:_.ANNOTATION_DEFAULT,defaultValue:r}},ie=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16(),a=n.getUint16(),o=Array(a);for(let e=0;e<a;e++){let r=n.getUint16();o[e]={index:r,entry:t[r]}}i[e]={ref:r,refEntry:t[r],args:o}}return{...e,type:_.BOOTSTRAP_METHODS,methods:i}},ae=e=>{let t=w(e.operands);return{...e,type:e.opcode===h.NEWARRAY?t.getUint8():t.getUint16(),dimensions:e.opcode===h.MULTIANEWARRAY?t.getUint8():1}},oe=e=>{let t=w(e.operands),n=e.opcode===h.GOTO_W||e.opcode===h.JSR_W;return{...e,wide:n,branchOffset:n?t.getInt32():t.getInt16()}},P=e=>{let t=w(e.operands),n=e.operands.length>2;return{...e,wide:n,index:n?t.getUint16():t.getUint8(),const:n?t.getInt16():t.getInt8()}},se=e=>{let t=w(e.operands),n={...e,ref:t.getUint16()};if(e.opcode===h.INVOKEINTERFACE){let e=n;e.count=t.getUint8()}return n},ce=e=>{let t=w(e.operands),n=e.operands.length>1;return{...e,wide:n,index:n?t.getUint16():t.getUint8()}},le=e=>{let t=w(e.operands),n=e.operands.length>1;return{...e,wide:n,index:n?t.getUint16():t.getUint8()}},ue=e=>{let t=w(e.operands);return{...e,value:e.opcode===h.SIPUSH?t.getUint16():t.getUint8()}},de=e=>{let t=w(e.operands),n={...e,defaultOffset:t.getInt32()};if(e.opcode===h.TABLESWITCH){let e=n;e.lowCase=t.getInt32(),e.highCase=t.getInt32();let r=e.highCase-e.lowCase+1;n.jumpOffsets=Array(r);for(let e=0;e<r;e++)n.jumpOffsets[e]=t.getInt32()}else if(e.opcode===h.LOOKUPSWITCH){let e=n,r=t.getInt32();e.cases=Array(r),e.jumpOffsets=Array(r);for(let n=0;n<r;n++)e.cases[n]=t.getInt32(),e.jumpOffsets[n]=t.getInt32()}else throw Error(`Unrecognized switch opcode ${e.opcode}`);return n},fe=e=>{let t=w(e.operands);return{...e,index:t.getUint16()}},pe=e=>{let t=w(e.operands),n={opcode:t.getUint8(),operands:t.arrayView.subarray(1),offset:e.offset+1,length:e.length-1,dirty:!1},r;switch(n.opcode){case h.ALOAD:case h.ASTORE:case h.DLOAD:case h.DSTORE:case h.FLOAD:case h.FSTORE:case h.ILOAD:case h.ISTORE:case h.LLOAD:case h.LSTORE:case h.RET:r=le(n);break;case h.IINC:r=P(n);break;default:throw Error(`Unrecognized wide opcode ${n.opcode}`)}return{...e,insn:r}},me={[h.NOP]:0,[h.ACONST_NULL]:0,[h.ICONST_M1]:0,[h.ICONST_0]:0,[h.ICONST_1]:0,[h.ICONST_2]:0,[h.ICONST_3]:0,[h.ICONST_4]:0,[h.ICONST_5]:0,[h.LCONST_0]:0,[h.LCONST_1]:0,[h.FCONST_0]:0,[h.FCONST_1]:0,[h.FCONST_2]:0,[h.DCONST_0]:0,[h.DCONST_1]:0,[h.BIPUSH]:1,[h.SIPUSH]:2,[h.LDC]:1,[h.LDC_W]:2,[h.LDC2_W]:2,[h.ILOAD]:1,[h.LLOAD]:1,[h.FLOAD]:1,[h.DLOAD]:1,[h.ALOAD]:1,[h.ILOAD_0]:0,[h.ILOAD_1]:0,[h.ILOAD_2]:0,[h.ILOAD_3]:0,[h.LLOAD_0]:0,[h.LLOAD_1]:0,[h.LLOAD_2]:0,[h.LLOAD_3]:0,[h.FLOAD_0]:0,[h.FLOAD_1]:0,[h.FLOAD_2]:0,[h.FLOAD_3]:0,[h.DLOAD_0]:0,[h.DLOAD_1]:0,[h.DLOAD_2]:0,[h.DLOAD_3]:0,[h.ALOAD_0]:0,[h.ALOAD_1]:0,[h.ALOAD_2]:0,[h.ALOAD_3]:0,[h.IALOAD]:0,[h.LALOAD]:0,[h.FALOAD]:0,[h.DALOAD]:0,[h.AALOAD]:0,[h.BALOAD]:0,[h.CALOAD]:0,[h.SALOAD]:0,[h.ISTORE]:1,[h.LSTORE]:1,[h.FSTORE]:1,[h.DSTORE]:1,[h.ASTORE]:1,[h.ISTORE_0]:0,[h.ISTORE_1]:0,[h.ISTORE_2]:0,[h.ISTORE_3]:0,[h.LSTORE_0]:0,[h.LSTORE_1]:0,[h.LSTORE_2]:0,[h.LSTORE_3]:0,[h.FSTORE_0]:0,[h.FSTORE_1]:0,[h.FSTORE_2]:0,[h.FSTORE_3]:0,[h.DSTORE_0]:0,[h.DSTORE_1]:0,[h.DSTORE_2]:0,[h.DSTORE_3]:0,[h.ASTORE_0]:0,[h.ASTORE_1]:0,[h.ASTORE_2]:0,[h.ASTORE_3]:0,[h.IASTORE]:0,[h.LASTORE]:0,[h.FASTORE]:0,[h.DASTORE]:0,[h.AASTORE]:0,[h.BASTORE]:0,[h.CASTORE]:0,[h.SASTORE]:0,[h.POP]:0,[h.POP2]:0,[h.DUP]:0,[h.DUP_X1]:0,[h.DUP_X2]:0,[h.DUP2]:0,[h.DUP2_X1]:0,[h.DUP2_X2]:0,[h.SWAP]:0,[h.IADD]:0,[h.LADD]:0,[h.FADD]:0,[h.DADD]:0,[h.ISUB]:0,[h.LSUB]:0,[h.FSUB]:0,[h.DSUB]:0,[h.IMUL]:0,[h.LMUL]:0,[h.FMUL]:0,[h.DMUL]:0,[h.IDIV]:0,[h.LDIV]:0,[h.FDIV]:0,[h.DDIV]:0,[h.IREM]:0,[h.LREM]:0,[h.FREM]:0,[h.DREM]:0,[h.INEG]:0,[h.LNEG]:0,[h.FNEG]:0,[h.DNEG]:0,[h.ISHL]:0,[h.LSHL]:0,[h.ISHR]:0,[h.LSHR]:0,[h.IUSHR]:0,[h.LUSHR]:0,[h.IAND]:0,[h.LAND]:0,[h.IOR]:0,[h.LOR]:0,[h.IXOR]:0,[h.LXOR]:0,[h.IINC]:2,[h.I2L]:0,[h.I2F]:0,[h.I2D]:0,[h.L2I]:0,[h.L2F]:0,[h.L2D]:0,[h.F2I]:0,[h.F2L]:0,[h.F2D]:0,[h.D2I]:0,[h.D2L]:0,[h.D2F]:0,[h.I2B]:0,[h.I2C]:0,[h.I2S]:0,[h.LCMP]:0,[h.FCMPL]:0,[h.FCMPG]:0,[h.DCMPL]:0,[h.DCMPG]:0,[h.IFEQ]:2,[h.IFNE]:2,[h.IFLT]:2,[h.IFGE]:2,[h.IFGT]:2,[h.IFLE]:2,[h.IF_ICMPEQ]:2,[h.IF_ICMPNE]:2,[h.IF_ICMPLT]:2,[h.IF_ICMPGE]:2,[h.IF_ICMPGT]:2,[h.IF_ICMPLE]:2,[h.IF_ACMPEQ]:2,[h.IF_ACMPNE]:2,[h.GOTO]:2,[h.JSR]:2,[h.RET]:1,[h.TABLESWITCH]:-1,[h.LOOKUPSWITCH]:-1,[h.IRETURN]:0,[h.LRETURN]:0,[h.FRETURN]:0,[h.DRETURN]:0,[h.ARETURN]:0,[h.RETURN]:0,[h.GETSTATIC]:2,[h.PUTSTATIC]:2,[h.GETFIELD]:2,[h.PUTFIELD]:2,[h.INVOKEVIRTUAL]:2,[h.INVOKESPECIAL]:2,[h.INVOKESTATIC]:2,[h.INVOKEINTERFACE]:4,[h.INVOKEDYNAMIC]:4,[h.NEW]:2,[h.NEWARRAY]:1,[h.ANEWARRAY]:2,[h.ARRAYLENGTH]:0,[h.ATHROW]:0,[h.CHECKCAST]:2,[h.INSTANCEOF]:2,[h.MONITORENTER]:0,[h.MONITOREXIT]:0,[h.WIDE]:-1,[h.MULTIANEWARRAY]:3,[h.IFNULL]:2,[h.IFNONNULL]:2,[h.GOTO_W]:4,[h.JSR_W]:4},he=e=>{let t=[],n=0;for(;n<e.length;){let r=n,i=e[n++],a;switch(i){case h.LOOKUPSWITCH:case h.TABLESWITCH:if(n+=n%4?4-n%4:0,i===h.TABLESWITCH){let t=e[n+4]<<24|e[n+5]<<16|e[n+6]<<8|e[n+7];a=12+((e[n+8]<<24|e[n+9]<<16|e[n+10]<<8|e[n+11])-t+1)*4}else a=8+(e[n+4]<<24|e[n+5]<<16|e[n+6]<<8|e[n+7])*8;break;case h.WIDE:a=e[n]===h.IINC?5:3;break;default:let t=me[i];if(t===void 0)throw Error(`Unrecognized opcode ${i} at position ${r}`);a=t}n+=a,t.push({opcode:i,operands:e.subarray(n-a,n),offset:r,length:n-r,dirty:!1})}for(let e=0;e<t.length;e++){let n=t[e];switch(n.opcode){case h.IFEQ:case h.IFNE:case h.IFLT:case h.IFGE:case h.IFGT:case h.IFLE:case h.IF_ICMPEQ:case h.IF_ICMPNE:case h.IF_ICMPLT:case h.IF_ICMPGE:case h.IF_ICMPGT:case h.IF_ICMPLE:case h.IF_ACMPEQ:case h.IF_ACMPNE:case h.GOTO:case h.GOTO_W:case h.JSR:case h.JSR_W:case h.IFNULL:case h.IFNONNULL:t[e]=oe(n);break;case h.TABLESWITCH:case h.LOOKUPSWITCH:t[e]=de(n);break;case h.ALOAD:case h.ASTORE:case h.DLOAD:case h.DSTORE:case h.FLOAD:case h.FSTORE:case h.ILOAD:case h.ISTORE:case h.LLOAD:case h.LSTORE:case h.RET:case h.GETFIELD:case h.GETSTATIC:case h.PUTFIELD:case h.PUTSTATIC:t[e]=le(n);break;case h.IINC:t[e]=P(n);break;case h.WIDE:t[e]=pe(n);break;case h.INVOKEDYNAMIC:case h.INVOKEINTERFACE:case h.INVOKESPECIAL:case h.INVOKESTATIC:case h.INVOKEVIRTUAL:t[e]=se(n);break;case h.LDC:case h.LDC_W:case h.LDC2_W:t[e]=ce(n);break;case h.CHECKCAST:case h.INSTANCEOF:case h.NEW:t[e]=fe(n);break;case h.BIPUSH:case h.SIPUSH:t[e]=ue(n);break;case h.ANEWARRAY:case h.NEWARRAY:case h.MULTIANEWARRAY:t[e]=ae(n)}}return t},ge=(e,t,n=0)=>{let r=w(e.data),i={...e,type:_.CODE,maxStack:r.getUint16(),maxLocals:r.getUint16()},a=r.getUint32();i.insns=he(r.get(a));let o=r.getUint16();i.exceptionTable=Array(o);for(let e=0;e<o;e++)i.exceptionTable[e]={startPC:r.getUint16(),endPC:r.getUint16(),handlerPC:r.getUint16(),catchType:r.getUint16()};return i.attrs=F(r,t,n),i},_e=(e,t)=>{let n=w(e.data).getUint16();return{...e,type:_.CONSTANT_VALUE,constIndex:n,constEntry:t[n]}},ve=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=n.getUint16();return{...e,type:_.ENCLOSING_METHOD,classIndex:r,methodIndex:i,classEntry:t[r],methodEntry:t[i]}},ye=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16();i[e]={index:r,entry:t[r]}}return{...e,type:_.EXCEPTIONS,entries:i}},be=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16(),a=n.getUint16(),o=n.getUint16();i[e]={innerIndex:r,innerEntry:t[r],outerIndex:a,outerEntry:t[a],innerNameIndex:o,innerNameEntry:t[o],innerAccess:n.getUint16()}}return{...e,type:_.INNER_CLASSES,classes:i}},xe=e=>{let t=w(e.data),n=t.getUint16(),r=Array(n);for(let e=0;e<n;e++)r[e]={startPC:t.getUint16(),lineNumber:t.getUint16()};return{...e,type:_.LINE_NUMBER_TABLE,entries:r}},Se=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r={startPC:n.getUint16(),length:n.getUint16(),nameIndex:n.getUint16(),descriptorIndex:n.getUint16(),index:n.getUint16()};r.nameEntry=t[r.nameIndex],r.descriptorEntry=t[r.descriptorIndex],i[e]=r}return{...e,type:e.name.string,entries:i}},Ce=(e,t)=>{let n=w(e.data),r=n.getUint8(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16(),a=n.getUint16();i[e]={nameIndex:r,accessFlags:a,nameEntry:t[r]}}return{...e,type:_.METHOD_PARAMETERS,parameters:i}},we=(e,t)=>{let n=e.getUint16(),r=Array(n);for(let i=0;i<n;i++){let n=e.getUint16();r[i]={index:n,entry:t[n]}}return r},Te=(e,t)=>{let n=e.getUint16(),r=Array(n);for(let i=0;i<n;i++){let n=e.getUint16(),a=e.getUint16(),o=we(e,t);r[i]={index:n,flags:a,to:o,entry:t[n]}}return r},Ee=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=n.getUint16(),a=n.getUint16(),o=n.getUint16(),s=Array(o);for(let e=0;e<o;e++){let r=n.getUint16(),i=n.getUint16(),a=n.getUint16();s[e]={index:r,flags:i,versionIndex:a,entry:t[r],versionEntry:a>0?t[a]:void 0}}let c=Te(n,t),l=Te(n,t),u=we(n,t),d=n.getUint16(),f=Array(d);for(let e=0;e<d;e++){let r=n.getUint16(),i=we(n,t);f[e]={index:r,with:i,entry:t[r]}}return{...e,type:_.MODULE,moduleNameIndex:r,moduleFlags:i,moduleVersionIndex:a,moduleNameEntry:t[r],moduleVersionEntry:a>0?t[a]:void 0,requires:s,exports:c,opens:l,uses:u,provides:f}},De=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16();i[e]={index:r,entry:t[r]}}return{...e,type:_.MODULE_PACKAGES,packages:i}},Oe=(e,t)=>{let n=w(e.data).getUint16();return{...e,type:_.MODULE_MAIN_CLASS,mainClassIndex:n,mainClassEntry:t[n]}},ke=(e,t)=>{let n=w(e.data).getUint16();return{...e,type:_.NEST_HOST,hostClass:n,hostClassEntry:t[n]}},Ae=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16();i[e]={index:r,entry:t[r]}}return{...e,type:_.NEST_MEMBERS,classes:i}},je=(e,t)=>{let n=w(e.data),r=n.getUint16(),i=Array(r);for(let e=0;e<r;e++){let r=n.getUint16();i[e]={index:r,entry:t[r]}}return{...e,type:_.PERMITTED_SUBCLASSES,classes:i}},Me=(e,t,n=0)=>{let r=w(e.data),i=r.getUint16(),a=Array(i);for(let e=0;e<i;e++){let i=r.getUint16(),o=r.getUint16();a[e]={name:i,nameEntry:t[i],descriptor:o,descriptorEntry:t[o],attrs:F(r,t,n)}}return{...e,type:_.RECORD,components:a}},Ne=(e,t)=>{let n=w(e.data).getUint16();return{...e,type:_.SIGNATURE,signatureIndex:n,signatureEntry:t[n]}},Pe=new TextDecoder(`utf-8`),Fe=e=>({...e,type:_.SOURCE_DEBUG_EXTENSION,debugExtension:Pe.decode(e.data)});new TextEncoder;const Ie=(e,t)=>{let n=w(e.data).getUint16();return{...e,type:_.SOURCE_FILE,sourceFileIndex:n,sourceFileEntry:t[n]}},Le=(e,t,n)=>{let r=e.getUint16(),i=t[r],a=e.get(e.getInt32(),!!(n&4)),o={dirty:!1,nameIndex:r,data:a,name:i};if(!(n&2))try{switch(i?.string){case _.CODE:o=ge(o,t,n);break;case _.SOURCE_FILE:o=Ie(o,t);break;case _.SIGNATURE:o=Ne(o,t);break;case _.LOCAL_VARIABLE_TABLE:case _.LOCAL_VARIABLE_TYPE_TABLE:o=Se(o,t);break;case _.EXCEPTIONS:o=ye(o,t);break;case _.CONSTANT_VALUE:o=_e(o,t);break;case _.BOOTSTRAP_METHODS:o=ie(o,t);break;case _.RECORD:o=Me(o,t,n);break;case _.PERMITTED_SUBCLASSES:o=je(o,t);break;case _.NEST_HOST:o=ke(o,t);break;case _.NEST_MEMBERS:o=Ae(o,t);break;case _.INNER_CLASSES:o=be(o,t);break;case _.ENCLOSING_METHOD:o=ve(o,t);break;case _.SOURCE_DEBUG_EXTENSION:o=Fe(o);break;case _.LINE_NUMBER_TABLE:o=xe(o);break;case _.METHOD_PARAMETERS:o=Ce(o,t);break;case _.MODULE:o=Ee(o,t);break;case _.MODULE_MAIN_CLASS:o=Oe(o,t);break;case _.MODULE_PACKAGES:o=De(o,t);break;case _.RUNTIME_VISIBLE_ANNOTATIONS:case _.RUNTIME_INVISIBLE_ANNOTATIONS:o=te(o,t);break;case _.RUNTIME_VISIBLE_PARAMETER_ANNOTATIONS:case _.RUNTIME_INVISIBLE_PARAMETER_ANNOTATIONS:o=ne(o,t);break;case _.ANNOTATION_DEFAULT:o=re(o,t);break;case _.DEPRECATED:case _.SYNTHETIC:o.type=o.name.string}}catch(e){console.warn(`failed to parse ${i?.string||`unknown`} attribute, data length ${a.length}`),console.error(e)}return o},F=(e,t,n=0)=>{let r=e.getUint16(),i=[];if(n&1)for(let t=0;t<r;t++){e.offset+=2;let t=e.getInt32();e.offset+=t}else{i=Array(r);for(let a=0;a<r;a++)i[a]=Le(e,t,n)}return i},Re=new TextDecoder,ze=(e,t)=>{let n=e.getUint8();switch(n){case v.UTF8:let r=e.getUint16(),i=e.get(r);return{type:n,index:t,string:Re.decode(i),bytes:i,dirty:!1};case v.INTEGER:return{type:n,index:t,value:e.getInt32()};case v.FLOAT:return{type:n,index:t,value:e.getFloat32()};case v.LONG:return{type:n,index:t,value:e.getBigInt64()};case v.DOUBLE:return{type:n,index:t,value:e.getFloat64()};case v.CLASS:return{type:n,index:t,name:e.getUint16()};case v.STRING:return{type:n,index:t,data:e.getUint16()};case v.METHOD_TYPE:return{type:n,index:t,descriptor:e.getUint16()};case v.MODULE:case v.PACKAGE:return{type:n,index:t,name:e.getUint16()};case v.FIELDREF:case v.METHODREF:case v.INTERFACE_METHODREF:return{type:n,index:t,ref:e.getUint16(),nameType:e.getUint16()};case v.NAME_AND_TYPE:return{type:n,index:t,name:e.getUint16(),type_:e.getUint16()};case v.DYNAMIC:case v.INVOKE_DYNAMIC:return{type:n,index:t,bsmIndex:e.getUint16(),nameType:e.getUint16()};case v.METHOD_HANDLE:return{type:n,index:t,kind:e.getUint8(),ref:e.getUint16()};default:throw Error(`Unrecognized constant pool tag `+n+` at position `+t)}},Be=(e,t)=>{let n=0;for(let r=1;r<t;r++){let t=e.getUint8();switch(n+=1,t){case v.UTF8:let i=e.getUint16();e.offset+=i,n+=2+i;break;case v.INTEGER:case v.FLOAT:case v.FIELDREF:case v.METHODREF:case v.INTERFACE_METHODREF:case v.NAME_AND_TYPE:case v.DYNAMIC:case v.INVOKE_DYNAMIC:e.offset+=4,n+=4;break;case v.LONG:case v.DOUBLE:r++,e.offset+=8,n+=8;break;case v.CLASS:case v.STRING:case v.METHOD_TYPE:case v.MODULE:case v.PACKAGE:e.offset+=2,n+=2;break;case v.METHOD_HANDLE:e.offset+=3,n+=3;break;default:throw Error(`Unrecognized constant pool tag `+t+` at position `+r)}}return e.offset-=n,n},Ve=(e,t=0)=>{let n=e.getUint16(),r=Array(n);r.fill(null);let i=t&4?w(e.get(Be(e,n),!0)):e;for(let e=1;e<n;e++){let t=ze(i,e);r[e]=t,(t.type===v.DOUBLE||t.type===v.LONG)&&e++}for(let e=1;e<n;e++){let t=r[e];if(t)switch(t.type){case v.CLASS:let e=t;e.nameEntry=r[e.name];break;case v.STRING:let n=t;n.dataEntry=r[n.data];break;case v.NAME_AND_TYPE:let i=t;i.nameEntry=r[i.name],i.typeEntry=r[i.type_];break;case v.FIELDREF:case v.METHODREF:case v.INTERFACE_METHODREF:let a=t;a.refEntry=r[a.ref],a.nameTypeEntry=r[a.nameType];break;case v.MODULE:case v.PACKAGE:let o=t;o.nameEntry=r[o.name];break;case v.DYNAMIC:case v.INVOKE_DYNAMIC:let s=t;s.nameTypeEntry=r[s.nameType];break;case v.METHOD_HANDLE:let c=t;c.refEntry=r[c.ref];break;case v.METHOD_TYPE:let l=t;l.descriptorEntry=r[l.descriptor]}}return r};new TextEncoder;const He=(e,t,n)=>({access:e.getUint16(),name:t[e.getUint16()],type:t[e.getUint16()],attrs:F(e,t,n)}),Ue=(e,t=0)=>{let n=w(e),r={magic:n.getUint32(),minor:n.getUint16(),major:n.getUint16(),pool:Ve(n,t),access:n.getUint16()};r.thisClass=r.pool[n.getUint16()];let i=n.getUint16();i!==0&&(r.superClass=r.pool[i]);let a=n.getUint16();r.interfaces=Array(a);for(let e=0;e<a;e++)r.interfaces[e]=r.pool[n.getUint16()];let o=n.getUint16();r.fields=Array(o);for(let e=0;e<o;e++)r.fields[e]=He(n,r.pool,t);let s=n.getUint16();r.methods=Array(s);for(let e=0;e<s;e++)r.methods[e]=He(n,r.pool,t);return r.attrs=F(n,r.pool,t),r};function We(e){let t=Ue(e,1);if(t.magic!==3405691582)throw Error(`Invalid Java entry class`);for(let[e,n]of[[`([Ljava/lang/String;)V`,`args`],[`()V`,`noargs`]]){let r=t.methods.find(t=>t.name.string===`main`&&t.type.string===e&&(t.access&g.PRIVATE)===0);if(r)return`${(r.access&g.STATIC)===0?`instance`:`static`}-${n}`}throw Error(`Main method not found`)}const Ge=e=>typeof globalThis.SharedArrayBuffer==`function`&&e instanceof SharedArrayBuffer,Ke=e=>Ge(e?.buffer),qe=Int32Array.BYTES_PER_ELEMENT*2;new TextEncoder;const Je=new TextDecoder,Ye=e=>e instanceof Int32Array?e:new Int32Array(e),Xe=e=>new Uint8Array(e.buffer,e.byteOffset+qe,e.byteLength-qe),Ze=e=>{let t=Ye(e),n=Atomics.load(t,1);if(n===-1)return null;let r=Xe(t);return Je.decode(r.slice(0,n))},Qe=(e,t)=>{if(!e||!Ke(e))return null;let n=Atomics.load(e,0);for(t();;)if(Atomics.wait(e,0,n,100)===`not-equal`)return Ze(e)};function $e(e,t=`wasm_idle_debug`){if(![e,t].every(e=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(e)))throw Error(`Invalid Java debugger helper name`);return{qualifiedName:`${t}.${e}`,sourceFileName:`${e}.java`,source:String.raw`package ${t};
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;
import org.teavm.jso.core.JSString;
import org.teavm.jso.core.JSNumber;
import java.util.ArrayList;
import java.lang.String;
import java.lang.StringBuilder;
import java.lang.Throwable;
import java.lang.StackTraceElement;

public final class ${e} {
    public interface Inspectable {
        Class<?> ${e}_fieldOwner();
        int ${e}_fieldCount();
        Field ${e}_field(int index);
    }
    public static final class Field {
        final String name;
        final String type;
        final Object value;
        public Field(String name, String type, Object value) {
            this.name = name; this.type = type; this.value = value;
        }
    }
    private static final class Captured {
        final String kind;
        final Object value;
        Captured(String kind, Object value) { this.kind = kind; this.value = value; }
    }
    public static Object capture(boolean value) { return new Captured("boolean", value); }
    public static Object capture(byte value) { return new Captured("byte", value); }
    public static Object capture(short value) { return new Captured("short", value); }
    public static Object capture(char value) { return new Captured("char", value); }
    public static Object capture(int value) { return new Captured("int", value); }
    public static Object capture(long value) { return new Captured("long", value); }
    public static Object capture(float value) { return new Captured("float", value); }
    public static Object capture(double value) { return new Captured("double", value); }
    public static Object capture(String value) { return new Captured("java.lang.String", value); }
    public static Object capture(Object value) { return new Captured("reference", value); }
    private static String quote(String value) {
        if (value == null) return "null";
        StringBuilder text = new StringBuilder("\"");
        String hex = "0123456789abcdef";
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\\' || c == '"') text.append('\\').append(c);
            else if (c < 32 || (c >= 0xd800 && c <= 0xdfff)) {
                text.append("\\u").append(hex.charAt((c >>> 12) & 15))
                    .append(hex.charAt((c >>> 8) & 15)).append(hex.charAt((c >>> 4) & 15))
                    .append(hex.charAt(c & 15));
            } else text.append(c);
        }
        return text.append('"').toString();
    }
    private static JSObject target() {
        Window window = Window.current();
        if (window == null) return null;
        JSMapLike<JSObject> globals = window.cast();
        return globals.get("wasmIdleJavaDebug");
    }
    public static boolean poll(String source, int line, int column) {
        JSObject target = target();
        if (target == null) return false;
        JSMapLike<JSObject> methods = target.cast();
        JSFunction poll = methods.get("poll").cast();
        return poll.call(target, JSString.valueOf(source), JSNumber.valueOf(line), JSNumber.valueOf(column)) != null;
    }
    public static void hit(String source, int line, int column) {
        if (poll(source, line, column)) hit(source, line, column, new String[0], new String[0], new Object[0]);
    }
    public static void hit(String source, int line, int column, String[] names, String[] types, Object[] values) {
        JSObject target = target();
        if (target == null) return;
        JSMapLike<JSObject> methods = target.cast();
        Snapshot snapshot = new Snapshot(names, types, values);
        StackTraceElement[] frames = new Throwable().getStackTrace();
        StringBuilder result = new StringBuilder("[");
        for (int i = 0; i < frames.length && i < 64; i++) {
            if (i > 0) result.append(',');
            StackTraceElement frame = frames[i];
            result.append('[').append(quote(frame.getClassName())).append(',')
                .append(quote(frame.getMethodName())).append(',')
                .append(quote(frame.getFileName())).append(',')
                .append(frame.getLineNumber()).append(']');
        }
        result.append(']');
        JSFunction pause = methods.get("pause").cast();
        JSObject request = (JSObject) pause.call(target, JSString.valueOf(source), JSNumber.valueOf(line),
            JSNumber.valueOf(column), JSString.valueOf(result.toString()), JSNumber.valueOf(frames.length),
            JSString.valueOf(snapshot.variables(0, 0, 50)), JSNumber.valueOf(names.length));
        while (request != null) {
            JSMapLike<JSObject> fields = request.cast();
            int id = ((JSNumber) fields.get("id")).intValue();
            int stopId = ((JSNumber) fields.get("stopId")).intValue();
            String op = ((JSString) fields.get("op")).stringValue();
            String response = null;
            String error = null;
            try {
                if (op.equals("context")) response = snapshot.context();
                else if (op.equals("variables")) response = snapshot.variables(
                    ((JSNumber) fields.get("reference")).intValue(),
                    ((JSNumber) fields.get("start")).intValue(),
                    ((JSNumber) fields.get("count")).intValue());
                else throw new IllegalArgumentException("Unknown Java inspection request");
            } catch (Throwable failure) {
                error = failure.getClass().getName() + ": " + failure.getMessage();
            }
            JSFunction reply = methods.get("reply").cast();
            request = (JSObject) reply.call(target, JSNumber.valueOf(id), JSNumber.valueOf(stopId),
                response == null ? null : JSString.valueOf(response),
                error == null ? null : JSString.valueOf(error));
        }
    }

    private static final class Snapshot {
        final String[] names;
        final String[] types;
        final String[] kinds;
        final Object[] values;
        final ArrayList<Object> handles = new ArrayList<Object>();
        Snapshot(String[] names, String[] types, Object[] values) {
            if (names.length != types.length || names.length != values.length || names.length > 1024)
                throw new IllegalArgumentException("Invalid Java local snapshot");
            this.names = names;
            this.types = types;
            this.values = new Object[values.length];
            this.kinds = new String[values.length];
            for (int i = 0; i < values.length; i++) {
                if (!(values[i] instanceof Captured)) throw new IllegalArgumentException("Missing Java static capture type");
                Captured captured = (Captured) values[i];
                this.values[i] = captured.value;
                this.kinds[i] = captured.kind;
            }
        }
        int handle(Object value) {
            for (int i = 0; i < handles.size(); i++) if (handles.get(i) == value) return i + 1;
            if (handles.size() >= 4096) return 0;
            handles.add(value);
            return handles.size();
        }
        int length(Object value) {
            if (value instanceof Object[]) return ((Object[]) value).length;
            if (value instanceof int[]) return ((int[]) value).length;
            if (value instanceof long[]) return ((long[]) value).length;
            if (value instanceof byte[]) return ((byte[]) value).length;
            if (value instanceof short[]) return ((short[]) value).length;
            if (value instanceof char[]) return ((char[]) value).length;
            if (value instanceof boolean[]) return ((boolean[]) value).length;
            if (value instanceof float[]) return ((float[]) value).length;
            if (value instanceof double[]) return ((double[]) value).length;
            return -1;
        }
        Inspectable fields(Object value) {
            if (!(value instanceof Inspectable)) return null;
            // A proxy can discover the generated interface at runtime and dispatch
            // its methods into a user InvocationHandler. Proxy classes extend Proxy
            // directly; test trusted class metadata before dispatch, without linking
            // java.lang.reflect.Proxy (absent from the pinned browser SDK).
            Class<?> parent = value.getClass().getSuperclass();
            if (parent != null && parent.getName().equals("java.lang.reflect.Proxy")) return null;
            Inspectable fields = (Inspectable) value;
            // An uninstrumented anonymous subclass must not inherit a partial inspector.
            return fields.${e}_fieldOwner() == value.getClass() ? fields : null;
        }
        Object element(Object value, int index) {
            if (value instanceof Object[]) return ((Object[]) value)[index];
            if (value instanceof int[]) return ((int[]) value)[index];
            if (value instanceof long[]) return ((long[]) value)[index];
            if (value instanceof byte[]) return ((byte[]) value)[index];
            if (value instanceof short[]) return ((short[]) value)[index];
            if (value instanceof char[]) return ((char[]) value)[index];
            if (value instanceof boolean[]) return ((boolean[]) value)[index];
            if (value instanceof float[]) return ((float[]) value)[index];
            if (value instanceof double[]) return ((double[]) value)[index];
            throw new IllegalArgumentException("Java object has no indexed children");
        }
        String scalarType(Object value) {
            if (value instanceof String) return "java.lang.String";
            if (value instanceof Boolean) return "boolean";
            if (value instanceof Character) return "char";
            if (value instanceof Byte) return "byte";
            if (value instanceof Short) return "short";
            if (value instanceof Integer) return "int";
            if (value instanceof Long) return "long";
            if (value instanceof Float) return "float";
            if (value instanceof Double) return "double";
            return value == null ? "null" : value.getClass().getName();
        }
        String scalar(Object value) {
            if (value instanceof String) return (String) value;
            if (value instanceof Boolean) return Boolean.toString(((Boolean) value).booleanValue());
            if (value instanceof Character) return Integer.toString(((Character) value).charValue());
            if (value instanceof Byte) return Byte.toString(((Byte) value).byteValue());
            if (value instanceof Short) return Short.toString(((Short) value).shortValue());
            if (value instanceof Integer) return Integer.toString(((Integer) value).intValue());
            if (value instanceof Long) return Long.toString(((Long) value).longValue());
            if (value instanceof Float) return Float.toString(((Float) value).floatValue());
            if (value instanceof Double) return Double.toString(((Double) value).doubleValue());
            return null;
        }
        String describe(String name, String declaredType, Object value) {
            String type = declaredType.equals("var") || declaredType.length() == 0 ? scalarType(value) : declaredType;
            String display;
            int reference = 0;
            int size = length(value);
            Inspectable fields = fields(value);
            if (value == null) display = "null";
            else if (value instanceof String) {
                String text = (String) value;
                display = quote(text.length() > 1024 ? text.substring(0, 1024) + "…" : text);
            } else if (value instanceof Character) {
                String text = quote(String.valueOf(((Character) value).charValue()));
                display = "'" + text.substring(1, text.length() - 1).replace("'", "\\'") + "'";
            }
            else if (scalar(value) != null) display = scalar(value);
            else if (size >= 0) {
                reference = handle(value);
                display = value.getClass().getName() + " (" + size + ")";
            } else {
                int identity = handle(value);
                if (fields != null) reference = identity;
                display = value.getClass().getName() + "@" + identity;
            }
            return "{\"name\":" + quote(name) + ",\"type\":" + quote(type)
                + ",\"value\":" + quote(display) + ",\"variablesReference\":" + reference
                + (size >= 0 ? ",\"indexedVariables\":" + size : "")
                + (fields != null ? ",\"namedVariables\":" + fields.${e}_fieldCount() : "") + "}";
        }
        String variables(int reference, int start, int count) {
            if (start < 0 || count < 0 || count > 1000 || reference < 0 || reference > handles.size())
                throw new IllegalArgumentException("Invalid Java variable page");
            Object target = reference == 0 ? null : handles.get(reference - 1);
            Inspectable fields = fields(target);
            int size = reference == 0 ? names.length : fields == null ? length(target) : fields.${e}_fieldCount();
            if (size < 0) throw new IllegalArgumentException("Java object has no inspectable children");
            StringBuilder result = new StringBuilder("[");
            int end = start >= size ? size : start + Math.min(count, size - start);
            for (int i = start; i < end; i++) {
                if (i > start) result.append(',');
                String type = reference == 0 && types[i].equals("var")
                    ? (kinds[i].equals("reference") ? (values[i] == null ? "null" : values[i].getClass().getName()) : kinds[i])
                    : reference == 0 ? types[i] : "";
                if (reference == 0) result.append(describe(names[i], type, values[i]));
                else if (fields != null) {
                    Field field = fields.${e}_field(i);
                    result.append(describe(field.name, field.type, field.value));
                } else result.append(describe("[" + i + "]", "", element(target, i)));
            }
            return result.append(']').toString();
        }
        String context() {
            StringBuilder result = new StringBuilder("{\"bindings\":[");
            int written = 0;
            for (int i = 0; i < names.length; i++) {
                if (names[i].equals("this")) continue;
                if (written++ > 0) result.append(',');
                Object value = values[i];
                String type = kinds[i].equals("reference") ? types[i] : kinds[i];
                String text = scalar(value);
                String unavailable = null;
                if (kinds[i].equals("reference")) unavailable = "Live Java reference expressions are not supported";
                else if (value instanceof String && ((String) value).length() > 65536) unavailable = "Java String exceeds the evaluation snapshot limit";
                result.append("{\"name\":").append(quote(names[i])).append(",\"type\":").append(quote(type))
                    .append(",\"value\":").append(quote(unavailable == null ? text : null));
                if (unavailable != null) result.append(",\"unavailable\":").append(quote(unavailable));
                result.append('}');
                if (result.length() > 900000) throw new IllegalArgumentException("Java evaluation context exceeds its limit");
            }
            return result.append("]}").toString();
        }
    }
}
`}}new TextEncoder;const et=new TextDecoder(`utf-8`,{fatal:!0});function tt(e,t,n,r=`Lua`){let i=new Int32Array(e,0,4);if(!Ke(i)||e.byteLength!==65552)throw Error(`Invalid ${r} debugger command buffer.`);for(;;){let a=Atomics.load(i,0);if(Atomics.load(i,2))return null;let o=Atomics.load(i,1);if(o<0||o>65536)throw Error(`Invalid ${r} debugger command length.`);if(o){let t=et.decode(new Uint8Array(e,16,o).slice());return Atomics.store(i,1,0),n(),t}if(!t)return``;Atomics.wait(i,0,a)}}function nt(e,t,n,r,i=()=>{}){let a=new Map(e.map(e=>[e.path,e])),o=t.debugPath?.endsWith(`/${t.activePath}`)?t.debugPath.slice(0,-t.activePath.length):``,s=e=>e===t.activePath?t.debugPath||e:`${o}${e}`,c=/* @__PURE__ */ new Map,l=t.pauseOnEntry?`entry`:`continue`,u=0,d=``,f=0,p=0,m=!1,h=0,g,_,v,y=/* @__PURE__ */ new Set,b=()=>h*1e5+1,x=e=>{if(!Array.isArray(e)||e.length>1e3)throw Error(`Invalid Java variable response`);return e.map(e=>{if(!e||typeof e.name!=`string`||typeof e.value!=`string`||typeof e.type!=`string`||!Number.isSafeInteger(e.variablesReference)||e.variablesReference<0||e.variablesReference>4096||e.indexedVariables!==void 0&&(!Number.isSafeInteger(e.indexedVariables)||e.indexedVariables<0)||e.namedVariables!==void 0&&(!Number.isSafeInteger(e.namedVariables)||e.namedVariables<0||e.namedVariables>257))throw Error(`Invalid Java variable descriptor`);let t=e.variablesReference?b()+e.variablesReference:0;return t&&y.add(t),{name:e.name,value:e.value,type:e.type,variablesReference:t,...e.indexedVariables===void 0?{}:{indexedVariables:e.indexedVariables},...e.namedVariables===void 0?{}:{namedVariables:e.namedVariables}}})},S=(t,r)=>{if(!Array.isArray(r)||r.length>1024||r.some(e=>!Number.isSafeInteger(e)||e<1))throw Error(`Invalid Java breakpoint lines`);let i=e.find(e=>s(e.path)===t),a=[...new Set(i?.locations.map(e=>e.line)??[])].sort((e,t)=>e-t),o=[...new Set(r)].map(e=>{let t=a.find(t=>t>=e);return{requestedLine:e,line:t??e,verified:t!==void 0,...t===void 0?{message:`No instrumented Java statement at or after this line`}:{}}});c.set(t,new Set(o.filter(e=>e.verified).map(e=>e.line))),n({type:`breakpoints`,sourcePath:t,sourceContentSha256:i?.sourceContentSha256,breakpoints:o})},C=e=>{let t=r(e);if(t===null)throw Error(`Java debugger stopped`);return t?JSON.parse(t):null},w=e=>{e.op===`breakpoints`?S(e.sourcePath,e.lines):e.op===`pause`&&(m=!0)},T=(e,t)=>{Number.isSafeInteger(e.id)&&e.id>0&&Number.isSafeInteger(e.stopId)&&i({id:e.id,stopId:e.stopId,error:t})},E=()=>{for(;;){let e=C(!0);if(e){if(e.op===`control`){if(![`continue`,`stepInto`,`nextLine`,`stepOut`].includes(e.command))throw Error(`Invalid Java debugger control`);return l=e.command,g=void 0,_=void 0,y.clear(),v=void 0,n({type:`resume`,command:l}),null}if(e.op===`breakpoints`||e.op===`pause`){w(e);continue}if(!Number.isSafeInteger(e.id)||e.id<1||e.id>2147483647||e.stopId!==h){T(e,`Java inspection request belongs to an earlier stop`);continue}if(e.op===`scopes`){i({id:e.id,stopId:h,value:e.frameId===g&&_?[_]:[]});continue}if(e.op===`context`){if(e.frameId!==g){T(e,`Java values are available only for the currently stopped frame`);continue}return v={id:e.id,stopId:h,op:e.op},{op:e.op,id:e.id,stopId:h}}if(e.op===`variables`){let{reference:t,start:n=0,count:r=50}=e;if(!y.has(t)||!Number.isSafeInteger(n)||n<0||!Number.isSafeInteger(r)||r<0||r>1e3){T(e,`Invalid or stale Java variable page`);continue}return v={id:e.id,stopId:h,op:e.op},{op:e.op,id:e.id,stopId:h,reference:t-b(),start:n,count:r}}T(e,`Unsupported Java inspection request`)}}};S(s(t.activePath),t.breakpoints);for(let e of t.sourceBreakpoints??[])S(e.sourcePath,e.lines);return{poll(e,t,n){if(!a.has(e))throw Error(`Unknown Java debugger source`);for(let e;e=C(!1);)e.op===`breakpoints`||e.op===`pause`?w(e):T(e,`Java inspection requires a paused frame`);return m||l!==`continue`||c.get(s(e))?.has(t)?{}:null},pause(t,r,i,a,o,S=`[]`,C=0){if(a.length>1e6||!Number.isSafeInteger(o)||o<1)throw Error(`Invalid Java debugger stack`);let w=JSON.parse(a);if(!Array.isArray(w)||w.length>64)throw Error(`Invalid Java debugger stack`);let T=[];for(let t of w){if(!Array.isArray(t)||t.length!==4||typeof t[0]!=`string`||typeof t[1]!=`string`||typeof t[2]!=`string`||!Number.isSafeInteger(t[3]))continue;let n=t[0].slice(0,Math.max(0,t[0].lastIndexOf(`.`))).replaceAll(`.`,`/`),r=n?`${n}/${t[2]}`:t[2],i=e.filter(e=>e.path.split(`/`).pop()===t[2]),a=i.filter(e=>e.path===r||e.path.endsWith(`/${r}`)),o=a.length===1?a[0]:i.length===1?i[0]:void 0;!o||t[3]<1||t[3]>o.lineCount||T.push({functionName:`${t[0]}.${t[1]}`,line:t[3],sourcePath:s(o.path),sourceContentSha256:o.sourceContentSha256})}let D=T[0];if(!D||D.sourcePath!==s(t))throw Error(`The Java runtime could not provide the current source stack`);let O=c.get(s(t))?.has(r)===!0,k=t!==d||r!==f||o!==u||i===p;if(!m&&!O&&!(l===`entry`||l===`stepInto`&&k||l===`nextLine`&&o<=u&&k||l===`stepOut`&&o<u))return null;let A=m?`pause`:O?`breakpoint`:l===`entry`?`entry`:l===`stepInto`?`step`:l===`stepOut`?`stepOut`:`nextLine`;if(m=!1,h++,h>2147483647||S.length>1e6||!Number.isSafeInteger(C)||C<0||C>1024)throw Error(`Invalid Java local snapshot`);y.clear(),v=void 0;let j=x(JSON.parse(S));return T.forEach((e,t)=>{e.id=h*100+t+1}),D.line=r,D.column=i,g=D.id,_={name:`Locals`,variablesReference:b(),namedVariables:C,expensive:!1,variables:j},y.add(b()),u=o,d=t,f=r,p=i,n({type:`pause`,reason:A,line:r,sourcePath:D.sourcePath,sourceContentSha256:D.sourceContentSha256,frameId:D.id,threadId:1,locals:j,scopes:[_],callStack:T,capabilities:{readMemory:!1,writeMemory:!1,dataBreakpoints:!1}},h),E()},reply(e,t,n,r){let a=v;if(!a||a.id!==e||a.stopId!==t||!_)throw Error(`Java inspection reply belongs to an earlier request`);v=void 0;try{if(r)i({id:e,stopId:t,error:r});else{if(typeof n!=`string`||n.length>1e6)throw Error(`Invalid Java inspection response`);let r=JSON.parse(n);i({id:e,stopId:t,value:a.op===`variables`?x(r):r})}}catch(n){i({id:e,stopId:t,error:n instanceof Error?n.message:`Unable to inspect Java values`})}return E()}}}const I=e=>e.reason??new DOMException(`Runtime asset load aborted`,`AbortError`),rt=(e,t)=>{try{Promise.resolve(e.cancel(t)).catch(()=>void 0)}catch{}};async function it(e,{asset:t,maxAssetBytes:n,total:r,signal:i,onProgress:a}){let o=()=>/* @__PURE__ */ Error(`Runtime asset ${t} exceeds the ${n} byte limit`);try{if(!Number.isSafeInteger(n)||n<=0)throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);if(r!==void 0&&(!Number.isSafeInteger(r)||r<0))throw TypeError(`Runtime asset total must be a non-negative safe integer`);if(r!==void 0&&r>n)throw o();if(i?.aborted)throw I(i)}catch(t){throw e.body&&rt(e.body,t),t}let s=e.headers.get(`content-type`),c={status:200,headers:s?{"Content-Type":s}:void 0};if(!e.body){let t,s=i?new Promise((e,n)=>{t=()=>n(I(i)),i.addEventListener(`abort`,t,{once:!0})}):void 0;try{let t=e.arrayBuffer(),l=s?await Promise.race([t,s]):await t;if(i?.aborted)throw I(i);if(l.byteLength>n)throw o();if(a?.(l.byteLength,r??l.byteLength),i?.aborted)throw I(i);return new Response(l,c)}finally{t&&i?.removeEventListener(`abort`,t)}}let l=e.body.getReader(),u=!1,d=!1,f=0,p,m=()=>{d||(d=!0,l.releaseLock())},h=()=>i?.removeEventListener(`abort`,v),g=e=>{if(!u){u=!0,h(),rt(l,e);try{m()}catch{}}},_=e=>{u||(g(e),p.error(e))},v=()=>{i&&_(I(i))},y=new ReadableStream({start(e){p=e,i?.addEventListener(`abort`,v,{once:!0}),i?.aborted&&v()},async pull(e){if(!u)try{let{done:t,value:s}=await l.read();if(u)return;if(i?.aborted)throw I(i);if(t){if(m(),a?.(f,r??f),u)return;u=!0,h(),e.close();return}if(!s)return;let c=f+s.byteLength;if(!Number.isSafeInteger(c)||c>n)throw o();f=c,a?.(f,r),u||e.enqueue(s)}catch(e){_(i?.aborted?I(i):e)}},cancel(e){g(e)}},{highWaterMark:0});return new Response(y,c)}const at=new TextDecoder,ot=globalThis.fetch.bind(globalThis),st=globalThis.XMLHttpRequest;let L=null,R=null,ct=/* @__PURE__ */ new Map,lt=!1,ut=0;const dt=/* @__PURE__ */ new Map,z=/* @__PURE__ */ new Map,B=(e,t)=>{try{Promise.resolve(e.body?.cancel(t)).catch(()=>void 0)}catch{}},ft=()=>{if(!L)return null;let e=globalThis.location?.origin,t=globalThis.location?.href,n=e&&e!==`null`?`${e}/`:t?.startsWith(`blob:`)?t.slice(5):t||`http://localhost/`,r;try{r=new URL(L.baseUrl,n)}catch{throw Error(`Runtime asset base URL is invalid: ${L.baseUrl}`)}if(r.protocol!==`http:`&&r.protocol!==`https:`)throw Error(`Runtime asset base URL must use HTTP(S): ${L.baseUrl}`);if(r.username||r.password||r.hash||r.search)throw Error(`Runtime asset base URL must not include credentials, a query, or a fragment: ${L.baseUrl}`);return r.pathname.endsWith(`/`)||(r.pathname+=`/`),r},pt=e=>{let t=e.buffer;return e.byteOffset===0&&e.byteLength===t.byteLength?t:t.slice(e.byteOffset,e.byteOffset+e.byteLength)},mt=e=>{let t=ft();if(!t)return null;try{return typeof e==`string`?new URL(e,t).href:e instanceof URL?e.href:e.url}catch{return null}},ht=e=>{if(!R)return!1;let t;try{t=new URL(e)}catch{return!1}return t.protocol===R.protocol&&t.origin===R.origin&&t.pathname.startsWith(R.pathname)},gt=e=>{let t=ft();if(!t)return null;let n;try{n=new URL(e,t)}catch{return null}return n.protocol!==`http:`&&n.protocol!==`https:`||n.username||n.password||n.hash||/%2f|%5c/iu.test(n.pathname)?null:ct.get(n.href)||(ht(n.href)||n.origin!==t.origin||!n.pathname.startsWith(t.pathname)?null:`${n.pathname.slice(t.pathname.length)}${n.search}`)},_t=e=>gt(e)!==null,vt=async e=>{let t=++ut;return await new Promise((n,r)=>{dt.set(t,{resolve:n,reject:r}),self.postMessage({assetRequest:{id:t,asset:e}})})},yt=async(e,t,n,r)=>{let i=mt(e);if(!i||gt(i)!==t||!L)throw Error(`Untracked runtime asset request`);let a=L.maxAssetBytes??134217728;r?.throwIfAborted();let o=await ot(i,{credentials:`omit`,redirect:`error`,referrerPolicy:`no-referrer`,...n?{integrity:n}:{},...r?{signal:r}:{}});if(r?.aborted&&(B(o,r.reason),r.throwIfAborted()),o.url){let e;try{e=new URL(o.url)}catch{let e=/* @__PURE__ */ Error(`Runtime asset response URL is invalid: ${o.url}`);throw B(o,e),e}if(e.href!==i){let t=/* @__PURE__ */ Error(`Runtime asset response URL mismatch: expected ${i}, received ${e.href}`);throw B(o,t),t}}if(!o.ok){let e=/* @__PURE__ */ Error(`Failed to load ${t}: ${o.status}`);throw B(o,e),e}let s=o.headers.get(`content-length`),c;if(s!==null){let e=Number(s);if(!/^\d+$/u.test(s.trim())||!Number.isSafeInteger(e)){let e=/* @__PURE__ */ Error(`Runtime asset ${t} has an invalid Content-Length`);throw B(o,e),e}c=e||void 0}if(c!==void 0&&c>a){let e=/* @__PURE__ */ Error(`Runtime asset ${t} exceeds the ${a} byte limit`);throw B(o,e),e}let l=o.headers.get(`content-type`)||void 0;return{response:o,maxAssetBytes:a,total:c,mimeType:l}},bt=async(e,t,n)=>{let{response:r,maxAssetBytes:i,total:a,mimeType:o}=await yt(e,t,n);if(!r.body){let e=new Uint8Array(await r.arrayBuffer());if(e.byteLength>i)throw Error(`Runtime asset ${t} exceeds the ${i} byte limit`);return self.postMessage({assetProgress:{asset:t,loaded:e.byteLength,total:a??e.byteLength}}),{bytes:e,mimeType:o}}let s=r.body.getReader(),c=!1,l=e=>{if(!c){c=!0;try{Promise.resolve(s.cancel(e)).catch(()=>void 0)}catch{}}},u=0,d,f;try{for(d=new Uint8Array(a||Math.min(65536,i));;){let{done:e,value:n}=await s.read();if(e)break;if(!n)continue;let r=u+n.byteLength;if(r>i){let e=/* @__PURE__ */ Error(`Runtime asset ${t} exceeds the ${i} byte limit`);throw l(e),e}if(r>d.byteLength){let e=Math.min(i,Math.max(r,d.byteLength*2)),t=new Uint8Array(e);t.set(d.subarray(0,u)),d=t}d.set(n,u),u=r,self.postMessage({assetProgress:{asset:t,loaded:u,total:a}})}}catch(e){throw l(e),e}finally{try{s.releaseLock()}catch(e){f={error:e}}}if(f)throw f.error;return u!==d.byteLength&&(d=d.slice(0,u)),self.postMessage({assetProgress:{asset:t,loaded:u,total:a??u}}),{bytes:d,mimeType:o}};async function xt(e,t){let n=gt(e);if(!n||!L)throw Error(`Untracked runtime asset request`);return L.useAssetBridge?await vt(n):await bt(e,n,t)}function St(e){return new Response(pt(e.bytes),{status:200,headers:e.mimeType?{"Content-Type":e.mimeType}:void 0})}function Ct(){if(st===void 0)return;class e{responseType=``;response=null;responseText=``;readyState=0;status=0;statusText=``;timeout=0;withCredentials=!1;onload=null;onerror=null;onprogress=null;onreadystatechange=null;native=null;url=``;open(e,t){let n=mt(t);if(!n||!_t(n)){if(n&&ht(n))throw Error(`Untracked runtime asset request`);let r=n||(t instanceof URL?t.href:String(t));this.native=new st,this.native.responseType=this.responseType,this.native.timeout=this.timeout,this.native.withCredentials=this.withCredentials,this.native.onload=e=>{this.response=this.native?.response,this.responseText=this.native?.responseText||``,this.readyState=this.native?.readyState||0,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onload?.call(this,e)},this.native.onerror=e=>{this.readyState=this.native?.readyState||4,this.status=this.native?.status||0,this.statusText=this.native?.statusText||``,this.onreadystatechange?.call(this,e),this.onerror?.call(this,e)},this.native.onprogress=e=>{this.onprogress?.call(this,e)},this.native.onreadystatechange=e=>{this.readyState=this.native?.readyState||0,this.onreadystatechange?.call(this,e)},this.native.open(e,r);return}this.url=n,this.readyState=1,this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`))}setRequestHeader(e,t){this.native?.setRequestHeader(e,t)}async send(e){if(this.native){this.native.send(e);return}try{let e=await xt(this.url),t=pt(e.bytes);if(this.status=200,this.statusText=`OK`,this.readyState=4,this.responseType===`arraybuffer`)this.response=t;else if(this.responseType===`blob`)this.response=new Blob([t],{type:e.mimeType||`application/octet-stream`});else{let t=at.decode(e.bytes);this.responseText=t,this.response=t}let n=new ProgressEvent(`progress`,{lengthComputable:!0,loaded:e.bytes.byteLength,total:e.bytes.byteLength});this.onprogress?.call(this,n),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onload?.call(this,new ProgressEvent(`load`))}catch(e){this.readyState=4,this.status=0,this.statusText=e instanceof Error?e.message:String(e),this.onreadystatechange?.call(this,new ProgressEvent(`readystatechange`)),this.onerror?.call(this,new ProgressEvent(`error`))}}abort(){this.native?.abort()}getAllResponseHeaders(){return this.native?.getAllResponseHeaders()||``}getResponseHeader(e){return this.native?.getResponseHeader(e)||null}}globalThis.XMLHttpRequest=e}function wt(){lt||(lt=!0,globalThis.fetch=(async(e,t)=>{let n=mt(e);if(!n||!_t(n)){if(n&&ht(n))throw Error(`Untracked runtime asset request`);return ot(e,t)}let r=typeof Request<`u`&&e instanceof Request?e:void 0,i=t?.integrity??r?.integrity,a=typeof i==`string`?i:void 0,o=(t?.method??r?.method??`GET`).toUpperCase();if(L?.useAssetBridge===!1&&o===`GET`&&new URL(n).pathname.endsWith(`.wasm`)){let e=gt(n),i=(t?.signal===void 0?r?.signal:t.signal)??void 0,{response:o,maxAssetBytes:s,total:c}=await yt(n,e,a,i);return it(o,{asset:e,maxAssetBytes:s,total:c,signal:i,onProgress:(t,n)=>self.postMessage({assetProgress:{asset:e,loaded:t,total:n}})})}return St(await xt(n,a))}),Ct())}function Tt(e){if(e?.maxAssetBytes!==void 0&&(!Number.isSafeInteger(e.maxAssetBytes)||e.maxAssetBytes<=0))throw TypeError(`Runtime asset maxAssetBytes must be a positive safe integer`);for(let e of z.values())e.reject(/* @__PURE__ */ Error(`Runtime module configuration changed`));z.clear(),R=null,ct=/* @__PURE__ */ new Map,L=e,wt()}function Et(e){let t=e?.assetResponse;if(!t)return!1;let n=z.get(t.id);if(n)return z.delete(t.id),t.ok?t.module instanceof WebAssembly.Module?n.resolve(t.module):n.reject(/* @__PURE__ */ Error(`Runtime module response is invalid`)):n.reject(Error(t.error||`Runtime module request failed`)),!0;let r=dt.get(t.id);return!r||(dt.delete(t.id),t.ok?(r.resolve({bytes:new Uint8Array(t.bytes),mimeType:t.mimeType||void 0}),!0):(r.reject(Error(t.error||`Runtime asset request failed`)),!0))}async function V(e){if(!L)throw Error(`Runtime asset config unavailable`);let t=mt(e);if(!t||!_t(t))throw Error(`Untracked runtime asset request`);return await xt(t)}let H=null,Dt=null,Ot=null,kt=``,U=null,At=``,jt=``,Mt=``,Nt=``,W=null,G=null,K=!1,q=[],Pt=``,J=[],Ft=!1,Y=[];const X=/* @__PURE__ */ new Map,It=16777216;let Lt=0,Z=/* @__PURE__ */ new Set;const Rt=new TextDecoder,zt=e=>new Int8Array(e.buffer.slice(e.byteOffset,e.byteOffset+e.byteLength)),Q=()=>U?.flush(),$=Q,Bt=e=>U?.write(e),Vt=Bt;self.addEventListener(`message`,async e=>{if(Et(e.data))return;let{load:t,assets:n,buffer:r,code:s,prepare:c,debugMode:l,cacheEvaluationArtifacts:u,javaDebug:h,args:g=[],stdin:_=``,hasExplicitStdin:v=!1,activePath:y,workspaceFiles:b=[]}=e.data;try{if(t){let e=n;Tt(e||null);let t=e?.baseUrl||``,r=e?.streamCompiler===!0;if(!H||kt!==t){let[n,o,s,c]=await Promise.all([(async()=>{let[n,o]=await Promise.all([(async()=>{let e=Rt.decode((await V(`compiler.wasm-runtime.js`)).bytes);K=r,K&&(e=a(e));let t=URL.createObjectURL(new Blob([e],{type:`text/javascript;charset=utf-8`}));try{return await import(
/* @vite-ignore */
t)}finally{URL.revokeObjectURL(t)}})(),(async()=>{let n=r?await i(t,e?.maxAssetBytes??134217728):void 0;return n?{bytes:n}:V(`compiler.wasm`)})()]),s=n.load,c=await s(o.bytes,{stackDeobfuscator:{enabled:!1}});return{load:s,lib:c.exports,compiler:c.exports.createCompiler()}})(),V(`compile-classlib-teavm.bin`).then(({bytes:e})=>zt(e)),V(`runtime-classlib-teavm.bin`).then(({bytes:e})=>zt(e)),V(`compiler.wasm-deobfuscator.wasm`).then(async({bytes:e})=>{let t=await WebAssembly.compile(e,{builtins:[`js-string`]});return r?t:Uint8Array.from(e)})]);n.compiler.setSdk(o),n.compiler.setTeaVMClasslib(s),n.lib,H=n.compiler,Dt=n.load,Ot=c,kt=t,At=``,jt=``,Mt=``,Nt=``,W=null,G=null,q=[],Pt=``,J=[],Ft=!1,Y=[],X.clear(),Lt=0,Z=/* @__PURE__ */ new Set}self.postMessage({load:!0});return}if(!H||!Dt||!Ot)throw Error(`TeaVM compiler not loaded`);U?.close(),U=o(e=>self.postMessage({output:e}));let e=v===!0,x=d(s),S=p(s,y),C=typeof y==`string`&&y?y:S.sourcePath,w=C.split(`/`).pop()||C;if(!Array.isArray(b)||!b.every(e=>e&&typeof e.path==`string`&&(typeof e.content==`string`||e.content instanceof Uint8Array)))throw Error(`Invalid Java workspace files`);let T=new TextDecoder(`utf-8`,{fatal:!0}),E=b.map(e=>({path:e.path,content:typeof e.content==`string`?e.content:T.decode(e.content)})),D=l===`trace`;if(l&&l!==`none`&&!D)throw Error(`Java supports the trace debugger backend`);let O=Pt!==C||J.length!==E.length||J.some((e,t)=>e.path!==E[t]?.path||e.content!==E[t]?.content);if(x.usesStdin&&x.helperSourcePath&&(C===x.helperSourcePath||E.some(e=>e.path===x.helperSourcePath)))throw Error(`Java workspace conflicts with generated stdin helper: ${x.helperSourcePath}`);let k=u===!0&&K&&!D&&E.length===0?JSON.stringify([s,C,x.stdinCacheKey]):void 0,A=k?X.get(k):void 0;if(k&&A&&(X.delete(k),X.set(k,A),At=s,jt=x.stdinCacheKey,Mt=A.mainClass,Nt=A.formatter,W=A.wasm,G=A.module,q=A.diagnostics,Pt=C,J=[],Ft=!1,Y=[]),At!==s||Ft!==D||jt!==x.stdinCacheKey||!A&&O||!W){W=null,G=null,q=[],Y=[],Z=new Set([C,...E.map(e=>e.path)].flatMap(e=>[e,e.split(`/`).pop()||e]));let e=x.transformedCode,t=E,n,r=[];if(D){let{instrumentJavaDebugSource:i}=await import(`./chunks/ckZeTOMe.js`),a=[{path:C,content:s},...E],o;do o=crypto.randomUUID().replaceAll(`-`,``);while(a.some(e=>e.content.includes(o)||e.path.includes(o)));n=$e(`WasmIdleJavaDebug_${o}`,`wasm_idle_debug_${o}`);let c=[];for(let e of a){if(e.path!==C&&!e.path.endsWith(`.java`)){c.push(e);continue}let t=i(e.content,e.path,n.qualifiedName),a=new Uint8Array(await crypto.subtle.digest(`SHA-256`,new TextEncoder().encode(e.content)));r.push({path:e.path,sourceContentSha256:[...a].map(e=>e.toString(16).padStart(2,`0`)).join(``),lineCount:e.content.trimEnd().split(/\r\n|\r|\n/).length,locations:t.locations}),c.push({path:e.path,content:t.code})}e=d(c[0].content).transformedCode,t=c.slice(1)}let i=[],a=[],o=!1,c=H.onDiagnostic(e=>{let t=e.severity?String(e.severity).toLowerCase():`error`,n=e.fileName?`${e.fileName}:${e.lineNumber||0}${e.columnNumber?`:${e.columnNumber}`:``}`:`TeaVM`;if(i.push(`${n}: ${t}: ${e.message}`),o)return;let r=e.fileName?String(e.fileName):null;if(r&&!Z.has(r))return;let s={diagnostic:{fileName:r,lineNumber:Number(e.lineNumber)||1,columnNumber:Number(e.columnNumber)||1,severity:t===`warning`?`warning`:t===`other`?`other`:`error`,message:String(e.message||``)}};a.push(s),self.postMessage(s)}),l=()=>{if(typeof c==`function`){c();return}c?.destroy?.()};H.clearSourceFiles?.(),H.clearInputClassFiles?.(),H.clearOutputFiles?.(),H.addSourceFile(w,e);for(let e of t)H.addSourceFile(e.path.split(`/`).pop()||e.path,e.content);if(n&&H.addSourceFile(n.sourceFileName,n.source),x.usesStdin&&x.helperSourcePath&&x.helperSource&&(H.addSourceFile(x.helperSourcePath.split(`/`).pop()||x.helperSourcePath,x.helperSource),Z.add(x.helperSourcePath),Z.add(x.helperSourcePath.split(`/`).pop()||x.helperSourcePath)),!H.compile())throw l(),Error(i.join(`
`)||`TeaVM javac compilation failed`);let u=Array.from(H.detectMainClasses());if(u.length!==1)throw l(),Error(u.length===0?`Main method not found`:`Multiple main methods found`);let f=u[0].replaceAll(`/`,`.`),p=Array.from(H.listOutputFiles()),h;try{h=We(new Uint8Array(H.getOutputFile(`${f.replaceAll(`.`,`/`)}.class`)))}catch(e){throw l(),e}let g=m(f,[s,...E.map(e=>e.content),x.helperSource||``],p,h);for(let e of p)e.endsWith(`.class`)&&H.addClassFile(e,H.getOutputFile(e));H.clearSourceFiles(),H.addSourceFile(g.sourceFileName,g.source),H.addSourceFile(g.formatterSourceFileName,g.formatterSource);let _;try{o=!0,_=H.compile()}finally{o=!1}if(!_)throw l(),Error(i.join(`
`)||`Java exception bridge compilation failed`);let v=H.generateWebAssembly({outputName:`app`,mainClass:g.mainClass});if(l(),!v)throw Error(i.join(`
`)||`TeaVM WebAssembly generation failed`);let y=new Uint8Array(H.getWebAssemblyOutputFile(`app.wasm`)),b=K?await WebAssembly.compile(y,{builtins:[`js-string`]}):null;if(At=s,jt=x.stdinCacheKey,Mt=f,Nt=g.formatExport,W=y,G=b,Pt=C,J=E.map(e=>({...e})),Ft=D,Y=r,q=a,k&&b){let e=y.byteLength+k.length*2+JSON.stringify(a).length*2;if(e<=It){for(;X.size>=8||Lt+e>It;){let e=X.keys().next().value;Lt-=X.get(e).bytes,X.delete(e)}X.set(k,{wasm:y,module:b,mainClass:f,formatter:g.formatExport,diagnostics:a,bytes:e}),Lt+=e}}}else for(let e of q)self.postMessage(e);if(c){self.postMessage({results:!0});return}let j=new Int32Array(r),ee=f(_,e,()=>(Q(),$(),Qe(j,()=>self.postMessage({buffer:!0})))),M=globalThis,N=M.window,te=Object.prototype.hasOwnProperty.call(M,`wasmIdleJavaStdin`),ne=M.wasmIdleJavaStdin,re=Object.prototype.hasOwnProperty.call(M,`wasmIdleJavaOutput`),ie=M.wasmIdleJavaOutput,ae=Object.prototype.hasOwnProperty.call(M,`wasmIdleJavaDebug`),oe=M.wasmIdleJavaDebug,P=Error,se=Object.getOwnPropertyDescriptor(P,`stackTraceLimit`);M.window=M,M.wasmIdleJavaStdin=ee,M.wasmIdleJavaOutput={flush:()=>U?.flush()};try{if(D){if(!h)throw Error(`Java debugger command transport is missing`);typeof P.stackTraceLimit==`number`&&(P.stackTraceLimit=1/0),M.wasmIdleJavaDebug=nt(Y,{activePath:C,debugPath:h.sourcePath,breakpoints:h.breakpoints??[],sourceBreakpoints:h.sourceBreakpoints,pauseOnEntry:h.pauseOnEntry!==!1},(e,t)=>{e.type===`pause`&&(Q(),$()),self.postMessage({javaDebug:{event:e,stopId:t}})},e=>(e||U?.flushIfDue(),tt(h.buffer,e,()=>self.postMessage({javaDebug:{consumed:!0}}),`Java`)),e=>self.postMessage({javaDebug:{response:e}}))}let e=await Dt(G??W,{installImports(e){e.teavmConsole.putcharStdout=Bt,e.teavmConsole.putcharStderr=Vt},stackDeobfuscator:{enabled:!0,path:Ot,infoLocation:`embedded`}});self.postMessage({progress:{kind:`ready`,state:`running`,reason:`started`,label:`Java program started`}});try{e.exports.main(g)}catch(t){let n;try{n=e.exports[Nt](t)}catch{}throw typeof n==`string`&&n?Error(n):t}Q(),$(),self.postMessage({results:!0,mainClass:Mt})}finally{ee.dispose(),re?M.wasmIdleJavaOutput=ie:delete M.wasmIdleJavaOutput,ae?M.wasmIdleJavaDebug=oe:delete M.wasmIdleJavaDebug,se?Object.defineProperty(P,"stackTraceLimit",se):Reflect.deleteProperty(P,`stackTraceLimit`),te?M.wasmIdleJavaStdin=ne:delete M.wasmIdleJavaStdin,N===void 0?Reflect.deleteProperty(M,`window`):M.window=N}}catch(e){Q(),$(),self.postMessage({error:e instanceof Error?e.message:String(e)})}finally{U?.close(),U=null}});