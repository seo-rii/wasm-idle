package org.wasmidle.kotlin.teavm;

import org.teavm.interop.Export;

public final class BrowserKotlinCompilerProbe {
    private BrowserKotlinCompilerProbe() {
    }

    public static void main(String[] args) {
        // Keep the compiler path reachable for TeaVM analysis while this is still a probe.
        if (args.length == 42) {
            compileKotlinSource("", "", "");
        }
    }

    @Export(name = "compileKotlinSource")
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
