package org.wasmidle.kotlin.teavm;

import org.teavm.jso.JSExport;
import org.teavm.jso.JSMethod;

public final class BrowserKotlinCompilerProbe {
    private BrowserKotlinCompilerProbe() {
    }

    public static void main(String[] args) {
        // The browser API is exposed through JSO exports; loading the module should not compile.
    }

    @JSExport
    @JSMethod("compileKotlinSource")
    public static boolean compileKotlinSource(String sourcePath, String outputDir, String classpath) {
        return DirectKotlinCompilerProbe.compileWithoutHostJdk(
                sourcePath, outputDir, splitClasspath(classpath));
    }

    private static String[] splitClasspath(String classpath) {
        if (classpath == null || classpath.isEmpty()) {
            return new String[0];
        }
        return classpath.split("\n");
    }
}
