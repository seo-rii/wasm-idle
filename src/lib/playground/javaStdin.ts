const JAVA_STDIN_HELPER_CLASS = 'WasmIdleStdin';
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
	if (!usesStdin) {
		return {
			usesStdin: false,
			stdinCacheKey: '',
			transformedCode: code,
			helperSourcePath: null,
			helperSource: null
		};
	}

	const packageMatch = code.match(/^\s*package\s+([A-Za-z_][\w.]*)\s*;/m);
	const packageName = packageMatch?.[1] || '';
	const helperSourcePath = packageName
		? `${packageName.replaceAll('.', '/')}/${JAVA_STDIN_HELPER_CLASS}.java`
		: `${JAVA_STDIN_HELPER_CLASS}.java`;
	const transformedCode = code.replaceAll('System.in', `${JAVA_STDIN_HELPER_CLASS}.open()`);
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
