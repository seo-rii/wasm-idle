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
import org.teavm.jso.JSExport;
import org.teavm.jso.JSObject;
import org.teavm.jso.JSExceptions;

final class ${formatterClass} {
    interface Program {
        void run(String[] args) throws Throwable;
    }

    public static void main(String[] args) throws Throwable {
        ${className}.program().run(args);
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
