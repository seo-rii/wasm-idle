const JAVA_STDIN_HELPER_CLASS = 'WasmIdleStdin';
const JAVA_SCANNER_COMPAT_SENTINEL = '// wasm-idle Scanner compatibility shim';
const JAVA_SCANNER_COMPAT_SHIM = `${JAVA_SCANNER_COMPAT_SENTINEL}
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
}`;
export interface PreparedJavaStdinInjection {
	usesStdin: boolean;
	stdinCacheKey: string;
	transformedCode: string;
	helperSourcePath: string | null;
	helperSource: string | null;
}

export const prepareJavaStdinInjection = (
	code: string,
	stdin: string
): PreparedJavaStdinInjection => {
	const usesStdin = code.includes('System.in');
	const usesScanner =
		/\bScanner\b/.test(code) &&
		!code.includes(JAVA_SCANNER_COMPAT_SENTINEL) &&
		!/\b(?:class|interface|enum|record)\s+Scanner\b/.test(code) &&
		!/^[ \t]*import[ \t]+(?!java\.util\.Scanner\b)(?!static\b)[\w.]+\.Scanner[ \t]*;[ \t]*$/m.test(
			code
		);
	if (!usesStdin) {
		if (!usesScanner) {
			return {
				usesStdin: false,
				stdinCacheKey: '',
				transformedCode: code,
				helperSourcePath: null,
				helperSource: null
			};
		}
		const transformedCode = code
			.replace(
				/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,
				(match) => match.replace(/[^\r\n]/g, ' ')
			)
			.replaceAll(/\bjava\.util\.Scanner\b/g, 'Scanner');
		return {
			usesStdin: false,
			stdinCacheKey: '',
			transformedCode: `${transformedCode.trimEnd()}\n\n${JAVA_SCANNER_COMPAT_SHIM}\n`,
			helperSourcePath: null,
			helperSource: null
		};
	}

	const packageMatch = code.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m);
	const packageName = packageMatch?.[1] || '';
	const helperSourcePath = packageName
		? `${packageName.replaceAll('.', '/')}/${JAVA_STDIN_HELPER_CLASS}.java`
		: `${JAVA_STDIN_HELPER_CLASS}.java`;
	let transformedCode = code.replaceAll('System.in', `${JAVA_STDIN_HELPER_CLASS}.open()`);
	if (usesScanner) {
		transformedCode = transformedCode
			.replace(
				/^[ \t]*import[ \t]+java\.util\.Scanner[ \t]*;[ \t]*$/gm,
				(match) => match.replace(/[^\r\n]/g, ' ')
			)
			.replaceAll(/\bjava\.util\.Scanner\b/g, 'Scanner');
		transformedCode = `${transformedCode.trimEnd()}\n\n${JAVA_SCANNER_COMPAT_SHIM}\n`;
	}
	const encodedBytes = [...new TextEncoder().encode(stdin)].join(', ');

	return {
		usesStdin: true,
		stdinCacheKey: stdin,
		transformedCode,
		helperSourcePath,
		helperSource: `${packageName ? `package ${packageName};\n\n` : ''}import java.io.InputStream;
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;

final class ${JAVA_STDIN_HELPER_CLASS} extends InputStream {
    private static final byte[] INITIAL_DATA = new byte[] { ${encodedBytes} };
    private static final ${JAVA_STDIN_HELPER_CLASS} INSTANCE = new ${JAVA_STDIN_HELPER_CLASS}();
    private int position = 0;

    private ${JAVA_STDIN_HELPER_CLASS}() {
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
`
	};
};
