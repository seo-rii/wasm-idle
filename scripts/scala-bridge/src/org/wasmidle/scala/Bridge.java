package org.wasmidle.scala;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public final class Bridge {
    private Bridge() {}

    public static void main(String[] args) {
        Path workDir = resolveWorkDir(args);
        int status = 1;
        try {
            Files.createDirectories(workDir);
            if (args.length == 0) {
                writeText(workDir.resolve("bridge.stderr.txt"), "Missing bridge mode\n");
            } else if ("compile".equals(args[0])) {
                status = compile(args);
            } else if ("run".equals(args[0])) {
                status = run(args);
            } else {
                writeText(workDir.resolve("bridge.stderr.txt"), "Unknown bridge mode: " + args[0] + "\n");
            }
        } catch (Throwable error) {
            writeText(workDir.resolve("bridge.stderr.txt"), stackTrace(error));
        } finally {
            writeText(workDir.resolve("bridge.status.txt"), Integer.toString(status));
        }
    }

    private static Path resolveWorkDir(String[] args) {
        if (args.length > 0 && "compile".equals(args[0]) && args.length > 4) {
            return Paths.get(args[4]);
        }
        if (args.length > 0 && "run".equals(args[0]) && args.length > 5) {
            return Paths.get(args[5]);
        }
        return Paths.get("/files/wasm-idle-scala");
    }

    private static int compile(String[] args) throws Exception {
        if (args.length < 5) {
            writeText(Paths.get("/files/wasm-idle-scala/compile.stderr.txt"), "compile mode requires source, classes, scala library, and work dir\n");
            return 1;
        }

        String sourcePath = args[1];
        Path classesDir = Paths.get(args[2]);
        String scalaLibraryJar = args[3];
        Path workDir = Paths.get(args[4]);
        List<String> extraArgs = Arrays.asList(args).subList(5, args.length);

        Files.createDirectories(classesDir);
        Files.createDirectories(workDir);

        Capture capture = capture(null, new ThrowingRunnable() {
            @Override
            public void run() throws Exception {
                List<String> scalacArgs = new ArrayList<String>();
                scalacArgs.add("-d");
                scalacArgs.add(classesDir.toString());
                scalacArgs.add("-classpath");
                scalacArgs.add(scalaLibraryJar);
                scalacArgs.addAll(extraArgs);
                scalacArgs.add(sourcePath);
                Object result = invokeScalaCompiler(scalacArgs.toArray(new String[0]));
                if (Boolean.FALSE.equals(result)) {
                    throw new CompilerReturnedFalseException();
                }
            }
        });

        writeText(workDir.resolve("compile.stdout.txt"), capture.stdout);
        writeText(workDir.resolve("compile.stderr.txt"), capture.stderr);

        if (capture.error != null) {
            Throwable error = capture.error;
            if (error instanceof CompilerReturnedFalseException) {
                writeText(workDir.resolve("compile.status.txt"), "1");
                return 1;
            }
            writeText(workDir.resolve("compile.stderr.txt"), capture.stderr + stackTrace(error));
            writeText(workDir.resolve("compile.status.txt"), "1");
            return 1;
        }

        List<String> mainClasses = detectMainClasses(classesDir, scalaLibraryJar);
        writeText(workDir.resolve("main-classes.txt"), joinLines(mainClasses));
        if (mainClasses.size() != 1) {
            String message = mainClasses.isEmpty()
                ? "Main method not found\n"
                : "Multiple main methods found: " + joinComma(mainClasses) + "\n";
            writeText(workDir.resolve("compile.stderr.txt"), capture.stderr + message);
            writeText(workDir.resolve("compile.status.txt"), "1");
            return 1;
        }

        writeText(workDir.resolve("main-class.txt"), mainClasses.get(0));
        writeText(workDir.resolve("compile.status.txt"), "0");
        return 0;
    }

    private static Object invokeScalaCompiler(String[] scalacArgs) throws Exception {
        Class<?> mainClass = Class.forName("scala.tools.nsc.Main");
        try {
            Method process = mainClass.getMethod("process", String[].class);
            return process.invoke(null, new Object[] { scalacArgs });
        } catch (NoSuchMethodException ignored) {
            Method main = mainClass.getMethod("main", String[].class);
            main.invoke(null, new Object[] { scalacArgs });
            return Boolean.TRUE;
        } catch (InvocationTargetException error) {
            Throwable target = error.getTargetException();
            if (target instanceof Exception) throw (Exception) target;
            if (target instanceof Error) throw (Error) target;
            throw error;
        }
    }

    private static int run(String[] args) throws Exception {
        if (args.length < 6) {
            writeText(Paths.get("/files/wasm-idle-scala/run.stderr.txt"), "run mode requires classes, main class, scala library, stdin, and work dir\n");
            return 1;
        }

        Path classesDir = Paths.get(args[1]);
        String mainClassName = args[2];
        String scalaLibraryJar = args[3];
        String stdinPath = args[4];
        Path workDir = Paths.get(args[5]);
        String[] programArgs = Arrays.copyOfRange(args, 6, args.length);
        byte[] stdin = stdinPath.length() == 0 ? new byte[0] : Files.readAllBytes(Paths.get(stdinPath));

        Files.createDirectories(workDir);

        Capture capture = capture(stdin, new ThrowingRunnable() {
            @Override
            public void run() throws Exception {
                invokeMain(classesDir, scalaLibraryJar, mainClassName, programArgs);
            }
        });

        writeText(workDir.resolve("run.stdout.txt"), capture.stdout);
        writeText(workDir.resolve("run.stderr.txt"), capture.stderr);

        if (capture.error != null) {
            writeText(workDir.resolve("run.stderr.txt"), capture.stderr + stackTrace(capture.error));
            writeText(workDir.resolve("run.status.txt"), "1");
            return 1;
        }

        writeText(workDir.resolve("run.status.txt"), "0");
        return 0;
    }

    private static void invokeMain(
        Path classesDir,
        String scalaLibraryJar,
        String mainClassName,
        String[] args
    ) throws Exception {
        URL[] urls = new URL[] {
            classesDir.toUri().toURL(),
            Paths.get(scalaLibraryJar).toUri().toURL()
        };
        URLClassLoader loader = new URLClassLoader(urls, Bridge.class.getClassLoader());
        try {
            Class<?> mainClass = Class.forName(mainClassName, true, loader);
            Method main = mainClass.getMethod("main", String[].class);
            int modifiers = main.getModifiers();
            if (!Modifier.isPublic(modifiers) || !Modifier.isStatic(modifiers)) {
                throw new IllegalArgumentException("Main method is not public static: " + mainClassName);
            }
            main.invoke(null, new Object[] { args });
        } catch (InvocationTargetException error) {
            Throwable target = error.getTargetException();
            if (target instanceof Exception) throw (Exception) target;
            if (target instanceof Error) throw (Error) target;
            throw error;
        } finally {
            loader.close();
        }
    }

    private static List<String> detectMainClasses(Path classesDir, String scalaLibraryJar) throws Exception {
        if (!Files.exists(classesDir)) return Collections.emptyList();
        final List<String> classNames = new ArrayList<String>();
        Files.walk(classesDir)
            .filter(Files::isRegularFile)
            .filter(path -> path.toString().endsWith(".class"))
            .forEach(path -> {
                String relative = classesDir.relativize(path).toString();
                if (relative.equals("module-info.class")) return;
                if (relative.contains("$")) return;
                String className = relative
                    .substring(0, relative.length() - ".class".length())
                    .replace(File.separatorChar, '.');
                classNames.add(className);
            });
        Collections.sort(classNames);

        URL[] urls = new URL[] {
            classesDir.toUri().toURL(),
            Paths.get(scalaLibraryJar).toUri().toURL()
        };
        URLClassLoader loader = new URLClassLoader(urls, Bridge.class.getClassLoader());
        try {
            List<String> mainClasses = new ArrayList<String>();
            for (String className : classNames) {
                try {
                    Class<?> candidate = Class.forName(className, false, loader);
                    Method main = candidate.getMethod("main", String[].class);
                    int modifiers = main.getModifiers();
                    if (
                        Modifier.isPublic(modifiers) &&
                        Modifier.isStatic(modifiers) &&
                        Void.TYPE.equals(main.getReturnType())
                    ) {
                        mainClasses.add(className);
                    }
                } catch (ClassNotFoundException ignored) {
                } catch (NoClassDefFoundError ignored) {
                } catch (NoSuchMethodException ignored) {
                }
            }
            mainClasses.sort(Comparator.naturalOrder());
            return mainClasses;
        } finally {
            loader.close();
        }
    }

    private static Capture capture(byte[] stdin, ThrowingRunnable runnable) {
        PrintStream previousOut = System.out;
        PrintStream previousErr = System.err;
        java.io.InputStream previousIn = System.in;
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        Throwable error = null;

        try {
            System.setOut(new PrintStream(stdout, true, "UTF-8"));
            System.setErr(new PrintStream(stderr, true, "UTF-8"));
            if (stdin != null) {
                System.setIn(new ByteArrayInputStream(stdin));
            }
            runnable.run();
        } catch (Throwable nextError) {
            error = nextError;
        } finally {
            System.setOut(previousOut);
            System.setErr(previousErr);
            System.setIn(previousIn);
        }

        return new Capture(
            new String(stdout.toByteArray(), StandardCharsets.UTF_8),
            new String(stderr.toByteArray(), StandardCharsets.UTF_8),
            error
        );
    }

    private static void writeText(Path path, String content) {
        try {
            Path parent = path.getParent();
            if (parent != null) Files.createDirectories(parent);
            Files.write(path, content.getBytes(StandardCharsets.UTF_8));
        } catch (Exception ignored) {
        }
    }

    private static String stackTrace(Throwable error) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        PrintWriter writer = new PrintWriter(bytes);
        error.printStackTrace(writer);
        writer.flush();
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String joinLines(List<String> values) {
        StringBuilder builder = new StringBuilder();
        for (String value : values) {
            builder.append(value).append('\n');
        }
        return builder.toString();
    }

    private static String joinComma(List<String> values) {
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) builder.append(", ");
            builder.append(values.get(i));
        }
        return builder.toString();
    }

    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    private static final class Capture {
        final String stdout;
        final String stderr;
        final Throwable error;

        Capture(String stdout, String stderr, Throwable error) {
            this.stdout = stdout;
            this.stderr = stderr;
            this.error = error;
        }
    }

    private static final class CompilerReturnedFalseException extends RuntimeException {
        private static final long serialVersionUID = 1L;
    }
}
