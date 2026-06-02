package org.wasmidle.kotlin.teavm;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.jetbrains.kotlin.builtins.DefaultBuiltIns;
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
        return KotlinCompilerProbe.compileWithoutHostJdk(
                sourcePath, outputDir, splitClasspath(classpath));
    }

    @JSExport
    @JSMethod("compileKotlinSourceContent")
    public static boolean compileKotlinSourceContent(String source, String outputDir, String classpathPayload) {
        try {
            String sourcePath = "/workspace/src/Main.kt";
            writeVirtualFile(sourcePath, source.getBytes(StandardCharsets.UTF_8));
            String[] classpath = materializeClasspath(classpathPayload);
            new File(outputDir).mkdirs();
            return KotlinCompilerProbe.compileWithoutHostJdk(sourcePath, outputDir, classpath);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @JSExport
    @JSMethod("describeKotlinCompileFailure")
    public static String describeKotlinCompileFailure(String sourcePath, String outputDir, String classpath) {
        try {
            return KotlinCompilerProbe.compileWithoutHostJdkAndDescribe(
                    sourcePath, outputDir, splitClasspath(classpath));
        } catch (Throwable failure) {
            return describe(failure);
        }
    }

    @JSExport
    @JSMethod("describeKotlinCompileContentFailure")
    public static String describeKotlinCompileContentFailure(String source, String outputDir, String classpathPayload) {
        try {
            String sourcePath = "/workspace/src/Main.kt";
            writeVirtualFile(sourcePath, source.getBytes(StandardCharsets.UTF_8));
            String[] classpath = materializeClasspath(classpathPayload);
            new File(outputDir).mkdirs();
            return KotlinCompilerProbe.compileWithoutHostJdkAndDescribe(sourcePath, outputDir, classpath);
        } catch (Throwable failure) {
            return describe(failure);
        }
    }

    @JSExport
    @JSMethod("listVirtualFiles")
    public static String listVirtualFiles(String rootPath) {
        var result = new StringBuilder();
        appendVirtualFiles(result, new File(rootPath));
        return result.toString();
    }

    @JSExport
    @JSMethod("readVirtualFileBase64")
    public static String readVirtualFileBase64(String path) {
        try {
            return Base64.getEncoder().encodeToString(readVirtualFile(path));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @JSExport
    @JSMethod("builtinsResourceLength")
    public static int builtinsResourceLength(String path) {
        try (InputStream input = KotlinBuiltinsResources.open(path)) {
            if (input == null) {
                return -1;
            }
            int total = 0;
            byte[] buffer = new byte[8192];
            while (true) {
                int read = input.read(buffer);
                if (read < 0) {
                    return total;
                }
                total += read;
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    @JSExport
    @JSMethod("describeDefaultUnitType")
    public static String describeDefaultUnitType() {
        try {
            return String.valueOf(DefaultBuiltIns.getInstance().getUnitType());
        } catch (Throwable failure) {
            return describe(failure);
        }
    }

    private static String[] materializeClasspath(String classpathPayload) throws IOException {
        if (classpathPayload == null || classpathPayload.isEmpty()) {
            return new String[0];
        }
        String[] entries = splitClasspath(classpathPayload);
        String[] paths = new String[entries.length];
        for (int i = 0; i < entries.length; i++) {
            String path = "/workspace/cp/" + i + ".jar";
            writeVirtualFile(path, Base64.getDecoder().decode(entries[i]));
            paths[i] = path;
        }
        return paths;
    }

    private static void writeVirtualFile(String path, byte[] bytes) throws IOException {
        File file = new File(path);
        File parent = file.getParentFile();
        if (parent != null) {
            parent.mkdirs();
        }
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(bytes);
        }
    }

    private static byte[] readVirtualFile(String path) throws IOException {
        try (FileInputStream input = new FileInputStream(path);
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            while (true) {
                int read = input.read(buffer);
                if (read < 0) {
                    return output.toByteArray();
                }
                output.write(buffer, 0, read);
            }
        }
    }

    private static void appendVirtualFiles(StringBuilder result, File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isFile()) {
            if (result.length() > 0) {
                result.append('\n');
            }
            result.append(file.getPath()).append('\t').append(file.length());
            return;
        }
        File[] files = file.listFiles();
        if (files == null) {
            return;
        }
        for (File child : files) {
            appendVirtualFiles(result, child);
        }
    }

    private static String[] splitClasspath(String classpath) {
        if (classpath == null || classpath.isEmpty()) {
            return new String[0];
        }
        int count = 1;
        for (int i = 0; i < classpath.length(); i++) {
            if (classpath.charAt(i) == '\n') {
                count++;
            }
        }
        String[] result = new String[count];
        int start = 0;
        int index = 0;
        for (int i = 0; i < classpath.length(); i++) {
            if (classpath.charAt(i) == '\n') {
                result[index++] = classpath.substring(start, i);
                start = i + 1;
            }
        }
        result[index] = classpath.substring(start);
        return result;
    }

    private static String describe(Throwable failure) {
        StringBuilder result = new StringBuilder();
        appendThrowable(result, failure, "");
        return result.toString();
    }

    private static void appendThrowable(StringBuilder result, Throwable failure, String prefix) {
        String className;
        try {
            className = failure.getClass().getName();
        } catch (Throwable ignored) {
            className = "<unknown>";
        }
        String message;
        try {
            message = failure.getMessage();
        } catch (Throwable ignored) {
            message = "<message unavailable>";
        }
        result.append(prefix).append(className).append(": ").append(message);
        try {
            StackTraceElement[] stack = failure.getStackTrace();
            int limit = Math.min(stack.length, 24);
            for (int i = 0; i < limit; i++) {
                result.append("\n").append(prefix).append("  at ").append(stack[i]);
            }
        } catch (Throwable ignored) {
            result.append("\n").append(prefix).append("  <stack unavailable>");
        }
        try {
            Throwable cause = failure.getCause();
            if (cause != null && cause != failure) {
                result.append("\n").append(prefix).append("Caused by: ");
                appendThrowable(result, cause, prefix + "  ");
            }
        } catch (Throwable ignored) {
            result.append("\n").append(prefix).append("Caused by: <cause unavailable>");
        }
    }
}
