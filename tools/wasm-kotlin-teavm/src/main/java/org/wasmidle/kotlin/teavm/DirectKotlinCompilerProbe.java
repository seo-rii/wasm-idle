package org.wasmidle.kotlin.teavm;

import com.intellij.openapi.Disposable;
import com.intellij.openapi.util.Disposer;
import java.io.File;
import java.util.Arrays;
import org.jetbrains.kotlin.cli.common.CLIConfigurationKeys;
import org.jetbrains.kotlin.cli.common.config.KotlinSourceRoot;
import org.jetbrains.kotlin.cli.common.messages.MessageCollector;
import org.jetbrains.kotlin.cli.common.messages.MessageRenderer;
import org.jetbrains.kotlin.cli.common.messages.PrintingMessageCollector;
import org.jetbrains.kotlin.cli.jvm.compiler.EnvironmentConfigFiles;
import org.jetbrains.kotlin.cli.jvm.compiler.KotlinCoreEnvironment;
import org.jetbrains.kotlin.cli.jvm.compiler.KotlinToJVMBytecodeCompiler;
import org.jetbrains.kotlin.cli.jvm.config.JvmContentRootsKt;
import org.jetbrains.kotlin.config.CommonConfigurationKeys;
import org.jetbrains.kotlin.config.CompilerConfiguration;
import org.jetbrains.kotlin.config.JVMConfigurationKeys;
import org.jetbrains.kotlin.config.JvmTarget;
import org.jetbrains.kotlin.config.LanguageVersionSettingsImpl;

public final class DirectKotlinCompilerProbe {
    private DirectKotlinCompilerProbe() {
    }

    public static void main(String[] args) {
        if (args.length < 2) {
            throw new IllegalArgumentException(
                    "Usage: DirectKotlinCompilerProbe <source.kt> <output-dir> [classpath...]");
        }
        var classpath = Arrays.copyOfRange(args, 2, args.length);
        var ok = compile(args[0], args[1], classpath);
        System.out.println("KOTLIN_DIRECT_COMPILE=" + ok);
        if (!ok) {
            throw new IllegalStateException("Kotlin direct compile failed");
        }
    }

    public static boolean compile(String sourcePath, String outputDir, String[] classpathEntries) {
        var configuration = createBaseConfiguration(sourcePath, outputDir, classpathEntries);
        configuration.put(JVMConfigurationKeys.JDK_HOME, new File(System.getProperty("java.home")));
        JvmContentRootsKt.configureJdkClasspathRoots(configuration);
        return compileConfigured(configuration);
    }

    public static boolean compileWithoutHostJdk(
            String sourcePath, String outputDir, String[] classpathEntries) {
        var configuration = createBaseConfiguration(sourcePath, outputDir, classpathEntries);
        configuration.put(JVMConfigurationKeys.NO_JDK, Boolean.TRUE);
        return compileConfigured(configuration);
    }

    private static CompilerConfiguration createBaseConfiguration(
            String sourcePath, String outputDir, String[] classpathEntries) {
        var configuration = new CompilerConfiguration();
        MessageCollector collector = new PrintingMessageCollector(
                System.err, MessageRenderer.PLAIN_FULL_PATHS, false);

        configuration.put(CommonConfigurationKeys.MODULE_NAME, "main");
        configuration.put(CommonConfigurationKeys.LANGUAGE_VERSION_SETTINGS,
                LanguageVersionSettingsImpl.DEFAULT);
        configuration.put(CommonConfigurationKeys.MESSAGE_COLLECTOR_KEY, collector);
        configuration.put(CommonConfigurationKeys.PARALLEL_BACKEND_THREADS, 1);
        configuration.put(CLIConfigurationKeys.MESSAGE_COLLECTOR_KEY, collector);
        configuration.put(JVMConfigurationKeys.OUTPUT_DIRECTORY, new File(outputDir));
        configuration.put(JVMConfigurationKeys.JVM_TARGET, JvmTarget.JVM_1_8);
        configuration.put(JVMConfigurationKeys.NO_REFLECT, Boolean.TRUE);
        configuration.put(JVMConfigurationKeys.INCLUDE_RUNTIME, Boolean.FALSE);
        configuration.put(JVMConfigurationKeys.USE_JAVAC, Boolean.FALSE);
        configuration.put(JVMConfigurationKeys.COMPILE_JAVA, Boolean.FALSE);
        configuration.add(CLIConfigurationKeys.CONTENT_ROOTS,
                new KotlinSourceRoot(sourcePath, false, null));

        for (var classpathEntry : classpathEntries) {
            JvmContentRootsKt.addJvmClasspathRoot(configuration, new File(classpathEntry));
        }
        return configuration;
    }

    private static boolean compileConfigured(CompilerConfiguration configuration) {
        MessageCollector collector = configuration.get(CommonConfigurationKeys.MESSAGE_COLLECTOR_KEY);
        Disposable rootDisposable = Disposer.newDisposable("wasm-idle-kotlin-direct-probe");
        try {
            var environment = KotlinCoreEnvironment.Companion.createForProduction(
                    rootDisposable, configuration, EnvironmentConfigFiles.JVM_CONFIG_FILES);
            return KotlinToJVMBytecodeCompiler.INSTANCE.compileBunchOfSources(environment)
                    && !collector.hasErrors();
        } finally {
            Disposer.dispose(rootDisposable);
        }
    }
}
