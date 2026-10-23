/** A real Java entry point keeps exception formatting inside the Java class library. */
export function prepareJavaExceptionBridge(
	mainClass: string,
	sourceTexts: readonly string[],
	classFiles: readonly string[]
) {
	const packageName = mainClass.slice(0, Math.max(0, mainClass.lastIndexOf('.')));
	const packagePath = packageName ? `${packageName.replaceAll('.', '/')}/` : '';
	const entryClass = mainClass.slice(mainClass.lastIndexOf('.') + 1);
	const sourcePrefix = packageName ? `package ${packageName};\n\n` : '';
	let className = 'WasmIdleJavaEntryPoint';
	while (
		classFiles.some(
			(path) =>
				path === `${packagePath}${className}.class` ||
				path.startsWith(`${packagePath}${className}$`)
		)
	)
		className += '_';
	let formatterClass = 'WasmIdleJavaExceptionBridge';
	while (
		classFiles.some(
			(path) =>
				path === `${packagePath}${formatterClass}.class` ||
				path.startsWith(`${packagePath}${formatterClass}$`)
		)
	)
		formatterClass += '_';
	// Conservatively reserve names even when user identifiers use Java Unicode escapes.
	const decodedSources = sourceTexts.map((source) =>
		source.replace(/\\u+([0-9a-f]{4})/gi, (_, hex: string) =>
			String.fromCharCode(parseInt(hex, 16))
		)
	);
	let formatExport = 'wasmIdleFormatJavaException';
	while (decodedSources.some((source) => source.includes(formatExport))) formatExport += '_';
	return {
		mainClass: packageName ? `${packageName}.${formatterClass}` : formatterClass,
		sourceFileName: `${className}.java`,
		formatterSourceFileName: `${formatterClass}.java`,
		formatExport,
		// No imported types can hide the user entry class, even when it is named String.
		source: `${sourcePrefix}final class ${className} {
    static ${formatterClass}.Program program() {
        return ${entryClass}::main;
    }
}
`,
		formatterSource: `${sourcePrefix}import java.lang.String;
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

final class ${formatterClass} {
    interface Program {
        void run(String[] args) throws Throwable;
    }

    public static void main(String[] args) throws Throwable {
        PrintStream out = System.out;
        PrintStream err = System.err;
        System.setOut(new Output(out));
        System.setErr(new Output(err));
        try {
            ${className}.program().run(args);
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
    public static String ${formatExport}(JSObject error) {
        Throwable exception = JSExceptions.getJavaException(error);
        if (exception == null) return null;
        StringWriter text = new StringWriter();
        exception.printStackTrace(new PrintWriter(text));
        return text.toString();
    }
}
`
	};
}
