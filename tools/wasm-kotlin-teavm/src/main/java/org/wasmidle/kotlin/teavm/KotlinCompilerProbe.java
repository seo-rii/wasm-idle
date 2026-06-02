package org.wasmidle.kotlin.teavm;

import java.io.File;
import java.util.Collections;
import org.jetbrains.kotlin.cli.common.ExitCode;
import org.jetbrains.kotlin.cli.common.arguments.K2JVMCompilerArguments;
import org.jetbrains.kotlin.cli.common.messages.CompilerMessageSeverity;
import org.jetbrains.kotlin.cli.common.messages.CompilerMessageSourceLocation;
import org.jetbrains.kotlin.cli.common.messages.MessageCollector;
import org.jetbrains.kotlin.cli.jvm.K2JVMCompiler;
import org.jetbrains.kotlin.config.Services;

public final class KotlinCompilerProbe {
    private KotlinCompilerProbe() {
    }

    public static void main(String[] args) {
        ExitCode exitCode = new K2JVMCompiler().exec(System.err, args);
        System.out.println("KOTLIN_EXIT_CODE=" + exitCode.getCode());
    }

    public static boolean compileWithoutHostJdk(
            String sourcePath, String outputDir, String[] classpathEntries) {
        return DirectKotlinCompilerProbe.compileWithoutHostJdk(sourcePath, outputDir, classpathEntries);
    }

    public static String compileWithoutHostJdkAndDescribe(
            String sourcePath, String outputDir, String[] classpathEntries) {
        try {
            return DirectKotlinCompilerProbe.compileWithoutHostJdkAndDescribe(
                    sourcePath, outputDir, classpathEntries);
        } catch (Throwable failure) {
            return describe(failure);
        }
    }

    public static String compileViaCliWithoutHostJdkAndDescribe(
            String sourcePath, String outputDir, String[] classpathEntries) {
        var arguments = new K2JVMCompilerArguments();
        arguments.setNoStdlib(true);
        arguments.setNoReflect(true);
        arguments.setNoJdk(true);
        arguments.setJvmTarget("1.8");
        arguments.setLanguageVersion("1.9");
        arguments.setApiVersion("1.9");
        arguments.setClasspath(joinClasspath(classpathEntries));
        arguments.setDestination(outputDir);
        arguments.setModuleName("main");
        arguments.setIncludeRuntime(false);
        arguments.setCompileJava(false);
        arguments.setUseJavac(false);
        arguments.setUseFastJarFileSystem(false);
        arguments.setFreeArgs(Collections.singletonList(sourcePath));

        var collector = new CapturingMessageCollector();
        var exitCode = new K2JVMCompiler().exec(collector, Services.EMPTY, arguments);
        if (exitCode == ExitCode.OK) {
            return "OK";
        }
        var result = new StringBuilder();
        result.append("exitCode=").append(exitCode.name()).append("(").append(exitCode.getCode()).append(")");
        result.append("\nhasErrors=").append(collector.hasErrors());
        if (collector.messages.length() > 0) {
            result.append("\n").append(collector.messages);
        }
        return result.toString();
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

    private static String joinClasspath(String[] classpathEntries) {
        var joined = new StringBuilder();
        for (var entry : classpathEntries) {
            if (entry == null || entry.isEmpty()) {
                continue;
            }
            if (joined.length() > 0) {
                joined.append(File.pathSeparatorChar);
            }
            joined.append(entry);
        }
        return joined.toString();
    }

    private static final class CapturingMessageCollector implements MessageCollector {
        private boolean hasErrors;
        private final StringBuilder messages = new StringBuilder();

        @Override
        public void clear() {
            hasErrors = false;
            messages.setLength(0);
        }

        @Override
        public void report(CompilerMessageSeverity severity, String message,
                CompilerMessageSourceLocation location) {
            hasErrors |= severity != null && severity.isError();
            if (messages.length() > 0) {
                messages.append('\n');
            }
            messages.append(severity == null ? "<unknown>" : severity.name()).append(": ");
            if (location != null) {
                messages.append(location.getPath()).append(':')
                        .append(location.getLine()).append(':')
                        .append(location.getColumn()).append(": ");
            }
            messages.append(message);
        }

        @Override
        public boolean hasErrors() {
            return hasErrors;
        }
    }
}
