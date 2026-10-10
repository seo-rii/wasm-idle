import { prepareJavaStdinInjection, type PreparedJavaStdinInjection } from './javaStdin';

/** Browser execution input is runtime data. Retain the snapshot API for standalone callers. */
export function prepareJavaRuntimeStdinInjection(code: string): PreparedJavaStdinInjection {
	const injection = prepareJavaStdinInjection(code, '', false);
	if (!injection.usesStdin || !injection.helperSourcePath) return injection;
	const parts = injection.helperSourcePath.split('/');
	const className = parts.pop()!.replace(/\.java$/, '');
	const packageName = parts.join('.');
	return {
		...injection,
		stdinCacheKey: 'host-chunks-v1',
		helperSource: `${packageName ? `package ${packageName};\n\n` : ''}import java.io.InputStream;
import org.teavm.jso.JSBody;

final class ${className} extends InputStream {
    private static final ${className} INSTANCE = new ${className}();
    private byte[] chunk = new byte[0];
    private int position = 0;
    private boolean ended = false;

    private ${className}() {}

    static InputStream open() {
        return INSTANCE;
    }

    // Normal copied byte[] conversion is supported by TeaVM Wasm GC; do not use @JSByRef.
    @JSBody(script = "var input = globalThis.wasmIdleJavaStdin; "
        + "if (!input) return null; "
        + "if (typeof input.readChunk === 'function') return input.readChunk(); "
        + "var value = input.readByte(); "
        + "return value < 0 ? null : new Int8Array([value]);")
    private static native byte[] readFromHost();

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
`
	};
}

/** Single cursor shared by compatibility byte reads and bounded block reads. */
export function createJavaStdinBridge(
	initialInput: string,
	explicit: boolean,
	readInput: () => string | null,
	maxChunkBytes = 4096
) {
	if (!Number.isSafeInteger(maxChunkBytes) || maxChunkBytes < 1) {
		throw new RangeError('Java stdin chunk size must be a positive safe integer');
	}
	const encoder = new TextEncoder();
	let bytes = encoder.encode(initialInput);
	let offset = 0;
	let ended = false;
	function ensureBytes() {
		while (offset === bytes.length && !ended) {
			const input = explicit ? null : readInput();
			bytes = input === null ? new Uint8Array(0) : encoder.encode(input);
			offset = 0;
			ended = input === null;
		}
		return offset < bytes.length;
	}
	function releaseConsumed() {
		if (offset === bytes.length) {
			bytes = new Uint8Array(0);
			offset = 0;
		}
	}
	return {
		readByte() {
			if (!ensureBytes()) return -1;
			const value = bytes[offset++];
			releaseConsumed();
			return value;
		},
		readChunk(): Int8Array | null {
			if (!ensureBytes()) return null;
			const count = Math.min(maxChunkBytes, bytes.length - offset);
			const chunk = new Int8Array(bytes.buffer, bytes.byteOffset + offset, count);
			offset += count;
			releaseConsumed();
			return chunk;
		},
		dispose() {
			bytes = new Uint8Array(0);
			offset = 0;
			ended = true;
		}
	};
}
