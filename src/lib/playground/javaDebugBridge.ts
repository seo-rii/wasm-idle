/** Hooks call genuine Java Throwable stack inspection and the existing TeaVM JSO overlay. */
export function createJavaDebugBridge(className: string, packageName = 'wasm_idle_debug') {
	if (![className, packageName].every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
		throw new Error('Invalid Java debugger helper name');
	return {
		qualifiedName: `${packageName}.${className}`,
		sourceFileName: `${className}.java`,
		source: String.raw`package ${packageName};
import org.teavm.jso.JSObject;
import org.teavm.jso.browser.Window;
import org.teavm.jso.core.JSFunction;
import org.teavm.jso.core.JSMapLike;
import org.teavm.jso.core.JSString;
import org.teavm.jso.core.JSNumber;
import java.lang.String;
import java.lang.StringBuilder;
import java.lang.Throwable;
import java.lang.StackTraceElement;

public final class ${className} {
    private static String quote(String value) {
        if (value == null) return "null";
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"")
            .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t") + "\"";
    }
    public static void hit(String source, int line, int column) {
        Window window = Window.current();
        if (window == null) return;
        JSMapLike<JSObject> globals = window.cast();
        JSObject target = globals.get("wasmIdleJavaDebug");
        if (target == null) return;
        JSMapLike<JSObject> methods = target.cast();
        JSFunction poll = methods.get("poll").cast();
        if (poll.call(target, JSString.valueOf(source), JSNumber.valueOf(line), JSNumber.valueOf(column)) == null) return;
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
        pause.call(target, JSString.valueOf(source), JSNumber.valueOf(line), JSNumber.valueOf(column), JSString.valueOf(result.toString()), JSNumber.valueOf(frames.length));
    }
}
`
	};
}
