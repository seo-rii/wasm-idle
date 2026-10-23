package org.wasmidle.jdtls;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.PrintStream;
import java.lang.reflect.InvocationTargetException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/** Browser platform adapter. All language analysis remains in the selected upstream server. */
public final class BrowserStreams {
    private BrowserStreams() {}

    private static native String readChunk();
    private static native void writeChunk(String chunk, boolean error);
    private static native void reportPhase(String phase);

    public static void copyFile(String source, String target) throws Exception {
        Path destination = Path.of(target);
        Files.createDirectories(destination.getParent());
        Files.copy(Path.of(source), destination, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
    }

    public static void writeFile(String target, String text) throws Exception {
        Path destination = Path.of(target);
        Files.createDirectories(destination.getParent());
        Files.writeString(destination, text, StandardCharsets.UTF_8);
    }

    public static String readFile(String target) throws Exception {
        return Files.readString(Path.of(target), StandardCharsets.UTF_8);
    }

    public static String property(String name) {
        return System.getProperty(name);
    }

    public static String listFiles(String directory) {
        String[] names = new java.io.File(directory).list();
        return names == null ? "" : String.join("\n", names);
    }

    public static String systemCompilerAvailability() throws Exception {
        Class<?> provider = Class.forName("javax.tools.ToolProvider");
        Object compiler = provider.getMethod("getSystemJavaCompiler").invoke(null);
        return compiler == null ? "unavailable" : compiler.getClass().getName();
    }

    public static String compilerAvailability() throws Exception {
        Class<?> javacTool = Class.forName("com.sun.tools.javac.api.JavacTool");
        Object direct = javacTool.getMethod("create").invoke(null);
        java.util.Iterator<?> providers = java.util.ServiceLoader
            .load(Class.forName("javax.tools.JavaCompiler")).iterator();
        if (!providers.hasNext()) return "unavailable";
        Object compiler = providers.next();
        if (!compiler.getClass().getName().equals(direct.getClass().getName())) {
            throw new IllegalStateException("Unexpected JavaCompiler provider: " + compiler.getClass().getName());
        }
        return compiler.getClass().getName();
    }

    public static String platformAvailability() {
        try {
            Path objectClass = java.nio.file.FileSystems.getFileSystem(java.net.URI.create("jrt:/"))
                .getPath("/modules/java.base/java/lang/Object.class");
            return "jrt.java.base.Object=" + Files.exists(objectClass);
        } catch (Throwable error) {
            return error.toString();
        }
    }

    public static void main(String[] args) throws Throwable {
        reportPhase("java-main");
        System.setIn(new InputStream() {
            private byte[] chunk = new byte[0];
            private int cursor;

            private boolean ensureChunk() {
                if (cursor < chunk.length) return true;
                String next = readChunk();
                if (next == null) return false;
                chunk = next.getBytes(StandardCharsets.UTF_8);
                cursor = 0;
                return true;
            }

            @Override public int read() {
                while (ensureChunk()) {
                    if (cursor < chunk.length) return chunk[cursor++] & 255;
                }
                return -1;
            }

            @Override public int read(byte[] output, int offset, int length) {
                if (length == 0) return 0;
                while (ensureChunk()) {
                    int count = Math.min(length, chunk.length - cursor);
                    if (count == 0) continue;
                    System.arraycopy(chunk, cursor, output, offset, count);
                    cursor += count;
                    return count;
                }
                return -1;
            }
        });
        System.setOut(stream(false));
        System.setErr(stream(true));
        reportPhase("launcher-arguments:" + String.join(" ", args));
        reportPhase("java-home:" + System.getProperty("java.home"));
        String mainClass = "org.eclipse.equinox.launcher.Main";
        if (args.length > 0 && args[0].startsWith("--main-class=")) {
            mainClass = args[0].substring("--main-class=".length());
            args = java.util.Arrays.copyOfRange(args, 1, args.length);
            reportPhase("upstream-main:" + mainClass);
        } else reportPhase("equinox-main");
        if (mainClass.equals("org.javacs.Main")) {
            reportPhase("platform:" + platformAvailability());
            reportPhase("system-compiler:" + systemCompilerAvailability());
            String compiler = compilerAvailability();
            reportPhase("compiler:" + compiler);
            if (compiler.equals("unavailable")) {
                throw new IllegalStateException("Original javacs requires a JavaCompiler service provider");
            }
            if (args.length > 0 && args[0].equals("--compiler-check-only")) return;
        }
        try {
            Class.forName(mainClass)
                .getMethod("main", String[].class).invoke(null, (Object) args);
        } catch (InvocationTargetException error) {
            throw error.getCause();
        }
    }

    private static PrintStream stream(boolean error) throws Exception {
        return new PrintStream(new OutputStream() {
            @Override public void write(int value) {
                writeChunk(String.valueOf((char) (value & 255)), error);
            }

            @Override public void write(byte[] bytes, int offset, int length) {
                writeChunk(new String(bytes, offset, length, StandardCharsets.ISO_8859_1), error);
            }
        }, true, StandardCharsets.UTF_8);
    }
}
